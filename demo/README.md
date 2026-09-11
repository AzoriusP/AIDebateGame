# 《抬杠模拟器》DEMO（v2：天梯系列赛 + 自由切磋）

AI 原生辩论游戏。用文字说服 AI NPC，把 TA 的「自信度」说到归零即赢；token 用尽则败。

**天梯**：和同一对手三局两胜（每局换题），TA 会记住你的打法；**自由切磋**：任意对手、记忆可开关、六维会随交流成长。

## 快速开始

1. 确保 **Ollama 已运行**，且已拉取模型（默认 `qwen3.5:latest`）
2. 双击 **`start.bat`**（或命令行 `python server.py`）
3. 浏览器打开 **http://localhost:8787**，从主界面选「天梯赛」或「自由切磋」

## 配置（config.json）

| 字段 | 说明 |
|---|---|
| `llm_mode` | `ollama`（本地）/ `openai`（云端 API）/ `mock`（规则模拟，无需模型） |
| `ollama_base` | Ollama 地址，默认 `http://localhost:11434` |
| `model` | 本地模型名，默认 `qwen3.5:latest` |
| `llm_opening` | 开局开场白是否用 LLM 现场生成。默认 `false` = 本地模板秒开（0 延迟，推荐）；置 `true` 则开局同步等一次 LLM 推理（会更慢，仅在已预热模型/云端 API 时建议） |
| `keep_alive` | Ollama 模型常驻时长，默认 `30m`。防止每局反复把模型 load 进显存（冷加载是开局卡顿主因） |
| `openai_base` / `openai_api_key` / `openai_model` | 云端 API 配置（OpenAI 兼容通用） |
| `tts.enabled` | 语音总开关。`false` = 关闭且前端隐藏 🔊（kill switch，代码保留）。**当前默认 `false`**：edge-tts 免费神经音听感不达标，暂下线，等换成云端语音大模型再开 |
| `tts` 恢复方式 | 把 `enabled` 改回 `true` 并**重启后端**即可（前端无需改动） |
| `tts.mode` | `edge`（默认）：微软 Edge 神经音，免费走社区接口（无 SLA，demo/试玩够用）。换云端语音大模型时新增 provider 分支 + 改这里 |
| `tts.voices` | NPC 音色表（`npc_id` → 音色）。5 个 NPC 已按人设预分配；**听感不合适直接改这里换音色，不用改代码** |

**语音（TTS）依赖**：`mode=edge` 需要先 `pip install edge-tts`（可选依赖，没装则语音自动降级关闭）。台词有磁盘缓存（`data/tts_cache/`），同句只对外合成一次。

**切云端 API**：`llm_mode` 改 `openai` 并填 endpoint/key/model。**无模型调试**：`llm_mode` 改 `mock`。

## 玩法

- **双模式**：天梯（三局两胜系列赛，NPC 必带记忆，**逐级解锁——战胜本层才解锁下一层**）/ 自由（任意对手，记忆开关）
- **NPC 记忆与成长**：每局结束 NPC 记住你的打法并微调六维（越打越懂你）；数据存 `data/npc_state.json`，主界面可一键重置
- **立场按 NPC 人设分配**：每局先看命题，NPC 站 TA 人设天然支持/反对的一边（与人设无关的题才随机），你自动站对面。界面先亮双方立场再开辩
- **六维雷达图** = NPC 人格（逻辑/证据/情感/利益/认同/权威），值 ≤4 是薄弱点；软肋会漂移（被打上浮、冷落下沉），需持续读图换维度
- **命中薄弱点** → 自信度大降 + 玩家金「异议」；**命中强项** → 被反驳 + NPC 红「异议」
- **双资源**：token + 8 分钟倒计时（归零即结束）
- **胜负**：自信度→0 胜；token/超时/超回合败。胜败都出「克制版复盘」（只评表达，不喂数值攻略）
- **语音**：NPC 服务端神经音（edge-tts，按人设分音色），🔊 可静音；语音异常/关闭时入口自动隐藏，不影响游玩；💡 提示可在卡壳时问教练

## 内容工具（tools/）

```bash
python tools/sync_csv.py export   # npcs/topics JSON → CSV（Excel 编辑）
python tools/sync_csv.py import   # CSV → JSON（改完导回，重启后端生效）
python tools/gen_npcs.py --tier 2 --n 3   # LLM 批量生成 NPC 候选 → data/npc_candidates.json
```

## 目录结构

```
demo/
├── server.py            # 单文件后端：Session/Judge/NPC/Settlement/漂移/记忆成长/复盘/提示/反注入
├── config.json          # 配置（本地/云端/模拟）
├── start.bat            # 双击启动
├── playtest.py          # 数值推演脚本（纯数值，可重跑校准）
├── tools/               # sync_csv.py（表格化）/ gen_npcs.py（AI 批量生成 NPC）
├── data/
│   ├── npcs.json        # NPC 库（5 个，六维/人设/薄弱点）
│   ├── topics.json      # 题库（50 命题，5 层）
│   ├── npcs.csv / topics.csv   # 表格版（Excel 编辑层，export 生成）
│   ├── npc_candidates.json     # AI 生成的 NPC 候选（待审核）
│   └── npc_state.json          # NPC 记忆与成长存档（运行时生成，可重置）
└── static/
    ├── index.html / style.css / app.js   # 前端（模式/系列赛/自由）
    └── assets/          # AI 生成立绘
```

## 架构要点（对齐 docs/architecture/harness-architecture.md）

- **裁判 LLM 与 NPC LLM 分离**（两次独立调用）
- **状态层确定性持有**：自信度/token/六维/漂移只走游戏代码，LLM 只读
- **调度用规则、内容用 LLM**：何时打异议是纯函数，论点内容交 LLM
- **反注入**：玩家消息作为 data 字段隔离，维度闭合枚举，注入落 NULL/L0
