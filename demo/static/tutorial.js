"use strict";
/* 新手教学关（A11）· 脚本化教学局
 * ---------------------------------------------------------------------------
 * 性质：零 LLM、零后端、不可编辑发言的「交互式过场」，不是真对局。
 * 依赖：必须在 app.js 之后加载——本文件与 app.js 共享同一个全局作用域，
 *   直接复用 addMsg / addMsgNpc / objection / renderRadar / renderConfidence /
 *   renderToken / setPortrait / showMode / hideScreens /
 *   updateCharacterVisibility，以及可写的 state / activeRound / roundVersion。
 * 铁律：本文件不修改 app.js 任何一行；任何异常都必须「静默降级」，
 *   绝不允许教学失败卡住玩家进入对局。
 * 数据：/static/tutorial.json（必须落 static/，demo/data/ 不经 HTTP 暴露）
 * ------------------------------------------------------------------------- */
(function () {
  const SCRIPT_URL = "/static/tutorial.json";

  let script = null;
  let running = false;
  let fast = false;
  let pending = null;      // { resolve, mode }
  let ui = null;           // 教学 UI 引用
  let inputRowDisplay = null;
  let coachEl = null;          // 引导箭头元素

  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- 样式（自包含注入，不改 theme.css） ---------------- */
  const CSS = `
#tutorial-ui{display:flex;flex-direction:column;gap:10px;padding:10px 0 2px}
#tut-say{border:1px solid rgba(85,125,139,.35);border-radius:8px;padding:10px 12px;background:rgba(255,255,255,.72)}
#tut-say[hidden]{display:none}
#tut-say-label{font-size:12px;letter-spacing:.06em;color:#60767F;margin-bottom:6px}
#tut-say-text{font-size:15px;line-height:1.6;color:#1E2A2E;min-height:24px}
#tut-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#tut-bar button{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;cursor:pointer;
  border:1px solid rgba(85,125,139,.45);background:#fff;color:#1E2A2E}
#tut-bar button:hover{border-color:#B76055;color:#B76055}
#tut-bar button:disabled{opacity:.45;cursor:default}
#tut-say-btn{margin-top:10px;font:inherit;font-size:14px;font-weight:600;padding:9px 18px;border-radius:8px;
  cursor:pointer;border:1px solid #B76055;background:#B76055;color:#fff}
#tut-say-btn:hover{background:#A55549}
#tut-say-btn:disabled{opacity:.5;cursor:default}
#tut-skip{margin-left:auto}
#tut-fast[aria-pressed="true"]{border-color:#B76055;color:#B76055;font-weight:600}
#tut-hint{font-size:12px;color:#60767F}
/* 指向「对手底细」按钮的引导箭头：不拦截点击（pointer-events:none） */
#tut-coach{position:fixed;z-index:9999;display:flex;flex-direction:column;align-items:center;
  pointer-events:none;animation:tut-coach-in .28s ease-out both}
#tut-coach .tut-coach-arrow{width:0;height:0;
  border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:11px solid #B76055}
#tut-coach .tut-coach-text{background:#B76055;color:#fff;font-size:13px;font-weight:600;line-height:1.3;
  padding:8px 14px;border-radius:8px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.22);
  animation:tut-coach-pulse 1.6s ease-in-out infinite}
@keyframes tut-coach-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes tut-coach-pulse{0%,100%{transform:translateY(0)}50%{transform:translateY(3px)}}
@media (prefers-reduced-motion: reduce){
  #tut-coach,#tut-coach .tut-coach-text{animation:none}
  #tut-say-text,#tut-bar button{transition:none}
}
`;

  function injectStyle() {
    if ($("#tutorial-style")) return;
    const st = document.createElement("style");
    st.id = "tutorial-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------------- 引导箭头（指向「对手底细」按钮等） ---------------- */
  function showCoach(selector, text) {
    hideCoach();
    const target = document.querySelector(selector);
    if (!target) return;
    const el = document.createElement("div");
    el.id = "tut-coach";
    const arrow = document.createElement("div");
    arrow.className = "tut-coach-arrow";
    const box = document.createElement("div");
    box.className = "tut-coach-text";
    box.textContent = text || "";
    el.appendChild(arrow);
    el.appendChild(box);
    document.body.appendChild(el);
    coachEl = el;

    // 先入 DOM 再量宽度，才能算出居中的 left
    const r = target.getBoundingClientRect();
    el.style.top = (r.bottom + 9) + "px";
    const left = r.left + r.width / 2 - el.offsetWidth / 2;
    el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, left)) + "px";

    // 玩家点开面板即视为"看过" → 收起提示。
    // 用 addEventListener 叠加，不会覆盖 app.js 自己绑的 openNpcInfo。
    if (!target.__tutCoachBound) {
      target.__tutCoachBound = true;
      target.addEventListener("click", hideCoach);
    }
  }

  function hideCoach() {
    if (coachEl && coachEl.parentNode) coachEl.parentNode.removeChild(coachEl);
    coachEl = null;
  }

  function setTutorialSurrenderLocked(locked) {
    const surrenderBtn = $("#surrender");
    if (!surrenderBtn) return;
    surrenderBtn.disabled = locked;
    surrenderBtn.style.opacity = locked ? "0.5" : "";
    surrenderBtn.style.pointerEvents = locked ? "none" : "";
    surrenderBtn.setAttribute("aria-disabled", locked ? "true" : "false");
    surrenderBtn.title = locked ? "新手教学中暂不可用" : "";
  }

  /* ---------------- UI 装配 / 拆除 ---------------- */
  function buildUi() {
    injectStyle();
    const row = $("#input-row");
    if (row) { inputRowDisplay = row.style.display; row.style.display = "none"; }

    const wrap = document.createElement("div");
    wrap.id = "tutorial-ui";
    wrap.innerHTML = `
      <div id="tut-say" hidden>
        <div id="tut-say-label">你的发言 · 教学演示中，已为你写好</div>
        <div id="tut-say-text"></div>
        <button id="tut-say-btn" type="button">就这么说</button>
      </div>
      <div id="tut-bar">
        <button id="tut-continue" type="button" hidden>继续 ▸</button>
        <button id="tut-fast" type="button" aria-pressed="false">快进</button>
        <span id="tut-hint">点击「继续」或对话区推进</span>
        <button id="tut-skip" type="button">跳过教学</button>
      </div>`;

    const host = row && row.parentNode ? row.parentNode : ($("#dialogue") && $("#dialogue").parentNode);
    if (!host) return null;
    if (row && row.parentNode) host.insertBefore(wrap, row); else host.appendChild(wrap);

    ui = {
      wrap,
      say: wrap.querySelector("#tut-say"),
      sayText: wrap.querySelector("#tut-say-text"),
      sayBtn: wrap.querySelector("#tut-say-btn"),
      cont: wrap.querySelector("#tut-continue"),
      fast: wrap.querySelector("#tut-fast"),
      hint: wrap.querySelector("#tut-hint"),
      skip: wrap.querySelector("#tut-skip"),
    };

    ui.sayBtn.addEventListener("click", () => release("button"));
    ui.cont.addEventListener("click", () => release("click"));
    ui.skip.addEventListener("click", () => { if (running) finish(false); });
    ui.fast.addEventListener("click", () => {
      fast = !fast;
      ui.fast.setAttribute("aria-pressed", String(fast));
      ui.hint.textContent = fast ? "快进中：自动推进" : "点击「继续」或对话区推进";
      if (fast && pending) release(pending.mode);   // 立刻放行当前等待
    });
    // 点击对话区也能推进（视觉小说式手感）
    const dlg = $("#dialogue");
    if (dlg) dlg.addEventListener("click", () => release("click"));
    return ui;
  }

  function destroyUi() {
    hideCoach();   // 教学收尾若箭头仍显示，必须一并移除，否则 DOM 泄漏
    if (ui && ui.wrap && ui.wrap.parentNode) ui.wrap.parentNode.removeChild(ui.wrap);
    ui = null;
    const row = $("#input-row");
    if (row) row.style.display = inputRowDisplay || "";
  }

  /* ---------------- 推进控制 ---------------- */
  function waitAdvance(mode) {
    return new Promise((resolve) => {
      if (fast) { setTimeout(resolve, mode === "button" ? 350 : 700); return; }
      pending = { resolve, mode };
      if (mode === "button") { ui.sayBtn.disabled = false; }
      else { ui.cont.hidden = false; }
    });
  }

  function release(mode) {
    if (!pending) return;
    if (pending.mode !== mode) return;   // 只放行匹配的等待
    const { resolve } = pending;
    pending = null;
    if (ui.sayBtn) ui.sayBtn.disabled = true;
    if (ui.cont) ui.cont.hidden = true;
    resolve();
  }

  /* ---------------- 单步演出 ---------------- */
  async function showStep(step) {
    const p = step.performance || {};

    // 先收起上一步可能的箭头；本步只有在 performance.coach 里定义了才弹出，
    // 保证箭头只活在对应那一步、不会拖满整局教学。
    hideCoach();
    if (p.coach && p.coach.target) showCoach(p.coach.target, p.coach.text);

    // 雷达图：先脉冲软肋三轴（自动演出，不是玩家操作）
    if (Array.isArray(p.radar_pulse) && p.radar_pulse.length) {
      for (const d of p.radar_pulse) {
        renderRadar(state.dimensions, d);
        await sleep(fast ? 110 : 300);
      }
      renderRadar(state.dimensions, null);
    } else if (p.radar_highlight) {
      renderRadar(state.dimensions, p.radar_highlight);
    }

    if (p.emotion) setPortrait("npc", p.emotion);

    // 台词
    if (step.speaker === "npc") {
      if (fast) {
        addMsg("npc", step.text, p.verdict_label || "");
      } else {
        try { await addMsgNpc(step.text, p.verdict_label || "", roundVersion); }
        catch (_) { addMsg("npc", step.text, p.verdict_label || ""); }
      }
      if (characterViews.npc) characterViews.npc.setSpeaking(false);
    } else if (step.speaker === "player") {
      ui.sayText.textContent = step.text;
      ui.say.hidden = false;
      await waitAdvance("button");
      ui.say.hidden = true;
      ui.sayText.textContent = "";
      addMsg("player", step.text, p.verdict_label || "");
    } else {
      addMsg("sys", step.text);
    }

    // 异议演出（教学里的玩家异议全部是「命中软肋」拍点 → 带 kind，
    // 复用真实对局的 weak-hit 溢出窗口：手臂画出角色卡）
    if (p.objection === "player" || p.objection === "npc") {
      const kind = p.objection === "player" ? "hit_weak" : undefined;
      try { objection(p.objection, { duration_ms: 1000, kind }); } catch (_) { /* 演出降级：不影响流程 */ }
      await sleep(fast ? 220 : 850);
      // 收手回站姿。真实对局里 Live2D 的异议姿态会一直保持到发言结束（endStatement），
      // 教学是固定 1s 拍点、没人调 endStatement，不收手就会永远停在指向姿势。
      try { characterViews[p.objection]?.endStatement?.(); } catch (_) { /* 同上，降级不挡流程 */ }
    }

    // 自信度（固化自真值查表，非结算结果）
    if (typeof p.confidence_to === "number") {
      state.confidence = p.confidence_to;
      renderConfidence();
      await sleep(fast ? 120 : 420);
    }

    // 教学点评
    if (p.caption) addMsg("sys", p.caption);

    // NPC / 系统步等玩家点击推进
    if (step.speaker !== "player" && step.advance !== "finish") {
      await waitAdvance("click");
    }
  }

  /* ---------------- 主流程 ---------------- */
  async function startTutorial() {
    if (running) return;
    running = true;
    try {
      if (!script) script = await loadScript();

      // 进入战斗舞台：hideScreens() 无参 → #app 显示、其它屏隐藏
      hideScreens();
      buildUi();
      if (!ui) { running = false; return; }
      setTutorialSurrenderLocked(true); // 新手教学中锁定投降，避免触发 session not found

      // 装配教学用的伪状态（不写任何存档）
      const init = script.initial || {};
      state.npcName = "王阿姨";
      state.npcId = script.npc_id || "L1_A";
      state.dimensions = Object.assign({}, init.dimensions || {});
      // 软肋面板（openNpcInfo）直接 join state.npcWeakness，存英文键会显示
      // "EVIDENCE、AUTHORITY、LOGIC"。开局即转为中文标签，与真实对局一致。
      // DIM_LABELS 是 app.js 顶层 const（不挂 window），用 typeof 守卫避免缺失时报错。
      const dimLabels = (typeof DIM_LABELS !== "undefined") ? DIM_LABELS : {};
      state.npcWeakness = (init.weakness || []).map((k) => dimLabels[k] || k);
      state.confidence = init.confidence != null ? init.confidence : 100;
      state.quota = init.token_quota != null ? init.token_quota : 840;
      state.token = state.quota;
      state.topic = (script.topic && script.topic.text) || "";

      // 关键：activeRound = true，否则 updateCharacterVisibility 会把立绘 pause（王阿姨僵住）
      // 同时 addMsgNpc 的守卫 `!activeRound` 也会让打字机静默不出字
      activeRound = true;
      updateCharacterVisibility();

      const dlg = $("#dialogue");
      if (dlg) dlg.innerHTML = "";

      const topicEl = $("#topic-text");
      if (topicEl && script.topic) topicEl.textContent = script.topic.text;

      renderRadar(state.dimensions, null);
      renderConfidence();
      renderToken();
      setPortrait("npc", "calm");

      ui.sayBtn.disabled = true;

      for (const step of script.steps) {
        if (!running) return;                       // 中途跳过
        await showStep(step);
      }
      finish(true);
    } catch (err) {
      // 任何异常：静默降级回主菜单，绝不卡住玩家
      console.warn("[tutorial] 教学中断，已降级：", err);
      cleanup();
      try { showMode(); } catch (_) { /* 兜底到底 */ }
      running = false;
    }
  }

  async function loadScript() {
    const r = await fetch(SCRIPT_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error("tutorial.json HTTP " + r.status);
    return r.json();
  }

  function cleanup() {
    setTutorialSurrenderLocked(false);
    activeRound = false;
    pending = null;
    try { updateCharacterVisibility(); } catch (_) {}
    destroyUi();
  }

  function finish(victory) {
    cleanup();
    running = false;
    state.confidence = 100;          // 复位，避免污染下一局初值
    if (victory) {
      // 正常通关：弹与普通关卡一致的结算页，点「返回主界面」回主菜单
      showTutorialSummary();
    } else {
      // 跳过：直接回主菜单，不弹假胜利结算
      try { showMode(); } catch (_) {}
    }
  }

  /* ---------------- 教学结算页（复用普通关卡的 #result-overlay UI） ----------------
   * 设计铁律：教学**不写真实战绩**（不走 openResult，否则 appendMatchRecord 会污染
   * 「交手次数」）。因此这里只复用结算页的 DOM/CSS，自管内容与返回逻辑。
   */
  function showTutorialSummary() {
    // ⚠️ 不要在这里写 `run = null`：本 IIFE 内曾有同名 `run` 函数声明，赋值会遮蔽
    // app.js 的全局 `let run`，把教学主流程函数覆盖成 null → 二次进入教学直接
    // TypeError（2026-09-11 实测复现的回归）。全局 run 在主菜单（showMode）已被置空，
    // 教学期间无任何路径改写它，restartAction 读到的必是 null → 走 showMode 分支。
    try { if (typeof closeNpcInfo === "function") closeNpcInfo(); } catch (_) {}

    const titleEl = $("#result-title");
    if (titleEl) { titleEl.textContent = "教学完成！"; titleEl.className = "win"; }
    const subEl = $("#result-sub");
    if (subEl) subEl.textContent = "你读懂了王阿姨的软肋，把她的自信度说到了 0。";
    const retEl = $("#result-retrospect");
    if (retEl) {
      retEl.style.display = "";
      retEl.textContent = "复盘：① 先看软肋，再出拳；② 把自信度打到 0 就赢。";
    }
    const seriesEl = $("#result-series");
    if (seriesEl) seriesEl.textContent = "";
    const restartBtn = $("#restart");
    if (restartBtn) restartBtn.textContent = "返回主界面";

    const box = $("#result-overlay");
    if (box) box.classList.remove("hidden");

    // 点「返回主界面」→ 回到主菜单。全局 restartAction 在此也会触发（run 已为空 → showMode），
    // 这里只挂一次性的「高亮天梯卡」衔接，把教学的正反馈接到真实对局。
    if (restartBtn) restartBtn.addEventListener("click", highlightLadder, { once: true });
  }

  function highlightLadder() {
    const ladder = $("#mode-ladder");
    if (!ladder) return;
    ladder.classList.add("tut-highlight");
    setTimeout(() => ladder.classList.remove("tut-highlight"), 2600);
  }

  /* ---------------- 入口 ----------------
   * 只通过主界面「新手教学」卡进入——不自动播放，不触碰登录/启动流程。
   * 理由：自动播放要 hook bootstrapIdentity 并抢首屏资产加载顺序，
   * 改动面与登录流程耦合，收益不抵风险（大王 2026-09-10 拍板）。
   */
  function init() {
    const card = document.getElementById("mode-tutorial");
    if (!card) return;
    card.addEventListener("click", () => {
      if (running) return;
      startTutorial().catch(() => { running = false; });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
