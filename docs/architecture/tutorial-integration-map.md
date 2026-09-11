# 新手教学关卡 · 代码接入手册（Recon）

> **Task**：ENG-TUT-000（只读侦察）· **作者**：程基岩（engineering-lead）· **日期**：2026-09-10
> **配套设计稿**：`design/gdd/systems/06-tutorial-level.md`（文策渊并行产出）
> **本文性质**：只读侦察结论，**本轮未修改任何代码/配置/数据**。
> 所有结论均附**当前真实行号**（任务书里的预估行号已过期——`server.py` 已增长到 2416 行，实际位置见正文纠正）。

---

## 0. 一句话结论

**最小接入方案 = 纯前端状态机 + 静态 JSON/JS 数据，零后端改动、零 LLM、零 token、不写任何存档。**
新增 `demo/static/tutorial-*.{js,json}` + `index.html` 里一段教学层 DOM + 在 `mode-screen` 加第三个 `.mode-card#mode-tutorial`。
**工期 ≈ 1.0 人天（播放器 + 数据 + 接线）；含 node:test 验证脚本 ≈ 1.5 人天。**
不要复用 `/api/new_session`，不要碰 `/api/progress`，不要动 `demo/data/`。

---

## 1. 接入点清单

| # | 文件 | 行号 | 现有逻辑 | 教学关卡如何挂载 | 风险 |
|---|---|---|---|---|---|
| 1 | `demo/static/app.js` | **736–748** `addMsg(role,text,tag)` | 生成 `div.msg.<role>`，npc/player 走 innerHTML+`.who`，sys 走 textContent；append 到 `#dialogue` 并滚到底 | **直接复用**：预写台词逐条 `addMsg("npc"/"player"/"sys", text)` | 无（不依赖 round 状态，最安全） |
| 2 | `demo/static/app.js` | **762–797** `addMsgNpc(text,tag,version)` | 打字机：`setTimeout` 16ms/字；**L785 守卫 `version!==roundVersion \|\| !activeRound` 直接 resolve（字都不显示）** | 若要用打字机：必须在教学期把 `activeRound=true` 且冻结 `roundVersion` | ⚠️ **高危**：脱离对局直接调用会静默不出字 |
| 3 | `demo/static/app.js` | **818–842** `appendToLastNpc` | 同款打字机，追加到最后一条 npc 气泡 | 同上守卫 | 同上 |
| 4 | `demo/static/app.js` | **845–867** `api(path,body)` | `fetch` POST + `r.json()`（**无 SSE / 无流式**）；自动注入 `playerCtxPayload` | 教学**不调用**它 | 无 |
| 5 | `demo/static/app.js` | **457–468** `characterViews` | 一次性创建 3 个 `DebateCharacters.create`：`#player-avatar`→player、`#npc-avatar`→**"L1_A"**、`#avatar-preview`→player | 复用 `characterViews.npc` 驱动王阿姨演出 | 全局单例，教学结束后会被下一局 `setCharacter` 覆盖 |
| 6 | `demo/static/app.js` | **469** `setPortrait(side, emotion)` / **702** `renderEmotion(npc,player)` | 立绘 + emoji 徽章状态切换 | 直接复用做表情驱动 | 无 |
| 7 | `demo/static/app.js` | **612–635** `objection(side,event)` | 全屏"我有异议"金/红闪 + 震动 + 角色 objection 动作（`duration_ms` clamp 200–3000） | 复用做"玩家异议"高光 | 依赖 `fx.flash`/`fx.shake`，教学页应尊重降级开关 |
| 8 | `demo/static/app.js` | **470–474** `updateCharacterVisibility()` | `characterViews.player/npc.pause(!activeRound \|\| document.hidden)` | ⚠️ 教学期 `activeRound=false` → **两侧立绘被暂停，无呼吸/眨眼** | **必须**在教学期显式 `pause(false)` 或置 `activeRound=true` |
| 9 | `demo/static/app.js` | **936–948** `hideScreens(keep)` | 隐藏 `["mode-screen","tier-screen","free-screen","stance-screen","result-overlay","entry-screen"]`，并 `#app` 显隐 | 教学复用战斗舞台（`#app`）→ 调 `hideScreens()`（无 keep）| ⚠️ 新屏幕 id **必须**登记进这个数组，否则切换失灵 |
| 10 | `demo/static/app.js` | **1132–1171** `showMode()` | 回主界面：重置 round/screen 版本、清 sid、`run=null` | 教学结束"返回主界面"调它 | 无 |
| 11 | `demo/static/app.js` | **1379–1475** `newGame()` | 真开局：`api("/api/new_session")`、建 session、LLM 开场 | **不要复用**（会建 session / 为账号预扣 token） | 高（见 §3） |
| 12 | `demo/static/app.js` | **1609–1688** `openResult(...)` | 结算弹层；**L1612 `appendMatchRecord`**；**L1636 仅当 `run.mode==="ladder"` 且比分到 2 才 `api("/api/progress")`** | 可用它做"胜利"结局：**保持 `run=null`** 则完全不触发晋级写档 | 若教学设了 ladder `run` → 会写 `progress.json` |
| 13 | `demo/static/app.js` | **1719–1727** `bootstrapIdentity()` | 启动路由：有账号→大厅，否则→入场页 | 教学入口建议放主界面，避免改启动流程 | 无 |
| 14 | `demo/static/index.html` | **29 / 49** `#player-avatar` / `#npc-avatar` | 立绘 host 挂载点（`characters.js` `host.replaceChildren`） | 教学复用现成舞台；**禁止改名** | 改名=立绘全断 |
| 15 | `demo/static/index.html` | **40** `#dialogue`（`.scroll`） | 对话流容器 | 复用 | 无 |
| 16 | `demo/static/index.html` | **198–207** `#mode-cards` > `.mode-card#mode-ladder` / `#mode-free` | 主界面两张模式卡 | **加第三张 `.mode-card#mode-tutorial`** | 需自带点击监听（app.js 的监听按 id 硬绑 L1774/1775） |
| 17 | `demo/static/lobby.js` | **43–55** | 自动给 `#mode-cards .mode-card` 加 kicker + 键盘可达 | 第三张卡会被自动装饰（kicker 兜底 `"DEBATE MENU"`） | 无（但 kicker 文案由 lobby.js 固定数组 `["RANKED DEBATE","FREE SESSION"]`，第三张走默认） |
| 18 | `demo/static/characters.js` | **600–606** `window.DebateCharacters.create/preload` | 角色工厂 | 教学用现成 `characterViews`，无需新建 | 无 |
| 19 | `demo/server.py` | **2252–2268** `do_GET` | 仅 `/`、`/index.html`、`/static/*`、`/api/status`、`/api/tts`；**无 `/data/` 路由** | 教学数据放 `demo/static/` 即走现成静态服务 | 放 `demo/data/` 会 404（见 §7） |
| 20 | `demo/server.py` | **2302–2363** `do_POST` | 硬编码 API 白名单，无 `/api/tutorial` | 教学**不需要**新端点 | 无 |
| 21 | `demo/server.py` | **1567–1577** `_can_access_tier`（纠正：非 L1253） | 游客 ladder 仅 tier≤1；free 一律禁；账号 ladder 全开、free 看 `free_mode` | 教学**绕过**门禁（不调 tiers/new_session） | 无 |
| 22 | `demo/server.py` | **1647–1676** `tier_list`（纠正：非 L1347） | 关卡列表（读 `PROGRESS`/`NPC_STATE`） | 教学不调 | 无 |
| 23 | `demo/server.py` | **1754–1833** `new_session`（纠正：非 L1442） | 建 session；`_reserve_match_tokens` 账号预扣；**不写 progress** | 教学不调 | 无 |
| 24 | `demo/server.py` | **1580–1586** `_save_progress`（纠正：非 L1266） | 唯一写 `progress.json` 处，仅由 `progress_update`(L1589) 调用，仅经 `/api/progress`(POST L2317) 抵达 | 教学**绝不**触发 → `progress.json` 零写入 | 无 |
| 25 | `demo/static/rehearsal-timeline.mjs` + `recording-rehearsal.js` | 全文件 | **已有的 cue 时间轴播放器原型**：`Timeline({apply})` + `CUES[{at,pose,emotion,speaker,text,...}]` + rAF 推进 | **强烈建议复用其数据模型/推进逻辑**，改成"点击推进" | 它直接驱动**裸** `Live2DCharacterRuntime`（有 `selectPose`），非 `Character` 包装层 |

---

## 2. 推荐方案 vs 备选方案

### ✅ 推荐：纯前端状态机 + 静态数据（0 后端改动）
- **动到的文件**：
  1. `demo/static/tutorial-data.js`（或 `demo/static/tutorial/level1.json`）——**预写死的剧本**（玩家+NPC 双方台词、表情、动作、节拍）。
  2. `demo/static/tutorial.js`——播放器状态机（点击推进 + 打字机 + 角色驱动）。
  3. `demo/static/index.html`——加 `.mode-card#mode-tutorial`（L198 区块内）+ 引入两个 `<script>`（仿 L300 附近）+ 视需要加教学专用底栏按钮。
  4. `demo/static/app.js`——**仅两处小改**：`hideScreens` 白名单若新增教学屏 id；绑定 `#mode-tutorial` 点击（或把绑定放进 `tutorial.js` 以避免动 app.js）。**若教学直接复用战斗舞台（`#app`），则 app.js 可零改动。**
  5. `demo/tests/tutorial.test.js`——沿用 `node:test` + `vm` stub-DOM 验证脚本。
- **工作量**：播放器+数据+接线 **≈1.0 人天**；验证脚本 +0.5；**合计 ≈1.5 人天**。
- **风险**：低。完全不触碰后端/存档/LLM/token。

### 备选 A：复用 `rehearsal-timeline` 的 Timeline 引擎
- 把 `Timeline`/cue 模型搬进教学，cue 从"时间驱动(`at` 秒)"改为"点击驱动(`next`)"。
- **省 ≈0.3 人天**，数据模型已被验证。缺点：原引擎驱动裸 Live2D 运行时（含 `selectPose`），而 `Character` 包装层**没有** `selectPose`；Pose 需砍掉或改用运行时。
- **合计 ≈1.0 人天**。

### ❌ 备选 B：`mode="tutorial"` 假 session（不推荐）
- 后端 `new_session` 会：`_can_access_tier` 门禁、`_reserve_match_tokens`（账号预扣真实代币）、用 LLM/mock 生成开场（L1805）——**与"预写死、零 LLM"的硬约束直接冲突**。
- 且 `state["history"]` 由服务端持有，预写双方台词没有落点。
- **结论：否决。** 零 LLM 就意味着不需要后端。

---

## 3. 必须遵守的工程铁律（从代码读出来的）

1. **铁律 · id 是唯一契约**：`app.js` 全篇 `$("#id")` 驱动；`#player-avatar`/`#npc-avatar` 是 `characterViews` 的 host 挂载点（app.js L458–468），且 `characters.js` `isLive2DHost`(L106) **另有一份硬编码名单** `["player-avatar","avatar-preview"]`。**改这两个 id = 立绘 + Live2D 双层断裂。**
2. **铁律 · 新屏幕必须在 `hideScreens` 白名单里**（app.js L940 硬编码数组）。漏登记会导致：进入教学后主界面/选关屏残留渲染，或返回时该屏永不隐藏。
3. **铁律 · 演出受 `activeRound` 闸门控制**：`addMsgNpc`/`appendToLastNpc` 的打字机（L785 / L831）与 `updateCharacterVisibility` 的 `pause`（L470–473）都读 `activeRound`。教学若不在"对局态"，**必须自行置 `activeRound=true` 或直接对 `characterViews.*.pause(false)`**，否则字不出、人不动。
4. **铁律 · 不写存档**：`progress.json` 的唯一写点是 `/api/progress`；`npc_state.json` 的写点是 `_finalize_match`(L2006，仅真对局终局) 与 `npc_reset`。教学只要**不调 `/api/*`、不设 ladder `run`**，两个存档文件就是零写入。
5. **铁律 · 无流式**：本项目**没有 SSE / fetch streaming**。"流式打字机"纯前端 `setTimeout` 假象（app.js L781–796）。教学不要去找流式接口。
6. **铁律 · 静态资源前缀**：只服务 `/static/*`（映射 `demo/static/`）与 `/`。`/assets/*` 实际会被 403（`do_GET` L2256–2262 要求归一化后仍以 `static` 开头，而 rel 是 `assets/...`）——所以全部走 `/static/assets/...`（现有立绘路径已如此）。
7. **铁律 · 表情值域**：`setEmotion` 只认 `calm/tense/anxious/desperate/smug/shaken/defeated` 及中文别名（见 §4），**未知名一律回落 `calm`**（静默，不报错）。

---

## 4. 关键接口签名（可直接照抄）

### 4.1 角色演出（`characters.js`，`window.DebateCharacters.create(host,{characterId,onDegraded})` → `Character`）
| 方法 | 行号 | 签名 | 参数取值域 / 返回 |
|---|---|---|---|
| `setEmotion` | L370 | `setEmotion(value)` | `calm \| tense \| anxious \| desperate \| smug \| shaken \| defeated`；中文别名：`冷静/从容→calm`、`紧张→tense`、`焦虑→anxious`、`绝望→desperate`、`得意→smug`、`动摇→shaken`、`被说服→defeated`（`character-performance.js` L10–18）。未知名→`calm`。写 `host.dataset.emotion` |
| `setSpeaking` | L389 | `setSpeaking(value)` | 任意值 `Boolean()`；驱动嘴部（不接真实音频包络）。写 `host.dataset.speaking` |
| `playObjection` | L403 | `playObjection({durationMs=1000}={})` | `durationMs` clamp **300–5000**（`character-performance.js` L55–60）；返回 `false`(立绘) / `true`(Live2D)；同时派发 `CustomEvent("character-action",{detail:{action:"objection",...}})` |
| `setCharacter` | L356 | `setCharacter(id)` | 角色 id，如 `"L1_A"`（王阿姨）、`"player"` |
| `reset` | L450 | `reset()` | 复位表情/说话/动作为 `calm` |
| `pause` | L428 | `pause(bool)` | 暂停/恢复演出帧 |
| `setMotionEnabled` | L441 | `setMotionEnabled(bool)` | 全局动态总闸（`applyFx` 已接） |
| `endStatement` | L399 | `endStatement()` | 结束台词（Live2D 分支有效） |
| `destroy` | L478 | `destroy()` | 卸载 |

> ⚠️ `selectPose(pose)` **只存在于裸 `window.Live2DCharacterRuntime`**（`rehearsal-runtime.js` 用它），`Character` 包装层**没有**。若设计稿要"三姿势（neutral/lean/point）"切换，需直接调运行时或降级为表情切换——**请文策渊在稿里明确：教学是否必须用 Pose，还是表情足够。**

### 4.2 对话/演出（`app.js` 全局函数）
- `addMsg(role, text, tag?)` L736 —— `role ∈ {npc, player, sys}`；`tag` 为右侧小标签（如"动摇/反驳"）。
- `setPortrait(side, emotion)` L469 —— `side ∈ {player, npc, preview}`。
- `renderEmotion(npcEmotion, playerEmotion)` L702 —— 同时更新 emoji 徽章 + 立绘。
- `objection(side, {duration_ms})` L612 —— `side ∈ {player, npc}`。
- `renderConfidence()` L687 —— 读 `state.confidence`(0–100) 刷自信度条（教学可用它做"王阿姨自信度归零→玩家胜利"的可视化）。

### 4.3 已有的 cue 数据模型（复用参考）
`rehearsal-timeline.mjs`：
```js
CUES = [{ at, pose, emotion, speaker, text, rival?, speaking?, objection?, end?, hit?, endcard? }, ...]
Timeline(apply) → .start() / .advance(dt) / .reset()
```

---

## 5. 入口链路（确切 id 与切换函数）

```
[bootstrapIdentity L1719]
  └─(无账号)→ showEntry L1028 → #entry-screen
       └─ #entry-guest L1894 → confirmGuestEntry L1041 → enterMainWithLoading L1213
       └─ #entry-account L1895 → openAuthPanel → submitAuth → applyAuthenticatedAccount → enterMainWithLoading
  └─(有账号)→ enterMainWithLoading({beforeAssets:recoverAbandonedMatch})
[enterMainWithLoading L1213] → showMode L1132  → #mode-screen 可见
   └─ #mode-cards L198
        ├─ #mode-ladder L199 (click L1774) → loadTiers L1262 → #tier-screen(#tier-list L238)
        │     └─ 卡片 click L1290 → run={mode:"ladder",...} → showStance L1349 → #stance-screen
        │           └─ #stance-start L273 (click L1918) → newGame L1379 → hideScreens() → 对局(#app)
        └─ #mode-free   L203 (click L1775) → renderFreeList L1301 → #free-screen(#free-list L252)
              └─ 卡片 click L1331 → run={mode:"free",...} → showStance L1349 → …
```

**教学插在哪一层之前？**
- **推荐**：作为 `#mode-cards` 的**第三张卡**（与"天梯赛 / 自由切磋"并列）。它在"入场之后、选模式之前"，是评委/新玩家的天然第一落点；且 `lobby.js` L43 会自动接管装饰，不需改 lobby。
- 备选：`#entry-actions`(L88–91) 加"新手教学"按钮，走**登录前**体验（更贴近"零门槛给评委看"），但需自己处理身份态。
- 教学内部的"开始"→ 直接进教学舞台；教学"胜利"→ 回 `showMode()`。

---

## 6. 数据加载约定（新增 `tutorial.json` 需要动的地方）

- **现状**：`server.py` 的 `do_GET`(L2252) **没有** `/data/` 或 `/api/tutorial` 路由；`demo/data/*.json`（`npcs/topics/npc_state/progress`）是**服务端 import 时加载**（L59–60、L1538–1543），**从不经 HTTP 暴露**。`characters.json` 能取到，是因为它在 `demo/static/`（前端 `fetch("/static/characters.json")`，characters.js L120）。
- **选项**：
  | 选项 | 做法 | 后端改动 | 评价 |
  |---|---|---|---|
  | **A（推荐）** | 数据放 `demo/static/tutorial/level1.json`，前端 `fetch("/static/tutorial/level1.json")` | **0** | 最省事，走现成静态服务 |
  | B（更稳） | `demo/static/tutorial-data.js` 内联剧本为 JS 常量 | **0** | 无 fetch、无缓存/路径问题，可离线 |
  | C（不建议） | 保留 `demo/data/tutorial.json` + 在 `do_GET`(~L2263) 加 `elif path=="/api/tutorial"` | 改 server.py | 与"零后端改动"目标相悖 |
- **建议**：选 **A 或 B**。若选题"数据放 `data/`"是硬要求，则必须走 C 且需大王批准改 `server.py`。

---

## 7. 已知坑（会踩的）

1. **打字机静默失效**：脱离 `activeRound` 调 `addMsgNpc` 会 resolve 但不写字（app.js L785）。教学要么用 `addMsg`，要么自己置 `activeRound=true` 并冻结 `roundVersion`。
2. **立绘被暂停**：`activeRound=false` 时 `updateCharacterVisibility`(L470) 把两侧停帧，王阿姨会"僵住不动"。必须显式恢复。
3. **误写存档的隐线**：只要教学走到 `openResult` 且 `run` 是 ladder 且比分到 2，就会 `api("/api/progress")` 写 `progress.json`（L1636）。教学期**保持 `run=null`**。
4. **`/assets/*` 其实 403**：路径前缀必须是 `/static/assets/...`（`do_GET` L2256–2262 的归一化校验）。
5. **新屏漏登记 `hideScreens`**：会与主界面/选关屏互相穿透。

---

## 8. 未知项 / 待澄清

1. **`judge_mode`（评审模式 E2）当前未实现**——全仓仅 `docs/submission-tech-readiness.md` L239/284 把它列为**提案**（0.4 人天，P0）；代码里只有 `JUDGE_MODEL`（模型选择，server.py L48），与门禁无关。**教学关卡设计不应依赖 E2。** 需主理人确认 E2 是否本周落地。
2. **教学用 Pose 还是仅表情？** `Character` 包装层无 `selectPose`（只有裸 Live2D 运行时才有）。请文策渊在设计稿明确诉求，决定是否需要新增包装层方法。
3. **教学是否需要"王阿姨"以外的角色？** 现成 `characterViews` 只有 player + npc 两侧。若教学要三方同台，需评估是否新增 host（成本上升）。
4. **教学入口位置最终定夺**：`#mode-cards` 第三卡 vs `#entry-actions` 登录前按钮——属体验决策，请文策渊/大王定。
5. **是否需要给教学单独底栏**：现 `#bottom-bar` 含输入框/发送/提示/投降（index.html L66–78），教学需隐藏输入相关控件、替换为"点击继续"。属 UX 细节，待设计稿。

---

## 9. 给文策渊（design-strategist）的配合请求

1. **剧本数据请按可播放结构给出**：每条 cue 至少含 `{ speaker, side(npc|player|sys), text, emotion, objection?, tag? }`，并标注"点击推进"边界；**可直接对齐 `rehearsal-timeline.mjs` 的 cue 字段**（见 §4.3）。
2. **请明确演出手段边界**：Pose（neutral/lean/point）当前**不在** `Character` 接口里；若不新增包装层方法，教学只能用 `setEmotion` + `setSpeaking` + `playObjection`。请在稿中标注哪些节拍是"必须 Pose"。
3. **胜利落点请绑到可复用信号**：建议用"NPC 自信度 100→0 + NPC 表情 `desperate/defeated` + 玩家 `objection`"收尾（全部现有能力，零新增），而非新造结算系统；并明确教学结束回到 `mode-screen`。

---

*接入手册 v1.0 · 程基岩 · 只读侦察产物，未改任何代码。行号基于 2026-09-10 现场文件状态。*
