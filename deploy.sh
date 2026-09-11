#!/bin/bash
# 抬杠模拟器 · 一键更新部署脚本（实例侧）
# 作用：从 GitHub 拉取 main 分支最新代码+美术资源，保留 HY4 密钥配置，重启服务
# 用法：bash /opt/bianyi/deploy.sh
# 重要：仓库不包含 config.json（只有 config.example.json，HY4 密钥不进库）。
#       合并逻辑 = 以 config.example.json 为基底 + 用旧实例 config.json 覆盖 6 个 HY4 相关键，
#       避免裸 json.load 新 demo 的 config.json（不存在会丢密钥/生成残缺配置）。
set -u
D=/opt/bianyi/demo
URL="https://github.com/AzoriusP/AIDebateGame/archive/refs/heads/main.tar.gz"

echo "[1/5] pull"; curl -sL "$URL" -o /tmp/g.tgz
SZ=$(stat -c%s /tmp/g.tgz 2>/dev/null||echo 0)
[ "$SZ" -lt 10000 ] && { echo "FAIL tarball=$SZ (仓库可能为空或网络异常)"; exit 1; }
echo "tarball=$SZ"

echo "[2/5] extract"; rm -rf /tmp/gd; mkdir -p /tmp/gd; tar xzf /tmp/g.tgz -C /tmp/gd
SRC=$(ls -d /tmp/gd/*/|head -1); [ -d "${SRC}demo" ] && SRC="${SRC}demo"
echo "SRC=$SRC"
[ -f "${SRC}/server.py" ] || { echo "NO server.py abort"; exit 1; }

echo "[3/5] backup key"; cp "$D/config.json" /tmp/oc.json 2>/dev/null||true
mv "$D" "${D}_old_$(date +%s)" 2>/dev/null||true; mv "$SRC" "$D"
if [ -f /tmp/oc.json ]; then
python3 - <<'PY'
import json,os
B="/tmp/oc.json";D="/opt/bianyi/demo"
T=os.path.join(D,"config.json");E=os.path.join(D,"config.example.json")
o=json.load(open(B))
# 策略：新版本模板兜底缺字段，实例侧旧配置全量覆盖（含 llm_endpoints / judge_endpoints / 密钥 / 超时）。
# 旧写法按 6 个固定键白名单合并，新增字段会被静默丢弃 → 已废弃。
n=json.load(open(E)) if os.path.exists(E) else {}
n.update(o)
json.dump(n,open(T,"w"),ensure_ascii=False,indent=2)
print("merged keys=",len(n),"endpoints=",len(n.get("llm_endpoints") or []))
PY
else
echo "WARN no /tmp/oc.json backup"
fi

echo "[4/5] restart"; pkill -f recv.py 2>/dev/null; pkill -f "server.py" 2>/dev/null; sleep 2
cd "$D" && setsid python3 server.py >/tmp/bianyi.log 2>&1 < /dev/null &
sleep 3

echo "[5/5] config check"; ls -la "$D/config.json" 2>/dev/null||echo "WARN no config.json"
echo DONE
