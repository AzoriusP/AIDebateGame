# -*- coding: utf-8 -*-
"""《辩弈》本机直推部署接收器（实例侧，一次性运行）。

为什么需要它：仓库转为 private 后，实例再无法用匿名方式拉 GitHub。
改为「本机打包 → 直接 POST 到实例」的部署通道，实例侧不需要任何 GitHub 凭据。

启动（由部署流程自动完成，一般不用手敲）：
    DEPLOY_TOKEN=<一次性随机串> python3 tools/deploy_recv.py

本机发送：
    POST http://<ip>:8787/        header: X-Deploy-Token: <同一个串>
    body: tar.gz（包内路径相对仓库根，例如 demo/server.py）

行为：落盘 → 校验一次性令牌 → 逐文件覆盖到目标目录 → 保留 config 与运行时状态 → 应答 → 退出。

安全设计：
  1. 令牌由环境变量注入、每次部署随机生成、用完即弃 —— 不落盘、不写日志、无长期凭据。
  2. 未设置 DEPLOY_TOKEN 时拒绝启动（fail-closed），避免裸奔的接收器留在公网。
  3. 只接受一次请求（handle_request），收到即退出，端口占用窗口只有几十秒。
  4. 白名单覆盖：只写包里带的文件；config.json 与玩家运行时数据永不覆盖。
"""
import hashlib
import http.server
import json
import os
import shutil
import tarfile
import traceback

PORT = int(os.environ.get("DEPLOY_PORT", "8787"))
TARGET = os.environ.get("DEPLOY_TARGET", "/opt/bianyi/demo")
TOKEN = os.environ.get("DEPLOY_TOKEN", "").strip()
TGZ = "/tmp/deploy_in.tgz"
WORK = "/tmp/deploy_unpacked"

# 这些文件属于「服务器运行时状态 / 环境专属配置」，部署时绝不覆盖：
#   config.json        —— 含本机 LLM / SMTP 配置
#   data/accounts.json —— 玩家账号
#   data/npc_state.json—— NPC 状态与长期记忆
#   data/progress.json —— 玩家进度
#   data/feedback.jsonl—— 玩家反馈（append-only 日志）
KEEP = {
    "config.json",
    "data/accounts.json",
    "data/npc_state.json",
    "data/progress.json",
    "data/feedback.jsonl",
}


def _norm(p):
    return os.path.normpath(p).replace("\\", "/")


def apply_package():
    """把包内文件逐文件覆盖到 TARGET，返回 (ok, 说明)。只写包内存在的文件，不删任何东西。"""
    if not os.path.exists(TGZ):
        return False, "no package file"
    size = os.path.getsize(TGZ)
    if size < 100:
        return False, "package too small: %d bytes" % size

    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK)
    try:
        tarfile.open(TGZ).extractall(WORK)
    except Exception as exc:
        return False, "untar failed: %s" % str(exc)[:200]

    # 包内可能是「仓库根布局」(demo/...) 也可能是「demo 布局」(server.py ...)
    src = WORK
    if os.path.isdir(os.path.join(WORK, "demo")) and not os.path.exists(os.path.join(WORK, "server.py")):
        src = os.path.join(WORK, "demo")

    copied = 0
    skipped = []
    for dirpath, _dirnames, filenames in os.walk(src):
        rel_dir = os.path.relpath(dirpath, src)
        for fname in filenames:
            rel = _norm(fname if rel_dir == "." else os.path.join(rel_dir, fname))
            if rel in KEEP:
                skipped.append(rel)
                continue
            dst = os.path.join(TARGET, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(dirpath, fname), dst)
            copied += 1

    shutil.rmtree(WORK, ignore_errors=True)
    return True, "copied=%d skipped=%s" % (copied, ",".join(sorted(skipped)) or "none")


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "AIDebateDeploy/1.0"

    def do_POST(self):
        given = (self.headers.get("X-Deploy-Token") or "").strip()
        if not TOKEN or given != TOKEN:
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"forbidden")
            print("[deploy] token mismatch, refused", flush=True)
            self.server.done = True
            return

        length = int(self.headers.get("Content-Length") or 0)
        received = 0
        with open(TGZ, "wb") as fh:
            while received < length:
                chunk = self.rfile.read(min(65536, length - received))
                if not chunk:
                    break
                fh.write(chunk)
                received += len(chunk)

        digest = hashlib.sha256(open(TGZ, "rb").read()).hexdigest()[:16]
        print("[deploy] received bytes=%d sha256=%s" % (received, digest), flush=True)

        ok, detail = apply_package()
        print("[deploy] apply ok=%s %s" % (ok, detail), flush=True)

        payload = json.dumps({"ok": ok, "detail": detail, "bytes": received,
                              "sha256": digest}, ensure_ascii=False).encode("utf-8")
        self.send_response(200 if ok else 500)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
        self.server.done = True

    def do_GET(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


def main():
    if not TOKEN:
        raise SystemExit("DEPLOY_TOKEN 未设置 —— 拒绝启动裸接收器（fail-closed）。")
    if not os.path.isdir(TARGET):
        raise SystemExit("目标目录不存在：%s" % TARGET)

    srv = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    srv.done = False
    srv.timeout = int(os.environ.get("DEPLOY_WAIT_S", "600"))
    print("[deploy] ready on :%d -> %s (wait<=%ds)" % (PORT, TARGET, srv.timeout), flush=True)
    try:
        srv.handle_request()
    except KeyboardInterrupt:
        pass
    srv.server_close()
    print("[deploy] exit (done=%s)" % srv.done, flush=True)


if __name__ == "__main__":
    main()
