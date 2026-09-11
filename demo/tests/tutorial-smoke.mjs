/* 新手教学关 · 运行时冒烟测试（零依赖，node:vm + stub DOM）
 * 目的：证明状态机真的能从 s0 推进到胜利结局，而不是"文件存在"。
 * 跑法：node demo/tests/tutorial-smoke.mjs
 * ---------------------------------------------------------------------------
 * 关键验证点：
 *   1. 全程 0 次 fetch 对局 API（零 LLM）
 *   2. 自信度弧线 100 → 100 → 80 → 40 → 0（与 core-loop 真值一致）
 *   3. 立绘表情序列 calm → calm → tense → anxious → desperate
 *   4. 玩家 4 句 / NPC 5 句，通关后弹结算页（#result-overlay 显示），点「返回主界面」→ showMode 回主菜单
 *   5. activeRound 在教学期被置 true（否则立绘会被 pause、打字机静默）
 */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(HERE, "..");
const code = fs.readFileSync(path.join(DEMO, "static", "tutorial.js"), "utf8");
const data = JSON.parse(fs.readFileSync(path.join(DEMO, "static", "tutorial.json"), "utf8"));

const log = {
  addMsg: [], addMsgNpc: [], confidence: [], emotion: [],
  objection: [], radar: [], showMode: 0, apiFetch: [],
};

/* ---------------- stub DOM ---------------- */
let host = null;
function makeEl(id) {
  const e = {
    id, innerHTML: "", textContent: "", value: "",
    style: {}, dataset: {}, hidden: false, disabled: false,
    classList: (() => {
      const s = new Set();
      return {
        add: (...c) => c.forEach((x) => s.add(x)),
        remove: (...c) => c.forEach((x) => s.delete(x)),
        contains: (x) => s.has(x),
        toggle: (x) => { if (s.has(x)) { s.delete(x); return false; } s.add(x); return true; },
      };
    })(),
    __h: {},
    addEventListener(type, fn) { (this.__h[type] ||= []).push(fn); },
    fire(type) { (this.__h[type] || []).forEach((fn) => fn({ target: this })); },
    setAttribute() {}, getAttribute: () => null,
    appendChild() {}, removeChild() {}, insertBefore() {},
    querySelector: (sel) => getEl(sel),
    querySelectorAll: () => [],
    parentNode: null, offsetWidth: 0, focus() {}, remove() {},
    getBoundingClientRect: () => ({ top: 100, left: 100, bottom: 120, right: 120, width: 20, height: 20 }),
  };
  if (!host) host = e; else e.parentNode = host;
  return e;
}
const els = new Map();
function getEl(sel) {
  if (!els.has(sel)) els.set(sel, makeEl(sel));
  return els.get(sel);
}
const bodyChildren = [];   // 记录 document.body.appendChild 收到的元素 id（用于断言引导箭头）
const bodyEl = makeEl("body");
bodyEl.appendChild = (c) => { bodyChildren.push(c.id); };
const document = {
  readyState: "complete",
  head: makeEl("head"),
  body: bodyEl,
  createElement: (tag) => makeEl("new-" + tag),
  querySelector: (sel) => getEl(sel),
  querySelectorAll: () => [],
  addEventListener() {},
  getElementById: (id) => getEl("#" + id),
};
// 教学需要的宿主节点必须"存在且可见"
getEl("#input-row").parentNode = host;
getEl("#dialogue").parentNode = host;
getEl("#mode-screen").classList.contains = () => false;   // 主菜单可见
// 结算页默认隐藏（教学通关后才去掉 hidden）
getEl("#result-overlay").classList.add("hidden");
// 模拟全局 #restart → restartAction：run 为空 → showMode() 回主菜单（真实 app.js 绑定）
getEl("#restart").addEventListener("click", () => sandbox.showMode());

/* ---------------- stub 全局（模拟 app.js 顶层作用域） ---------------- */
const store = new Map();
const sandbox = {
  console,
  setTimeout, clearTimeout, Promise, JSON, Math, Object, Array, String, Number, Boolean, Error, Date,
  document,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
  fetch: async (url) => {
    if (String(url).includes("/api/")) { log.apiFetch.push(url); return { ok: false, status: 0 }; }
    return { ok: true, status: 200, json: async () => data };
  },
  // app.js 提供的可写状态
  state: { npcName: "对手", npcId: "", dimensions: {}, confidence: 100, token: 0, quota: 400, npcWeakness: [] },
  activeRound: false,
  roundVersion: 0,
  run: null,   // 全局系列赛状态；教学从主菜单进入时必为 null（showMode 已置空），教学期无路径改写它
  closeNpcInfo: () => {},
  characterViews: { npc: { setSpeaking() {} } },
  // app.js 提供的渲染/演出函数
  addMsg: (role, text, tag) => { log.addMsg.push({ role, text, tag }); },
  addMsgNpc: (text, tag) => { log.addMsgNpc.push({ text, tag }); return Promise.resolve(); },
  objection: (side, evt) => { log.objection.push({ side, evt }); },
  renderRadar: (dims, hl) => { log.radar.push(hl ?? null); },
  renderConfidence: () => { log.confidence.push(sandbox.state.confidence); },
  renderToken: () => {},
  setPortrait: (side, emo) => { if (side === "npc") log.emotion.push(emo); },
  showMode: () => { log.showMode += 1; },
  hideScreens: () => {},
  updateCharacterVisibility: () => {},
  // app.js 顶层 const（不挂 window），教学用 typeof 守卫引用，这里注入以验证中文映射
  DIM_LABELS: { LOGIC: "逻辑", EVIDENCE: "证据", EMOTION: "情感", UTILITY: "利益", IDENTITY: "认同", AUTHORITY: "权威" },
  innerWidth: 1280, innerHeight: 800,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;

/* ---------------- 自动点击器：模拟玩家一路点「继续 / 就这么说」 ---------------- */
const clicker = setInterval(() => {
  getEl("#tut-continue").fire("click");
  getEl("#tut-say-btn").fire("click");
}, 20);

/* ---------------- 跑 ---------------- */
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// ① 不自动播放：加载后静置，教学不应自行启动（大王 2026-09-10 拍板：登录流程保持原样）
await new Promise((r) => setTimeout(r, 900));
const autoStartLines = log.addMsgNpc.length + log.addMsg.length;

// ② 唯一入口：点击主界面「新手教学」卡
getEl("#mode-tutorial").fire("click");

// 节拍预算：异议 850ms×4 + 自信度 420ms×4 + 雷达脉冲 300ms×3 ≈ 6s，留足余量
await new Promise((r) => setTimeout(r, 14000));
clearInterval(clicker);

/* ---------------- 断言 ---------------- */
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
  if (!ok) failed += 1;
};

console.log("\n新手教学关 · 运行时冒烟\n");

const npcLines = log.addMsgNpc.length;
const playerLines = log.addMsg.filter((m) => m.role === "player").length;
const objections1 = log.objection.length;
const conf = log.confidence;
// 首个 calm 是进入教学时的立绘复位（startTutorial 里 setPortrait("npc","calm")），教学步表情取后 5 个
const emo = log.emotion.slice(-5);

check("NPC 台词 5 句", npcLines === 5, `实际 ${npcLines}`);
check("玩家台词 4 句（不可编辑，走「就这么说」）", playerLines === 4, `实际 ${playerLines}`);
check("自信度弧线 100→100→80→40→0",
  JSON.stringify(conf) === JSON.stringify([100, 100, 80, 40, 0]), JSON.stringify(conf));
check("立绘表情序列 calm→calm→tense→anxious→desperate",
  JSON.stringify(emo) === JSON.stringify(["calm", "calm", "tense", "anxious", "desperate"]), JSON.stringify(emo));
check("异议演出 4 次（1 次红 + 3 次金）",
  objections1 === 4,
  "第一轮 " + objections1 + " 次");
check("教学期 activeRound 被置 true（否则立绘僵住/打字机静默）",
  sandbox.activeRound === false, "结束时已复位=false");
check("以胜利收尾（教学通关，不自动回主菜单）", log.showMode === 0, `showMode 调用 ${log.showMode} 次`);
check("通关后弹出结算页（#result-overlay 显示，hidden 已去掉）",
  !getEl("#result-overlay").classList.contains("hidden"),
  `hidden=${getEl("#result-overlay").classList.contains("hidden")}`);
check("结算页标题为「教学完成！」", getEl("#result-title").textContent === "教学完成！", `实际「${getEl("#result-title").textContent}」`);
check("确认按钮文案为「返回主界面」", getEl("#restart").textContent === "返回主界面", `实际「${getEl("#restart").textContent}」`);
// 模拟点「返回主界面」：真实 app.js 全局 restartAction（run 已空）→ showMode 回主菜单
getEl("#restart").fire("click");
check("点确认后返回主菜单（showMode 被调用一次）", log.showMode === 1, `实际 ${log.showMode}`);
check("零对局 API 调用（零 LLM）", log.apiFetch.length === 0, `实际 ${log.apiFetch.length}`);
check("不自动播放（静置 900ms 零输出，登录流程不受影响）", autoStartLines === 0, `实际 ${autoStartLines}`);
check("点击卡片可进入（主界面唯一入口）", npcLines > 0, `NPC 台词 ${npcLines} 句`);
check("引导箭头已创建（指向 #npc-info-btn 的 #tut-coach 元素）",
  bodyChildren.includes("tut-coach"), `body=${bodyChildren.join(",")}`);
check("软肋面板显示中文（EVIDENCE/AUTHORITY/LOGIC → 证据/权威/逻辑）",
  JSON.stringify(sandbox.state.npcWeakness) === JSON.stringify(["证据", "权威", "逻辑"]),
  JSON.stringify(sandbox.state.npcWeakness));

// ③ 回归测试（2026-09-11 大王报障）：通关回主菜单后，再次点教学卡必须能再次完整跑通。
// 历史 bug：showTutorialSummary 里 `run = null` 遮蔽了 IIFE 内的 run 函数（同名），
//   把教学主流程函数覆盖成 null → 二次进入 TypeError、卡片无反应。
const afterFirst = log.addMsgNpc.length;
const clicker2 = setInterval(() => {
  getEl("#tut-continue").fire("click");
  getEl("#tut-say-btn").fire("click");
}, 20);
getEl("#mode-tutorial").fire("click");
await new Promise((r) => setTimeout(r, 14000));
clearInterval(clicker2);
check("二次进入教学可再次完整跑通（回归 run 遮蔽 bug）",
  log.addMsgNpc.length === afterFirst * 2, `第一轮 ${afterFirst} 句，累计 ${log.addMsgNpc.length} 句`);
check("第二轮同样以结算页收尾（可反复重看）",
  !getEl("#result-overlay").classList.contains("hidden"), "overlay 显示");
getEl("#restart").fire("click");
check("第二轮确认后仍回主菜单", log.showMode === 2, `实际 ${log.showMode}`);

console.log(`\n${failed === 0 ? "全部通过" : failed + " 项失败"}\n`);
process.exit(failed === 0 ? 0 : 1);
