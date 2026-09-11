"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../static/app.js"), "utf8");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness({ settings = "{}", storageBlocked = false } = {}) {
  const nodes = new Map(), timers = new Map(), requests = [], routes = new Map(), controllers = [];
  let timerId = 0;
  function element() {
    const classes = new Set(), listeners = new Map();
    return {
      children: [], dataset: {}, style: { setProperty() {} }, value: "", textContent: "", disabled: false,
      classList: {
        add(...items) { items.forEach(i => classes.add(i)); },
        remove(...items) { items.forEach(i => classes.delete(i)); },
        contains(item) { return classes.has(item); },
        toggle(item, on = !classes.has(item)) { on ? classes.add(item) : classes.delete(item); },
      },
      get className() { return [...classes].join(" "); },
      set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
      get childElementCount() { return this.children.length; },
      set innerHTML(_) { this.children = []; },
      appendChild(child) { this.children.push(child); return child; },
      querySelectorAll() { return this.children; },
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, callback) { listeners.set(name, callback); },
      dispatch(name) { return listeners.get(name)?.({}); },
      remove() {}, focus() {},
      parentElement: { classList: { toggle() {} } },
    };
  }
  function node(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); }
  const createController = () => {
    const view = { events: [] };
    for (const name of ["setCharacter", "setEmotion", "setMotionEnabled", "playObjection", "setSpeaking", "reset", "pause"]) {
      view[name] = (...args) => view.events.push([name, ...args]);
    }
    controllers.push(view); return view;
  };
  const context = {
    console, URL, AbortController, Blob, navigator: {}, alert() {},
    localStorage: {
      getItem(key) { if (storageBlocked) throw new Error("Denied"); return key === "bianyi_fx" ? settings : null; },
      setItem() { if (storageBlocked) throw new Error("Denied"); },
    },
    window: { DebateCharacters: { create: createController }, matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener(name, callback) { node("window").addEventListener(name, callback); } },
    document: {
      hidden: false, documentElement: { dataset: {} },
      querySelector: node, getElementById: id => node("#" + id), createElement: element,
      querySelectorAll: () => node("#dialogue").children.filter(e => e.classList.contains("sys")),
      addEventListener() {},
    },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearInterval(id) { timers.delete(id); },
    async fetch(url, options) {
      if (url === "/api/status") return { ok: true, json: async () => ({ tts: { enabled: false, ready: false } }) };
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      const data = await routes.get(url)?.(body);
      return { ok: true, json: async () => data };
    },
  };
  vm.createContext(context);
  vm.runInContext(app, context);
  return { context, node, timers, requests, routes, controllers, run: code => vm.runInContext(code, context) };
}

const session = {
  sid: "session-1", topic: { domain: "测试", topic: "测试辩题", npc_stance: "支持" },
  player_stance: "反对", dimensions: {}, confidence: 100, token_remaining: 400, token_quota: 400,
  npc: { name: "测试对手", npc_id: "L1_A", tier: 1 }, opening: "开场", time_limit_s: 480,
};
async function start(h) {
  await flush(); h.run("confirmGuestEntry()");
  h.routes.set("/api/new_session", () => session);
  await h.run("newGame(1, null, 'topic-1')");
}

test("corrupt or unavailable preferences cannot stop startup", async () => {
  for (const options of [{ settings: "{" }, { settings: "null" }, { storageBlocked: true }]) {
    const h = harness(options); await flush(); h.run("confirmGuestEntry()");
    assert.equal(h.node("#avatar-controls").children.length, 4);
    assert.equal(h.run("fx.flash"), true);
    assert.equal(h.run("state.sid"), null);
  }
});

test("new round initializes controllers and ignores an obsolete session response", async () => {
  const h = harness(); await start(h);
  assert.equal(h.run("activeRound"), true);
  assert.equal(h.node("#send").disabled, false);
  assert.ok(h.controllers[1].events.some(([method, value]) => method === "setCharacter" && value === "L1_A"));
  const response = deferred(); h.routes.set("/api/new_session", () => response.promise);
  const pending = h.run("newGame(1, null, 'topic-2')");
  h.run("showMode()"); response.resolve({ ...session, sid: "obsolete" }); await pending;
  assert.equal(h.run("state.sid"), null);
  assert.equal(h.run("activeRound"), false);
  assert.equal(h.node("#mode-screen").classList.contains("hidden"), false);
});

test("server errors are reported instead of being read as session data", async () => {
  const h = harness(); h.routes.set("/api/new_session", () => ({ error: "session unavailable" }));
  await h.run("newGame(1, null, 'topic-1')");
  assert.equal(h.run("activeRound"), false);
  assert.match(h.node("#stance-prompt").textContent, /session unavailable/);
  assert.equal(h.node("#stance-start").disabled, false);
});

test("timeout waits for an in-flight turn and settles after its response", async () => {
  const h = harness(); await start(h);
  const response = deferred(); h.routes.set("/api/message", () => response.promise);
  h.routes.set("/api/timeout", () => ({ result: "LOSE_TIME", npc_reply: "", emotion: { npc: "得意", player: "绝望" } }));
  h.node("#input").value = "有依据的论点";
  const sending = h.run("send()");
  await h.run("handleTimeout()");
  assert.equal(h.requests.filter(r => r.url === "/api/timeout").length, 0);
  response.resolve({ judge: { dimension_label: "证据", dimension: "EVIDENCE", strength: "L1" },
    settlement: { direction: "neutral", confidence: 95, token_remaining: 380 }, dimensions: {},
    emotion: { npc: "得意", player: "从容" }, objection_event: { side: "none" }, npc_reply: "", next: { status: "ONGOING" } });
  await sending; await flush();
  assert.equal(h.requests.filter(r => r.url === "/api/timeout").length, 1);
  assert.equal(h.run("activeRound"), false);
  assert.equal(h.node("#send").disabled, true);
});

test("repeated objections replace the earlier cleanup timer", () => {
  const h = harness(); h.run("objection('player', {duration_ms: 1000})");
  const first = h.run("objectionTimer");
  h.run("objection('player', {duration_ms: 1200})");
  const second = h.run("objectionTimer");
  assert.equal(h.timers.has(first), false);
  assert.equal(h.timers.get(second).delay, 1200);
  assert.equal(h.node("#objection-overlay").classList.contains("active"), true);
  h.timers.get(second).callback();
  assert.equal(h.node("#objection-overlay").classList.contains("active"), false);
});

test("surrender waits for server settlement and honors its existing terminal result", async () => {
  const h = harness(); await start(h);
  const response = deferred(); h.routes.set("/api/surrender", () => response.promise);
  const pending = h.run("surrender()");
  assert.equal(h.run("activeRound"), true);
  assert.equal(h.run("state.busy"), true);
  response.resolve({ result: "WIN", npc_reply: "", emotion: { npc: "被说服", player: "从容" } });
  await pending;
  assert.equal(h.node("#result-title").textContent, "说服成功！");
  assert.equal(h.run("activeRound"), false);
  assert.equal(h.node("#send").disabled, true);
});

test("failed surrender leaves the round playable", async () => {
  const h = harness(); await start(h);
  h.routes.set("/api/surrender", () => ({ error: "offline" }));
  await h.run("surrender()");
  assert.equal(h.run("activeRound"), true);
  assert.equal(h.node("#send").disabled, false);
});

test("muting cancels pending speech before it can create audio", async () => {
  const h = harness(); await flush();
  const response = deferred(); let signal;
  h.context.fetch = (_, options) => { signal = options.signal; return response.promise; };
  h.run("voice.ready = true");
  const speaking = h.run("speak('测试语音', 'L1_A')");
  h.run("toggleMute()");
  response.resolve({ ok: true, blob: async () => ({ size: 500 }) });
  await speaking;
  assert.equal(signal.aborted, true);
  assert.equal(h.run("voice.audio"), null);
  assert.equal(h.run("voice.failStreak"), 0);
});

test("back/forward page restoration resumes existing character controllers", async () => {
  const h = harness(); await start(h);
  h.node("window").dispatch("pagehide");
  assert.equal(h.controllers[0].events.at(-1)[1], true);
  h.node("window").dispatch("pageshow");
  assert.equal(h.controllers[0].events.at(-1)[1], false);
  assert.equal(h.run("activeRound"), true);
  assert.equal(h.run("state.sid"), "session-1");
});


test("legacy account bypasses character creation and keeps fixed protagonist", async () => {
  const h = harness(); await flush();
  h.run(`applyAuthenticatedAccount({account_id: "legacy", player_name: "Existing account", setup_done: false, skin_id: "skin-desperate", appearance: {hair:"old"}})`);
  assert.equal(h.run("identity.setupDone"), true);
  assert.equal(h.run("identity.skinId"), "skin-default");
  assert.equal(h.run("Object.keys(identity.appearance).length"), 0);
  assert.equal(h.node("#mode-screen").classList.contains("hidden"), false);
  assert.equal(h.requests.some(r => r.url === "/api/auth/profile"), false);
});
