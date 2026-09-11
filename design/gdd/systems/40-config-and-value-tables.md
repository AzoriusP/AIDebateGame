# 配置与数值表系统 GDD（Config & Value Tables · F8）

> **本文是系统 GDD，用 `design/templates/system-gdd-template.md` 八节骨架写作。**
> **本文性质：设计文档，定义目标态，不是重构任务单。** 它回答"数值如何外置、schema 长什么样、如何加载校验、playtest 如何共享同一真值源"；正文给出迁移路径建议，**不承诺改动 `server.py` 代码**。
> **现状**：本作所有可调数值硬编码在 `demo/server.py` 顶部常量区（L61~L105）与函数体魔数，与 harness 架构工程控制第 4 条「改表不改码」（`docs/architecture/harness-architecture.md` §10）直接冲突。本文是消除该冲突的目标架构。
> **数值唯一真值源**：`design/decisions/2026-09-07-conflict-adjudication.md` §3。本文所有 schema 默认值与之逐项对应，**不在本文另行产生第二份数字**。

| 项 | 值 |
|---|---|
| 系统名 | 配置与数值表（Config & Value Tables · Config Store） |
| 系统编号 | F8 |
| Task ID | DS-002-D |
| 版本 | v1.0 |
| 作者 | 文策渊（设计策略师） |
| 状态 | 待大王评审（目标态设计稿，非实装清单） |
| 优先级 | P0（工程前置项） |
| 所属域 | F 技术底座 |
| 上游依赖 | harness-architecture §10 工程控制 #4（"改表不改码"）· 裁决文档 §3（真值基线）· A3/A4/A5 系统 GDD 的数值消费者 |
| 下游依赖 | F6 结算引擎 · A5 漂移 · A6 调度 · playtest 数值推演 · 未来 21-npc-memory-growth（跨局成长常量） |
| 对齐文档 | `harness-architecture.md` §10 · `core-loop.md` v0.3 §4/§5 · 裁决文档 §3/§6 · `systems/05-drift-system.md` §⑧ |
| 实装位置（现状） | `demo/server.py` L61~L105 常量区 + 函数体魔数（见 §② 盘点）；`demo/config.json`（现有运行层外置） |
| 目标落点 | 新增 `demo/value_tables.json`（全局规则数值表）+ `demo/game_values.py`（加载/校验/共享 loader，接口约定，非本文实现） |

---

## ① 概述与目标

**一句话职责**：把"会因调平衡而变"的**全局规则数值**从代码中剥离，外置为一份被 server 与 playtest **共同读取**的数值表，使调参 = 改 JSON 而非改代码。

**对应设计支柱**：不直接服务某条玩法支柱，服务的是**工程可信度**（评审维度）与 **solo 可持续性**（个人目标 4）——裁决文档 §5#3 已点明"只在代码里的设计是最危险的隐性知识"，数值外置是把它变成显性可调的第一件事。

**删掉/不做它会失去什么**：当前每次调平衡都要"动代码 → 重启 → 重测"，且 `playtest.py` 顶部还复制了一份 `DELTA / TOKEN_*` 硬编码（`playtest.py` L18~L28）——**同一真值在代码里有两份，必然后续漂移**。不做外置，漂移 GDD §⑧ 的 6 条待定项就没有干净的调参入口。

**本系统不负责什么**（划清边界）：

| 不负责 | 归属 |
|---|---|
| 每 NPC 数值（dimensions / token_quota / drift_personality / stance_bias 等） | **已在 `data/npcs.json` 内容数据层，不迁**（改 NPC 不动代码，本就是外置的） |
| LLM 连接与运行参数（mode / base / key / 超时 / keep_alive / port） | 留在现有 `demo/config.json`（部署向，按机器差异） |
| 内容数据（命题 topics.json、运行时存档 npc_state / progress） | 现状不动 |
| 跨局成长常量（adj ±0.3 / 回弹 0.1 / 钳制 2.0 / 记忆上限 3） | 通道 2 归属未来的 `21-npc-memory-growth.md`；本文只登记不迁移 |
| 演出类常量（duration_ms / 震动 / emotion 阈值 80·50·25 / token 比例 0.75·0.5·0.35） | 表现域 D3/D4 GDD；低优先级，可后置 |
| 静态结构（DIMENSIONS / DIM_LABELS / DIM_DESC） | 结构字典非"可调平衡值"，保留在代码；如需 i18n 另行立项 |

**关键判断（本 GDD 的核心分层）**：不是"把所有数值都外置"，而是按**变更频率与变更主体**分三层——**部署参数（config.json）≠ 平衡参数（value_tables.json，本文新设）≠ 内容数据（npcs/topics）**。三者生命周期与编辑者不同：部署参数按机器/环境差异改；平衡参数全局共享、被 playtest 反复调；内容数据按 NPC/命题个体改。

---

## ② 现状盘点与目标架构

### ②.1 硬编码清单（现状 → 将来归属）

> 逐项对照 `server.py` L61~L105 与函数体魔数。每项标"当前在哪 → 将来放哪"。"收益" = 被 playtest / 调平衡触达的频率（收益最高者先迁）。

| # | 项 | 当前在哪 | 值（真值源：裁决 §3） | 将来归属 | 迁移优先级 |
|---|---|---|---|---|---|
| 1 | `CONFIDENCE_DELTA`（自信度变化表 3×3 + L0） | `server.py` L77~L82 | weak −40/−20/−8 · normal −18/−9/−3 · strong +8/+4/0 · L0 0 | **value_tables.json `confidence_delta`** | **高**（调平衡最核心） |
| 2 | `TOKEN_BASE / TOKEN_FREE / TOKEN_PER_CHAR / TOKEN_L0_PENALTY / TOKEN_L0_STREAK_DOUBLE` | L85~L89 | 20 / 60 / 1 / 10 / 2 | **value_tables.json `token_economy`** | **高** |
| 3 | `DRIFT_VIGILANCE / DRIFT_ABANDON / DRIFT_FORTIFY / DRIFT_CLAMP` | L99~L102 | 0.5 / 1.0 / 0.5 / 3.0 | **value_tables.json `drift`** | **高** |
| 4 | 警觉触发下限 `abs(delta_conf) >= 20` | `settle()` 函数体 L416 魔数 | 20 | **value_tables.json `drift.vigilance_min_delta`**（漂移 GDD §④.2 已登记为"触发下限"，实装是裸魔数） | **高** |
| 5 | 软肋/强项阈值 `<= 4` / `>= 6.5` | `_direction()` 函数体 L378~L380 魔数 | 4.0 / 6.5 | **value_tables.json `direction_thresholds`** | **高**（05 GDD §④.2 依赖） |
| 6 | `MAX_TURN / TIME_LIMIT_S` | L104~L105 | 20 / 480 | **value_tables.json `turn_limits`** | 中 |
| 7 | `objection_threshold / objection_intensity` 公式中的参数 | 函数体 L92~L96 | 50 + (tier−3)×5 · clamp(1+below//15, 1, 3) | **公式留在代码，参数进 value_tables.json `pacing`**（见 §④ 公式约定） | 中 |
| 8 | 无进展钩子阈值 `no_progress_streak >= 3` | `schedule()` 函数体 L534 魔数 | 3 | **value_tables.json `pacing.hook_streak`** | 中 |
| 9 | 异议冷却 `cooldown = 1` | `schedule()` L533/L540 魔数 | 1 | **value_tables.json `pacing.objection_cooldown`** | 中 |
| 10 | LLM 连接/运行参数（mode/base/key/model/port/超时/keep_alive/llm_opening） | 现已在 `config.json` | — | **留在 config.json（不动）** | — |
| 11 | 每 NPC 数值（dimensions/token_quota/drift_personality/stance_bias/weakness/strength） | 现已在 `data/npcs.json` | — | **留在内容数据层（不动）** | — |
| 12 | 跨局成长常量（adj +0.3 / 回弹 −0.1 / 钳制 ±2 / 记忆留 3 局） | `_finalize_match()` L884~L896 魔数 | — | **归未来 21-npc-memory-growth.md**；本文登记不迁 | 后置（随 21） |
| 13 | emotion 阈值（NPC 80/50/25 · 玩家比例 0.75/0.5/0.35） | `_emotion()` L468~L485 魔数 | — | **表现域 D4**；本文不迁 | 低 |
| 14 | VFX 时长（duration_ms 800/1000） | `schedule()` 函数体 | — | **表现域 D3**；本文不迁 | 低 |
| 15 | `ARG_LEN = 50`（playtest 模拟假设"平均论点 50 字"） | `playtest.py` L29 | — | **留在 playtest 脚本**：这是模拟场景假设，不是游戏真值（server 不消费） | — |

> **"playtest 共享真值"的精确含义**：共享的是**结算/难度真值**（表 #1~#9），不共享**模拟假设**（#15）。只有被 server 消费的数值才进 value_tables.json。

### ②.2 三层归属划分（核心机制级规则）

```
┌─ 部署参数层 demo/config.json ──────────────────────────────┐
│  LLM 连接 / 端口 / 超时 / keep_alive / llm_opening          │
│  编辑者：按机器/环境；不参与平衡推演                        │
└────────────────────────────────────────────────────────────┘
┌─ 平衡参数层 demo/value_tables.json（本文目标·新增）─────────┐
│  confidence_delta / token_economy / drift / thresholds /   │
│  turn_limits / pacing                                      │
│  编辑者：调平衡；server 与 playtest 共享同一真值源          │
└────────────────────────────────────────────────────────────┘
┌─ 内容数据层 demo/data/*.json ──────────────────────────────┐
│  npcs.json（per-NPC 数值）/ topics.json                    │
│  npc_state.json / progress.json（运行时生成）              │
│  编辑者：做内容；tools/sync_csv.py 走 Excel 表格            │
└────────────────────────────────────────────────────────────┘
```

**分界规则（写入代码时不可违反）**：

- **R1 · 按主体分**：凡"作用于所有 NPC/所有局、由平衡推演共同调节"的值 → value_tables.json；凡"某个 NPC 专属"的值 → npcs.json。**判定提问**："这个值是『世界怎么运转』还是『这个角色是谁』？"
- **R2 · 按变更者分**：部署按机器差异 → config.json；内容按 NPC/命题制作 → data/；平衡按手感/赛事 → value_tables.json。
- **R3 · 公式与参数分离**：算法结构（怎么算）留在代码函数；算法里的可调常数（算多快/门槛多少）进表。`objection_threshold` 的**公式**（`50 + (tier−3)×5`）是代码，`50 / 5 / 3` 是表参数。
- **R4 · 一次迁移一个真值源**：迁移过程中 server 与 playtest 任一时刻都指向同一份值；禁止"先改表、代码还留着副本"的半迁移态（除非副本标注为 fallback，见 §⑥）。

### ②.3 迁移后的读取链路（目标态）

```
启动（server.py / playtest.py 共用同一 loader）
  ① 读 config.json            → 运行参数（沿用现有 _load_json）
  ② 读 value_tables.json      → 平衡参数（新 loader：校验 + 缺省兜底，见 §④/§⑥）
  ③ 读 data/npcs.json、topics → 内容数据（沿用现有加载）
  ↓ 合并成运行时对象
  settlement / drift / schedule 只从「② 的校验后对象」取数，代码内不再出现可调字面量
```

---

## ③ 玩家交互与 UX

> **本系统对终端玩家不可见，无任何 UI。** 它的"用户"是调平衡的人（大王/文策渊）与消费它的脚本（server / playtest）。因此本节讲**调参者体验（DX）**，不是玩家 UX。

**调参者必须能回答的三个问题**：

| 问题 | 达成手段（本系统规格） |
|---|---|
| "这个值在哪改？" | 一张表一份 schema；按域分节（confidence_delta / token_economy / drift / …），节名与文档/裁决术语一一对应，不需查代码 |
| "我改对了没？" | loader 启动时输出校验摘要（警告级即可，不刷屏）；非法字段回退默认并**指明违规项**（"drift.clamp=-1 非法，已回退默认 3.0"） |
| "改动影响多大？" | playtest 与 server 读同一份表 → 改表后跑一次 playtest 即得难度曲线变化（这就是 F8 对漂移 GDD §⑧ 待定的支撑） |

**对玩家侧的间接影响（设计责任）**：数值表承载的是**难度曲线与惩罚梯度**，改表即改难度——因此表内每项应能在文档追溯其设计意图（裁决 §3 / 各系统 GDD §④ 约束）。**禁止只凭手感盲改而无设计注释的值进入定稿**（字段可加 `_comment`，loader 忽略未知键，见 §④）。

---

## ④ 数据结构与数值

### ④.1 目标文件与命名规范

- **文件名**：`demo/value_tables.json`（与 config.json 同级，不放 `data/`——它是"规则"不是"内容"，且 sync_csv 工具只管 npcs/topics，放一起会污染内容管线）。
- **取舍说明（vs 扩展 config.json）**：扩展 config.json 省一个文件，但**部署参数与平衡参数的生命周期和编辑者不同**（一个按机器、一个按平衡推演），混在同一文件会导致"调手感"与"配环境"互相干扰、diff 难以审查。独立文件更干净，代价是多一个文件与一次加载——对 solo 项目可忽略。**推荐独立 value_tables.json。**
- **命名**：键名 `snake_case`；节名与裁决文档 §3 术语对齐（`confidence_delta` / `token_economy` / `drift` / `direction_thresholds` / `turn_limits` / `pacing`）；**结构化嵌套而非扁平前缀命名**（如 `token_economy.base`，不写 `TOKEN_BASE`）。
- **可注释性**：JSON 无注释。约定 loader **忽略未知键**，因此允许 `"_comment"` / `"_source"` 等文档字段存在（用于标注对应裁决条目），不参与消费。

### ④.2 目标 schema（全字段 · 值与裁决文档 §3 一一对应）

```jsonc
{
  "schema_version": 1,          // 必填 int；不匹配 → 整表回退默认并告警

  "_comment": "值 = 裁决文档 2026-09-07 §3 实装基线。改此表即改难度；每项变更应在系统 GDD §④ 登记意图。",

  "confidence_delta": {
    // 命中方向 × 强度 → 自信度变化（自信度 100→0；负 = 下降）
    "weak":   { "L3": -40, "L2": -20, "L1": -8 },
    "normal": { "L3": -18, "L2": -9,  "L1": -3 },
    "strong": { "L3": 8,   "L2": 4,   "L1": 0 },
    "L0": 0
  },

  "token_economy": {
    "base": 20,              // 每条消息固定底扣
    "free_chars": 60,        // 免费字数
    "per_char": 1,           // 超免费字数后每字
    "l0_penalty": 10,        // L0 废话题额外
    "l0_streak_double_at": 2 // 连续 N 条 L0 → 第 N 条起底扣翻倍
  },

  "drift": {
    "vigilance": 0.5,        // 警觉上浮基准（× npcs.json: drift_personality.vigilance_mult）
    "abandon": 1.0,          // 弃守下沉基准（× abandon_mult）
    "fortify": 0.5,          // 强项加固（无乘数）
    "clamp": 3.0,            // 局内漂移累计 ±上限
    "vigilance_min_delta": 20 // |delta_conf| ≥ 此值才触发警觉（= 仅 L2/L3）
  },

  "direction_thresholds": {
    "weak_max": 4.0,         // V_current ≤ 此值 = 软肋
    "strong_min": 6.5        // V_current ≥ 此值 = 强项
  },

  "turn_limits": {
    "max_turn": 20,
    "time_limit_s": 480
  },

  "pacing": {
    // objection_threshold(tier) = threshold_base + (tier - tier_offset) * tier_slope
    "objection": {
      "threshold_base": 50, "tier_slope": 5, "tier_offset": 3,
      "intensity_step": 15,   // objection_intensity(below) = clamp(1 + below//step, min, max)
      "intensity_min": 1, "intensity_max": 3
    },
    "hook_streak": 3,        // no_progress_streak ≥ N → 抛钩子
    "objection_cooldown": 1  // 异议后冷却回合
  }
}
```

### ④.3 公式约定（公式在代码，参数在表）

```
objection_threshold(tier) = pacing.objection.threshold_base
                          + (tier − pacing.objection.tier_offset) × pacing.objection.tier_slope
objection_intensity(below) = clamp(1 + below // pacing.objection.intensity_step,
                                   pacing.objection.intensity_min,
                                   pacing.objection.intensity_max)
token_cost = token_economy.base + max(0, len − token_economy.free_chars) × token_economy.per_char
            + (L0 时) token_economy.l0_penalty
            + (l0_streak ≥ token_economy.l0_streak_double_at 时) base 翻倍
```

> **决策**：公式结构（含 `//` 取整、`clamp`、`max/min`）属于算法，保留在代码函数中；表里只放公式的可调常数。若未来公式结构也要改（如从线性改分段），那是**代码变更**走正常评审，不是改表。

### ④.4 校验规则（两层）

**第一层 · 结构/类型校验**（加载期，逐节）——不满足 → **该节回退默认** + 警告：

| 检查 | 违规示例 |
|---|---|
| 必需节存在且为对象/数 | `confidence_delta` 缺失、`token_economy.base` 是字符串 |
| 枚举键完整 | `confidence_delta.weak` 缺 `L1` |
| 数值类型与范围 | `clamp` ≤ 0、`intensity_min` > `intensity_max` |

**第二层 · 语义设计约束**（面向裁决/系统 GDD §④ 的设计红线）——违反 → **回退该值** + 警告指明：

| 约束（真值：裁决 §3 + 系统 GDD §④） | 违规示例 | 回退 |
|---|---|---|
| `weak` 全负、`normal` 全负、`strong` ≥ 0、`L0 == 0`（方向语义） | weak.L3 = +40（方向反了） | 该字段回默认 |
| 警戒步进应可被弃守抵消（漂移 GDD §④.4 C2 精神） | clamp=0（不允许任何漂移） | 回默认 |
| token 各值 ≥ 0 | base = −5 | 回默认 |
| `strong_min > weak_max` | 6.5 vs 8.0（区间倒挂） | 回默认 |

### ④.5 缺省兜底

- 代码内嵌一份 `DEFAULT_VALUE_TABLES`（**内容 = 裁决 §3 现值，即当前硬编码值**），作为加载任何失败时的最终兜底 → **文件缺失/损坏/字段违规时，游戏行为 = 当前行为，零回归风险**（这也是迁移的安全网，见 §⑦ Step 2）。
- loader 对外暴露 `warnings` 列表，启动时打印（警告级，不打断启动）。

---

## ⑤ 表现与演出

**本系统无任何玩家可见演出。** 它唯一"输出"是两条日志：① 启动时校验摘要（正常 = 一行"value_tables OK"）；② 回退警告（异常 = 指明哪节哪键违规、已用默认）。日志面向调参者与排障，不进入游戏画面。

数值变更传导到玩家反馈的链路由各消费系统负责（改 `confidence_delta` → 结算不同 → HUD/表情不同），本系统只保证"改表 → 下一局就生效（重启后）"，见 §⑦/§⑧。

---

## ⑥ 与其他系统的接口

### ⑥.1 与各消费者的接口约定

| 方向 | 对端 | 数据 | 时机 | 约定 |
|---|---|---|---|---|
| 出 | F6 结算引擎（server） | `confidence_delta` / `token_economy` / `drift` / `direction_thresholds` / `turn_limits` | 启动加载一次，只读 | 代码内不再出现可调字面量；函数签名不改（仍传 `CONFIDENCE_DELTA` 等变量，只是值来自表） |
| 出 | A6 调度（server） | `pacing`（公式参数 / hook / cooldown） | 启动加载一次，只读 | 公式函数保留，参数来自表 |
| 出 | `demo/playtest.py` | 同一份 `confidence_delta` / `token_economy` 等 | 启动加载一次，只读 | **共享同一 loader**；删除 playtest.py 顶部 DELTA/TOKEN_* 硬编码副本（L18~L28） |
| 出 | A5 漂移 GDD §⑧ 待定 | 见 ⑥.2 映射表 | — | 调参入口 = 本表外置后 |
| 入 | `data/npcs.json` | 每 NPC 数值（内容数据，**不迁**） | 现状不动 | 全局表只存"跨 NPC 规则"，不存 per-NPC 值 |
| 入 | 未来 `21-npc-memory-growth.md` | 跨局成长常量（本文不迁，仅登记） | 随 21 文档 | 迁移时以本文 schema 风格追加节，或由 21 自持，二选一需拍板 |

### ⑥.2 对漂移 GDD §⑧ 六条待定的支撑映射（"调参入口 = 本表外置后"的落点）

| 漂移待定 | 性质 | 本表支撑 | 不靠本表的部分 |
|---|---|---|---|
| 1 "L1 蹭刀流"封堵 | **数值为主** | 改 `confidence_delta.weak.L1`（−8）或加新键（如"同维连续命中强度衰减"） | 若决定"L1 也触发警觉"，那是改 R1 条件（代码语义变更），需另评 |
| 2 软肋可打次数目标区间 | 纯数值 | 改 `drift.vigilance/abandon` + `direction_thresholds.weak_max`（per-NPC 乘数在 npcs.json 不动） | — |
| 3 L1 命中强项是否加固 | **规则语义** | `drift.fortify` 只承载该规则的值 | 是否加固是 R2 条件变更（代码），不由表解决 |
| 4 L0 回合 _last_hit 保留 | **规则语义** | — | 改代码行为，非数值 |
| 5 越界显示夹取 | 前端 | — | D1 前端渲染夹取 |
| 6 误差带与漂移叠加 | 数值 + 前端 | 若误差带数值化，建议随 D1 落表（加节）或留 D1 文档，待定 | 呈现规则归 D1 |

> 结论：6 条里 2 条纯数值（2/部分1）直接靠本表闭环；3 条是规则/前端问题（3/4/5/6 的主体），本表只提供数值落点。**外置是必要条件不是充分条件**——规则语义类仍要走代码评审。

### ⑥.3 与 harness 工程控制的对齐

- §10 第 4 条"所有数值表进 Config Store，改表不改码"→ 本文即该条的落地设计。
- 与 ADR-002（状态层确定性持有）不冲突：数值表是**只读配置**，不是可变状态；加载发生在会话创建之前，不影响"状态迁移只走纯函数"。

---

## ⑦ 边界情况与失败处理

| # | 类别 | 现象 | 判定 | 处理 | 玩家可见反馈 |
|---|---|---|---|---|---|
| 1 | **文件失效（等价"AI/依赖失效"类）** | `value_tables.json` 缺失 / JSON 语法错 / `schema_version` 不匹配 | loader 捕获异常 | **整表回退 `DEFAULT_VALUE_TABLES`** + 启动警告；server 正常起、能开局 | 无（游戏用默认数值，行为 = 迁移前） |
| 2 | 局部字段违规 | 单节单键缺失 / 类型错 / 越界 | 第一/二层校验 | **仅该节回退默认** + 警告指明违规键；其余节用文件值 | 无（只影响被回退的域，如 token 异常只影响 token 域） |
| 3 | 语义方向错误 | 如 `weak.L3 = +40`（自信度方向反转） | 第二层约束 | 该字段回默认 + 警告"方向语义违规" | 无 |
| 4 | 双真值漂移（迁移期间） | server 已用表、playtest 仍用旧副本（或反之） | — | 用共享 loader 根除；验收 = playtest 顶部无 DELTA/TOKEN_* 硬编码（grep 0 hits） | 不一致会直接表现为"playtest 预测与实机对不上" |
| 5 | 改动不生效（忘了重启） | 改表后直接 play 旧会话 | — | 明确"重启生效、无热重载"（见 §⑧ 决策）；新会话才取新值 | 同局结算不一致是**被禁止**的（ADR-002 确定性） |
| 6 | 内容层与规则层同名混淆 | npcs.json 里也有 `token_quota`、表里有 `token_economy` | 命名空间不同（per-NPC vs 全局） | 靠 §② R1/R2 分界 + schema 命名区分；文档边界表写明 | — |
| 7 | 表格被误删/空文件 | 空 `{}` 或空数组 | loader 视为缺节 | 各节缺省兜底，等价回退默认 | 无 |

---

## ⑧ 验收标准与待定项

### ⑧.0 已落实决策（本 GDD 明确拍板项）

| 决策 | 结论 | 理由 |
|---|---|---|
| 平衡参数文件形态 | **独立 `value_tables.json`**，不扩展 config.json | 部署参数 vs 平衡参数生命周期不同；独立便于 diff 审查与 playtest 共享 |
| 公式放哪 | **结构在代码，参数在表** | 公式是算法（可能走代码评审），常数是可调数值 |
| 每 NPC 数值迁不迁 | **不迁**（留在 npcs.json） | 本就外置；改 NPC 不动代码已是现状 |
| 跨局成长常量迁不迁 | **暂不迁**（归 21 文档） | 通道 2 边界在 05 GDD §⑥.2 已定；F8 只覆盖结算/难度/节奏域 |
| 热重载做不做 | **不做，重启生效** | 热重载引入同局结算不一致（违反 ADR-002 确定性）、缓存/并发复杂度；solo 重启成本 <1s，收益为负 |

### ⑧.1 验收标准（可判定 · 每条附观测方法）

1. **真值同源**：`demo/playtest.py` 顶部不再存在 `DELTA / TOKEN_BASE / TOKEN_FREE / TOKEN_PER_CHAR / TOKEN_L0_PENALTY` 硬编码（`grep` 0 hits）；改为与 server 共用 loader。
2. **改表即生效**：将 `value_tables.json` 中 `confidence_delta.weak.L3` 由 −40 改为 −35 → 重启 server 与重跑 playtest，两者结算均使用新值（冒烟：打一局 L1，命中 weak L3 自信度 −35）。
3. **回归零变化**：用默认值表启动，playtest 输出与迁移前**逐行一致**（parity 测试通过）；server 5 层各打 1 局 smoke 无异常。
4. **缺省兜底**：注入三类故障各一次——(a) 删除/损坏文件 (b) 单键类型错 `token_economy.base="x"` (c) 语义违规 `weak.L3=+40` → server 均能启动并打满一局，控制台给出对应回退警告；游戏行为回落默认。
5. **schema 与裁决对齐**：value_tables.json 每个节都能一一对应到裁决文档 §3 的某段，且 `_source` 注释标注了裁决条目。
6. **漂移待定具备调参入口**：05 GDD §⑧ 待定 1/2 涉及字段（`confidence_delta.weak.L1`、`drift.vigilance/abandon`、`direction_thresholds.weak_max`）均已出现在表中，可独立改值验证。

### ⑧.2 待定项

| # | 未定内容 | 原因 | 谁定 | 依赖 / 建议验证 |
|---|---|---|---|---|
| 1 | **loader 的实现语言/形态**：新增 `demo/game_values.py`（纯 stdlib）还是并入现有 `_load_json` 家族 | 本文只立接口契约，不实现 | 工程（程基岩） | 建议独立模块，server 与 playtest 各自 `import`；零依赖 stdlib 即可 |
| 2 | **缺省兜底粒度**：整表回退 vs 逐节回退 | 逐节更精细、日志更准，但代码略多；整表最简单 | 工程 + 大王 | 建议逐节（§⑦ #2 已按此写）；以故障注入测试定案 |
| 3 | **`l0_streak_double_at` 语义**：表值 2 表示"连续第 2 条起翻倍"；若未来想改"第 3 条起"，语义是">=N 时翻倍"还是"N-1 条后翻倍"易混 | 表命名与代码边界 | 文策渊 + 工程 | 迁移时在 loader 注释写明语义，或用 `double_from_streak` 更直白命名（可拍板改名） |
| 4 | **校准目标是否写入表注释**：如"weak_max=4.0（漂移 GDD §④.4 C1：软肋可打 2~3/5~6 次目标带）" | 保持表可读 vs 防注释冗长 | 大王 | 建议每节一个 `_comment`，不逐键注释 |
| 5 | 漂移 GDD §⑧ 待定 1~6 的**逐项裁决** | 依赖本表落地后才可闭环验证 | 大王 | 每项验证法见 05 GDD §⑧.2；本表提供调参入口 |

---

## 附录 · 迁移路径建议（分步 · 标注风险）

> 原则：**第一步不是重构 server.py**。先落 schema + 让 playtest 指向外置表（低风险验证真值同源），再迁结算引擎常量。

| 步骤 | 动作 | 风险 | 通过标准 |
|---|---|---|---|
| **Step 1（先做）** | ① 新建 `value_tables.json`（内容 = 裁决 §3 现值）② 新建共享 loader（game_values.py，含 `DEFAULT_VALUE_TABLES` + 两层校验 + warnings）③ `playtest.py` 改为 import loader，删除硬编码副本 | 低：不动 server，运行时行为零变化 | 真值同源验收（§⑧.1 #1）+ parity 通过 |
| **Step 2** | 迁移结算引擎常量：server.py 顶部 CONFIDENCE_DELTA / TOKEN_* / DRIFT_* / direction 阈值 / MAX_TURN / TIME_LIMIT_S / pacing 参数 → 从 loader 读；`DEFAULT_VALUE_TABLES` 作为兜底保留在 loader | 中：改动面在结算与调度核心；靠 Step 1 的 parity + 冒烟兜底 | 回归零变化（§⑧.1 #3）+ 故障注入（#4）通过 |
| **Step 3（后置·随 21）** | 跨局成长常量（adj 0.3/0.1/2.0、记忆 3 局）按 21 文档决定迁表或自持 | 低（独立域） | 21 文档落地时对照本 schema 风格 |

**收益排序**：Step 2 中收益最高 = `CONFIDENCE_DELTA` / `DRIFT_*` / `TOKEN_*`（漂移 GDD 6 条待定与后续赛事调平衡都反复动它们），优先迁；`turn_limits` / `pacing` 次之；函数体里 hook/cooldown/emotion/成长魔数随各自所属域文档（A6/D4/21）后置。

---

*配置与数值表系统 GDD v1.0 · 文策渊 · 待大王评审。目标态设计稿：不改 server.py；真值基线 = 裁决文档 2026-09-07 §3。*
