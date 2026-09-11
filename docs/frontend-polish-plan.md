# 《抬杠模拟器》前端演出层改造实施方案

**文责**：程基岩（技术负责人）｜Task **ENG-ART-001**（P0）
**日期**：2026-09-08 ｜ **状态**：待审批（本文档只做方案，未改动任何 `demo/` 代码）
**对齐**：`design/art-bible-v2.md` §2 分层表情 / §3 演出事件 / §7 决策点 4；`design/plan-art-upgrade.md` P1+P2
**硬约束**：零第三方依赖、零构建链、solo 开发、改动要能在 `localhost:8787` 立刻验证

---

## 0. 结论先行（TL;DR）

| # | 结论 | 依据 |
|---|---|---|
| 1 | **首屏 9MB 的真正元凶不是 6 张立绘，而是「缩略图加载原图」**：天梯/自由列表把 1.5MB 原图当 56px 头像用，一次拉 7.5MB | `app.js:341` / `app.js:371` |
| 2 | **表情系统不需要改后端档位**，只需前端加一张中文→英文映射表；`npc_id` 已在 API 返回体里，是现成的资产主键 | `server.py:796` / `_emotion()` `server.py:514-538` |
| 3 | **把「现有立绘」直接定义为 `calm` 帧**，缺失的新表情自动降级到 `calm`。→ **美术一张图都没出时，游戏表现与今天完全一致，不白屏** | 见 §2.4 |
| 4 | 资产用 **Pillow 转 WebP（本机已有，无需 cwebp）**：1024²→576×864 q80，**单张 1542KB → ~65–90KB（17–24×）**，6 张合计从 8.5MB 降到 ~0.5MB | §3.2 实测数据 |
| 5 | **后端唯一必改项：3 行 avatar 路径 + 2 行 Cache-Control**。其余全部在前端 | §2.5 |
| 6 | 演出全用 **CSS transform/opacity + SVG**，**不引入 Canvas 粒子系统**（JS 复杂度 + 每帧 GC，不值） | §4 |
| 7 | 总工作量 **≈9 小时**，其中 **≈8 小时可与美术出图完全并行**，只有「接图」一步必须等图 | §5 |

**一句话**：这是一次「纯前端 + 5 行后端」的改造，8.5MB 首屏有 7.5MB 是白送的优化，表情系统可以零风险地先搭骨架再等图。

---

## 1. 现状代码审计

### 1.1 演出层接入点全表

| # | 接入点 | 位置 | 现状 | 评估 |
|---|---|---|---|---|
| 1 | 情绪渲染主函数 `renderEmotion(npc, player)` | `app.js:168-176` | 只改 4 个 DOM 的 **emoji + 中文标签**，**完全不碰 `<img>`** | **要重写** |
| 2 | 表情映射表 `NPC_EMOJI` / `PLAYER_EMOJI` | `app.js:10-11` | 中文档位 → emoji 字符串 | **要改**（升级为「档位→state→URL」三级表） |
| 3 | NPC 立绘 `<img>` | `index.html:46`（硬编码 `npc_t1.png`）、`app.js:448`（`$("#npc-avatar img").src = d.npc.avatar`） | 开局设置一次，**整局不再变** | **要改**（改双层 + 状态机） |
| 4 | 玩家立绘 `<img>` | `index.html:26`（硬编码 `player.png`） | **JS 从不更新**，玩家侧完全静态 | **要改**（同 #3） |
| 5 | 立绘容器 `.avatar` | `style.css:108-119` | `clip-path` 多边形（非圆形 ✅ 已符合 art-bible-v2 要求）、`object-fit:cover; object-position:top center`；**无 `position`** | **要改**（加 `position:relative` + 双层绝对定位） |
| 6 | 情绪徽章 `.emotion` / `.emotion-label` | `index.html:30/50`；`style.css:126-130` | 24px emoji + 小胶囊标签 | **要改**（降级时才显示） |
| 7 | 底细面板第二情绪展示 | `app.js:173-175`（`#npc-info-emoji`） | 与主立绘同步的 emoji | **能复用**（保留作无障碍兜底） |
| 8 | 异议闪屏 `objection(side)` | `app.js:99-110` | 切 class（`flash-player`/`flash-npc`）+ `playImpact()` + 950ms 后复位 | **要改**（详见 #9/#10 两个缺陷） |
| 9 | 闪屏容器 `#objection-overlay` | `index.html:162-164`；`style.css:248-262` | 切换 class 会**改 `background`(radial-gradient)** → 触发 paint；`animation: flash 0.9s` 但 JS 950ms 才清，**若 950ms 内二次触发动画不会重放** | **要重写**（改常驻双层 + opacity/transform） |
| 10 | 屏幕震动 `#app.shake` | `style.css:263-270` | 动 `#app`（`position:fixed; inset:0`，含整棵子树）→ 全树重绘；同样有「950ms 内不重放」缺陷 | **要改**（加 `translate3d` + 重放 hack + 降级开关） |
| 11 | 系列赛横幅 `#series-bar` | `index.html:19-21`；`app.js:455-462`；`style.css:57-67` | 纯文本 `天梯 · X｜第 n/3 局｜你 a : b X`，**比分变化无动效** | **要改**（加比分弹跳，art-bible-v2 要求 200ms） |
| 12 | 结算弹窗 `#result-overlay` | `index.html:166-174`；`showResult()` `app.js:558-572`；`openResult()` `app.js:579-630`；`style.css:387-407` | 标题 + 副标题 + 复盘文本 + 按钮。**晋级/淘汰无差异化演出**（art-bible-v2 标为 P0） | **要改**（加金印/灰暗化） |
| 13 | token HUD `renderToken()` | `app.js:164-167`；`index.html:63`；`style.css:189-192` | `.low` class 在 ≤35% 时变红（**只有颜色变化**），**无暗角** | **要改**（加全屏暗角） |
| 14 | 倒计时 `tickTimer()` | `app.js:285-294`；`style.css:194-195` | `.low` 时 `opacity` 闪烁 ✅ 已是合成属性 | **能复用** |
| 15 | 自信度条 `renderConfidence()` | `app.js:156-163`；`style.css:105` | `transition: width 0.4s` —— **`width` 是 layout 属性**（每回合 1 次，频率低） | **要改**（低成本，`scaleX`） |
| 16 | 六维雷达 `renderRadar()` | `app.js:113-153` | 每回合重写 `svg.innerHTML`，DOM 重建 | **能复用**（回合级频率，非热路径） |
| 17 | 打字机 `addMsgNpc()` | `app.js:225-253` | `setTimeout` 16ms/字 + 每字 `scrollTop` 写入 | **能复用**（但每字写 `scrollTop` 会触发同步 layout，建议节流到每 4 字一次） |
| 18 | TTS | `app.js:45-96` | 分性别 + 分 tier 音色，`bianyi_muted` 持久化 ✅ | **能复用** |
| 19 | 选关/选边/主界面立绘 | `app.js:341`（`.tier-avatar`）、`app.js:371`（`.npc-card img`）、`app.js:393`（`#stance-avatar`） | **全部直接引用 1.5MB 原图当 48–56px 缩略图** | **要重写**（改缩略图，最大性价比） |
| 20 | 持久化 localStorage | `app.js:18` `bianyi_muted`、`app.js:23` `bianyi_freeMem` | 两个 key，命名前缀统一 ✅ | **能复用**（扩 `bianyi_fx`） |
| 21 | 静态文件服务 `_serve_file()` | `server.py:1200-1223` | **无 `Cache-Control` 头** → 开发期改图/改 JS 不生效；`.webp` MIME **已支持**（`server.py:1215` ✅） | **要改**（加 no-cache） |
| 22 | 静态路由 `do_GET()` | `server.py:1152-1160` | `path.startswith("/static/")` → `BASE/rel`，**自动递归子目录** → 新增 `assets/portrait/...` **无需改路由** ✅；但 `rel` 未过滤 `..` | **能复用**（`..` 穿越记为风险 R4） |
| 23 | 情绪后端源 `_emotion()` | `server.py:514-538` | NPC 4 档（得意/从容/动摇/被说服）由 confidence + beat 决定；玩家 4 档（从容/紧张/焦虑/绝望）由 token 比例决定 | **能复用**（档位不动） |
| 24 | 异议调度 `schedule()` | `server.py:554-596` | 输出 `objection{side,kind,intensity,duration_ms}`，**前端目前只用了 `side`**，`intensity`/`duration_ms` 被丢弃 | **能复用**（演出强度分级可直接消费 `intensity`） |
| 25 | 立绘 URL 生成 | `server.py:681` / `711` / `796` | **硬编码 `f"/static/assets/npc_t{tier}.png"`** —— 按 tier 映射，**不是 npc_id** | **要改**（见 §2.5，未来 15 NPC 会撞车） |

### 1.2 三个必须点名的现状缺陷

**D1 · 缩略图加载原图（最大性价比问题）**
```js
// app.js:341  loadTiers()
`<img class="tier-avatar" src="${t.avatar}" ...>`   // t.avatar = /static/assets/npc_t1.png = 1.5MB
// app.js:371  renderFreeList()
`<img src="${t.avatar}" ...>`                        // 同上
```
`.tier-avatar` 是 **56×56**（`style.css:321`），`.npc-card img` 是 **48×48**（`style.css:352`）。
→ **打开一次天梯列表 = 5 × 1.5MB = 7.5MB**，而真正用到的像素只有 5×56²。这是首屏 9MB 的绝大部分。

**D2 · 演出动画不可重放**
```js
// app.js:104-109
document.getElementById("app").classList.add("shake");
setTimeout(() => { ov.className = ""; ...classList.remove("shake"); }, 950);
```
`#app.shake` 动画只有 **0.4s**（`style.css:263`），但 class 挂了 **950ms**。若 950ms 内连续两次命中薄弱点，**第二次的 classList.add 不会重启动画**（class 已存在），玩家看到「第二次不震了」。闪屏同理（0.9s vs 950ms，边界更险）。
→ 修法：add 前先 `void el.offsetWidth` 强制 reflow，或用 `animationend` 事件复位。

**D3 · 立绘容器无定位上下文**
`.avatar`（`style.css:108-116`）只有 `display:flex`，**没有 `position`**。要做双层 crossfade 必须先加 `position:relative`。

---

## 2. 表情系统改造方案

### 2.1 资产路径约定（决策 + 理由）

```
demo/static/assets/
├── _raw/                        # 原图归档（可选，最后再移）
├── npc_t1..t5.png, player.png   # 保留 = 最后一道降级兜底
└── portrait/                    # 【新】按角色分目录
    ├── L1_A/  calm.webp  smug.webp  shaken.webp  defeated.webp   thumb.webp
    ├── L2_A/  ...
    ├── L5_A/  ...
    └── player/ calm.webp  tense.webp  anxious.webp  desperate.webp  thumb.webp
```

**决策 1：按角色建目录（`portrait/{char_id}/{state}.webp`），不用扁平名（`char_npc_L1_A_calm.webp`）**
- 理由是**未来 15 NPC × 4 表情 = 60 张**：扁平命名下批量生成脚本要拼字符串、人眼扫目录会疯；分目录后可以 `for d in portrait/*/` 一次处理一个角色，**也让「预加载当前角色 4 张」变成一个目录遍历**。目录结构本身承载了语义。

**决策 2：主键用 `npc_id`（`L1_A`…`L5_A`），不用 `tier`**
- `npc_id` **已经在 API 返回体里**（`server.py:674/711/796`），前端零成本拿到；
- `server.py:681` 现在硬编码 `npc_t{tier}.png` —— 一旦扩到「5 层 × 3 个 NPC」（`plan-art-upgrade.md` P2 已拍板 15 NPC），**tier 会撞车（同层 3 个 NPC 抢一个文件名）**。表情资产从第一天就 keyed by `npc_id`，可无痛扩张。

**决策 3：state 用英文键，不用中文**
| 角色 | 中文档位（后端输出，不动） | state 键 |
|---|---|---|
| NPC | 得意 / 从容 / 动摇 / 被说服 | `smug` / `calm` / `shaken` / `defeated` |
| Player | 从容 / 紧张 / 焦虑 / 绝望 | `calm` / `tense` / `anxious` / `desperate` |

理由：① 中文文件名在 URL 里会被 percent-encode（`%E5%BE%97%E6%84%8F`），Network 面板没法肉眼调试；② 与 `art-bible-v2.md` §2.2 已建议的 `state=smug/calm/shaken/defeated` **保持一致，不给美术增加认知负担**；③ 中文→英文映射是**前端一张表**的事，后端继续输出中文，**零后端改动**。

**决策 4：`calm` 帧 = 现有立绘**
把 6 张现有 PNG 转换成 `portrait/{char_id}/calm.webp`。这样「默认帧」永远存在，**新表情是增量叠加，不是替换**。

**决策 5：不做 `@2x`**（理由见 §3.4）

### 2.2 切换机制

**DOM 结构**（改 `index.html:26` / `index.html:46`）
```html
<div class="avatar" id="npc-avatar">
  <img class="pt-layer" data-slot="a" alt="对手立绘">
  <img class="pt-layer" data-slot="b" alt="">
</div>
```

**CSS**（新增到 `style.css`，紧接 `.avatar` 规则 `style.css:108-119`）
```css
.avatar { position: relative; }                    /* 新增：D3 */
.pt-layer {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover; object-position: top center;
  opacity: 0;
  transition: opacity 300ms ease-out;
  will-change: opacity;                            /* 仅 4 个元素，常驻可接受 */
}
.pt-layer.on { opacity: 1; }
.pt-layer.pt-hit { transition-duration: 120ms; }   /* 命中反馈：更利落 */
@media (prefers-reduced-motion: reduce) {
  .pt-layer { transition-duration: 120ms; }
}
```

**JS**（替换 `renderEmotion()` `app.js:168-176`，新增模块）
```js
/* ---- 表情状态机 ---- */
const EMOTION_STATE = {                       // 中文档位 → state 键
  npc:    { "得意": "smug", "从容": "calm", "动摇": "shaken", "被说服": "defeated" },
  player: { "从容": "calm", "紧张": "tense", "焦虑": "anxious", "绝望": "desperate" },
};
const DEFAULT_STATE = { npc: "calm", player: "calm" };
const NPC_IDS = { 1:"L1_A", 2:"L2_A", 3:"L3_A", 4:"L4_A", 5:"L5_A" };  // 见 §2.5 过渡到后端下发

const _ptSlot  = { npc: "a", player: "a" };
const _ptState = { npc: null, player: null };
const _ptReady = new Set();      // 已确认存在的 URL
const _ptMiss  = new Set();      // 已确认 404 的 URL → 不再重试

function portraitUrl(side, state) {
  const id = side === "npc" ? (state.npcId || NPC_IDS[state.tier] || "L1_A") : "player";
  return `/static/assets/portrait/${id}/${state}.webp`;
}

/* 降级链：目标 state → calm → 旧 PNG → 空（显示 emoji 徽章） */
function fallbackChain(side, st) {
  const chain = [];
  if (st) chain.push(portraitUrl(side, st));
  const calm = portraitUrl(side, "calm");
  if (!chain.includes(calm)) chain.push(calm);
  chain.push(side === "npc"
    ? `/static/assets/npc_t${state.tier || 1}.png`
    : "/static/assets/player.png");
  return chain;
}

async function setPortrait(side, zhEmotion) {
  const st = EMOTION_STATE[side][zhEmotion] || DEFAULT_STATE[side];
  if (_ptState[side] === st) return;           // 幂等：同档位不重放动画
  const host = side === "npc" ? $("#npc-avatar") : $("#player-avatar");
  const next = host.querySelector(`.pt-layer[data-slot="${_ptSlot[side] === "a" ? "b" : "a"}"]`);
  const cur  = host.querySelector(`.pt-layer[data-slot="${_ptSlot[side]}"]`);

  for (const url of fallbackChain(side, st)) {
    if (_ptMiss.has(url)) continue;
    const ok = await loadImage(url);          // new Image() + decode()
    if (!ok) { _ptMiss.add(url); continue; }
    if (_ptState[side] === st) return;        // 期间又切了档 → 放弃本次
    next.src = url; next.classList.add("on");
    cur.classList.remove("on");
    _ptSlot[side] = _ptSlot[side] === "a" ? "b" : "a";
    _ptState[side] = st;
    // 降级到 calm/旧 PNG 时，把 emoji 徽章露出来补偿信息量
    toggleEmojiBadge(side, url !== portraitUrl(side, st));
    return;
  }
  toggleEmojiBadge(side, true);               // 全链失败：只留 emoji
}

function loadImage(url) {
  if (_ptReady.has(url)) return Promise.resolve(true);
  return new Promise((res) => {
    const im = new Image();
    im.onload  = () => { _ptReady.add(url); res(true); };
    im.onerror = () => res(false);
    im.src = url;
    if (im.decode) im.decode().catch(() => {});
  });
}
```

**调用点**（2 处）
- `app.js:468` `renderEmotion("得意","从容")` → `setPortrait("npc","得意"); setPortrait("player","从容");`
- `app.js:513` `renderEmotion(d.emotion.npc, d.emotion.player)` → 同上，取 `d.emotion.*`

### 2.3 预加载策略（首次切换防闪烁）

| 阶段 | 时机 | 内容 | 体积 |
|---|---|---|---|
| L0 首屏 | HTML 解析（`<img>` 硬编码） | 玩家 `calm` + 1 张默认 NPC `calm` | ~130KB |
| L1 选关 | 打开天梯/自由列表 | 5 张 `thumb.webp`（06–08KB/张） | **~40KB**（替掉 7.5MB） |
| L2 开局 | `newGame()` 拿到 `npc_id` 后 | 当前 NPC 的 **4 个 state** + 玩家 **4 个 state** | ~720KB |
| L3 空闲 | `requestIdleCallback`（首帧之后） | 同上（L2 已覆盖则跳过） | 0 |

**关键**：`requestIdleCallback` 里**全部 8 张都预解码进 `_ptReady`**，之后再切档就是纯 opacity 过渡，**不可能闪**。
首次切换若尚未预载完 → `loadImage()` 会 await，`next.src` 在解码完成后才赋值，**旧帧一直留在屏幕上**，不会白屏。`.avatar` 的 `background: var(--bg-card)`（`style.css:111`）兜底最后一道。

```js
function prefetchPortraits(npcId) {
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
  idle(() => {
    ["calm","smug","shaken","defeated"].forEach((s) => loadImage(`/static/assets/portrait/${npcId}/${s}.webp`));
    ["calm","tense","anxious","desperate"].forEach((s) => loadImage(`/static/assets/portrait/player/${s}.webp`));
  });
}
```

### 2.4 缺失资产降级（开发期不白屏）

**三级降级链**（已在 `fallbackChain()` 实现）：

| 级别 | 条件 | 表现 |
|---|---|---|
| 1 | `portrait/{id}/{state}.webp` 存在 | ✅ 真·变脸（最终态） |
| 2 | 该 state 还没出图 | 落回 `calm.webp`（= 今天的立绘）+ **emoji 徽章重新显示**补偿信息量 |
| 3 | `calm.webp` 也缺失（转换脚本没跑） | 落回 `/static/assets/npc_t{tier}.png` 原图 |
| 4 | 全挂 | 隐藏 img，只留 emoji 徽章 + 文字标签 |

**这意味着：美术一张新图都没交付时，玩家看到的画面 = 今天完全一致。** 每交付一个 NPC 的 4 张图，那个 NPC 就「活」过来。**可以放心先合代码再等图。**

`_ptMiss` 缓存 404 结果，避免每回合重复发起失败请求刷屏 Network。

### 2.5 后端需要配合的改动（总计 5 行）

| 项 | 位置 | 改动 | 判断 |
|---|---|---|---|
| **① avatar 路径 npc_id 化** | `server.py:681`、`711`、`796` | `f"/static/assets/npc_t{t}.png"` → `f"/static/assets/portrait/{npc_id}/calm.webp"` | **必做**（3 行） |
| **② 新增 `avatar_thumb`** | 同上 3 处返回体 | `f"/static/assets/portrait/{npc_id}/thumb.webp"` | **必做**（3 行，可合并进 ①） |
| **③ `npc_id` 下沉到前端 state** | 前端 `app.js:443` 附近 | `state.npcId = d.npc.npc_id` | **必做**（前端，`npc_id` 已返回，无需后端改） |
| ④ `Cache-Control` | `server.py:1220` 前 | 加一行 `no-cache` | **必做**（见 R1） |
| ⑤ `memory_recall` | `new_session()` `server.py:793-812` | 加 `"memory_recall": (entry.get("memories") or [{}])[-1].get("summary","")` | 选做（P1「翻旧账」演出） |
| ⑥ 统一 emotion 档位名 | `server.py:514-538` | **不改** | **明确不改**：档位语义已与 `beat` 联动、稳定；改名要同时动 `_emotion` 与 LLM prompt，收益为零。映射在前端做 |

> **`intensity` 字段提示**：`server.py:584` 已输出 `objection_intensity(below)`，前端目前丢弃。建议顺手接上，用于「背水一战」时闪屏更强——零后端成本。

---

## 3. 资产优化方案

### 3.1 现状实测

```
npc_t1.png     (1024, 1024)  RGB  1.51MB      ← 全部 6 张：1024×1024、RGB、无 alpha
npc_t2.png     (1024, 1024)  RGB  1.29MB
npc_t3.png     (1024, 1024)  RGB  1.68MB
npc_t4.png     (1024, 1024)  RGB  1.25MB
npc_t5.png     (1024, 1024)  RGB  1.44MB
player.png     (1024, 1024)  RGB  1.33MB
TOTAL                             8.50 MB
```
工具链实测：**Pillow 12.3.0 已装且 WebP 可用**（`features.check('webp') == True`）；**`cwebp` / `ffmpeg` / `pngquant` 均不可用**。→ **结论：走 Pillow，不需要装任何东西。**

### 3.2 目标规格（基于本机实测压缩数据）

实测（npc_t1，1024² 源）：

| 目标尺寸 | q72 | q80 | q86 | q90 |
|---|---|---|---|---|
| 512×768 | 29.6KB | 37.5KB | 48.6KB | 60.3KB |
| 640×960 | 42.6KB | **54.4KB** | 71.1KB | 88.3KB |
| 768×1152 | 56.3KB | 71.1KB | 92.4KB | 118.9KB |
| 128×192 thumb (q78) | — | **6.2–8.1KB** | — | — |

**拍板规格**：

| 项 | 规格 | 理由 |
|---|---|---|
| 格式 | **WebP 有损，无 alpha** | 原图就是 RGB 无透明；画框由 CSS `clip-path` 提供（`style.css:113`），**不需要透明通道**；无 alpha 的 WebP 更小 |
| 尺寸 | **576×864（2:3 竖版）** | 立绘区实际约 244×450 CSS px（§3.3）；576 宽 = CSS 宽度的 **2.36×**，1×/1.5× 屏绰绰有余，2× 屏仅轻微偏软 |
| 质量 | **q80，method=6** | 实测 55–90KB；AI 插画无高频细节，q80 肉眼无损。q86 多花 30% 体积换不出可见差异 |
| **单张上限** | **≤ 120KB**（目标 ~90KB） | 硬闸门，超了脚本报警 |
| **首屏预算** | **≤ 300KB**（主界面 0 + 选关 40KB + 开局 2 张 ~130KB） | 从 8.5MB 降下来 |
| **单局总量** | **≤ 800KB**（8 张表情 + 5 张 thumb） | 一局打几分钟，完全可接受 |
| 缩略图 | **128×192 WebP q78，≤ 10KB** | 供 48/56px 头像位 |

**画框统一规格（给美术 / 给脚本）**：
```
比例 2:3 竖版；头顶留白 6%（±2%）；眼睛位于画面高度 ~28%；
水平居中；下巴不贴边（底部留 ≥8%）
```
> **为什么必须统一画框**：crossfade 是**同一像素位置的两张图互相淡入淡出**。若 4 张的头部位置/缩放不一致，淡入时会看到「头跳一下」——比不变脸更糟。这条是**硬要求**，要写进给美术的交付说明。

### 3.3 立绘区实际尺寸测算

`.portrait` flex-basis **268px**（`style.css:80`），padding 12px → 内宽 **~244px**。
高度 ≈ 视口 − topbar(50) − series-bar(~28) − bottom-bar(~80) − padding(20) − conf-box(~40) − pinfo(~50) − actions(~42) − chip(~30) ≈ **~450px**（1080p 下的典型值）。
→ 容器 **244×450（比例 ≈ 1:1.85）**，而源图是 1:1 方形 —— `object-fit:cover` 会横向裁掉约一半。
→ **2:3 竖版画框（1:1.5）比方形更贴合容器，能少裁掉 ~20% 的横向无效像素**，这也是选 2:3 而不是保留方形的理由。

### 3.4 Retina @2x：不做（决策）

| 理由 | 说明 |
|---|---|
| 收益低 | 576 宽已是 CSS 宽度 2.36×，2× 屏只轻微偏软；立绘是 AI 插画，无高频细节 |
| 成本高 | 资产数 ×2（24→48），零构建链下没有自动生成 `srcset` 的工具，全靠手工维护 |
| **延后成本 ≈ 0** | **路径与 state 命名不变，将来要 2x 只需改生成脚本的尺寸参数重跑** —— 这是「不做但可随时补」的典型 |

### 3.5 工具链与可复制命令

**新建 `demo/tools/optim_portraits.py`**（需单独授权；仅新增文件，不改现有代码）

```python
"""把现有 6 张 PNG 转成统一画框的 WebP 立绘 + 缩略图。
用法: python demo/tools/optim_portraits.py   (幂等，可重复跑)
"""
import pathlib
from PIL import Image

SRC  = pathlib.Path(__file__).resolve().parents[1] / "static" / "assets"
OUT  = SRC / "portrait"
# npc_id ↔ 旧文件名（当前 5 NPC 与 tier 一一对应；扩到 15 NPC 时在此表追加）
LEGACY = {"L1_A": "npc_t1.png", "L2_A": "npc_t2.png", "L3_A": "npc_t3.png",
          "L4_A": "npc_t4.png", "L5_A": "npc_t5.png", "player": "player.png"}
PORTRAIT, THUMB, Q = (576, 864), (128, 192), 80
CAP = 120 * 1024          # 单张硬上限

def frame(im, size):
    """统一画框：cover 缩放 + 水平居中 + 顶部对齐(保留头部)。"""
    sw, sh = size
    s  = max(sw / im.width, sh / im.height)
    nw, nh = round(im.width * s), round(im.height * s)
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - sw) // 2
    top  = min(round(nh * 0.06), max(0, nh - sh))   # 头顶留白 6%
    return im.crop((left, top, left + sw, top + sh))

def main():
    OUT.mkdir(exist_ok=True)
    for cid, fn in LEGACY.items():
        src = SRC / fn
        if not src.exists():
            print(f"  skip {fn} (不存在)"); continue
        im = Image.open(src).convert("RGB")
        (OUT / cid).mkdir(parents=True, exist_ok=True)
        for name, size, q in (("calm.webp", PORTRAIT, Q), ("thumb.webp", THUMB, 78)):
            dst = OUT / cid / name
            frame(im, size).save(dst, "WEBP", quality=q, method=6)
            kb = dst.stat().st_size / 1024
            flag = "  ⚠ 超上限" if name == "calm.webp" and dst.stat().st_size > CAP else ""
            print(f"  {cid}/{name:10s} {size[0]}x{size[1]}  {kb:6.1f} KB{flag}")

if __name__ == "__main__":
    main()
```

**验证命令**
```bash
python demo/tools/optim_portraits.py
# 期望：每张 calm.webp 55–95 KB，thumb.webp 6–9 KB

python -c "import pathlib;print(sum(f.stat().st_size for f in pathlib.Path('demo/static/assets/portrait').rglob('*.webp'))/1024,'KB total')"
# 期望：< 600 KB
```

**美术新图交付后的增量转换**（美术给的是 1024² PNG，命名 `L1_A_smug.png` → 丢进 `_inbox/` 后跑同脚本的 `--state` 模式，或直接一条命令）：
```bash
python -c "
from PIL import Image; import pathlib
for p in pathlib.Path('demo/static/assets/_inbox').glob('*.png'):
    cid, st = p.stem.rsplit('_', 1)          # L1_A_smug -> (L1_A, smug)
    im = Image.open(p).convert('RGB')
    d = pathlib.Path('demo/static/assets/portrait')/cid; d.mkdir(parents=True, exist_ok=True)
    # 复用上面 frame() 的画框逻辑
    s = max(576/im.width, 864/im.height); im = im.resize((round(im.width*s), round(im.height*s)), Image.LANCZOS)
    l = (im.width-576)//2; im = im.crop((l,0,l+576,864))
    im.save(d/f'{st}.webp', 'WEBP', quality=80, method=6)
    print(cid, st, round((d/f'{st}.webp').stat().st_size/1024,1), 'KB')
"
```

### 3.6 加载策略

| 场景 | 元素 | 策略 |
|---|---|---|
| 主界面 `#mode-screen` | 无图 | 零加载 ✅ |
| 天梯/自由列表 | `.tier-avatar` / `.npc-card img` | `thumb.webp`（~8KB）✅ **D1 修复** |
| 选边 `#stance-avatar` | 56px | `thumb.webp` |
| 对局主立绘 | `#npc-avatar` / `#player-avatar` | 首帧 `calm.webp`；空闲预取其余 7 张 |
| 全部 `<img>` | — | **加 `loading="lazy"` 到列表项**；主立绘**不**加（要立刻可见） |

> **不要给主立绘加 `loading="lazy"`**：`<img>` 在视口内，lazy 反而可能延迟首帧。

---

## 4. 动画与性能约束

### 4.1 属性纪律（控制清单）

| ✅ 只允许动画 | ❌ 禁止动画（会触发 layout / 重 paint） |
|---|---|
| `transform: translate/translate3d/scale/rotate` | `width` / `height` |
| `opacity` | `top` / `left` / `right` / `bottom` |
| `filter`（仅结算等一次性场景） | `margin` / `padding` |
| — | `box-shadow`（paint 极贵） |
| — | `background-position` / `background-image` 切换 |
| — | `border-width` / `font-size` / `clip-path` |

**现有违规与处置**：

| 位置 | 违规 | 处置 |
|---|---|---|
| `style.css:105` `#confidence-fill { transition: width 0.4s }` | 动 `width` | **改**：`transform: scaleX()` + `transform-origin: left`（纯色条无内容，拉伸无副作用）。每回合 1 次本不致命，但改只要 5 分钟 |
| `style.css:253-254` `.flash-*` 切 `background: radial-gradient(...)` | 改 background → paint | **重写**：预置金/红两个常驻层，只动 `opacity` + `transform: scale()` |
| `style.css:263-270` `#app.shake` 动全屏 `#app` | 全子树重绘 | **改**：`translate3d` + 动画期间挂 `will-change: transform`，结束后摘掉 |
| `app.js:247` 打字机每字写 `scrollTop` | 每字强制同步 layout | **改**：每 4 字写一次（60 字 → 15 次） |

### 4.2 各效果的低成本实现路径

| 效果 | 技术选型 | 理由 |
|---|---|---|
| 表情 crossfade | **双 `<img>` + CSS `opacity`** | 零 JS 逐帧逻辑，合成器直接处理 |
| 异议闪屏 | **2 个常驻 `div`（金/红 radial-gradient）+ opacity/scale** | 不动 background，纯合成；顺带修 D2 重放缺陷 |
| 全屏暗角（token 见底 / 背水一战） | **`#vignette` 单 div，`radial-gradient` 背景 + `opacity` 过渡** | 一个元素、一个属性，成本≈0 |
| 屏幕震动 | CSS `@keyframes` + `translate3d` | 已有，只需修重放 + 加降级 |
| 晋级金印 | **内联 SVG（印章路径）+ `scale(3)→scale(1)` + `opacity`** | 矢量、零位图、可复用色板；比 Canvas 简单 10 倍 |
| 金粒子（胜利） | **≤24 个 `<span>` + CSS `@keyframes` translate3d/rotate/opacity，动画结束 `remove()`** | DOM 粒子在 ≤30 个时开销可忽略；**不做 Canvas**（多一套 rAF 循环 + 每帧对象分配，与「零依赖快速验证」相悖） |
| 淘汰灰暗化 | `filter: grayscale()` 一次性作用于结算层 | 只在结算时用，非热路径 |
| 比分弹跳 | `transform: scale(1)→scale(1.35)→scale(1)` 200ms | 纯 transform |
| 雷达图 | 现有 SVG `innerHTML` 重建 | 回合级频率，保持现状 |

**统一纪律**：所有一次性元素（粒子/印章）在 `animationend` 里 `remove()`，**不残留 DOM**。

### 4.3 低端机与浏览器兼容降级

| 层级 | 触发条件 | 降级内容 |
|---|---|---|
| **系统级（自动，最高优先）** | `@media (prefers-reduced-motion: reduce)` | **全局关震动、关闪屏缩放、粒子数归零**；crossfade 降到 120ms |
| 硬件探测（自动） | `navigator.hardwareConcurrency <= 4` 或 `navigator.deviceMemory <= 4` | 关粒子、关金印缩放；保留闪屏（opacity only） |
| WebP 兜底 | 浏览器不支持 WebP（<3%） | **不做双格式**。目标环境（Chrome/Edge 评审演示）无风险；零构建链下维护两套资产不划算。真出问题还有降级链第 3 级的旧 PNG |
| 字体 | 无网络字体依赖 | 现有 `--serif` 已用 `Songti SC / 宋体` 系统栈（`style.css:23`）✅ |

**自动降级取值时机**：`app.js` 顶部**同步**读取（在 `showMode()` 之前），避免闪烁。

### 4.4 演出降级开关（决策点 4 的落地）

**持久化**（复用现有命名前缀）
```js
// localStorage: bianyi_fx  ->  JSON
const FX_DEFAULT = { flash: true, shake: true, particles: true, vignette: true };
let fx = Object.assign({}, FX_DEFAULT, JSON.parse(localStorage.getItem("bianyi_fx") || "{}"));
// 系统级 reduce-motion 强制覆盖（用户显式开过则尊重用户）
if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  fx = Object.assign(fx, { shake: false, particles: false });
}
document.documentElement.dataset.fxShake     = fx.shake ? "on" : "off";
document.documentElement.dataset.fxParticles = fx.particles ? "on" : "off";
```

**三级保险**（缺一不可）
1. **JS 早退**：`objection()`（`app.js:99`）开头 `if (!fx.flash) { /* 只播音效 + 对话标签 */ return; }`
2. **CSS 兜底**（防止别处漏加 class）：
```css
html[data-fx-shake="off"] #app.shake { animation: none !important; }
html[data-fx-particles="off"] .particle { display: none !important; }
@media (prefers-reduced-motion: reduce) {
  #app.shake { animation: none !important; }
  #objection-overlay.flash-player, #objection-overlay.flash-npc { animation-duration: 200ms; }
}
```
3. **默认值安全**：默认全开，但 `prefers-reduced-motion` 用户默认关震动+粒子 —— **光敏用户不设置也是安全的**。

**UI 入口位置**（决策）
- **主界面**：`#mode-inner` 底部（与 `#mode-reset` 同排，`index.html:109`）加一个 `⚙ 演出设置` 小按钮 → 展开 4 个 toggle + 一个「全部关闭（无障碍）」快捷键。
- **对局内**：**不加**。理由是 `#npc-side` 的 `.portrait-actions`（`index.html:54-57`）只有 2 个 34px 圆钮，塞第三个会挤；且对局中打开设置打断节奏。主界面入口足够（一局 3–8 分钟，玩家会回主界面）。

---

## 5. 实施顺序与工作量

> 每步**独立可验证**、改完立刻能在 `localhost:8787` 看到效果。
> **⚠ 需授权**：Step 0 需新建 `demo/tools/` 脚本；Step 1/7 需改 `demo/server.py`。本方案文档阶段**未执行任何写入**。

| Step | 改动文件 | 改动点 | 验证方法 | 耗时 | 是否需等美术 |
|---|---|---|---|---|---|
| **0** 资产管线 | **新建** `demo/tools/optim_portraits.py` | Pillow 转 6 张 PNG → `portrait/{id}/calm.webp` + `thumb.webp` | 跑脚本看体积；浏览器开 `/static/assets/portrait/L1_A/calm.webp` 出图 | **0.5h** | ✅ **可并行** |
| **1** 后端 5 行 | `server.py:681/711/796`、`1220` | avatar/avatar_thumb 指向 `portrait/{npc_id}/`；加 `Cache-Control: no-cache` | **重启后端**；`/api/tiers` 返回新路径；Network → Disable cache 关掉也生效 | **0.3h** | ✅ **可并行** |
| **2** 表情骨架 | `index.html:26/46`、`style.css`（`.avatar` 后）、`app.js`（`renderEmotion` → `setPortrait`） | 双层 img + crossfade + 映射表 + 降级链 + 预取 | 对局中立绘正常显示；**故意把 `smug.webp` 改名** → 应自动落回 calm + emoji 徽章，控制台无 404 刷屏 | **1.0h** | ✅ **可并行**（此时只有 calm，视觉与今天一致） |
| **3** 降级开关 | `index.html:109`（按钮）、`style.css`、`app.js` 顶部 | `bianyi_fx` 持久化 + 主界面入口 + `data-fx-*` + `prefers-reduced-motion` | 关震动 → 命中强项不抖；刷新保持；DevTools 模拟 reduce-motion → 自动关 | **0.8h** | ✅ **可并行** |
| **4** 闪屏/暗角重构 | `index.html`（`#objection-overlay` 内加两层 + `#vignette`）、`style.css:248-270`、`app.js:99-110`/`164-167` | 常驻双层只动 opacity/scale；修 D2 重放；vignette 联动 token<35% 与背水一战 | 连点两次命中 → **两次都闪都震**；token 降到 35% 以下 → 边缘暗角渐显；Perf 录 3 回合无掉帧 | **1.0h** | ✅ **可并行** |
| **5** 系列赛演出 | `app.js:455-462`/`579-630`、`style.css:57-67` | 横幅比分 200ms 弹跳 + 当前局高亮；晋级金印 SVG 落下；淘汰灰暗化 | 打完一个完整系列赛（可用 mock 快进） | **1.5h** | ✅ **可并行** |
| **6** 结算弹窗升级 | `index.html:166-174`、`app.js:579-630`、`style.css:387-407` | 比分板 + 晋级/淘汰差异化 + 复盘区样式 | 三种结局各看一次 | **1.0h** | ✅ **可并行** |
| **7** 翻旧账（选做 P1） | `server.py` new_session +1 行、`app.js` newGame | `memory_recall` → 开场前 1s 金字浮现 | 与同一 NPC 打第 2 局 → 出现「TA 还记得上次…」 | **0.8h** | ✅ **可并行** |
| **8** 表情资产接入 | `demo/static/assets/_inbox/` → 跑转换命令 | 美术图到位后按批次转换；**每转一个角色，该角色立刻变脸** | 逐个 NPC 打一局，确认 4 档切换 + 画框一致（无跳头） | **0.5h + 0.2h/角色** | ❌ **必须等图** |
| **9** 低端机降级 + 验收 | `app.js` 顶部探测、`style.css`、`style.css:105` confidence scaleX、打字机 scrollTop 节流 | 硬件探测自动降级；修剩余 layout 属性 | DevTools CPU 4× throttle 录一局；Network 首屏 < 300KB | **0.8h** | ✅ **可并行** |

**合计 ≈ 9.0 小时**（其中 Step 8 的 0.5h 固定 + 每个角色 0.2h；Step 7 为可选）

### 5.1 关键路径

```
[可并行区 ≈8h]  Step0 → Step1 → Step2 → Step3 → Step4 → Step5 → Step6 → Step9
                                    ↑
                              架构就位，此后接图零风险
[等图区]        Step8（美术出一批 → 转一批 → 亮一批）
```
**建议排期**：先一口气做完 Step 0–4（**2.6h**），此时「架构就位 + 首屏从 8.5MB 降到 ~200KB + 演出可降级」，**已经可以拿去演示**。Step 5/6/9 与美术出图并行。Step 8 变成纯流水线操作。

---

## 6. 风险清单

| # | 风险 | 后果 | 规避办法 |
|---|---|---|---|
| **R1** | **`_serve_file()` 无 `Cache-Control`**（`server.py:1200-1223`） | 浏览器按启发式缓存静态资源 → **改了 CSS/JS/图，刷新不生效**，误判「改错了」，浪费大量时间 | Step 1 加 `Cache-Control: no-cache`（常驻）。资产已降到 90KB，缓存收益可忽略。另养成习惯：**硬刷新 Ctrl+Shift+R** |
| **R2** | **改 `server.py` 必须重启后端**（无热重载；`start.bat` 直接起进程） | 改了没重启 → 前端拿旧数据，以为后端没改 | 改动后**先确认端口 8787 的进程已重启**；旧进程没退干净会导致「端口占用」起不来 → 用 `netstat -ano \| findstr 8787` 查杀 |
| **R3** | **改 CSS/JS 不需要重启，但改 `server.py` 需要** —— 容易混淆 | 重启了白重启 / 没重启干等 | 表格化：静态文件=免重启；Python=必重启。**Step 1（后端）与 Step 2（前端）分开做、分开验** |
| **R4** | `do_GET` 路径拼接未过滤 `..`（`server.py:1156-1158`） | 目录穿越读取（本地 demo 风险低，但属实打实的安全洞） | 加 `rel = os.path.normpath(rel).lstrip(os.sep)` 并断言 `rel.startswith("static"+os.sep)`。顺手修，3 行 |
| **R5** | **首帧白屏**：新路径图还没生成，旧 `<img>` src 已改 | 开发中期瞬间白屏 | 三级降级链（`calm` → 旧 PNG → emoji）+ `.avatar` 已有 `background`（`style.css:111`）。**Step 0 必须先于 Step 1 执行** |
| **R6** | **画框不一致导致 crossfade「跳头」** | 比不变脸更难看 | 统一 2:3 画框写进美术交付说明；**每接一个角色先肉眼验一次 4 档切换**再接下一个 |
| **R7** | 双层 img 内存：8 张 576×864 解码后约 **8 × 2MB = 16MB 显存/内存** | 低端机压力 | 只预载**当前对局的 2 个角色**（8 张），换对手时旧的随 GC 释放；不做全角色常驻 |
| **R8** | `will-change: opacity` 常驻 | 长期占用合成层 | 只有 4 个 `.pt-layer`，可接受；若后续扩张再改为过渡期间动态挂载 |
| **R9** | **并发写 `npc_state.json`**：`ThreadingHTTPServer` 多线程，`_finalize_match` 写盘 | JSON 文件损坏 → 记忆全丢 | 本次改造**不触碰状态写入逻辑**，风险不放大。建议后端统一收口到 `_lock` 内 + 原子写（临时文件 + `os.replace`）。记为后续项 |
| **R10** | 打字机 + 闪屏 + 震动同时触发 | 低端机掉帧 | 已有降级开关（Step 3）+ Step 9 硬件探测自动降级；`objection()` 与 `addMsgNpc()` 已串行（`app.js:515-521`） |
| **R11** | `npc_id` 与 tier 的映射目前是前端常量 `NPC_IDS`（Step 2 过渡用） | 扩到 15 NPC 时硬编码失效 | Step 1 后端下发 `npc_id` 后，**前端直接用 `d.npc.npc_id`**，`NPC_IDS` 只作兜底。**不要让它变成长期依赖** |
| **R12** | 美术一次交付 24 张，画框全不一致 | 返工 | **先只交付 1 个角色的 4 张 → 验收画框 → 再批量**。这是 Step 8 必须「分批」的原因 |

---

## 7. 验收清单（Done 定义）

- [ ] `python demo/tools/optim_portraits.py` 跑通，每张 `calm.webp` ≤ 120KB
- [ ] 首屏（主界面 → 天梯列表）Network 总传输 **< 300KB**
- [ ] `/api/tiers` 返回的 `avatar` 指向 `portrait/{npc_id}/calm.webp`
- [ ] 对局中 NPC 自信度跨过 80/50/25 阈值时，立绘切换且**无白屏、无闪烁**
- [ ] 故意删除 `smug.webp` → 自动降级到 `calm` + emoji 徽章，**Network 里 `smug.webp` 只 404 一次**（`_ptMiss` 生效）
- [ ] 关掉「震动」开关 → 命中强项不抖；刷新后保持；`prefers-reduced-motion` 用户默认关闭
- [ ] 950ms 内连续两次命中 → **两次闪屏、两次震动都播出来**（D2 已修）
- [ ] token 降到 35% 以下 → 边缘暗角渐显
- [ ] 打完一个 3 局系列赛 → 横幅比分弹跳、晋级金印、淘汰灰暗化都出现
- [ ] DevTools CPU 4× 节流下录一局，**无长帧（>50ms）**

---

## 8. 待拍板

| # | 决策点 | 我的建议 |
|---|---|---|
| 1 | **Step 0/1/7 需要写 `demo/` 代码**（新建 tools 脚本 + 改 server.py 5 行）—— 本次任务只授权了写文档 | **申请授权**，且 Step 1 改完需重启后端（会打断正在进行的演示） |
| 2 | 表情资产路线：**整脸变体 4 张**（图生图）vs **脸层贴回身体** | **整脸变体**（与 `art-bible-v2` §7-1 建议一致，工程最简） |
| 3 | 立绘区是否**移除 emoji 徽章** | **移除**（emoji 与新表情图打架，且显廉价）；改为「**降级时自动出现**」——没图时它兜底 |
| 4 | 是否做 @2x | **不做**（§3.4：延后成本≈0） |
| 5 | 是否做 WebP 双格式兜底 | **不做**（§4.3） |
| 6 | 演出设置入口放主界面还是对局内 | **主界面**（§4.4：对局内空间紧且打断节奏） |
