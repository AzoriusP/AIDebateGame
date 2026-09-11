# 《辩弈》Harness 架构文档 v0.1（ENG-001 · P0 · solo）

文责：程基岩（工程负责人）｜ Task ENG-001 ｜ 对齐 GDD `core-loop.md` v0.1 与 `art-bible.md` v0.1

---

## 0. 结论先行（TL;DR）

1. **裁判 LLM 与 NPC LLM 必须分离**（两条独立调用、两套独立 system prompt、可选不同模型档）。合一是角色混淆 + 注入的温床。→ ADR-001
2. **全部状态（自信度/token/六维/漂移/强度曲线/回合）由确定性游戏代码唯一持有，LLM 只读注入、无权改写**。LLM 只产出「判定信号」与「台词」，状态迁移只走游戏代码。→ ADR-002
3. **NPC「何时打异议 + 甩多强论点」用确定性规则调度，论点内容用 LLM 生成**。调度是纯函数，可复现、可单测、抗注入。→ ADR-003
4. **每回合 2 次 LLM 调用（1 判定 + 1 NPC 回复），不合并**；判定走轻量模型结构化输出，NPC 走大模型流式。→ ADR-004
5. **判定非流式、P95 < 1.5s；NPC 回复流式、首 token P95 < 1.5s；回合端到端感知延迟 ≤ 4s**，异议 VFX 在结算后 10ms 内即时触发，用演出掩盖 LLM 流式延迟。→ ADR-005
6. **反注入四道护栏**全部落到 schema 与调用边界。
7. ~~**待确认 1 个语义点**~~ ✅ **已作废（2026-09-04 语义反转）**：该张力建立在「自信度从 0 起爬」模型上。方向已反转为 **自信度 100→0**（开局从容、越打越紧张、<50% 背水一战），起始点张力自然消失，**warm-up 守卫随之作废**——§5.4 保留仅作历史记录，实现时不需该守卫。

---

## 1. 架构总览

### 1.1 分层与模块划分（Web 全栈）

```
┌─────────────────────────── 前端 Client ───────────────────────────┐
│  Game UI（立绘/HUD/雷达/认同条/token 倒计时）                       │
│  Input（打字 / 流式 ASR）                                           │
│  Performance Engine（异议闪帧/表情状态机/粒子，纯前端消费信号）       │
│  Transport（WebSocket 主信道 + SSE 流式子信道）                     │
└───────────────────────────────┬────────────────────────────────────┘
                                 │ 事件流 / 请求
┌───────────────────────────────▼────────────── 后端 Server ────────┐
│  API Gateway（鉴权/限流/会话路由）                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Session Manager（状态层 · 唯一持态方 · 唯一写点）              │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Judge Service │  │ NPC Service  │  │ Scheduler / Pacing Engine │ │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘ │
│  ┌──────────────────────────┐  ┌───────────────────────────────┐ │
│  │ Settlement Engine        │  │ Anti-Injection Guard          │ │
│  └──────────────────────────┘  └───────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Config & Content Store（题库/NPC库/加分表/难度表/rubric/few-shot）│ │
│  └──────────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Event Bus / Streaming Hub（结算事件 + NPC 流式推送）            │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

**模块职责一句话**：

| 模块 | 职责 | 确定性？ | 持态？ |
|---|---|---|---|
| Session Manager | 会话状态唯一持有者与唯一写点 | ✅ | ✅ 唯一 |
| Judge Service | 包装裁判 LLM：组装 prompt → 结构化输出 → 解码校验 | ❌ | 只读 |
| NPC Service | 包装对手 LLM：按 beat 指令组装 prompt → 流式生成台词 | ❌ | 只读 |
| Scheduler / Pacing Engine | 决定本回合 beat 与异议强度 | ✅ 纯函数 | 只读 |
| Settlement Engine | 自信度±、token−、六维漂移、连击结算 | ✅ 纯函数 | 只读 |
| Anti-Injection Guard | 输入校验、注入检测、schema 解码与白名单校验 | ✅ | 只读 |
| Config & Content Store | 数值表与 rubric/few-shot/persona | ✅ 静态 | — |
| Event Bus / Streaming Hub | 结算事件（同步）+ NPC 流式文本（异步） | ✅ 转发 | — |

### 1.2 完整数据流（一回合）

```
玩家输入(text/ASR)
   → [Anti-Injection Guard]  校验/清洗/字数计费
   → [Judge Service]         裁判 LLM（非流式，结构化输出）
   → [Settlement Engine]     确定性结算（<10ms）：自信度± / token− / 漂移 / 连击
   → [Scheduler]             确定性调度（<1ms）：beat + 异议信号 + 表情
   → [Session Manager]       提交状态（唯一写点）
        ├─(同步 <10ms)→ Event Bus 推 turn_resolved（含 objection_event）
        │                  └→ 前端立即播 VFX / 更新 HUD（不等 LLM）
        └─(异步)→ NPC Service 流式生成回复 → SSE 逐 token 推前端
```

**关键时序**：异议 VFX 是确定性信号，结算后立刻可播；NPC 台词是流式晚到 1~3s。两者解耦，演出在等待台词期间先把情绪顶起来。

---

## 2. 状态层设计

**核心原则**：LLM 产出「判定信号」与「台词」，游戏代码产出「状态迁移」。LLM 永不变写状态，状态迁移永不走 LLM。

**状态归属表**（节选）：

| 状态 | 唯一持有者 | LLM 权限 |
|---|---|---|
| 自信度（100→0） | 状态层 | 只读（Judge 判方向用） |
| token 余额/配额 | 状态层 | 不注入 NPC |
| 六维真实值 | 状态层 | Judge 只读判据；NPC 只读人格 |
| 六维情报估计值 | 状态层 | 不注入 LLM |
| 漂移累计 | 状态层 | 只读 |
| NPC 立场/profile | 状态层 | 只读注入 |
| 强度曲线/pacing | 状态层 | NPC 只读（beat 指令下发） |
| Judge 输出 / NPC 台词 | 状态层（持久化） | 产出 |

**会话状态 Schema**（核心字段）：`confidence`(100~0)、`token{quota,remaining,base_cost,l0_streak}`、`dimensions_true`、`dimensions_display`、`drift`、`hit_history`、`no_progress_streak`、`turn`、`max_turn`、`deadline_ms`、`pacing{mode,objection_cooldown}`、`result`。

> **v0.3 字段名统一**：本字段原写作 `agreement`（沿用方向反转前的旧术语），实装为 `confidence`，本文已统一为 `confidence`。

---

## 3. ADR（关键架构决策，5 条）

### ADR-001：裁判 LLM 与 NPC LLM 必须分离
- **决定**：分离为两条独立调用，独立 system prompt、独立上下文、可选不同模型档（Judge 轻量 + 结构化；NPC 大模型 + 流式）。
- **理由**：①角色混淆（裁判带 NPC 人格会系统偏袒 NPC）②注入面放大 ③可复现 ④独立演进与成本 ⑤可审计。
- **备选（否决）**：单一模型分 `<judge>/<npc>` 分区——省一次调用但角色混淆与注入无法根治。

### ADR-002：状态层确定性持有，LLM 只读
- **决定**：所有状态由 Session Manager 唯一持有；Judge/NPC 只读注入、无权改写；状态迁移只发生在 Settlement 与 Scheduler 两个纯函数。
- **边界硬规则**：①Judge 输出仅作 Settlement 输入，不写库 ②NPC 仅输出台词，不携带状态语义 ③NPC 台词无事实效力（嘴硬但认同条已到 80 是特性）④注入异常降级走确定性降 L0。

### ADR-003：调度用确定性规则，内容用 LLM
- **决定**：调度层（何时异议 + 多强）是确定性纯函数；内容层交 NPC LLM，由调度下发 beat 约束。
- **理由**：可复现、抗注入（玩家无法话疗 NPC 别打异议）、延迟可预期、内容创作空间保留。

### ADR-004：每回合 2 次调用，不合并
- **决定**：1 Judge + 1 NPC 顺序执行（NPC 依赖 Judge 结果决定语气与 beat）。
- **理由**：合并重引角色混淆；需不同模型档；分开计费/限流/降级。

### ADR-005：判定非流式 + NPC 流式
- **决定**：Judge 非流式结构化输出 P95<1.5s；NPC 流式 SSE 首 token P95<1.5s；回合端到端 ≤4s；VFX 结算后 <10ms 触发。
- **理由**：判定需完整 schema 可校验；NPC 流式把等待压到首 token + 边出边读。

---

## 4. Schema 定义

**Judge 输出**：
```jsonc
{
  "dimension": "EVIDENCE",   // LOGIC|EVIDENCE|EMOTION|UTILITY|IDENTITY|AUTHORITY|NULL
  "strength": "L2",          // L0|L1|L2|L3
  "confidence": 0.82,        // <阈值(tier) 则降 L0
  "rationale": "...",        // [扩展] 维度标签反馈
  "injection": false         // [扩展] true→强制 NULL/L0
}
```

**NPC Profile**：`id/name/tier/persona/background/stance/dimensions/weakness/strength/logic_bias/emotion_bias/speech_style/language_habits/rebuttal_style/drift_personality/match_domains`。

---

## 5. NPC 强度调度（Difficulty Pacing）

- **反击压力 P(a) = (100 − a)/100**：a 越低（NPC 未说服、占上风）→ P 越高。
- **异议阈值**：`objection_threshold(t) = 50 + (t−3)×5`（L1=40 … L5=60）。a < threshold → 主动异议。
- **异议强度**：`intensity = clamp(1 + floor(below/15), 1, 3)`，below = threshold − a。
- **Beat 决策树**（优先级从高到低）：
  1. turn==1 → OPENING
  2. warm-up（turn≤2 且 intensity<2）→ TALK
  3. 命中强项 && L1~L3 → REBUTTAL（NPC 反驳 + 红异议）
  4. 命中薄弱点 && L2/L3 → YIELD（NPC 动摇 + 玩家金异议）
  5. no_progress_streak≥3 → HOOK
  6. a < threshold && cooldown==0 → OBJECTION（主动异议）
  7. else → TALK
- **异议冷却**：OBJECTION 后 1 回合强制 TALK，防连续异议泛滥。

---

## 6. 双向异议触发信号契约（给前端）

`turn_resolved` 事件核心字段：

```jsonc
{
  "type": "turn_resolved",
  "turn": 3,
  "judge": { "dimension": "EVIDENCE", "strength": "L2", "label": "证据", "rationale": "..." },
  "settlement": { "confidence_delta": -20, "confidence": 60, "token_remaining": 320 },
  "objection_event": { "side": "player", "kind": "hit_weak", "intensity": 0, "duration_ms": 1000 },
  "beat": "YIELD",
  "emotion": { "npc": "动摇", "player": "紧张" },
  "npc_reply_stream": "/api/session/{sid}/turn/{turn}/stream",
  "next": { "status": "ONGOING" }
}
```

**side/kind 映射**：命中薄弱点 L2/L3 → `player/hit_weak`（玩家金异议）；命中强项 L2/L3 → `npc/rebuttal`（NPC 红异议）；主动异议 → `npc/npc_proactive`；命中薄弱点 L1 → `none`（只做警觉微表情）。

---

## 7. 延迟 / 成本预算

- 每回合 ≈ 2.7k~3.5k token（规划 ~3,000/回合）。
- Judge P95<1.5s；Settlement+Scheduler<10ms；NPC 首 token P95<1.5s；回合端到端 ≤4s。
- 单局 ≈ 2~2.5 万 token；30 分钟 demo ≈ 25~40 万 token（粗估 ¥5~20，需按实际选型钉定）。

---

## 8. 风险与缓解（节选）

| 风险 | 缓解 |
|---|---|
| Prompt 注入 | 四道护栏（data 隔离 + 白名单枚举 + 状态层只读 + rubric/few-shot + confidence 阈值） |
| 判定不稳定 | 闭合枚举 + rubric + few-shot + confidence 降 L0 + 维度标签反馈 + 30~50 条校准集回归 |
| 成本超预算 | Judge 轻量模型 + profile 裁剪 + history 近 3 回合 |
| 延迟 | Judge 轻量 + VFX 即时 + NPC 流式 + 超时降级降 L0 |
| 强度曲线失衡 | 纯函数可单测 + 异议冷却 + `[微调]` 阈值 |
| L5 多薄弱点未定义 | 待定（GDD 8.1#3），demo 先单薄弱点过渡 |

---

## 9. 待主理人确认项

1. **【需确认】反击强度语义的起始点张力**（见下，最重要）：warm-up 守卫的语义解读。
2. **【知识缺口】模型与单价**：需按实际供应商钉定。
3. **【待定】L5 多薄弱点贡献阈值**。
4. **【待定】`[微调]` 数值**：加分表/漂移/异议步长/阈值偏移。
5. **【预留】玩家主动「认同」投降按钮**（SURRENDER 态已预留）。

---

## 10. 附录：工程控制清单（一页规则）

1. 状态迁移只能发生在 SettlementEngine 与 Scheduler 两个纯函数。
2. LLM 输出不落库为事实，先经 AntiInjectionGuard 解码校验。
3. Judge 与 NPC 永不共享上下文、永不互传内部指令。
4. 所有数值表进 Config Store，改表不改码。
5. 每个纯函数配单测；Judge 配 30~50 条校准集回归。
6. 判定超时/解码失败 → 确定性降 L0，不阻塞 NPC 回复。
