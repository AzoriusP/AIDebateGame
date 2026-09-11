/* Portrait fallback with an optional Live2D runtime branch. */
(function (root) {
  "use strict";
  const { Performance, normalizeEmotion } = root.DebatePerformance;

  let manifestPromise;
  const images = new Map();
  const LIVE2D_RUNTIME_SCRIPT = "/static/vendor/live2d/5-r.5/character-runtime.js?v=stable-layout-2";
  const LIVE2D_RUNTIME_ROOT = "live2d-runtime-root";
  let runtimePromise = null;
  let live2dOwner = null;
  let sharedModelLoad = null;
  let sharedModelSource = null;

  function loadLive2DScript() {
    if (root.Live2DCharacterRuntime) return Promise.resolve(root.Live2DCharacterRuntime);
    if (runtimePromise) return runtimePromise;
    const loadScript = (url) => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => {
        script.remove();
        runtimePromise = null;
        reject(new Error("Live2D 加载超时"));
      }, 20000);
      script.src = url;
      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        runtimePromise = null;
        reject(new Error("Live2D 运行时脚本加载失败"));
      };
      document.head.appendChild(script);
    });
    runtimePromise = (async () => {
      if (!root.Live2DCubismCore) await loadScript("/static/vendor/live2d/5-r.5/live2dcubismcore.min.js");
      await loadScript(LIVE2D_RUNTIME_SCRIPT);
      if (typeof root.Live2DCharacterRuntime?.loadModel !== "function") throw new Error("未检测到 Live2D 运行时接口");
      return root.Live2DCharacterRuntime;
    })().catch((error) => { runtimePromise = null; throw error; });
    return runtimePromise;
  }

  function clampText(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function getLive2DSource(asset) {
    if (!asset || !asset.live2d) return null;
    if (typeof asset.live2d === "string") return clampText(asset.live2d, "");
    if (typeof asset.live2d === "object") {
      return clampText(asset.live2d.source || asset.live2d.path || asset.live2d.model, "");
    }
    return null;
  }

  function setLive2DHostVisibility(host, show) {
    if (!isLive2DHost(host)) return;
    const rootNode = document.getElementById(LIVE2D_RUNTIME_ROOT);
    if (!rootNode) return;
    if (rootNode.parentElement !== host) {
      if (!show) return;
      host.appendChild(rootNode);
    }
    rootNode.style.display = show ? "block" : "none";
    host.dataset.renderer = show ? "live2d" : "portrait";
  }

  function ensureLive2DRoot(host) {
    let rootNode = document.getElementById(LIVE2D_RUNTIME_ROOT);
    if (!rootNode) {
      rootNode = document.createElement("div");
      rootNode.id = LIVE2D_RUNTIME_ROOT;
      rootNode.style.position = "absolute";
      rootNode.style.inset = "0";
      rootNode.style.width = "100%";
      rootNode.style.height = "100%";
      rootNode.style.pointerEvents = "none";
      rootNode.style.display = "none";

      const stage = document.createElement("div");
      stage.id = "live2d-character-stage";
      stage.style.position = "absolute";
      stage.style.inset = "0";
      stage.style.width = "100%";
      stage.style.height = "100%";

      const canvas = document.createElement("canvas");
      canvas.id = "live2d-character-canvas";
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      stage.appendChild(canvas);
      rootNode.appendChild(stage);
      host.appendChild(rootNode);
    }
    if (rootNode.parentElement !== host) {
      host.appendChild(rootNode);
    }
    return rootNode;
  }

  function isLive2DHost(host) {
    return Boolean(host && ["player-avatar", "avatar-preview"].includes(host.id));
  }

  function canUseLive2D(host, asset) {
    if (!isLive2DHost(host)) return false;
    // renderer 显式为 "portrait" 时必须走立绘：否则只要 asset 里还留着 live2d 配置，
    // 玩家卡就会被强制走 Live2D 管线，而 Live2D 模型为容纳手臂动作预留了臂展空间，
    // 站姿只能占卡片约 43% 宽，和满幅的 NPC 立绘观感割裂。
    if (asset && typeof asset.renderer === "string" && asset.renderer !== "live2d") return false;
    return Boolean(getLive2DSource(asset));
  }

  function manifest() {
    if (!manifestPromise) manifestPromise = fetch("/static/characters.json")
      .then((r) => { if (!r.ok) throw new Error("角色清单加载失败"); return r.json(); })
      .then((data) => {
        if (data.version !== 1 || !data.characters || !data.characters.player) throw new Error("角色清单格式不支持");
        return data;
      })
      .catch((error) => {
        manifestPromise = null;
        throw error;
      });
    return manifestPromise;
  }

  function loadImage(url) {
    if (!images.has(url)) images.set(url, new Promise((resolve) => {
      const image = new Image();
      const timeout = setTimeout(() => finish(false), 12000);
      function finish(ok) {
        clearTimeout(timeout);
        image.onload = image.onerror = null;
        if (!ok) images.delete(url);
        resolve(ok);
      }
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = url;
    }));
    return images.get(url);
  }

  async function preload({ characterIds = null, onProgress = () => {} } = {}) {
    const data = await manifest();
    const ids = Array.isArray(characterIds) && characterIds.length
      ? characterIds.filter((id) => Object.hasOwn(data.characters, id))
      : Object.keys(data.characters);
    const urls = [...new Set(ids.flatMap((id) => {
      const asset = data.characters[id] || {};
      return [...Object.values(asset.portraits || {}), asset.fallback].filter(Boolean);
    }))];
    onProgress({ loaded: 0, total: urls.length });
    let loaded = 0;
    await Promise.all(urls.map(async (url) => {
      await loadImage(url);
      loaded += 1;
      onProgress({ loaded, total: urls.length, url });
    }));
    return { loaded, total: urls.length };
  }

  /* ---------------- 静态立绘演出：共享表现参数 → CSS 自定义属性 ----------------
     character-performance.js 只产出 7 个抽象参数（breath / eyeOpen / mouthOpen /
     bodyAngle / browForm / mouthForm / objection）。Live2D 分支由运行时消费，
     静态图分支由这里消费：逐帧把参数写成 CSS 自定义属性，由 characters.css
     组合成唯一一条 transform（只走合成器，不触发 layout）。

     纪律：
       1. 只给「已挂载 + 可见 + 未暂停 + 允许演出 + 非 Live2D」的角色跑帧；
       2. 全局只有一个 rAF，没有角色需要动画时彻底停掉，不空转；
       3. 变化小于阈值就不写 DOM；
       4. eyeOpen / browForm / mouthForm 目前立绘是整图没有对应部件，变量照写，
          等美术拆出部件后 CSS 直接接，不用再改 JS。 */
  const PERF_MAP = [
    ["--perf-breath", "breath", 0.002],
    ["--perf-mouth", "mouthOpen", 0.004],
    ["--perf-objection", "objection", 0.004],
    ["--perf-body-angle", "bodyAngle", 0.01],
    ["--perf-eye-open", "eyeOpen", 0.02],
    ["--perf-brow", "browForm", 0.01],
    ["--perf-mouth-form", "mouthForm", 0.01],
  ];
  const motionPreference = typeof root.matchMedia === "function"
    ? root.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  function reducedMotion() { return Boolean(motionPreference && motionPreference.matches); }

  const portraitRig = (function () {
    const running = new Set();
    const known = new Set();
    let frameId = 0;
    let previous = 0;

    function schedule() {
      if (frameId || !running.size || typeof root.requestAnimationFrame !== "function") return;
      frameId = root.requestAnimationFrame(tick);
    }
    function tick(now) {
      frameId = 0;
      const delta = previous ? Math.min((now - previous) / 1000, 0.1) : 1 / 60;
      previous = now;
      for (const rig of Array.from(running)) rig.applyFrame(delta);
      if (running.size) schedule();
      else previous = 0;
    }
    function stop(rig) {
      if (!running.delete(rig)) return;
      if (running.size) return;
      if (frameId && typeof root.cancelAnimationFrame === "function") root.cancelAnimationFrame(frameId);
      frameId = 0;
      previous = 0;
    }
    return {
      register(rig) { known.add(rig); },
      release(rig) { known.delete(rig); stop(rig); },
      sync(rig) {
        if (rig.shouldAnimate()) {
          if (!running.has(rig)) { running.add(rig); previous = 0; }
          schedule();
          return;
        }
        stop(rig);
        rig.clear();
      },
      syncAll() { for (const rig of Array.from(known)) this.sync(rig); },
      get activeCount() { return running.size; },
    };
  })();

  class PortraitRig {
    constructor(character) {
      this.character = character;
      this.visible = true;
      this.cache = Object.create(null);
      this.observer = null;
      const host = character.host;
      if (typeof root.IntersectionObserver === "function" && host && typeof host.nodeType === "number") {
        this.observer = new root.IntersectionObserver((entries) => {
          this.visible = entries.some((entry) => entry.isIntersecting);
          portraitRig.sync(this);
        });
        this.observer.observe(host);
      }
      portraitRig.register(this);
      portraitRig.sync(this);
    }

    shouldAnimate() {
      const character = this.character;
      if (!character || character.destroyed || character.paused) return false;
      if (!character.motionEnabled || character.live2dReady) return false;
      if (!character.portraitSrc || character.img.hidden) return false;
      if (reducedMotion()) return false;
      if (typeof document !== "undefined" && document.hidden) return false;
      return this.visible;
    }

    applyFrame(delta) {
      if (!this.shouldAnimate()) { portraitRig.sync(this); return; }
      this.write(this.character.performance.update(delta));
    }

    write(values) {
      const host = this.character.host;
      const style = host.style;
      if (!style || typeof style.setProperty !== "function") return;
      for (let index = 0; index < PERF_MAP.length; index++) {
        const entry = PERF_MAP[index];
        const raw = values[entry[1]];
        const value = Number.isFinite(raw) ? raw : 0;
        const cached = this.cache[entry[0]];
        if (cached !== undefined && Math.abs(cached - value) < entry[2]) continue;
        this.cache[entry[0]] = value;
        style.setProperty(entry[0], String(Math.round(value * 1000) / 1000));
      }
      if (host.dataset && host.dataset.perf !== "on") host.dataset.perf = "on";
    }

    clear() {
      const host = this.character.host;
      if (host.dataset && host.dataset.perf !== "off") host.dataset.perf = "off";
      this.cache = Object.create(null);
      const style = host.style;
      if (!style) return;
      for (let index = 0; index < PERF_MAP.length; index++) {
        const name = PERF_MAP[index][0];
        if (typeof style.removeProperty === "function") style.removeProperty(name);
        else style.setProperty(name, "");
      }
    }

    dispose() {
      if (this.observer) { this.observer.disconnect(); this.observer = null; }
      portraitRig.release(this);
      this.clear();
    }
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => portraitRig.syncAll());
  }
  if (motionPreference && typeof motionPreference.addEventListener === "function") {
    motionPreference.addEventListener("change", () => portraitRig.syncAll());
  }

  function lookupAsset(data, id) {
    if (Object.hasOwn(data.characters, id)) return data.characters[id];
    return null;
  }

  class Character {
    constructor(host, { characterId = "player", onDegraded = () => {} } = {}) {
      this.host = host;
      this.characterId = characterId;
      this.onDegraded = onDegraded;
      this.skinPortraits = null;
      this.emotion = "calm";
      this.motionEnabled = true;
      this.speaking = false;
      this.live2dSource = null;
      this.live2dReady = false;
      this.modelLoad = null;
      this.generation = 0;
      this.destroyed = false;
      this.paused = false;
      this.portraitSrc = null;
      this.rig = null;

      this.performance = new Performance({ seed: characterId === "player" ? 17 : 43 });

      this.img = document.createElement("img");
      this.img.className = "character-portrait";
      this.img.alt = "角色立绘";
      this.img.hidden = true;
      host.replaceChildren(this.img);
      host.classList.add("character-view");
      host.dataset.renderer = "portrait";
      host.dataset.assetStatus = "loading";
      host.dataset.emotion = this.emotion;
      host.dataset.speaking = "false";

      this.ready = this.render();
      this.rig = new PortraitRig(this);
    }

    /* 演出状态变化后重新判断这个角色还需不需要跑帧 */
    syncRig() { if (this.rig) portraitRig.sync(this.rig); }

    setCharacter(id) {
      if (this.destroyed) return;
      if (this.characterId !== id) {
        this.characterId = id;
        this.img.hidden = true;
        this.img.removeAttribute("src");
        this.host.dataset.assetStatus = "loading";
        this.live2dSource = null;
        this.reset();
      } else {
        this.ready = this.render();
      }
    }

    setEmotion(value) {
      if (this.destroyed) return;
      this.emotion = normalizeEmotion(value);
      this.performance.setEmotion(this.emotion);
      this.host.dataset.emotion = this.emotion;
      if (this.live2dReady && live2dOwner === this && root.Live2DCharacterRuntime) root.Live2DCharacterRuntime.setEmotion(this.emotion);
      this.ready = this.live2dReady ? Promise.resolve(true) : this.render();
    }

    setSkinPortraits(portraits) {
      if (this.destroyed) return;
      if (!portraits || typeof portraits !== "object") {
        this.skinPortraits = null;
      } else {
        this.skinPortraits = { calm: null, anxious: null, tense: null, desperate: null, ...portraits };
      }
      this.reset();
    }

    setSpeaking(value) {
      if (this.destroyed) return;
      const speaking = Boolean(value);
      this.speaking = speaking;
      this.performance.setSpeaking(speaking);
      this.host.dataset.speaking = speaking ? "true" : "false";
      if (this.live2dReady && live2dOwner === this && root.Live2DCharacterRuntime) root.Live2DCharacterRuntime.setSpeaking(speaking);
      this.syncRig();
    }

    endStatement() {
      if (this.live2dReady && live2dOwner === this) root.Live2DCharacterRuntime?.endStatement();
    }

    playObjection(options = {}) {
      const accepted = this.performance.playObjection(options);
      if (this.live2dReady && live2dOwner === this && root.Live2DCharacterRuntime) {
        this.host.dispatchEvent(new CustomEvent("character-action", {
          detail: {
            action: "objection",
            characterId: this.characterId,
            renderer: "live2d",
            visualPlayed: true,
          },
        }));
        root.Live2DCharacterRuntime.playObjection();
        return true;
      }
      if (accepted) this.host.dispatchEvent(new CustomEvent("character-action", {
        detail: {
          action: "objection",
          characterId: this.characterId,
          renderer: "portrait",
          visualPlayed: false,
        },
      }));
      return false;
    }

    pause(value) {
      if (this.destroyed) return;
      const paused = Boolean(value);
      this.paused = paused;
      this.performance.pause(paused);
      if (this.live2dReady && live2dOwner === this && root.Live2DCharacterRuntime) {
        root.Live2DCharacterRuntime.pause(paused);
      } else if (!paused && isLive2DHost(this.host)) {
        this.ready = this.render();
      }
      this.syncRig();
    }

    setMotionEnabled(value) {
      if (this.destroyed) return;
      const enabled = Boolean(value);
      this.motionEnabled = enabled;
      this.performance.setMotionEnabled(enabled);
      if (this.live2dReady && live2dOwner === this && root.Live2DCharacterRuntime) root.Live2DCharacterRuntime.setMotionEnabled(enabled);
      this.syncRig();
    }

    reset() {
      if (this.destroyed) return;
      this.generation++;
      this.performance.reset();
      this.speaking = false;
      this.emotion = "calm";
      this.host.dataset.emotion = "calm";
      this.host.dataset.speaking = "false";
      if (this.live2dReady && live2dOwner === this && root.Live2DCharacterRuntime) root.Live2DCharacterRuntime.reset();
      this.ready = this.render();
      this.syncRig();
    }

    unloadRuntime() {
      setLive2DHostVisibility(this.host, false);
      if (live2dOwner === this) {
        root.Live2DCharacterRuntime?.unload();
        live2dOwner = null;
        sharedModelSource = null;
        sharedModelLoad = null;
      }
      this.live2dReady = false;
      this.live2dSource = null;
      this.host.dataset.rigStatus = "not-authored";
      this.host.dataset.renderer = "portrait";
      this.syncRig();
    }

    destroy() {
      this.destroyed = true;
      this.generation++;
      this.unloadRuntime();
      if (this.rig) { this.rig.dispose(); this.rig = null; }
      this.host.replaceChildren();
    }

    async maybeUseLive2D(data, emotion) {
      if (this.paused || !canUseLive2D(this.host, data)) return false;
      const source = getLive2DSource(data);
      if (!source) return false;
      const ticket = this.generation;
      try {
        if (!this.live2dReady || live2dOwner !== this || this.live2dSource !== source) {
          this.host.dataset.assetStatus = "loading";
          this.img.hidden = true;
          setLive2DHostVisibility(this.host, false);
        }
        ensureLive2DRoot(this.host);
        const rt = await loadLive2DScript();
        if (ticket !== this.generation || this.paused) return false;

        if (live2dOwner && live2dOwner !== this) {
          live2dOwner.live2dReady = false;
          live2dOwner.host.dataset.renderer = "portrait";
          live2dOwner.img.hidden = false;
        }
        live2dOwner = this;
        rt.mount?.(ensureLive2DRoot(this.host));
        if (sharedModelSource !== source || !rt.isLoaded()) {
          if (!sharedModelLoad) {
            sharedModelLoad = rt.loadModel(source).then(() => {
              sharedModelSource = source;
            }).finally(() => { sharedModelLoad = null; });
          }
          await sharedModelLoad;
        }
        if (this.destroyed || ticket !== this.generation || this.paused || live2dOwner !== this) return false;
        if (!rt.isLoaded()) throw new Error("Live2D 模型未就绪");
        this.live2dSource = source;
        rt.setMotionEnabled(this.motionEnabled);
        rt.setSpeaking(this.speaking);
        rt.setEmotion(emotion);
        rt.pause(this.paused);
        this.host.dataset.characterId = this.characterId;
        this.host.dataset.speaking = this.speaking ? "true" : "false";
        this.host.dataset.emotion = this.emotion;
        this.host.dataset.rigStatus = "runtime-ready";
        this.host.dataset.assetStatus = "ready";
        setLive2DHostVisibility(this.host, true);
        rt.resize();
        this.img.hidden = true;
        this.live2dReady = true;
        this.onDegraded(false);
        return true;
      } catch (_error) {
        if (ticket !== this.generation) return false;
        console.warn("[characters] Live2D:", _error.message);
        this.unloadRuntime();
        this.onDegraded(true);
        this.host.dataset.rigStatus = "runtime-required";
        this.host.dataset.assetStatus = "runtime-fallback";
        return false;
      }
    }

    async render() {
      const ticket = ++this.generation;
      const current = () => !this.destroyed && ticket === this.generation;
      const id = this.characterId;
      const emotion = this.emotion;

      try {
        const data = await manifest();
        if (!current()) return;

        const asset = lookupAsset(data, id);
        if (!asset) throw new Error("角色未登记：" + id);

        const usedLive2D = await this.maybeUseLive2D(asset, emotion);
        if (!current()) return;
        if (!usedLive2D && this.live2dReady) this.unloadRuntime();
        if (usedLive2D) return;

        this.img.alt = asset.label || "角色立绘";
        const portraits = { ...(asset.portraits || {}), ...(this.skinPortraits || {}) };
        const desired = portraits[emotion];
        const urls = [...new Set([desired, portraits.calm, asset.fallback].filter(Boolean))];
        for (const url of urls) {
          const ok = await loadImage(url);
          if (!current()) return;
          if (!ok) continue;

          this.img.src = url;
          this.img.hidden = false;
          this.host.dataset.renderer = "portrait";
          this.host.dataset.assetStatus = url === desired ? "ready" : "fallback";
            this.host.dataset.characterId = id;
          this.host.dataset.emotion = emotion;
          this.host.dataset.rigStatus = asset.live2d ? "runtime-required" : "not-authored";
          setLive2DHostVisibility(this.host, false);
          this.onDegraded(url !== desired);
          this.portraitSrc = url;
          this.syncRig();
          return;
        }
        throw new Error("角色立绘不可用：" + id);
      } catch (error) {
        if (!current()) return;
        if (this.live2dReady) this.unloadRuntime();
        this.img.hidden = true;
        this.img.removeAttribute("src");
        this.host.dataset.assetStatus = "missing";
        this.onDegraded(true);
        this.portraitSrc = null;
        this.syncRig();
        console.warn("[characters]", error.message);
      }
    }
  }

  root.DebateCharacters = Object.freeze({
    create: (host, options) => new Character(host, options),
    manifest,
    preload,
    /* 演出自检：当前真正在跑帧的静态立绘数量（无可见角色时应为 0） */
    get activePortraits() { return portraitRig.activeCount; },
  });
})(window);
