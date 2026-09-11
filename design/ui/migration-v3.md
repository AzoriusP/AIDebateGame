# UI v3 工程落地清单

> 目标：把 `design/ui/prototype/index.html` 的 v3 设计系统落到 `demo/static/` 的真代码上，不改后端、不改玩法。
> 前提：前端目前是**纯静态 + id 驱动**（`app.js` 里 60+ 处 `$("#id")`），`characters.js` 通过外部传入 host 容器挂载立绘，不硬编码 index.html 结构 —— 这给了重构足够的腾挪空间。

---

## 1. 改动映射表

| v3 目标 | 现有载体 | 文件 | 改动类型 | 说明 |
|---|---|---|---|---|
| Design tokens | `:root` 变量（9 个旧色） | `style.css` | **改造** | 补 `bg-raise / border-strong / fs-* / sp-* / r-* / sh-* / ease / t-*`；`bg-deep` `#12162B → #0E1226` |
| 去 emoji 化 | `🎤💡🪙⏱🔊ⓘ⚙` 等 8 处 | `index.html` + `style.css` | **替换** | 新增 `icons.svg`（19 symbol）或内联 sprite；按钮内 `<svg class="icon"><use href="#i-xxx"/></svg>` |
| Button 组件 | 各处裸 `button` 样式 | `style.css` | **新增** | `.btn` + 5 变体 + 3 尺寸；保留旧按钮外观直到全部替换完成 |
| HUD 合并 | `#topbar` / `#series-bar` / `#token-box` / `#timer` 分散 | `index.html` + `app.js` | **重构** | 合成一个 `.hud` 三列网格；`renderToken()` / `renderConfidence()` 输出目标改到新节点 |
| 对话流限宽 | `#center > #dialogue` | `style.css` | **改造** | `max-width:720px; margin:0 auto`，两侧留白 |
| 对峙卡 | `#npc-side`（268px 固定栏） | `index.html` + `style.css` | **改造** | 改 `flex:0 0 240px` 悬浮卡；**保留 `#npc-avatar` 容器 id**（characters.js 的 host 挂载点，改名会断立绘） |
| 玩家状态收拢 | `#player-side` 整栏 | `index.html` | **降级** | 收缩为输入区左侧 `.me-chip`；保留 `#player-avatar` 与情绪标签 id |
| 底细抽屉 | `#npc-info-overlay`（全屏遮罩） | `index.html` + `app.js` | **改造** | 改右侧 360px drawer；`openNpcInfo()` / `closeNpcInfo()` 只改 class 操作，逻辑不动 |
| 入口合并 | `#entry-screen` + `#mode-screen` | `index.html` + `app.js` | **合并** | `showEntry()` / `showMode()` 合并；头像卡与演出设置收进二级入口 |
| 选对手 | `#tier-list` / `#free-list` | `app.js` | **改造** | 渲染函数改用 `.ticket.foe` 票据卡模板 + Tab 切换（复用 `renderFreeList()` 的卡片生成逻辑） |
| 响应式 | 无 | `style.css` | **新增** | 3 个断点（1024 / 768）+ `env(safe-area-inset-bottom)` + `prefers-reduced-motion` |
| 自信度条分级 | `#confidence-fill` | `style.css` + `app.js` | **增强** | 保持 `scaleX`（勿改 width，会掉帧）；`renderConfidence()` 里补 `data-level` 切换 |

---

## 2. 分阶段落地

### P0 · Token 层（零结构风险，可先合）
1. `style.css` 顶部 `:root` 全量替换为 v3 token。
2. 新增 `.btn` / `.chip` / `.ticket` / `.meter[data-level]` / `.icon` 组件样式（纯新增，不影响旧结构）。
3. 内联 SVG sprite 到 `index.html`（放在 `<body>` 首行）。
4. 把 8 处 emoji 换成 `<svg><use></svg>`。

**验收**：界面外观除配色微变外无差异；`renderConfidence()` 仍能跑。

### P1 · HUD 与抽屉（结构小改，逻辑不动）
5. `index.html`：新增 `.hud` 节点，把 `#series-bar` / `#token-box` / `#timer` 内容迁入；`#topbar` 保留但改为只承载 HUD。
6. `app.js`：`renderToken()` / `renderConfidence()` 的写入目标改到 HUD 内新 id（旧 id 保留为空壳或同步写入，防漏改）。
7. `#npc-info-overlay` → `.drawer` + `.scrim`；`openNpcInfo()` / `closeNpcInfo()` 内部从 `classList.toggle("hidden")` 改为 `classList.toggle("on")`。

**验收**：系列赛比分、token、计时在 HUD 显示正确；抽屉可开可关、Esc 可关；雷达图正常渲染。

### P2 · 对战区重构（视觉变化最大）
8. `#stage` 三栏 → `.arena`（对话流居中限宽 720px + 右侧 240px 对峙卡）。
9. `#player-side` 降级为输入区 `.me-chip`。
10. 投降按钮移入 HUD 右侧"更多"菜单（降低误触）。
11. 补 3 个断点响应式。

**验收**：桌面 / 平板 / 手机三档无横向滚动；立绘仍正常挂载（重点验 `#npc-avatar`）。

### P3 · 入口与选关（链路压缩）
12. `#entry-screen` + `#mode-screen` 合并为入场券；模式降为选对手页的 Tab。
13. `#tier-list` / `#free-list` 改票据卡模板。
14. 结算页 `#result-overlay` 补双 CTA 与复盘卡片样式。

**验收**：全链路走通一次（游客 → 天梯 → 王阿姨 → 三局两胜 → 晋级）。

---

## 3. 回归风险（按严重度排序）

| 风险 | 触发点 | 防控 |
|---|---|---|
| **立绘挂载断裂** | `#npc-avatar` / `#player-avatar` 被改名或移除 | characters.js 通过外部 host 挂载，P2 阶段**必须保留这两个 id**；改完先验立绘再验布局 |
| **判定/自信度不刷新** | HUD 重构后 id 未同步 | P1 阶段旧 id 保留空壳双写，全部替换完成后再删 |
| **移动端 `overflow:hidden`** | `html,body{overflow:hidden}` 未解 | P2 阶段改为 `#app` 内部滚动，body 允许滚动 |
| **演出降级开关失效** | `#fx-panel` / `#fx-master` 等 5 个 id | 演出设置收进 HUD 时保留全部 id 与事件绑定 |
| **输入框失焦（移动端）** | 键盘弹起遮挡 | 输入区 sticky 底部 + `env(safe-area-inset-bottom)`，实测真机一次 |

---

## 4. 每次改动后的冒烟清单

1. 启动 `demo/start.bat` → http://localhost:8787，**重启后端**（改 `index.html` 静态文件不用重启，改 `app.js` 要清缓存）。
2. 走一遍：游客登录 → 天梯赛 → L1 王阿姨 → 开辩 → 发 1 条论点 → 查看底细 → 投降 → 结算。
3. 检查：HUD 三段正确 / 自信度条分级变色 / 底细抽屉开关 / 立绘表情切换 / 移动端 390px 无横向滚动。
4. `prefers-reduced-motion` 开启后动效关闭。
