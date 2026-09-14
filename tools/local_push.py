# -*- coding: utf-8 -*-
"""《辩弈》本机直推：把 demo/ 打包并 POST 到实例上的一次性接收器（tools/deploy_recv.py）。

配合关系：
    实例侧   RECV_TOKEN=<token> bash /opt/bianyi/rs.sh   → 停游戏、起接收器
    本机侧   python tools/local_push.py <token>          → 打包并推送
    实例侧   bash /opt/bianyi/rs.sh                      → 收完退出后把游戏拉起来

用法：
    python tools/local_push.py <token>              # 全量推送 demo/
    python tools/local_push.py <token> --only demo/server.py demo/static/app.js
"""
import hashlib
import io
import json
import os
import sys
import tarfile
import urllib.error
import urllib.request

HOST = os.environ.get("AIDEBATE_HOST", "http://211.159.177.250:8787")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG_ROOT = "demo"          # 包内顶层目录名（相对仓库根）
IGNORE_DIRS = {"__pycache__", ".git", "node_modules"}
# 与服务端 KEEP 保持一致：环境专属配置与玩家运行时状态不进包
EXCLUDE = {
    "config.json",
    "data/accounts.json",
    "data/npc_state.json",
    "data/progress.json",
    "data/feedback.jsonl",
}


def build_tar(only=None):
    """打包 demo/。only 给相对仓库根的路径列表时只打这些文件。"""
    buf = io.BytesIO()
    names = []
    root = os.path.join(REPO, PKG_ROOT)
    with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=6) as tar:
        if only:
            for rel_repo in only:
                rel_repo = rel_repo.replace("\\", "/")
                if not rel_repo.startswith(PKG_ROOT + "/"):
                    print("  跳过（不在 demo/ 下）:", rel_repo)
                    continue
                rel = rel_repo[len(PKG_ROOT) + 1:]
                if rel in EXCLUDE:
                    print("  跳过（运行时状态）:", rel_repo)
                    continue
                full = os.path.join(REPO, rel_repo)
                if not os.path.isfile(full):
                    print("  跳过（文件不存在）:", rel_repo)
                    continue
                tar.add(full, arcname=rel_repo)
                names.append(rel_repo)
        else:
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
                for fname in filenames:
                    full = os.path.join(dirpath, fname)
                    rel = os.path.relpath(full, root).replace("\\", "/")
                    if rel in EXCLUDE:
                        continue
                    tar.add(full, arcname=PKG_ROOT + "/" + rel)
                    names.append(PKG_ROOT + "/" + rel)
    return buf.getvalue(), names


def push(blob, token, timeout=900):
    req = urllib.request.Request(
        HOST + "/",
        data=blob,
        headers={"Content-Type": "application/gzip", "X-Deploy-Token": token},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", "replace")


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    token = args[0]
    only = None
    if "--only" in args:
        idx = args.index("--only")
        only = args[idx + 1:]

    blob, names = build_tar(only)
    digest = hashlib.sha256(blob).hexdigest()
    print("打包完成：%d 个文件，%.1f KB" % (len(names), len(blob) / 1024.0))
    print("sha256:", digest[:16])
    print("推送到:", HOST)

    try:
        status, body = push(blob, token)
    except urllib.error.HTTPError as exc:
        print("HTTP 失败:", exc.code, exc.read().decode("utf-8", "replace")[:300])
        return 1
    except Exception as exc:
        print("推送异常:", repr(exc)[:300])
        return 1

    print("HTTP", status, "|", body)
    try:
        info = json.loads(body)
        return 0 if info.get("ok") else 1
    except Exception:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
