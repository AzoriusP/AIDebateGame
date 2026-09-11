(() => {
  // demo/static/rehearsal-timeline.mjs
  var DURATION = 36;
  var CUES = Object.freeze([
    { at: 0, pose: "neutral", emotion: "calm", speaker: "\u738B\u963F\u59E8", text: "\u5927\u5BB6\u4E00\u76F4\u90FD\u8FD9\u4E48\u8BF4\uFF0C\u600E\u4E48\u4F1A\u6CA1\u6709\u9053\u7406\uFF1F", rival: true },
    { at: 5, pose: "neutral", emotion: "calm", speaker: "\u4F60", text: "\u6D41\u4F20\u5F97\u4E45\uFF0C\u53EF\u4EE5\u6210\u4E3A\u7EBF\u7D22\uFF0C\u4F46\u8FD8\u4E0D\u80FD\u6210\u4E3A\u7ED3\u8BBA\u3002", speaking: true },
    { at: 11, pose: "lean", emotion: "tense", speaker: "\u4F60", text: "\u6211\u4EEC\u5148\u770B\u8BC1\u636E\uFF1A\u8FD9\u4E2A\u8BF4\u6CD5\uFF0C\u7A76\u7ADF\u89E3\u91CA\u4E86\u4EC0\u4E48\uFF1F", speaking: true },
    { at: 16, objection: true, emotion: "tense", speaker: "\u4F60", text: "\u6211\u6709\u5F02\u8BAE\uFF01\u201C\u5927\u5BB6\u76F8\u4FE1\u201D\u5E76\u4E0D\u80FD\u63A8\u51FA\u201C\u5B83\u662F\u771F\u7684\u201D\u3002", speaking: true },
    { at: 23, end: true, emotion: "calm", speaker: "\u738B\u963F\u59E8", text: "\u2026\u2026\u90A3\u4F60\u8BF4\uFF0C\u5E94\u8BE5\u600E\u6837\u5224\u65AD\uFF1F", rival: true, hit: true },
    { at: 28, pose: "neutral", emotion: "calm", speaker: "\u4F60", text: "\u628A\u4E8B\u5B9E\u3001\u63A8\u6D4B\u548C\u7ED3\u8BBA\u5206\u5F00\uFF0C\u518D\u9010\u9879\u6838\u5BF9\u3002", speaking: true },
    { at: 34, pose: "neutral", emotion: "calm", speaker: "\u6F14\u51FA\u7ED3\u675F", text: "", endcard: true }
  ]);
  var Timeline = class {
    constructor(apply) {
      this.apply = apply;
      this.reset();
    }
    reset() {
      this.time = 0;
      this.index = -1;
      this.running = false;
    }
    start() {
      this.running = true;
      this.advance(0);
    }
    advance(dt) {
      if (!this.running) return;
      this.time = Math.min(DURATION, this.time + Math.max(0, Number.isFinite(dt) ? dt : 0));
      while (this.index + 1 < CUES.length && CUES[this.index + 1].at <= this.time) this.apply(CUES[++this.index]);
      if (this.time >= DURATION) this.running = false;
    }
  };

  // demo/static/recording-rehearsal.js
  var $ = (id) => document.getElementById(id);
  var rt;
  var last = 0;
  var raf = 0;
  var ready = false;
  var timeline = new Timeline((c) => {
    rt.setSpeaking(!!c.speaking);
    rt.setEmotion(c.emotion);
    if (c.pose) rt.selectPose(c.pose);
    if (c.end) rt.endStatement();
    if (c.objection) {
      rt.playObjection();
      $("impact").textContent = "\u6211\u6709\u5F02\u8BAE\uFF01";
      $("impact").classList.remove("pop");
      void $("impact").offsetWidth;
      $("impact").classList.add("pop");
    } else {
      $("impact").textContent = "";
      $("impact").classList.remove("pop");
    }
    $("speaker").textContent = c.speaker;
    $("line").textContent = c.text;
    $("rival").classList.toggle("talking", !!c.rival);
    $("rival").classList.toggle("hit", !!c.hit);
    $("endcard").hidden = !c.endcard;
  });
  function step(now) {
    raf = 0;
    if (document.hidden || !timeline.running) return;
    timeline.advance(last ? Math.min((now - last) / 1e3, 0.1) : 0);
    last = now;
    $("progress").textContent = `${timeline.time.toFixed(1)} / ${DURATION} \u79D2`;
    if (timeline.running) raf = requestAnimationFrame(step);
    else if ($("loop").checked) restart();
    else {
      rt.pause(true);
      $("pause").textContent = "\u7EE7\u7EED";
    }
  }
  function start() {
    if (!ready) return;
    if (timeline.time >= DURATION) return restart();
    timeline.start();
    rt.pause(false);
    last = 0;
    $("pause").textContent = "\u6682\u505C";
    if (!raf && !document.hidden) raf = requestAnimationFrame(step);
  }
  function pause() {
    if (!ready) return;
    if (!timeline.running) return start();
    timeline.running = false;
    rt.pause(true);
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    $("pause").textContent = "\u7EE7\u7EED";
  }
  function restart() {
    if (!ready) return;
    cancelAnimationFrame(raf);
    raf = 0;
    rt.reset();
    timeline.reset();
    start();
  }
  $("play").onclick = start;
  $("pause").onclick = pause;
  $("restart").onclick = restart;
  $("clean").onclick = () => document.body.classList.toggle("clean");
  $("fullscreen").onclick = () => {
    const result = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    result.catch(() => {
      $("progress").textContent = "\u5168\u5C4F\u4E0D\u53EF\u7528\uFF0C\u53EF\u624B\u52A8\u653E\u5927\u7A97\u53E3";
    });
  };
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space") {
      e.preventDefault();
      pause();
    }
    if (e.key.toLowerCase() === "h") $("clean").click();
    if (e.key.toLowerCase() === "r") restart();
  });
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (!document.hidden && timeline.running) raf = requestAnimationFrame(step);
  });
  $("hero").addEventListener("live2d-error", () => {
    timeline.running = false;
    cancelAnimationFrame(raf);
    raf = 0;
    rt.pause(true);
    $("line").textContent = "\u89D2\u8272\u753B\u9762\u6682\u65F6\u4E2D\u65AD\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002";
  });
  async function script(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("\u89D2\u8272\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25"));
      document.head.append(s);
    });
  }
  async function initialize() {
    try {
      await script("/static/vendor/live2d/5-r.5/live2dcubismcore.min.js");
      await script("/static/vendor/live2d/5-r.5/character-runtime.js");
      rt = window.Live2DCharacterRuntime;
      rt.mount($("hero"));
      await rt.loadModel("/static/assets/live2d/male-acting/male-acting.model3.json");
      ready = true;
      for (const id of ["play", "pause", "restart"]) $(id).disabled = false;
      $("line").textContent = "\u5DF2\u5C31\u7EEA\u3002\u70B9\u51FB\u201C\u5F00\u59CB\u6392\u7EC3\u201D\uFF0C\u64AD\u653E 36 \u79D2\u5BF9\u8BDD\u6F14\u51FA\u3002";
      rt.pause(false);
    } catch (e) {
      $("line").textContent = e.message;
    }
  }
  initialize();
})();
