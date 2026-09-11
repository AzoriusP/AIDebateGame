# 部署 + 云端 LLM 切换 Runbook · 2026-09-10 03:42

> 主理人：游承峰 | 依据：腾讯云 Lighthouse 免费试用政策（已 WebSearch 核实）+ 本地代码状态审计
> 状态：方案就绪，待大王或并行会话手动执行（需云 API key + 腾讯云控制台凭证）

---

## 0. 一句话总结

**30 天免费云能用，但只能当"加分项"**——视频才是不会失效的主交付。需要做的三件事：

1. 腾讯云控制台开 8787 端口 + 上传代码 + 立绘
2. 改 `config.json` 切云端 LLM（**需要云 API key**，本地没有）
3. assets 懒加载（28MB → ≤2MB 首屏）

---

## 1. 关键约束（已核实，不是猜测）

| 约束 | 数值 | 影响 |
|---|---|---|
| 包月时长 | **1 个月**（试用） | 9/15 提交 → 10 月中失效 |
| 备案要求 | **需包月 ≥3 个月** | **80/443 全废**，只能 `IP:8787` |
| 配置 | 2核2G / 40G SSD | 跑 Python 后端 OK，**跑不动 ollama 9.7B** |
| 带宽 | **3Mbps = 375KB/s** | 28MB assets → **首屏 75 秒**（必须懒加载） |
| 流量 | 200G/月 | 100 次访问 × 5MB ≈ 500MB，**足够** |

---

## 2. 实例创建（控制台手动，5 分钟）

- 入口：腾讯云 → 轻量应用服务器 → 免费试用 → 立即领取
- 地域：上海 / 广州 / 北京（任选）
- 镜像：Ubuntu 22.04（推荐） / CentOS 7 / 宝塔面板（新手友好）
- 创建后**立即**：重置 root 密码 → 记录**公网 IP**（待会儿填到 demo URL）

---

## 3. 安全组开 8787 端口（1 分钟）

控制台 → 防火墙 → 添加规则：
```
协议：TCP
端口：8787
来源：0.0.0.0/0
备注：aidebate-demo
```

**不要开 80/443**——境内未备案会直接拦。

---

## 4. 代码 + assets 同步（10 分钟）

`.gitignore` 排除 `demo/static/assets/`，**git pull 没有立绘**。两条路径：

### A. 打包上传（最稳）
本机（Git Bash / PowerShell 都行）：
```bash
cd /g/WBSpace/AIDebate
tar -czf /tmp/aidebate.tar.gz \
  --exclude='demo/static/assets/acting-v2' \
  --exclude='demo/static/assets/live2d' \
  --exclude='demo/static/assets/npc_t*.png' \
  --exclude='demo/static/assets/player.png' \
  --exclude='demo/static/assets/parts' \
  --exclude='demo/data/tts_cache' \
  --exclude='demo/static/__probe*.html' \
  --exclude='demo/static/__perf-smoke.html' \
  --exclude='design/live2d/pipeline-proof' \
  --exclude='_t.webp' \
  demo/ docs/submission-tech-readiness.md docs/submission-gap-master-list.md
```

上传到云：
```bash
scp /tmp/aidebate.tar.gz root@<IP>:/opt/aidebate.tar.gz
scp -r /g/WBSpace/AIDebate/demo/static/assets/portrait root@<IP>:/tmp/portrait
scp -r /g/WBSpace/AIDebate/demo/static/assets/live2d/male-master root@<IP>:/tmp/male-master
```

服务端：
```bash
mkdir -p /opt/aidebate && cd /opt/aidebate && tar -xzf /opt/aidebate.tar.gz
mkdir -p demo/static/assets
mv /tmp/portrait demo/static/assets/
mv /tmp/male-master demo/static/assets/live2d/
```

> **为什么 actor/live2d/parts 排除？** 28MB 中大头是 acting-v2(12M) + npc_t*.png(9.8M) + player.png + parts/。首屏只需要 portrait/(788K)。其他按需加载。

### B. 懒加载改造（推荐**今晚/明天**一并做）
对 `index.html` / `app.js` 改造：首屏只挂 `portrait/{id}/calm.webp`，异议/换 NPC 才拉 `acting-v2/` 与 Live2D 模型。

---

## 5. 启动服务（30 秒）

```bash
cd /opt/aidebate/demo
nohup python3 server.py > /var/log/aidebate.log 2>&1 &
curl -I http://localhost:8787/  # 应返回 200
```

**Python 依赖**：项目零依赖（标准库）。但 Ubuntu 默认 Python 3.10+，需要 `python3` 命令；如果只有 `python` 改名或建链接。

---

## 6. 云端 LLM 切换（必做，否则白屏）

### 6.1 填 key
编辑 `/opt/aidebate/demo/config.json`：
```json
{
  "llm_mode": "openai",
  "openai_base": "https://open.bigmodel.cn/api/v1",
  "openai_api_key": "<你的GLM-4-Flash key>",
  "openai_model": "glm-4-flash",
  "judge_timeout_s": 30,
  "npc_timeout_s": 30
}
```

### 6.2 候选服务商对比（中文辩论）

| 服务 | 模型 | 成本/千 token | 单局成本 | 评测期 50 次 | 备注 |
|---|---|---|---|---|---|
| 智谱 GLM-4-Flash | 推荐 | ~0.0001 元 | ~0.03 元 | ~1.5 元 | 便宜够用 |
| 腾讯混元 Hy3 | 备选 | 领免费额度 | ~0 | ~0 | 需腾讯云开通 |
| OpenAI gpt-4o-mini | 最稳 | ~0.0003 美元 | ~0.4 元 | ~20 元 | 海外卡 |

### 6.3 降级链（已部分实现，需复核）
`server.py` 的 `/api/message` 应当有：
```
1. 首选云端 API（30s 超时）
2. → 失败降级 mock（关键词匹配）
3. → 失败前端弹"网络抽风"提示，不要静默落 mock（静默会让评委以为游戏坏了）
```

### 6.4 超时收敛
180s 太长，**改为 30s**。前端需要在 30s 内显示"AI 思考中"loading 状态。

---

## 7. 30 分钟内容可达性 ✅ 已无需修

**已核实**：`_can_access_tier`（server.py L1295-1305）在 `player_mode=account` 时 **直接 return True**（L1299），全 5 层天梯对注册账号无限制。

**做法**：
1. 准备一个**专用评委账号**（邮箱+密码，免验证码注册，L319-328 路径）
2. 在 PPT / 介绍文案 / 视频说明里给出"评委请用此账号登录"
3. 不需要修 `highest_cleared`（仅限制游客）

---

## 8. 兜底

- **录屏**（P0 视频，3 分钟）：本地录制（见 `outputs/ui-check-lobby*.png` 状态、acting-v2 异议）
- **zip 包**（P1）：`start.bat`（已有）+ `demo/` 目录打成 zip，让评委在 Windows 双击即可本地起服

---

## 9. 提交前验证清单（9/14 必走）

- [ ] 评委账号能注册登录
- [ ] 天梯 L1-L5 全部可玩
- [ ] 单回合 LLM 响应 < 30 秒
- [ ] assets 首屏 < 5 秒（懒加载生效）
- [ ] 录屏文件 < 500MB / 1080p / 60fps
- [ ] 视频反证页（mock 模式对比）清晰
- [ ] 飞书/PPT 介绍页无错别字

---

## 10. 当前阻塞清单（标红）

1. **❗ 云 API key 缺失**（`openai_api_key` 为空）—— 需大王去智谱/腾讯控制台领
2. **❗ 腾讯云实例未创建** —— 需大王控制台点 5 次
3. ⚠ assets 懒加载未做（建议大王醒来直接做，影响首屏体验）

---

## 附录 A：.gitignore 排除清单（要单独传的文件）

```
demo/static/assets/
├── portrait/      ← 788K，必须传（首屏立绘）
├── live2d/male-master/  ← 1.8M 贴图 + 60K 模型，玩家用
├── live2d/male-acting/  ← 4.3M，按需（异议时）
├── acting-v2/     ← 12M，**排除**（按需加载）
├── npc_t1~t5.png  ← 9.8M 遗留原图，**排除**（已有 webp）
├── player.png     ← 1.4M 遗留原图，**排除**（已有 webp）
└── parts/         ← 376K 玩家部件，**排除**（已砍捏人）
```

## 附录 B：相关文档

| 文件 | 用途 |
|---|---|
| `docs/submission-tech-readiness.md` | 完整技术评估（部署/LLM/门禁/稳定性） |
| `docs/submission-gap-master-list.md` | 9/15 提交缺口总清单（含 4 项拍板 + A6 浅底补偿） |
| `design/art-submission-sprint.md` | 美术冲刺方案（含 MDA 20 张 + 视频优先附录 B） |
| `design/submission-package-plan.md` | PPT/介绍文案/视频脚本 |
| `outputs/ui-diagnosis-report.md` | UI 修复对比报告（标题重影+卡片双层+A6） |