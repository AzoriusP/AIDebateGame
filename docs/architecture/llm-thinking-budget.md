# LLM 思考模式（thinking）成本与质量评估

> 2026-09-12 · 针对《抬杠模拟器》接入云端 LLM 的场景
> 结论先行：**本项目必须关闭思考模式。开了不是"贵"，是"不可用"——实测 hy4-preview 在两种任务上都会把 max_tokens 全部烧在推理链上、正文返回空串，直接触发项目里的"连接超时 / 思考垫话"故障。**

---

## 一、决策表

| 任务 | 调用频率 | 思考模式建议 | 理由 |
|---|---|---|---|
| `judge` 六维判定 | 每回合 1 次 | **off** | 6 分类 + 4 档强度的"模式匹配"任务，few-shot 已给 5 条示例；实测开思考判定结果**完全一致**，token ×86 |
| `npc` NPC 回复 | 每回合 1~4 次（含防重复重试） | **off（强制）** | 需求是"2~3 句、每句 ≤25 字、半截话、市井口语"，与思考模型的"完整严谨书面"目标**相反**；且推理链会跑飞吃满配额 |
| `other` 复盘 / 记忆摘要 / 认输台词 / 提示 | 每局各 1 次 | **off**（可试 low） | 唯一有归纳需求的任务，但每局仅 1 次，成本占比 <5%。若复盘质量确实空泛，再单独给它开 `low` |
| 全局默认 | — | **off** | 已在 `config.json` 落地 |

---

## 二、实测数据

### 2.1 本地 qwen3.5:latest（Ollama 9B），项目真实 prompt

每档 3 组用例取均值，非流式 `/api/chat`：

| 任务 | 思考 | 输出 token | 耗时 | 正文 | 判定结果 |
|---|---|---|---|---|---|
| judge | off | **20.7** | 0.62s | 58 字 | 3/3 正确 |
| judge | on | **1790**（427 / 3424 / 1519） | 16.37s | 58 字 | 3/3 **与关闭时完全相同**，仅 confidence 0.95→0.85/0.90 |
| npc | off | **58** | 1.00s | 79 字（有人设、有例子） | — |
| npc | on | **4000（配额吃满）** | 36.72s | **0 字** | 推理链 9416~11714 字符，未收敛 |

输入侧：judge prompt ≈ 810 token，npc prompt ≈ 1650~2030 token（随历史增长）。

### 2.2 云端 hy4-preview（tokenhub，项目当前 key）

| 设置 | 耗时 | 输出 token | reasoning token | 正文 |
|---|---|---|---|---|
| 默认（不传 thinking 参数） | 59.1s | 1200 | **1200** | **0** |
| `thinking:{"type":"disabled"}` | **3.8s** | **40** | **0** | 52 字 ✅ |
| `thinking:{"type":"enabled"}` | 110.8s | 2400 | 2400 | **0** |
| `enable_thinking:false` | 59.4s | 1200 | 1200 | **0**（该参数对混元**无效**） |
| judge + disabled | 2.0s | 21 | 0 | `{"dimension":"EVIDENCE","strength":"L2"}` ✅ |
| judge + enabled | 94.9s | 2400 | 2400 | **0** |

关闭后 NPC 实际输出（质量可用）：

> 自私？你爸妈养你到大就盼抱孙子！不结婚不生娃，老了病了连端水的都没！别拿选择当借口，就是太只顾自己！

### 2.3 glm-5.3-flash（同平台，作为"低成本替代"对照）

| 设置 | 耗时 | 输出 token | reasoning token | 正文 |
|---|---|---|---|---|
| npc `reasoning_effort=low` | 1.4s | 29 | 0 | 38 字 ✅ |
| npc `reasoning_effort=high` | 1.8s | 76 | 40 | 50 字 ✅ |
| judge `low` | 1.1s | 19 | 3 | `{"dimension":"EVIDENCE","level":2}` ⚠️ 字段名漂移 |
| judge `high` | 1.1s | 29 | 8 | 带 ` ```json ` 围栏（`_extract_json` 已能剥） |

GLM-5.3 系列**只能 enabled**，深度靠 `reasoning_effort` 控制——但它 1~2 秒返回、推理 token 个位数，是比 hy4 关思考（3.8s）更快的选项。

---

## 三、质量影响评估（回答"关掉会掉多少质量"）

### 3.1 NPC 回复：不降反升

| 维度 | 开思考 | 关思考 |
|---|---|---|
| 人设一致性（市井、短句、半截话） | 差——推理模型倾向输出完整书面长句，与"每句 ≤25 字"直接冲突 | 好 |
| 可用性 | **0**（正文空，吃满配额） | 正常 |
| 响应速度 | 59~110s | 3.8s |
| 逻辑严密性（L4/L5 高逻辑 NPC） | 理论略优 | 靠 prompt 的【立场铁律】+ 素材库 A/B 源兜底，不靠模型临场推理 |

结论：NPC 的"聪明"应该来自**预置素材库 + 立场铁律 + 防重复机制**，不是让模型临场想。关思考不影响这条链路。

### 3.2 Judge 判定：几乎无损

- 本地 9B 上 3 条用例，开/关思考判定结果 100% 一致（EVIDENCE/L3、EMOTION/L2、NULL/L0）
- 云端 hy4 关思考 2.0s 判定正确
- 该任务本质是"按既定标准分类"，few-shot + 强制 JSON 已经足够；多步推理的边际收益≈0
- 唯一可观测差异：confidence 数值略粗（0.95 vs 0.85~0.90），不进战斗数值，风险低

### 3.3 复盘 / 记忆摘要：理论有损失，实际可接受

这类任务要归纳整局对话，思考有理论收益。但每局仅 1 次，成本占比 <5%，且当前复盘是"克制版"（只给战术反馈）。**保持 off；若实测发现复盘空泛，单独给它开 `low`。**

---

## 四、成本换算

按一局 8 回合、每回合 judge 1 次 + npc 1 次（常态，不含重试）估算**输出 token**：

| 模式 | judge | npc | 合计/局 | 相对倍数 |
|---|---|---|---|---|
| 全 off（云端 hy4 实测） | 21 × 8 = 168 | 40 × 8 = 320 | **≈ 0.5k** | 1× |
| 全 on（云端实测，且不可用） | 2400 × 8 = 19.2k | 1200 × 8 × 重试 2~4 次 = 19.2k~38.4k | **38k~58k** | **76×~116×** |

注意：开思考的账单里**没有任何一次产出可用正文**——这是纯亏损，不是"贵一点"。

---

## 五、厂商参数速查（同一件事，四种方言）

| 厂商 / 模型 | 关闭思考 | 降低思考深度 | 备注 |
|---|---|---|---|
| 腾讯混元 hy4（tokenhub） | `{"thinking":{"type":"disabled"}}` | — | `enable_thinking` **无效**；默认开启深度思考；返回 `reasoning_content` |
| 智谱 GLM | `{"thinking":{"type":"disabled"}}` | `reasoning_effort: low\|high` | GLM-5.3 / 5.3-FLASH 只能 enabled，靠 effort 控深度；`clear_thinking` 默认 true（自动丢弃历史推理，省钱） |
| Qwen 系 | `{"enable_thinking": false}` | `thinking_budget: N`（建议 ≥4096） | 需放 `extra_body`；商业版默认关闭、开源版默认开启 |
| OpenAI o 系列 / gpt-5 | 关不掉 | `reasoning_effort: low\|medium\|high` | 要关只能换非 o 模型 |
| Ollama（本地） | `{"think": false}` | — | 项目本地一直是关闭状态 |

---

## 六、已落地实现

### `demo/config.json`（新增 `thinking` 段，默认全 off，行为与改动前一致）

```json
"thinking": {
  "mode": "off",          // 全局默认：off | on | low
  "style": "auto",        // auto | ollama | enable_thinking | glm | thinking_dict | reasoning_effort
  "budget": 0,            // 推理预算 token，0=厂商默认；开启时正文配额会自动加上它
  "tasks": {"judge": "off", "npc": "off", "other": "off"}
}
```

### `demo/server.py`

- 新增 `_thinking_mode(task)` / `_thinking_budget(mode)` / `_thinking_payload(mode, provider, model)`：
  按 provider+model 自动选方言（`auto` 模式），也支持手工指定 `style`
- `_chat(..., task=...)`：judge / npc / other 三类任务分别取开关；开启时自动把推理预算加进 `max_tokens`
- `_openai_chat` / `_ollama_chat` 新增 `extra_body` 参数承载厂商字段
- 新增 `_USAGE_TOTAL` 累计器 + `usage.reasoning_tokens` 打印；`/api/status` 暴露 `usage` 与 `thinking` 配置，方便直接观察思考到底吃了多少 token
- 冒烟验证：`_thinking_payload` 8 种组合输出正确；本地 judge 端到端通过（806 prompt + 25 completion + 0 reasoning）

### 复现脚本

- `demo/tools/bench_thinking.py`（本地 Ollama，用项目真实 prompt）
- `demo/tools/bench_thinking_cloud.py`（云端 hy4 / glm，`--only-judge` 只跑判定对照）

---

## 六点五、第二轮：四条待拍板项的落地（2026-09-12 已完成）

按"省钱收益 × 紧迫度"排序执行，全部完成并冒烟通过。

### ① prompt 前缀稳定化 + 动态段预算（最大的一项）

**改动**：`_npc_system_prompt` 重排为「静态段在前、动态段在后」。提示词文案一字未改，只调顺序。

- 静态段（2086 字，跨回合逐字不变）：身份 / 自然度铁律 / 立场铁律 / 攻防铁律 / 输出要求 / 节奏铁律
- 动态段（每回合变化）：当前辩论 / 玩家刚说的话 / 当前状态 / 场次记忆 / 防重复块
- 新增 `_fit_dynamic_blocks()`：动态段字符预算 `npc_prompt_dyn_char_budget=1600`，超预算时从后往前裁（先砍场次记忆、防重复块），**前 3 块（当前辩论 / 玩家原话 / 当前状态）永不裁**

**实测**（模拟 6 回合）：

| 回合 | total chars | static chars | 前缀一致 |
|---|---|---|---|
| R1 | 2463 | 2086 | ✅ |
| R3 | 3502 | 2086 | ✅ |
| R6 | 3544 | 2086 | ✅ |

静态段占比 59%~85%。配 `npc_turn_prompt_char_budget=12000` 兜底，一回合 4 次重试也不会失控。

**history 缓存（第三轮已补，见 §6.6）**：静态段已拆成 `messages[0]` 独立固定 message。

### ② 每回合 prompt 成本闸

`npc_reply` 新增 `prompt_chars` 累计 + `NPC_TURN_PROMPT_CHAR_BUDGET`（默认 12000 字）。触发时**提前收工取 best-of**，而不是砍重试次数——保留防重复能力，只封顶花销。

```
[npc] 本回合 prompt 已用 10240 字，触顶 12000，不再重试，取当前最优版本
```

### ③ 超时三层闸对齐

| 配置 | 旧值 | 新值 | 实际语义 |
|---|---|---|---|
| `llm_attempt_timeout_s` | 20 | **45** | 单个候选端点的单次尝试上限 |
| `llm_total_timeout_s` | 60 | **90** | `_chat` 总时限（真正管用的那道） |
| `judge_timeout_s` | 180（无效） | **90** | 现在 `min(90,90)=90` 真实生效 |
| `npc_timeout_s` | 180（无效） | **90** | 同上 |

另加运行时告警：开思考 + 调用方 timeout > 总闸时会打印 `⚠️` 提示，避免再次出现"配置写着 180、实际 60"的静默陷阱。

### ④ judge 字段别名归一

- 新增 `_normalize_judge_fields()`：接受 `dimension/dim/维度`、`strength/level/强度/lvl`；数值档位 `0-3` → `L0-L3`；小写 `l2` → `L2`；中文维度名映射；非法值返回 `(None, None)` 交给兜底（并打印诊断日志）
- judge prompt 新增第 5 条硬约束：字段名逐字照抄、强度必须是 `"L0"~"L3"` 字符串而非数字
- 验证 9 组方言用例全部正确归一；端到端 3 条判定（L3 / L0 / L0）全部通过

---

## 六点六、第三轮：history 缓存 + JSON 提取加固（2026-09-12 已完成）

### ⑤ 静态段拆成独立 message，吃满前缀缓存

**问题**：第二轮虽然把 system prompt 内部重排成"静态在前、动态在后"，但整条 system 仍是 `messages[0]`。云厂商的缓存命中条件是"**请求前缀逐字节相同**"——它扫到 system 内部第一处变化（动态段开头）就停了，静态段白搭。而 history 又是紧跟其后的独立 message，进一步把变化点前移。

**改法**：新增 `_assemble_npc_messages()` + `_split_static_prefix()`，在 `【当前辩论】` 处切开：

```
messages[0] = 静态段（2085 字，跨回合逐字不变）   ← 缓存前缀命中这一段
messages[1] = 动态段（当前辩论/玩家原话/状态/素材/防重复）
messages[2..] = 历史对话（窗口可配）
```

**实测**（模拟两回合）：

| | R1 | R2 | 一致 |
|---|---|---|---|
| `messages[0]` 长度 | 2085 | 2085 | ✅ 逐字一致 |
| `messages[1]` 长度 | 1372 | 1372 | 内容不同（动态） |

注意：**不用动手调厂商参数**。prompt caching 由服务端按前缀自动判定，客户端唯一要做的就是保证前缀真的逐字相同。当前 OpenAI 兼容接口没有显式 `cache_control` 字段可用，所以"顺序正确"就是全部。

新增配置 `npc_history_window`（默认 6，与原行为一致），历史条数可调。

### ⑥ `_extract_json` 改括号配平

原实现 `re.search(r"\{.*\}", text, re.S)` 是贪婪匹配，遇到"JSON 后面还有解释文字"或"正文里先出现别的花括号"就会吞进来导致解析失败。

新实现分三级兜底：
1. 整段直接 `json.loads`
2. 剥 ` ```json ``` ` 代码块围栏
3. `_scan_json_object()` 按括号配平扫描 —— 带字符串状态与转义跟踪，不会把字符串里的 `{` `}` 当结构括号

**实测 10 组用例全通过**，其中 4 组是贪婪正则必挂的：前有解释、后有多余花括号、字符串内花括号、转义引号。截断/无 JSON 正确返回 `None` 交给上层兜底。

---

## 七、遗留风险与"更大的鱼"

1. ~~超时配置是隐形天花板~~ → **已修**（第二轮 ③）：总闸 90s，`judge_timeout_s` 真实生效，开思考时打印告警。
2. ~~防重复重试是成本放大器~~ → **已封顶**（第二轮 ②）：单回合 prompt 12000 字闸，触顶取 best-of。
3. ~~真正的成本大头是 prompt~~ → **已做前缀稳定化 + 动态预算**（第二轮 ①）。剩余空间见下。
4. ~~GLM-5.3 字段名漂移~~ → **已修**（第二轮 ④）：字段别名归一 + prompt 钉死。
5. ~~下一步只剩 history 缓存~~ → **已做**（第三轮 ⑤）：静态段已拆为 `messages[0]` 独立固定 message。
6. ~~`_extract_json` 正则贪婪~~ → **已修**（第三轮 ⑥）：括号配平 + 字符串状态跟踪，10 组用例通过。
7. **judge 侧没有做同等的缓存拆分**：judge prompt 目前是单条 system，内部前半段（六维标准/档案）也是跨回合稳定的。可以照同样思路拆，但 judge prompt 只有 810 字、占比小，收益有限 —— 优先级低。
8. **缓存折扣需要实测确认**：以上是"让前缀具备被缓存的条件"，实际命中率与折扣取决于所选厂商（混元/GLM/Qwen 的缓存策略与 TTL 各不相同）。换到真实付费 key 后，应对比 `/api/status` 的 `usage.prompt` 与账单里 `cached_tokens` 的差异来验证。
