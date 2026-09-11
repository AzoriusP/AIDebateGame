/* Shared performance parameters. This drives a rig; it is not a Live2D renderer. */
(function (root) {
  "use strict";
  const STATES = Object.freeze({
    calm:      Object.freeze({ breathSeconds: 4.2, breathDepth: 0.32, blinkSeconds: 4.6, eyeOpen: 1, bodyAngle: 0, browForm: 0, mouthForm: 0 }),
    tense:     Object.freeze({ breathSeconds: 2.6, breathDepth: 0.45, blinkSeconds: 3.0, eyeOpen: 1, bodyAngle: -1, browForm: 0.8, mouthForm: 0.3 }),
    anxious:   Object.freeze({ breathSeconds: 1.7, breathDepth: 0.58, blinkSeconds: 2.2, eyeOpen: 1, bodyAngle: -2, browForm: -0.4, mouthForm: -0.3 }),
    desperate: Object.freeze({ breathSeconds: 1.15, breathDepth: 0.72, blinkSeconds: 1.7, eyeOpen: 0.75, bodyAngle: 3, browForm: -1, mouthForm: -0.8 }),
  });
  const ALIASES = Object.freeze({
    "冷静": "calm", "从容": "calm", "焦虑": "anxious", "紧张": "tense", "绝望": "desperate",
    "得意": "smug", "动摇": "shaken", "被说服": "defeated",
  });
  const EMOTIONS = new Set([...Object.keys(STATES), "smug", "shaken", "defeated"]);
  function normalizeEmotion(value) {
    const name = ALIASES[value] || value;
    return EMOTIONS.has(name) ? name : "calm";
  }
  function profileFor(emotion) {
    const name = normalizeEmotion(emotion);
    return STATES[{ smug: "calm", shaken: "tense", defeated: "desperate" }[name] || name];
  }
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  class Performance {
    constructor({ seed = 1 } = {}) {
      this.seed = seed >>> 0 || 1;
      this.motionEnabled = true;
      this.paused = false;
      this.reset();
    }
    random() {
      this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
      return this.seed / 4294967296;
    }
    reset() {
      this.emotion = "calm";
      this.time = 0;
      this.breathPhase = 0;
      this.speaking = false;
      this.action = null;
      this.blinkAt = 2 + this.random() * 2;
      this.blinkStart = -1;
      this.values = { breath: 0, eyeOpen: 1, mouthOpen: 0, bodyAngle: 0, browForm: 0, mouthForm: 0, objection: 0 };
    }
    setEmotion(value) { this.emotion = normalizeEmotion(value); }
    setSpeaking(value) { this.speaking = Boolean(value); }
    setMotionEnabled(value) {
      this.motionEnabled = Boolean(value);
      if (!this.motionEnabled) {
        this.action = null; this.blinkStart = -1;
        this.values = { breath: 0, eyeOpen: profileFor(this.emotion).eyeOpen, mouthOpen: 0, bodyAngle: 0, browForm: 0, mouthForm: 0, objection: 0 };
      }
    }
    pause(value) { this.paused = Boolean(value); }
    playObjection({ durationMs = 1000 } = {}) {
      if (!this.motionEnabled || this.paused) return false;
      const duration = Number.isFinite(durationMs) ? clamp(durationMs, 300, 5000) / 1000 : 1;
      this.action = { elapsed: 0, duration };
      return true;
    }
    update(deltaSeconds) {
      if (this.paused) return { ...this.values };
      const profile = profileFor(this.emotion);
      if (!this.motionEnabled) {
        this.values = { breath: 0, eyeOpen: profile.eyeOpen, mouthOpen: 0, bodyAngle: 0, browForm: 0, mouthForm: 0, objection: 0 };
        return { ...this.values };
      }
      const dt = Number.isFinite(deltaSeconds) ? clamp(deltaSeconds, 0, 0.1) : 0;
      this.time += dt;
      // Preserve phase when emotion changes; transition parameters instead of restarting breathing.
      this.breathPhase = (this.breathPhase + dt / profile.breathSeconds) % 1;
      if (this.time >= this.blinkAt && this.blinkStart < 0) this.blinkStart = this.time;
      let blink = 1;
      if (this.blinkStart >= 0) {
        const progress = (this.time - this.blinkStart) / 0.18;
        if (progress >= 1) {
          this.blinkStart = -1;
          this.blinkAt = this.time + profile.blinkSeconds * (0.75 + this.random() * 0.5);
        } else blink = Math.abs(progress * 2 - 1);
      }
      let objection = 0;
      if (this.action) {
        this.action.elapsed += dt;
        const p = this.action.elapsed / this.action.duration;
        if (p >= 1) this.action = null;
        else if (p < 0.2) objection = 1 - Math.pow(1 - p / 0.2, 3);
        else if (p < 0.7) objection = 1;
        else objection = Math.pow((1 - p) / 0.3, 2);
      }
      const blend = 1 - Math.exp(-dt * 8);
      const targetBreath = (Math.sin(this.breathPhase * Math.PI * 2) + 1) * 0.5 * profile.breathDepth;
      this.values = {
        breath: this.values.breath + (targetBreath - this.values.breath) * blend,
        eyeOpen: profile.eyeOpen * blink,
        // A speaking cue only. Audio lip sync must come from the actual audio envelope.
        mouthOpen: this.speaking ? 0.25 + 0.45 * Math.abs(Math.sin(this.time * 13)) : 0,
        bodyAngle: this.values.bodyAngle + (profile.bodyAngle - this.values.bodyAngle) * blend,
        browForm: profile.browForm,
        mouthForm: profile.mouthForm,
        objection,
      };
      return { ...this.values };
    }
  }
  const api = Object.freeze({ Performance, STATES, normalizeEmotion, profileFor });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DebatePerformance = api;
})(typeof window !== "undefined" ? window : globalThis);
