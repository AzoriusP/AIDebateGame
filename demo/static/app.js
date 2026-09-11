"use strict";

const $ = (s) => document.querySelector(s);

function readPreference(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}
function savePreference(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* Storage may be unavailable in private mode. */ }
}
function readSettings(key, defaults) {
  try {
    const saved = JSON.parse(readPreference(key, "{}"));
    return Object.fromEntries(Object.entries(defaults).map(([name, value]) =>
      [name, saved && typeof saved[name] === typeof value ? saved[name] : value]));
  } catch (_) { return { ...defaults }; }
}

const DIM_ORDER = ["LOGIC", "EVIDENCE", "EMOTION", "UTILITY", "IDENTITY", "AUTHORITY"];
const DIM_LABELS = {
  LOGIC: "逻辑", EVIDENCE: "证据", EMOTION: "情感",
  UTILITY: "利益", IDENTITY: "认同", AUTHORITY: "权威",
};
const HINTS_PER_MATCH = 3;
const HINT_AD_BONUS_PER_MATCH = 2;
const NPC_EMOJI = { "得意": "😏", "从容": "😌", "动摇": "😰", "被说服": "😳" };
const PLAYER_EMOJI = { "从容": "😄", "紧张": "😟", "焦虑": "😰", "绝望": "😱" };
const SPEECH_TIMING_DEFAULTS = { npcSpeakMs: 2000 };
const SPEECH_TIMING_KEY = "bianyi_speech_timing";
let speechTiming = readSettings(SPEECH_TIMING_KEY, SPEECH_TIMING_DEFAULTS);
function getNpcSpeakDurationMs() {
  const raw = Number(speechTiming?.npcSpeakMs);
  const clamped = Number.isFinite(raw) ? raw : SPEECH_TIMING_DEFAULTS.npcSpeakMs;
  return Math.max(300, Math.min(10000, clamped));
}
function setNpcSpeakDurationMs(ms) {
  const clamped = Math.max(300, Math.min(10000, Math.round(Number(ms) || SPEECH_TIMING_DEFAULTS.npcSpeakMs)));
  speechTiming = { ...speechTiming, npcSpeakMs: clamped };
  savePreference(SPEECH_TIMING_KEY, JSON.stringify(speechTiming));
}

let state = {
  sid: null, topic: null, dimensions: {}, confidence: 100,
  token: 0, quota: 400, busy: false, npcName: "对手", tier: 1,
  hintsLeft: HINTS_PER_MATCH,
  hintAdLeft: HINT_AD_BONUS_PER_MATCH,
  npcId: "", stance: "反对",
  npcWeakness: [], npcTags: [],
  muted: readPreference("bianyi_muted", "0") === "1",
};

const IDENT_KEY = "bianyi_identity_v1";
const ACTIVE_MATCH_KEY = "bianyi_active_match_v1";
const ACCOUNT_INITIAL_TOKENS = 1000;
const ACCOUNT_FEATURE_DEFAULTS = {
  free_mode: { enabled: false, cost: 1, missing: 1 },
  progress_reset: { enabled: false, cost: 2, missing: 2 },
};
// One authored protagonist. Account identity does not select character artwork.
// 主角形象一律由 Live2D 运行时渲染（characters.json: player.renderer = "live2d"）。
// 旧的静态立绘是占位废稿，已下线，这里不再提供任何立绘 src。
const SKINS = [{ id: "skin-default", label: "主角", src: null }];
const DEFAULT_APPEARANCE = {};

function pickSkinPortraits(raw) {
  const found = SKINS.find((it) => it.id === raw);
  const id = found ? found.id : SKINS[0].id;
  const src = found ? found.src : SKINS[0].src;
  // src 为 null 时返回空映射：让 characters.js 走 Live2D，不产生任何静态立绘回退。
  return src ? { id, calm: src, anxious: src, tense: src, desperate: src, preview: src } : { id };
}

function normalizeSkin(raw) {
  return pickSkinPortraits(SKINS.some((it) => it.id === raw) ? raw : SKINS[0].id);
}
function normalizePermissions(raw) {
  const freeMode = raw && typeof raw.free_mode === "object" ? raw.free_mode : {};
  const progressReset = raw && typeof raw.progress_reset === "object" ? raw.progress_reset : {};
  return {
    free_mode: {
      enabled: Boolean(freeMode.enabled),
      cost: Number.isFinite(Number(freeMode.cost)) ? Number(freeMode.cost) : ACCOUNT_FEATURE_DEFAULTS.free_mode.cost,
      missing: Number.isFinite(Number(freeMode.missing))
        ? Number(freeMode.missing)
        : Math.max(0, (Number.isFinite(Number(freeMode.cost)) ? Number(freeMode.cost) : ACCOUNT_FEATURE_DEFAULTS.free_mode.cost)
          - (Number.isFinite(Number(raw?.account_token)) ? Number(raw.account_token) : ACCOUNT_INITIAL_TOKENS)),
    },
    progress_reset: {
      enabled: Boolean(progressReset.enabled),
      cost: Number.isFinite(Number(progressReset.cost)) ? Number(progressReset.cost) : ACCOUNT_FEATURE_DEFAULTS.progress_reset.cost,
      missing: Number.isFinite(Number(progressReset.missing))
        ? Number(progressReset.missing)
        : Math.max(0, (Number.isFinite(Number(progressReset.cost)) ? Number(progressReset.cost) : ACCOUNT_FEATURE_DEFAULTS.progress_reset.cost)
          - (Number.isFinite(Number(raw?.account_token)) ? Number(raw.account_token) : ACCOUNT_INITIAL_TOKENS)),
    },
  };
}

function makeDefaultProfile(mode = "guest") {
  const base = {
    mode,
    accountId: "",
    playerName: mode === "account" ? "" : "游客",
    skinId: SKINS[0].id,
    setupDone: true,
    appearance: { ...DEFAULT_APPEARANCE },
    callbackSecret: "",
    accountToken: ACCOUNT_INITIAL_TOKENS,
    permissions: {
      free_mode: { ...ACCOUNT_FEATURE_DEFAULTS.free_mode },
      progress_reset: { ...ACCOUNT_FEATURE_DEFAULTS.progress_reset },
    },
    history: [],
    lastResult: "暂无",
    updatedAt: Date.now(),
  };
  return base;
}

function normalizeIdentity(raw) {
  if (!raw || typeof raw !== "object") return null;
  const skinPortrait = normalizeSkin(raw.skinId);
  const name = String(raw.mode === "account" ? (raw.accountId || raw.playerName || "") : "游客").trim();
  const token = Number(raw.accountToken);
  return {
    mode: raw.mode === "account" ? "account" : "guest",
    accountId: String(raw.accountId || "").trim(),
    playerName: name || (raw.mode === "account" ? "我" : "游客"),
    skinId: raw.skinId && SKINS.some((it) => it.id === raw.skinId) ? raw.skinId : SKINS[0].id,
    callbackSecret: String(raw.callbackSecret || raw.callback_secret || "").trim(),
    setupDone: true,
    appearance: {},
    accountToken: Number.isFinite(token) ? token : ACCOUNT_INITIAL_TOKENS,
    permissions: normalizePermissions({ ...raw.permissions, account_token: token }),
    history: Array.isArray(raw.history) ? raw.history : [],
    lastResult: String(raw.lastResult || "暂无"),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    skinPortrait,
  };
}

function loadIdentity() {
  try {
    const saved = readPreference(IDENT_KEY, null);
    return normalizeIdentity(saved ? JSON.parse(saved) : null);
  } catch (_) {
    return null;
  }
}

function saveIdentity(profile) {
  if (!profile || typeof profile !== "object") return;
  const portrait = normalizeSkin(profile?.skinId);
  profile.skinPortrait = portrait;
  profile.updatedAt = Date.now();
  savePreference(IDENT_KEY, JSON.stringify(profile));
}

let identity = null;
let authMode = "login";
let authMethod = "credential";

function accountIdentity(rawId) {
  const id = String(rawId || "").trim();
  return {
    mode: "account",
    accountId: id,
    playerName: id || "我",
    skinId: SKINS[0].id,
    callbackSecret: "",
    setupDone: true,
    appearance: { ...DEFAULT_APPEARANCE },
    accountToken: ACCOUNT_INITIAL_TOKENS,
    permissions: {
      free_mode: { ...ACCOUNT_FEATURE_DEFAULTS.free_mode },
      progress_reset: { ...ACCOUNT_FEATURE_DEFAULTS.progress_reset },
    },
    history: [],
    lastResult: "暂无",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    skinPortrait: normalizeSkin(SKINS[0].id),
  };
}

function switchIdentity(next) {
  identity = normalizeIdentity(next);
  if (!identity) return;
  identity.skinPortrait = normalizeSkin(identity.skinId);
  saveIdentity(identity);
  if (identity.mode === "account" && !identity.playerName && identity.accountId) {
    identity.playerName = identity.accountId;
  }
  applyIdentityToAvatar();
  syncIdentityUI();
}

function applyIdentityToAvatar() {
  if (!identity) return;
  const name = identity.mode === "account" ? (identity.playerName || "我") : "你";
  const pName = document.querySelector("#player-side .pname");
  if (pName) pName.textContent = name;
  const skin = identity.skinPortrait || normalizeSkin(identity.skinId);
  if (characterViews.player?.setSkinPortraits) {
    characterViews.player.setSkinPortraits(skin);
  }
  // 形象预览由 characters.js 的 Live2D 管线渲染，此处不再写入静态图 src。
}

function syncIdentityUI() {
  if (!identity) return;
  const nameEl = $("#identity-name");
  const tokenBox = $("#identity-token");
  const tokenNum = $("#identity-token-num");
  const summary = $("#identity-summary");
  const historyEl = $("#identity-history");
  const lastEl = $("#identity-last-result");
  const adBtn = $("#identity-ad-reward");
  const buyBtn = $("#identity-buy");
  const featureHintWrap = $("#identity-feature-hints");
  const resetBtn = $("#mode-reset");
  const freeCard = $("#mode-free");
  if (freeCard) {
    const guestLocked = identity.mode !== "account";
    freeCard.classList.toggle("guest-locked", guestLocked);
    freeCard.setAttribute("aria-disabled", String(guestLocked));
    freeCard.title = guestLocked ? "自由切磋仅限账号玩家" : "";
  }
  if (nameEl) nameEl.textContent = identity.mode === "account"
    ? `${identity.playerName}${identity.accountId ? ` (${identity.accountId})` : ""}`
    : "游客";
  if (identity.mode === "account") {
    if (tokenBox) tokenBox.classList.remove("hidden");
    if (tokenNum) tokenNum.textContent = String(identity.accountToken || 0);
    if (summary) summary.classList.remove("hidden");
    if (historyEl) historyEl.textContent = String((identity.history || []).length);
    if (lastEl) lastEl.textContent = identity.lastResult || "暂无";
    if (adBtn) adBtn.classList.remove("hidden");
    if (buyBtn) buyBtn.classList.remove("hidden");
    if (featureHintWrap) {
      renderPermissionHints();
    }
    if (resetBtn) {
      const resetMsg = requirePermissionMessage("progress_reset", "进度重置（NPC记忆与成长）");
      resetBtn.disabled = Boolean(resetMsg);
      resetBtn.title = resetMsg || "重置所有 NPC 的记忆与成长";
    }
  } else {
    if (tokenBox) tokenBox.classList.add("hidden");
    if (summary) summary.classList.add("hidden");
    if (adBtn) adBtn.classList.add("hidden");
    if (buyBtn) buyBtn.classList.add("hidden");
    if (featureHintWrap) featureHintWrap.classList.add("hidden");
    if (resetBtn) {
      resetBtn.disabled = false;
      resetBtn.title = "";
    }
  }
}

function getFeaturePermissionLabel(featureKey) {
  const featureMeta = {
    free_mode: {
      label: "自由切磋",
      unlockedHint: "已解锁自由切磋（可在自由列表自由选 NPC 对手）。",
      lockedHint: "未解锁自由切磋（当前代币不足）。看广告 +100 / 购买 +500 可解锁。",
      effect: "适合先体验对手机制，或在非天梯路径中练习发言。",
    },
    progress_reset: {
      label: "进度重置（NPC记忆与成长）",
      unlockedHint: "已解锁进度重置（允许清空 NPC 记忆、成长与天梯进度）。",
      lockedHint: "未解锁进度重置（当前代币不足）。看广告 +100 / 购买 +500 可解锁。",
      effect: "执行后将清空历史记忆与成长加成，并重置天梯到起始位。",
    },
  };
  const meta = featureMeta[featureKey] || {
    label: featureKey === "free_mode" ? "自由切磋" : "进度重置",
    unlockedHint: `${featureKey === "free_mode" ? "自由切磋" : "进度重置"}已解锁。`,
    lockedHint: `${featureKey === "free_mode" ? "自由切磋" : "进度重置"}暂未解锁。`,
    effect: "",
  };
  const permission = getFeaturePermission(featureKey);
  const token = Number(identity?.accountToken || 0);
  const label = meta.label;
  if (!identity || identity.mode !== "account") {
    const cost = ACCOUNT_FEATURE_DEFAULTS[featureKey]?.cost || 0;
    return {
      key: featureKey,
      label,
      enabled: false,
      cost,
      missing: Math.max(0, cost - token),
      token,
      statusText: "仅账号可见",
      note: `${label}需先登录账号。此功能默认需 ${cost} 代币门槛。`,
      locked: true,
    };
  }
  if (!permission) {
    const cost = ACCOUNT_FEATURE_DEFAULTS[featureKey]?.cost || 0;
    const missing = Math.max(0, cost - token);
    return {
      key: featureKey,
      label,
      enabled: false,
      cost,
      missing,
      statusText: "未解锁",
      token,
      note: `当前代币 ${token}，尚无权限信息。${meta.lockedHint.includes("当前代币不足") ? "" : ` 需要达到 ${cost} 代币。`}`,
      locked: true,
    };
  }
  const cost = Number(permission.cost || 0) || 0;
  const missing = Number.isFinite(permission.missing)
    ? permission.missing
    : Math.max(0, cost - token);
  return {
    key: featureKey,
    label,
    enabled: Boolean(permission.enabled),
    cost,
    missing,
    token,
    locked: !permission.enabled,
    statusText: permission.enabled ? "已解锁" : "未解锁",
    note: permission.enabled
      ? `${meta.unlockedHint}（满足 ${cost} 代币门槛，当前 ${token}）。${meta.effect ? ` ${meta.effect}` : ""}`
      : `${meta.lockedHint}（当前 ${token}，还差 ${missing}/${cost}）`,
  };
}

function renderPermissionHints() {
  const wrap = $("#identity-feature-hints");
  if (!wrap || !identity || identity.mode !== "account") {
    if (wrap) wrap.classList.add("hidden");
    return;
  }
  const rows = ["free_mode", "progress_reset"].map((featureKey) => {
    const p = getFeaturePermissionLabel(featureKey);
    return {
      ...p,
      detailClass: p.enabled ? "permission-ok" : "permission-locked",
    };
  });
  const title = "权限说明（刷新后实时更新）";
  wrap.classList.remove("hidden");
  wrap.innerHTML = `<div class="permission-title">${title}</div>`
    + rows.map((row) => (
      `<div class="permission-row ${row.detailClass}">`
      + `<span class="permission-name">${row.label}</span>`
      + `<span class="permission-status ${row.detailClass}">${row.statusText}</span>`
      + `<span class="permission-detail">${row.note}</span>`
      + `</div>`
    )).join("");
}

function getFeaturePermission(feature) {
  if (!identity || identity.mode !== "account") return null;
  const permissions = identity.permissions || {};
  return permissions[feature] && typeof permissions[feature] === "object" ? permissions[feature] : null;
}

function applyAccountTokenPayload(payload) {
  if (!identity || identity.mode !== "account" || !payload || typeof payload !== "object") return;
  const token = Number(payload.account_token);
  if (typeof payload.callback_secret === "string") {
    identity.callbackSecret = payload.callback_secret;
  }
  if (Number.isFinite(token)) {
    identity.accountToken = token;
  }
  if (payload.permissions) {
    identity.permissions = normalizePermissions({
      ...payload.permissions,
      account_token: Number.isFinite(token) ? token : (identity.accountToken || ACCOUNT_INITIAL_TOKENS),
    });
  }
  if (typeof payload.before === "number" && Number.isFinite(payload.before)
      && typeof payload.after === "number" && Number.isFinite(payload.after)
      && payload.delta) {
    const delta = payload.after - payload.before;
    if (delta !== 0) {
      const direction = delta > 0 ? `+${delta}` : `${delta}`;
      const reason = payload.reason === "match_settlement" ? "本局结算" : payload.reason || "代币变更";
      addMsg("sys", `账号代币 ${direction}（${reason}）。当前：${identity.accountToken}`);
    }
  }
  saveIdentity(identity);
  syncIdentityUI();
}

async function sha256Hex(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(text));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

function normalizeCallbackActionContext(action, payload) {
  const value = Number(payload.amount || payload.delta || 0);
  return `${action || ""}|${payload.callback_id || ""}|${payload.callback_ts || 0}|${value}|${String(payload.sku || "")}|${String(payload.source_context || "")}|${identity?.accountId || ""}`;
}

async function buildCallbackSignature(action, payload) {
  const secret = String(identity?.callbackSecret || "").trim();
  if (!secret) return "";
  const base = `${action}|${identity?.accountId || ""}|${String(payload.callback_id || "")}|${String(payload.callback_ts || 0)}|${Number(payload.amount || 0)}|${String(payload.sku || "")}|${String(payload.delta || "")}|${String(payload.source_context || "")}|${secret}`;
  return sha256Hex(base);
}

function requirePermissionMessage(featureKey, label) {
  const featureMeta = {
    free_mode: {
      label: "自由切磋",
      actionDesc: "开启后可进入自由切磋场景，按意愿选择目标 NPC。",
    },
    progress_reset: {
      label: "进度重置（NPC记忆与成长）",
      actionDesc: "执行后会清空 NPC 的记忆与成长，并重置天梯进度。",
    },
  };
  const featureName = featureMeta[featureKey]?.label || label;
  const permission = getFeaturePermission(featureKey);
  const actionHint = featureMeta[featureKey]?.actionDesc ? ` ${featureMeta[featureKey].actionDesc}` : "";
  if (!identity) return `${featureName}需要账号登录后开启（当前为游客）。${actionHint}`;
  if (identity.mode !== "account") return `${featureName}需要账号登录后开启（游客不可用）。${actionHint}`;
  if (!permission || permission.enabled) return "";
  const token = Number(identity?.accountToken || 0);
  const need = Number(permission.cost || 0) || 0;
  const missing = Number.isFinite(permission.missing) ? permission.missing : Math.max(0, need - token);
  return `${featureName}暂未解锁（当前代币 ${token}，还差 ${missing}/${need}）。看广告 +100 或购买 +500 可解锁。${actionHint}`;
}

function generateCallbackId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function appendMatchRecord(win, status) {
  if (!identity || identity.mode !== "account") return;
  identity.history = Array.isArray(identity.history) ? identity.history : [];
  const item = {
    t: Date.now(),
    mode: (run && run.mode) || "ladder",
    tier: state.tier || 1,
    npc: state.npcName || "对手",
    result: win ? "胜" : "负",
    status: status || "",
    topic: state.topic?.topic || "",
  };
  identity.history.unshift(item);
  identity.history = identity.history.slice(0, 50);
  identity.lastResult = `${item.result} ${item.npc}`;
  saveIdentity(identity);
  syncIdentityUI();
}


/* ---------------- 模式 / 系列赛状态 ---------------- */
let run = null;              // {mode:'ladder'|'free', tier, npcId, npcName, score:[0,0], game:1}
let freeMem = readPreference("bianyi_freeMem", "0") === "1";  // 自由模式记忆默认关
let resultLocked = false;    // 结算防重入
let roundVersion = 0;
let screenVersion = 0;
let activeRound = false;
let pendingTimeout = false;
let npcThinkingMessage = null;

function isHintAvailable() {
  return activeRound && state.sid && !state.busy && !resultLocked && state.hintsLeft > 0;
}

function isHintAdAvailable() {
  return activeRound && state.sid && !state.busy && !resultLocked && state.hintsLeft <= 0 && state.hintAdLeft > 0;
}

function updateHintButton() {
  const btn = $("#hint");
  if (!btn) return;
  if (!activeRound || !state.sid) {
    btn.disabled = true;
    btn.classList.remove("is-loading");
    btn.textContent = "💡 提示";
    return;
  }
  if (state.hintsLeft > 0) {
    btn.disabled = state.busy;
    btn.classList.remove("is-loading");
    btn.textContent = `💡 提示 (${state.hintsLeft})`;
    return;
  }
  if (state.hintAdLeft > 0) {
    btn.disabled = state.busy;
    btn.classList.remove("is-loading");
    btn.textContent = "广告+1";
    return;
  }
  btn.disabled = true;
  btn.classList.remove("is-loading");
  btn.textContent = "💡 提示（已用尽）";
}

function resetMatchHints() {
  state.hintsLeft = HINTS_PER_MATCH;
  state.hintAdLeft = HINT_AD_BONUS_PER_MATCH;
}

async function simulateWatchHintAd() {
  const btn = $("#hint");
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add("is-loading");
  btn.textContent = "加载广告中…";
  try {
    await new Promise((resolve) => setTimeout(resolve, 800));
    state.hintAdLeft = Math.max(0, state.hintAdLeft - 1);
    state.hintsLeft = Math.min(HINTS_PER_MATCH + HINT_AD_BONUS_PER_MATCH, state.hintsLeft + 1);
    addMsg("sys", "广告观看完成，提示次数+1。");
  } finally {
    updateHintButton();
  }
}

/* ---------------- 角色显示：统一控制器管理立绘与后续模型 ---------------- */
function toggleEmojiBadge(side, degraded) {
  const el = $(side === "npc" ? "#npc-emotion" : "#player-emotion");
  if (el && el.parentElement) el.parentElement.classList.toggle("degraded", degraded);
}
const characterViews = {};
for (const [side, selector, characterId] of [
  ["player", "#player-avatar", "player"], ["npc", "#npc-avatar", "L1_A"],
  ["preview", "#avatar-preview", "player"],
]) {
  const host = $(selector);
  if (host && window.DebateCharacters) {
    characterViews[side] = window.DebateCharacters.create(host, {
      characterId, onDegraded: (degraded) => { if (side !== "preview") toggleEmojiBadge(side, degraded); },
    });
  } else if (side !== "preview") toggleEmojiBadge(side, true);
}
function setPortrait(side, emotion) { characterViews[side]?.setEmotion(emotion); }
function updateCharacterVisibility() {
  characterViews.player?.pause(!activeRound || document.hidden);
  characterViews.npc?.pause(!activeRound || document.hidden);
  characterViews.preview?.pause($("#mode-screen").classList.contains("hidden") || document.hidden);
}
function renderAvatarCard() {
  const ctl = $("#avatar-controls");
  if (!ctl || ctl.childElementCount) return;
  for (const emotion of ["从容", "紧张", "焦虑", "绝望"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ac-opt" + (emotion === "从容" ? " on" : "");
    button.textContent = emotion === "从容" ? "冷静" : emotion;
    button.setAttribute("aria-pressed", String(emotion === "从容"));
    button.addEventListener("click", () => {
      characterViews.preview?.setEmotion(emotion);
      ctl.querySelectorAll("button").forEach((item) => {
        item.classList.toggle("on", item === button);
        item.setAttribute("aria-pressed", String(item === button));
      });
    });
    ctl.appendChild(button);
  }
}

/* ---------------- 演出设置与无障碍 ---------------- */
const FX_DEFAULT = { flash: true, shake: true, particles: true, motion: true };
let fx = readSettings("bianyi_fx", FX_DEFAULT);
const motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
let _reducedMotion = !!motionPreference?.matches;
function applyFx() {
  document.documentElement.dataset.fxShake = fx.shake && !_reducedMotion ? "on" : "off";
  document.documentElement.dataset.fxParticles = fx.particles && !_reducedMotion ? "on" : "off";
  for (const view of Object.values(characterViews)) view.setMotionEnabled(fx.motion && !_reducedMotion);
}
applyFx();

/* ---------------- 音频（Web Audio 简单冲击音） ---------------- */
let audioCtx = null;
function playImpact(hard) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(hard ? 180 : 260, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.25);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.32);
  } catch (e) {}
}

/* ---------------- 语音（服务端 TTS → mp3，默认 edge-tts 神经音；可整体下线） ----------------
   前端不再用浏览器自带 speechSynthesis（机械腔）。
   统一走 GET /api/tts?npc=<npc_id>&text=… → mp3 播放。
   kill switch：/api/status 上报 tts.ready=false（config 关闭 / 依赖缺失 / 连挂 2 次）
   → 隐藏 🔊 入口、不再请求语音。代码保留，功能下线。 */
let voice = { ready: false, broken: false, audio: null, failStreak: 0, request: 0, abort: null, objectUrl: null };
let npcSpeakTimer = null;
let npcSpeakToken = 0;

function stopNpcSpeech() {
  if (npcSpeakTimer) {
    clearTimeout(npcSpeakTimer);
    npcSpeakTimer = null;
  }
  characterViews.npc?.setSpeaking(false);
}

function startNpcSpeech() {
  stopNpcSpeech();
  const token = ++npcSpeakToken;
  characterViews.npc?.setSpeaking(true);
  npcSpeakTimer = setTimeout(() => {
    if (token !== npcSpeakToken) return;
    characterViews.npc?.setSpeaking(false);
  }, getNpcSpeakDurationMs());
}

function stopNpcAudio() {
  if (voice.audio) {
    try { voice.audio.pause(); } catch (_) {}
    voice.audio = null;
  }
  if (voice.objectUrl) {
    try { URL.revokeObjectURL(voice.objectUrl); } catch (_) {}
    voice.objectUrl = null;
  }
}

async function initTts() {
  try {
    const d = await (await fetch("/api/status")).json();
    const t = (d && d.tts) || {};
    voice.ready = !!(t.enabled && t.ready);
  } catch (e) {
    voice.ready = false;
  }
  applyVoiceUI();
}

function applyVoiceUI() {
  const btn = $("#mute-btn");
  if (!btn) return;
  if (!voice.ready) { btn.classList.add("hidden"); return; }   // 语音下线 → 藏 UI
  btn.classList.remove("hidden");
  btn.textContent = state.muted ? "🔇" : "🔊";
}

function stopVoice() {
  voice.request++;
  voice.abort?.abort();
  voice.abort = null;
  stopNpcAudio();
  stopNpcSpeech();
}

async function speak(text, npcId) {
  if (!voice.ready || state.muted || voice.broken || !text || !text.trim()) return;
  stopVoice();
  const request = voice.request;
  const version = roundVersion;
  const abort = new AbortController();
  voice.abort = abort;
  const q = `npc=${encodeURIComponent(npcId || "default")}&text=${encodeURIComponent(text.trim())}`;
  try {
    const r = await fetch("/api/tts?" + q, { signal: abort.signal });
    if (!r.ok) throw new Error("tts http " + r.status);
    const blob = await r.blob();
    if (request !== voice.request || version !== roundVersion || state.muted) return;
    if (!blob || blob.size < 100) throw new Error("empty audio");
    voice.objectUrl = URL.createObjectURL(blob);
    const a = new Audio(voice.objectUrl);
    voice.audio = a;
    a.addEventListener("playing", () => { if (voice.audio === a) startNpcSpeech(); });
    a.addEventListener("ended", () => {
      if (voice.audio !== a) return;
      stopNpcAudio();
    });
    a.addEventListener("error", () => {
      if (voice.audio !== a) return;
      stopNpcAudio();
    });
    a.play().catch(() => { if (voice.audio === a) stopVoice(); });
    voice.failStreak = 0;
  } catch (e) {
    if (e.name === "AbortError" || request !== voice.request || version !== roundVersion) return;
    voice.failStreak += 1;
    if (voice.failStreak >= 2) {          // 连续失败 → 本次会话语音下线并隐藏入口（保代码，藏 UI）
      voice.ready = false;
      voice.broken = true;
      applyVoiceUI();
      console.warn("[tts] 连续失败，本次会话语音已下线：", e);
    }
  }
}

function toggleMute() {
  state.muted = !state.muted;
  savePreference("bianyi_muted", state.muted ? "1" : "0");
  if (state.muted) stopVoice();
  applyVoiceUI();
}

/* ---------------- 异议演出 ---------------- */
let objectionTimer = null;
function clearObjection() {
  clearTimeout(objectionTimer);
  $("#objection-overlay").classList.remove("active");
  $("#app").classList.remove("shake");
}
function objection(side, event = {}) {
  if (side !== "npc" && side !== "player") return;
  clearObjection();
  const isWeakHit = side === "player" && event && event.kind === "hit_weak";
  const durationMs = Math.max(200, Math.min(3000, Number(event.duration_ms) || 1000));
  characterViews[side]?.playObjection({ durationMs });
  if (isWeakHit) startWeakHitOverflowWindow(durationMs);
  playImpact(side === "npc");
  if (fx.flash) {
    const ov = $("#objection-overlay");
    const txt = $("#objection-text");
    txt.textContent = side === "player" ? "我有异议！" : "异议！";
    ov.dataset.side = side;
    // Restart the visual when a second objection arrives before the first ends.
    ov.classList.remove("active");
    void ov.offsetWidth;
    ov.classList.add("active");
  }
  if (fx.shake && !_reducedMotion) {
    const app = document.getElementById("app");
    app.classList.remove("shake");
    void app.offsetWidth;
    app.classList.add("shake");
  }
  objectionTimer = setTimeout(clearObjection, durationMs);
}

/* ---------------- 雷达图 ---------------- */
function renderRadar(dims, highlight) {
  const svg = $("#radar");
  const cx = 160, cy = 150, R = 96;
  let s = "";
  [0.25, 0.5, 0.75, 1].forEach((v) => {
    s += `<polygon points="${hexPoints(cx, cy, R * v)}" fill="none" stroke="rgba(85,125,139,0.24)" stroke-width="1"/>`;
  });
  DIM_ORDER.forEach((d, i) => {
    const p = axisPoint(cx, cy, R, i);
    s += `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="rgba(85,125,139,0.24)" stroke-width="1"/>`;
  });
  const pts = DIM_ORDER.map((d, i) => {
    const v = (dims[d] ?? 5) / 10;
    const p = axisPoint(cx, cy, R * v, i);
    return `${p.x},${p.y}`;
  }).join(" ");
  s += `<polygon points="${pts}" fill="rgba(183,96,85,0.18)" stroke="#B76055" stroke-width="2" stroke-linejoin="round"/>`;
  DIM_ORDER.forEach((d, i) => {
    const v = (dims[d] ?? 5) / 10;
    const p = axisPoint(cx, cy, R * v, i);
    const hl = d === highlight;
    s += `<circle cx="${p.x}" cy="${p.y}" r="${hl ? 6 : 3.5}" fill="${hl ? "#D95159" : "#B76055"}"/>`;
  });
  DIM_ORDER.forEach((d, i) => {
    const p = axisPoint(cx, cy, R + 24, i);
    const val = dims[d] ?? 5;
    const weak = val <= 4;
    s += `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="${weak ? "#A5742C" : "#60767F"}">${DIM_LABELS[d]} ${val}</text>`;
  });
  svg.innerHTML = s;
}
function hexPoints(cx, cy, r) {
  return DIM_ORDER.map((_, i) => {
    const p = axisPoint(cx, cy, r, i);
    return `${p.x},${p.y}`;
  }).join(" ");
}
function axisPoint(cx, cy, r, i) {
  const ang = -Math.PI / 2 + i * (Math.PI / 3);
  return { x: +(cx + r * Math.cos(ang)).toFixed(1), y: +(cy + r * Math.sin(ang)).toFixed(1) };
}

/* ---------------- 状态渲染 ---------------- */
function updateVignette() {
  // 已按大王要求移除「NPC 快失败时全屏黑色虚化」特效，不再激活 #vignette
  const vig = $("#vignette");
  if (vig) vig.classList.remove("on");
}
function renderConfidence() {
  // 用 scaleX 代替 width：纯合成属性，不触发 layout
  $("#confidence-fill").style.transform = `scaleX(${state.confidence / 100})`;
  $("#confidence-num").textContent = state.confidence;
  const fill = $("#confidence-fill");
  if (state.confidence >= 60) fill.style.background = "#FF3B4E";
  else if (state.confidence >= 30) fill.style.background = "#F5C04E";
  else fill.style.background = "#FFE08A";
  updateVignette();
}
function renderToken() {
  $("#token-num").textContent = state.token;
  $("#token-box").classList.toggle("low", state.token <= state.quota * 0.35);
  updateVignette();
}
function renderEmotion(npc, player) {
  // emoji 徽章文字照旧更新（降级时露出补偿信息量），立绘走 setPortrait 状态机
  $("#npc-emotion").textContent = NPC_EMOJI[npc] || "😌";
  $("#npc-emotion-label").textContent = npc;
  $("#player-emotion").textContent = PLAYER_EMOJI[player] || "😄";
  $("#player-emotion-label").textContent = player;
  const ie = $("#npc-info-emoji"), il = $("#npc-info-emotion-label");
  if (ie) ie.textContent = NPC_EMOJI[npc] || "😌";
  if (il) il.textContent = npc;
  setPortrait("npc", npc);
  setPortrait("player", player);
}

/* ---------------- NPC 底细面板（ℹ️） ---------------- */
function openNpcInfo() {
  $("#npc-info-title").textContent = `${state.npcName} 的底细`;
  renderRadar(state.dimensions, null);
  $("#npc-weakness-text").textContent = (state.npcWeakness || []).join("、") || "未知";
  const tc = $("#npc-tags");
  tc.innerHTML = "";
  (state.npcTags || []).forEach((t) => {
    const s = document.createElement("span");
    s.className = "tag-chip";
    s.textContent = t;
    tc.appendChild(s);
  });
  if (!(state.npcTags || []).length) tc.innerHTML = '<span class="tag-empty">暂无</span>';
  $("#npc-info-overlay").classList.remove("hidden");
}
function closeNpcInfo() {
  $("#npc-info-overlay").classList.add("hidden");
}

/* ---------------- 对话 ---------------- */
function addMsg(role, text, tag) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  if (role === "npc") {
    div.innerHTML = `<div class="who">${state.npcName}${tag ? `<span class="tag">${tag}</span>` : ""}</div>${esc(text)}`;
  } else if (role === "player") {
    div.innerHTML = `<div class="who">你${tag ? `<span class="tag">${tag}</span>` : ""}</div>${esc(text)}`;
  } else {
    div.textContent = text;
  }
  $("#dialogue").appendChild(div);
  $("#dialogue").scrollTop = $("#dialogue").scrollHeight;
}
function esc(s) {
  return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

/* 把最后一条系统消息（"判定中…"）改写为判定结果，保持对话流整洁 */
function setLastSysMsg(text, cls) {
  const sysMsgs = document.querySelectorAll(".msg.sys");
  const last = sysMsgs[sysMsgs.length - 1];
  if (!last) { addMsg("sys", text); return; }
  last.className = "msg sys" + (cls ? " " + cls : "");
  last.textContent = text;
}

function showNpcThinking(version = roundVersion) {
  if (version !== roundVersion || !activeRound) return;
  if (!npcThinkingMessage || !npcThinkingMessage.isConnected) {
    const msg = document.createElement("div");
    msg.className = "msg sys thinking";
    msg.textContent = "NPC 正在思考… 续句话术中";
    $("#dialogue").appendChild(msg);
    $("#dialogue").scrollTop = $("#dialogue").scrollHeight;
    npcThinkingMessage = msg;
  }
  return npcThinkingMessage;
}

function hideNpcThinking(version = roundVersion) {
  if (version !== roundVersion) return;
  if (npcThinkingMessage && npcThinkingMessage.parentElement) {
    npcThinkingMessage.remove();
  }
  npcThinkingMessage = null;
}

let weakHitOverflowTimer = null;

function clearWeakHitOverflow() {
  const side = $("#player-side");
  const avatar = $("#player-avatar");
  if (!side || !avatar) return;
  if (weakHitOverflowTimer) {
    clearTimeout(weakHitOverflowTimer);
    weakHitOverflowTimer = null;
  }
  side.classList.remove("weak-hit-overflow");
  avatar.classList.remove("weak-hit-overflow");
}

function startWeakHitOverflowWindow(durationMs = 1000) {
  const side = $("#player-side");
  const avatar = $("#player-avatar");
  if (!side || !avatar) return;
  clearWeakHitOverflow();
  side.classList.add("weak-hit-overflow");
  avatar.classList.add("weak-hit-overflow");
  weakHitOverflowTimer = setTimeout(clearWeakHitOverflow, durationMs);
}

function addMsgNpc(text, tag, version = roundVersion) {
  text = String(text || "");
  startNpcSpeech();
  characterViews.npc?.setSpeaking(true);
  const div = document.createElement("div");
  div.className = "msg npc";
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = state.npcName;
  if (tag) {
    const s = document.createElement("span");
    s.className = "tag";
    s.textContent = tag;
    who.appendChild(s);
  }
  const body = document.createElement("span");
  div.appendChild(who);
  div.appendChild(body);
  $("#dialogue").appendChild(div);
  $("#dialogue").scrollTop = $("#dialogue").scrollHeight;
  return new Promise((resolve) => {
    let i = 0;
    const speed = 16;
    const step = () => {
      if (version !== roundVersion || !activeRound) { resolve(); return; }
      body.textContent = text.slice(0, ++i);
      // 每 4 字写一次 scrollTop，避免每字强制同步 layout（S9）
      if (i % 4 === 0 || i >= text.length) $("#dialogue").scrollTop = $("#dialogue").scrollHeight;
      if (i < text.length) setTimeout(step, speed);
      else {
        resolve();
      }
    };
    step();
  });
}

/* 空回复兜底：垫话已经显示，这里向服务端续拉 NPC 真正的回复。
   最多续拉 3 次，避免模型持续吐空导致死循环刷请求。 */
async function pullPendingReply(sid, version, maxTry = 3) {
  let thinkShown = false;
  for (let i = 0; i < maxTry; i++) {
    if (version !== roundVersion || !activeRound) return "";
    try {
      const d = await api("/api/message_retry", { sid });
      if (version !== roundVersion || !activeRound) return "";
      if (!d.pending) {
        hideNpcThinking(version);
        return d.npc_reply || "";
      }
      if (d.npc_reply) {
        if (!thinkShown) {
          thinkShown = true;
          showNpcThinking(version);
        }
        // 续拉垫话要分开发言，保留“多句”表现感。
        await addMsgNpc(d.npc_reply, "思考中", version);
      }
    } catch (_) {
      hideNpcThinking(version);
      return "";
    }
  }
  hideNpcThinking(version);
  return "";
}

/* 把后到的文字追加到最后一个 NPC 气泡（打字机效果，与 addMsgNpc 同速） */
function appendToLastNpc(text, version = roundVersion) {
  text = String(text || "");
  if (!text) return Promise.resolve();
  startNpcSpeech();
  const msgs = document.querySelectorAll(".msg.npc");
  const last = msgs[msgs.length - 1];
  if (!last) return addMsgNpc(text, "", version);
  const body = last.querySelector("span:not(.who)") || last.lastElementChild;
  const base = body.textContent || "";
  characterViews.npc?.setSpeaking(true);
  return new Promise((resolve) => {
    let i = 0;
    const speed = 16;
    const step = () => {
      if (version !== roundVersion || !activeRound) { resolve(); return; }
      body.textContent = base + text.slice(0, ++i);
      if (i % 4 === 0 || i >= text.length) $("#dialogue").scrollTop = $("#dialogue").scrollHeight;
      if (i < text.length) setTimeout(step, speed);
      else {
        resolve();
      }
    };
    step();
  });
}

/* ---------------- API ---------------- */
async function api(path, body) {
  if (path !== "/api/tts" && path !== "/api/status") {
    body = playerCtxPayload(body || {});
  }
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json();
  if (data && data.account && identity?.mode === "account") {
    applyAccountTokenPayload(data.account);
  }
  if (!r.ok || data.error) {
    const msg = typeof data?.message === "string" && data.message
      ? data.message
      : typeof data?.error === "string" && data.error
        ? data.error
        : `请求失败（${r.status}）`;
    throw new Error(msg);
  }
  return data;
}

function applyMatchSettlement(payload) {
  applyAccountTokenPayload(payload);
}

/* ---------------- 倒计时 ---------------- */
let timerInterval = null;
let deadline = 0;
let timedOut = false;

function stanceText(s) {
  return s === "支持" ? "正方" : "反方";
}
function renderStanceChips() {
  const you = $("#player-stance-chip"), npc = $("#npc-stance-chip");
  you.textContent = stanceText(state.stance);
  npc.textContent = stanceText(state.topic.npc_stance);
}
function startTimer(limitS) {
  clearInterval(timerInterval);
  timedOut = false;
  pendingTimeout = false;
  deadline = Date.now() + (limitS || 480) * 1000;
  tickTimer();
  timerInterval = setInterval(tickTimer, 1000);
}
function tickTimer() {
  const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  const m = Math.floor(left / 60), s = left % 60;
  $("#timer-num").textContent = `${m}:${String(s).padStart(2, "0")}`;
  $("#timer").classList.toggle("low", left <= 30);
  if (left <= 0) {
    clearInterval(timerInterval);
    handleTimeout();
  }
}
async function handleTimeout() {
  if (timedOut || !state.sid || !activeRound) return;
  // Finish the current turn first; concurrent timeout/message requests can settle twice.
  if (state.busy) { pendingTimeout = true; return; }
  const version = roundVersion;
  pendingTimeout = false;
  timedOut = true;
  state.busy = true;
  $("#send").disabled = true;
  try {
    const d = await api("/api/timeout", { sid: state.sid });
    if (version !== roundVersion || !activeRound) return;
    applyMatchSettlement(d.account_settlement);
    if (d.npc_reply) addMsg("npc", d.npc_reply);
    if (d.emotion) renderEmotion(d.emotion.npc, d.emotion.player);
    showResult(d.result || "LOSE_TIME", d.retrospect);
  } catch (e) {
    if (version !== roundVersion) return;
    addMsg("sys", "出错了：" + e.message);
    timedOut = false;
    if (activeRound) timerInterval = setInterval(tickTimer, 1000);
  } finally {
    if (version === roundVersion) {
      characterViews.player?.setSpeaking(false);
      characterViews.player?.endStatement?.();
      state.busy = false;
      $("#send").disabled = !activeRound;
    }
  }
}

/* ---------------- 屏幕切换 ---------------- */
function hideScreens(keep) {
  // 对局层只在真正进入对局时显示。菜单飞入会从透明态开始，若对局层仍在
  // 下面，加载层退场后的前几帧就会把旧对局画面透出来。
  $("#app")?.classList.toggle("hidden", Boolean(keep));
  ["mode-screen", "tier-screen", "free-screen", "stance-screen", "result-overlay", "entry-screen"].forEach((id) => {
    const el = $(`#${id}`);
    if (id !== keep) {
      el?.classList.add("hidden");
      el?.classList.remove("lobby-pre-entry", "lobby-boot-in");
    }
  });
  updateCharacterVisibility();
}
function playerCtxPayload(overrides = {}) {
  const mode = identity?.mode === "account" ? "account" : "guest";
  const payload = {
    player_mode: mode,
    ...overrides,
  };
  if (mode === "account") {
    payload.account_id = identity?.accountId || "";
    payload.player_name = identity?.playerName || identity?.accountId || "";
    payload.account_token = Number.isFinite(identity?.accountToken) ? identity.accountToken : ACCOUNT_INITIAL_TOKENS;
  }
  return payload;
}

function rememberActiveMatch(sid) {
  if (!sid) return;
  try {
    localStorage.setItem(ACTIVE_MATCH_KEY, JSON.stringify({
      sid,
      accountId: identity?.accountId || "",
      playerMode: identity?.mode === "account" ? "account" : "guest",
    }));
  } catch (_) { /* localStorage 不可用时仍由 pagehide 尽力通知 */ }
}

function forgetActiveMatch() {
  clearWeakHitOverflow();
  try { localStorage.removeItem(ACTIVE_MATCH_KEY); } catch (_) {}
  state.hintsLeft = 0;
  state.hintAdLeft = 0;
  updateHintButton();
}

async function recoverAbandonedMatch() {
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(ACTIVE_MATCH_KEY) || "null"); } catch (_) {}
  if (!pending?.sid) return;
  const sameAccount = pending.playerMode !== "account"
    || (identity?.mode === "account" && identity.accountId === pending.accountId);
  if (!sameAccount) return;
  try {
    const result = await api("/api/abandon", { sid: pending.sid });
    applyMatchSettlement(result.account_settlement);
  } catch (_) {
    // 会话可能已被服务端清理；清掉本地指针，避免阻塞登录/主界面。
  } finally {
    forgetActiveMatch();
  }
}

async function refreshAccountToken() {
  if (!identity || identity.mode !== "account" || !identity.accountId) return;
  const d = await api("/api/account_token/query", playerCtxPayload({}));
  applyAccountTokenPayload(d);
}

async function requestAccountTokenCallback(action, payload = {}) {
  if (!identity || identity.mode !== "account" || !identity.accountId) {
    alert("该操作仅账号登录可用，请先登录账号。");
    return;
  }
  const normalized = {
    action,
    ...payload,
    callback_id: payload.callback_id || generateCallbackId(action),
    callback_ts: Math.floor(Date.now() / 1000),
    callback_secret: identity.callbackSecret || "",
  };
  normalized.callback_signature = await buildCallbackSignature(action, normalized);
  const d = await api("/api/account_token/callback", normalized);
  applyAccountTokenPayload(d);
  // 回调入账后再从服务端读取一次，确保账号信息区显示最新余额。
  return await refreshAccountToken();
}

async function simulateWatchAdReward() {
  await requestAccountTokenCallback("ad_reward", { amount: 100, source_context: "ui_simulation" });
}

async function simulatePurchaseTokenPack() {
  await requestAccountTokenCallback("purchase", { amount: 500, source_context: "ui_simulation", sku: "token_500" });
}

function showEntry() {
  stopVoice();
  stopMic();
  clearInterval(timerInterval);
  hideScreens("entry-screen");
  $("#entry-screen").classList.remove("hidden");
  $("#entry-actions").classList.remove("hidden");
  $("#entry-account-panel").classList.add("hidden");
  setAuthStatus("");
  const acctBtn = $("#identity-switch");
  if (acctBtn) acctBtn.textContent = "切换身份";
}

function confirmGuestEntry() {
  switchIdentity(makeDefaultProfile("guest"));
  enterMainWithLoading().catch(reportUiError);
}

function setAuthStatus(message, kind = "") {
  const status = $("#auth-status");
  if (!status) return;
  status.textContent = message;
  status.className = kind;
}

function renderAuthPanel() {
  const registering = authMode === "register";
  const phone = authMethod === "phone";
  $("#auth-title").textContent = registering ? "注册账号" : "账号登录";
  $("#auth-submit").textContent = registering ? "注册并继续" : "登录";
  $("#auth-switch-mode").textContent = registering ? "已有账号？返回登录" : "还没有账号？注册账号";
  $("#auth-username-row").classList.toggle("hidden", !registering);
  $("#auth-password-row").classList.toggle("hidden", phone);
  $("#auth-code-row").classList.toggle("hidden", !phone);
  $("#auth-forgot").classList.toggle("hidden", registering || phone);
  $("#auth-identifier-label").textContent = phone ? "手机号" : (registering ? "邮箱" : "邮箱或用户名");
  const identifier = $("#auth-identifier");
  identifier.type = phone ? "tel" : (registering ? "email" : "text");
  identifier.placeholder = phone ? "输入手机号" : (registering ? "输入邮箱" : "输入邮箱或用户名");
  $("#auth-password").autocomplete = registering ? "new-password" : "current-password";
  $("#auth-method-tabs").querySelectorAll("button").forEach((button) => button.classList.toggle("on", button.dataset.authMethod === authMethod));
  setAuthStatus("");
}

function openAuthPanel() {
  authMode = "login";
  authMethod = "credential";
  $("#entry-actions").classList.add("hidden");
  $("#entry-account-panel").classList.remove("hidden");
  ["#auth-username", "#auth-identifier", "#auth-password", "#auth-code"].forEach((id) => { const input = $(id); if (input) input.value = ""; });
  renderAuthPanel();
  $("#auth-identifier").focus();
}

async function applyAuthenticatedAccount(account) {
  const profile = accountIdentity(account.account_id);
  profile.playerName = account.player_name || account.username || account.account_id;
  profile.skinId = SKINS[0].id;
  profile.appearance = {};
  profile.setupDone = true;
  profile.accountToken = Number(account.account_token || 0);
  profile.callbackSecret = account.callback_secret || "";
  profile.permissions = normalizePermissions({ ...(account.permissions || {}), account_token: profile.accountToken });
  identity = normalizeIdentity(profile);
  saveIdentity(identity);
  await enterMainWithLoading();
}

async function submitAuth() {
  const payload = {
    mode: authMode,
    method: authMethod,
    identifier: $("#auth-identifier").value.trim(),
    username: $("#auth-username").value.trim(),
    password: $("#auth-password").value,
    code: $("#auth-code").value.trim(),
  };
  setAuthStatus(authMode === "register" ? "正在创建账号…" : "正在登录…");
  const submitButton = $("#auth-submit");
  if (submitButton) submitButton.disabled = true;
  showLoadingScreen();
  updateLoadingProgress(8, authMode === "register" ? "正在创建账号…" : "正在验证账号…", "AUTHENTICATION");
  try {
    const data = await api(authMode === "register" ? "/api/auth/register" : "/api/auth/login", payload);
    await applyAuthenticatedAccount(data.account);
  } catch (error) {
    hideLoadingScreen();
    setAuthStatus(error.message, "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function sendAuthCode() {
  const identifier = $("#auth-identifier").value.trim();
  if (!identifier) { setAuthStatus("请先输入手机号", "error"); return; }
  try {
    const data = await api("/api/auth/code", { identifier, purpose: authMode });
    setAuthStatus(data.message + (data.demo_code ? `：${data.demo_code}` : ""), "ok");
  } catch (error) {
    setAuthStatus(error.message, "error");
  }
}

function showMode({ bootstrapTransition = false } = {}) {
  if (!identity) {
    showEntry();
    return;
  }
  if (identity.mode === "account" && !identity.accountId) {
    identity = makeDefaultProfile("guest");
    saveIdentity(identity);
    applyIdentityToAvatar();
    syncIdentityUI();
  }
  roundVersion++;
  screenVersion++;
  activeRound = false;
  pendingTimeout = false;
  state.sid = null;
  state.busy = false;
  resetMatchHints();
  updateHintButton();
  $("#send").disabled = true;
  $("#stance-back").disabled = false;
  $("#stance-reroll").disabled = false;
  $("#stance-start").disabled = false;
  $("#stance-start").textContent = "开 辩";
  clearInterval(timerInterval);
  stopVoice();
  stopMic();
  clearObjection();
  closeNpcInfo();
  resultLocked = false;
  clearWeakHitOverflow();
  $("#series-bar").classList.add("hidden");
  run = null;
  hideScreens("mode-screen");
  $("#mode-screen").classList.remove("hidden");
  $("#mode-screen").classList.remove("lobby-boot-in");
  if (bootstrapTransition) {
    $("#mode-screen").classList.add("lobby-pre-entry");
  } else {
    $("#mode-screen").classList.remove("lobby-pre-entry");
  }
  renderAvatarCard();
  applyIdentityToAvatar();
  syncIdentityUI();
  updateCharacterVisibility();
  updateVignette();
}

let loadingSequence = 0;
function updateLoadingProgress(percent, detail, stage) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const fill = $("#loading-fill");
  const number = $("#loading-percent");
  const detailEl = $("#loading-detail");
  const stageEl = $("#loading-stage");
  if (fill) fill.style.width = `${value}%`;
  if (number) number.textContent = `${value}%`;
  if (detailEl && detail) detailEl.textContent = detail;
  if (stageEl && stage) stageEl.textContent = stage;
}

function showLoadingScreen() {
  const screen = $("#loading-screen");
  if (!screen) return;
  updateLoadingProgress(4, "正在同步账号与本地进度…", "IDENTITY SYNC");
  // 登录后的第一帧必须由加载层完全覆盖；避免淡入期间漏出底层对局 UI。
  screen.classList.add("loading-enter-lock");
  screen.classList.remove("hidden");
  void screen.offsetWidth;
  screen.classList.remove("loading-enter-lock");
}

function hideLoadingScreen() {
  $("#loading-screen")?.classList.add("hidden");
}

function waitForPaint() {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function waitAtMost(promise, timeoutMs) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

async function enterMainWithLoading({ beforeAssets = null } = {}) {
  const ticket = ++loadingSequence;
  showLoadingScreen();
  // 同步搭好被遮罩覆盖的大厅，保证登录回调结束时不会暴露中间状态。
  showMode({ bootstrapTransition: true });
  await waitForPaint();

  if (beforeAssets) {
    updateLoadingProgress(12, "正在恢复账号进度…", "PROFILE RECOVERY");
    try { await beforeAssets; } catch (_) { /* 恢复失败不阻塞本地资源加载 */ }
  }
  if (ticket !== loadingSequence) return;

  // 大厅在全屏加载层下完成排版，让 Live2D 获得有效画布尺寸。
  updateLoadingProgress(20, "正在构建主界面…", "INTERFACE ASSEMBLY");
  await waitForPaint();

  const portraitLoad = window.DebateCharacters?.preload?.({
    onProgress: ({ loaded, total }) => {
      if (ticket !== loadingSequence) return;
      const ratio = total ? loaded / total : 1;
      updateLoadingProgress(28 + ratio * 42, `正在载入角色资源 ${loaded}/${total}…`, "ASSET CACHE");
    },
  });
  const protagonistLoad = characterViews.preview?.ready;
  await Promise.all([
    waitAtMost(portraitLoad, 20000),
    waitAtMost(protagonistLoad, 25000),
  ]);
  if (ticket !== loadingSequence) return;

  updateLoadingProgress(92, "正在校准角色与界面…", "FINAL CALIBRATION");
  applyIdentityToAvatar();
  syncIdentityUI();
  updateCharacterVisibility();
  const modeScreen = $("#mode-screen");
  if (modeScreen) {
    modeScreen.classList.remove("lobby-pre-entry");
    modeScreen.classList.add("lobby-boot-in");
  }
  await waitForPaint();
  updateLoadingProgress(100, "终端连接完成", "SYSTEM READY");
  if (ticket === loadingSequence) hideLoadingScreen();
}

/* ---------------- 模式选择 ---------------- */
const TIER_COLORS = { 1: "#639922", 2: "#BA7517", 3: "#EF9F27", 4: "#D85A30", 5: "#FF3B4E" };
const TIER_LABELS = { 1: "街头大妈", 2: "精明白领", 3: "意见领袖", 4: "资深辩手", 5: "辩论专家" };
const isGuest = () => identity?.mode !== "account";
const shouldShowFights = () => !isGuest();

async function loadTiers(mode = "ladder") {
  if (mode === "free") {
    const permissionMessage = requirePermissionMessage("free_mode", "自由切磋");
    if (permissionMessage) {
      alert(permissionMessage);
      return;
    }
  }
  const version = ++screenVersion;
  clearInterval(timerInterval);
  const tiers = await api("/api/tiers", { mode });
  if (version !== screenVersion) return;
  const list = $("#tier-list");
  list.innerHTML = "";
  tiers.forEach((t) => {
    const unlockHint = mode === "free" ? requirePermissionMessage("free_mode", "自由切磋") : "";
    const card = document.createElement("div");
    card.className = "tier-card" + (t.unlocked ? "" : " locked");
    const memTag = (shouldShowFights() && t.fights > 0) ? `<span class="mem-chip">交手 ${t.fights} 次</span>` : "";
    const lockTag = t.unlocked ? "" : `<span class="lock-chip">🔒 ${mode === "free" && unlockHint ? unlockHint : "未解锁"}</span>`;
    card.innerHTML =
      `<img class="tier-avatar" src="${t.avatar_thumb || t.avatar}" alt="${t.name}">` +
      `<div class="tier-body">` +
      `<div class="tier-name"><span class="tier-chip" style="background:${TIER_COLORS[t.tier]}">${t.tier}</span>${t.name}${memTag}${lockTag}<span style="font-size:12px;color:#C8CCE0"> · ${TIER_LABELS[t.tier] || ""}</span></div>` +
      `<div class="tier-persona">${t.unlocked ? t.persona : "战胜上一关后解锁"}</div>` +
      `<div class="tier-meta">软肋：${t.weakness.join("、")} · token <b>${t.token_quota}</b></div>` +
      `</div>`;
    if (t.unlocked) {
      card.addEventListener("click", () => {
        run = { mode: "ladder", tier: t.tier, npcId: t.npc_id, npcName: t.name, score: [0, 0], game: 1 };
        showStance().catch(reportUiError);
      });
    }
    list.appendChild(card);
  });
  hideScreens("tier-screen");
  $("#tier-screen").classList.remove("hidden");
}

function renderFreeList() {
  const version = ++screenVersion;
  if (!identity || identity.mode !== "account") {
    alert(requirePermissionMessage("free_mode", "自由切磋"));
    return Promise.resolve(false);
  }
  const permissionMessage = requirePermissionMessage("free_mode", "自由切磋");
  if (permissionMessage) {
    alert(permissionMessage);
    return Promise.resolve(false);
  }
  const memRow = $("#free-mem-switch");
  memRow.classList.toggle("on", freeMem);
  $("#free-mem-hint").textContent = freeMem ? "开" : "关";
  return api("/api/tiers", { mode: "free" }).then((tiers) => {
    if (version !== screenVersion) return false;
    const list = $("#free-list");
    list.innerHTML = "";
    tiers.forEach((t) => {
      const card = document.createElement("div");
      card.className = "npc-card" + (t.unlocked ? "" : " locked");
      const memTag = (shouldShowFights() && t.fights > 0) ? `<span class="mem-chip">交手 ${t.fights} 次</span>` : "";
      const lockHint = t.unlocked
        ? ""
        : `<div class="lock-chip">🔒 ${requirePermissionMessage("free_mode", "自由切磋") || "尚未解锁"}</div>`;
      card.innerHTML =
        `<img src="${t.avatar_thumb || t.avatar}" alt="${t.name}">` +
        `<div class="tier-body"><div class="nc-name">${t.name}${memTag}</div>` +
        `<div class="nc-meta">${t.persona} · token ${t.token_quota}</div>${lockHint}</div>`;
      if (t.unlocked) {
        card.addEventListener("click", () => {
          run = { mode: "free", tier: t.tier, npcId: t.npc_id, npcName: t.name, score: [0, 0], game: 1 };
          showStance().catch(reportUiError);
        });
      }
      list.appendChild(card);
    });
    return true;
  });
}
function toggleFreeMem() {
  freeMem = !freeMem;
  savePreference("bianyi_freeMem", freeMem ? "1" : "0");
  renderFreeList().catch(reportUiError);
}

/* ---------------- 选边 / 开局 ---------------- */
let pendingStance = { topicId: null };
async function showStance() {
  if (!run) return;
  const version = ++screenVersion;
  const selectedRun = run;
  const p = await api("/api/preview", { tier: selectedRun.tier, npc_id: selectedRun.npcId, mode: selectedRun.mode || "ladder" });
  if (version !== screenVersion || run !== selectedRun) return;
  pendingStance.topicId = p.topic.id;
  $("#stance-avatar").src = p.npc.avatar_thumb || p.npc.avatar;
  $("#stance-npc-name").textContent = p.npc.name;
  $("#stance-topic").textContent = p.topic.topic;
  $("#side-npc-text").textContent = `${p.npc.name} · ${stanceText(p.npc_stance)}（${p.npc_stance}）`;
  $("#side-you-text").textContent = `你 · ${stanceText(p.player_stance)}（${p.player_stance}）`;
  const tagsEl = $("#stance-tags");
  tagsEl.innerHTML = "";
  (p.npc.tags || []).forEach((tg) => {
    const s = document.createElement("span");
    s.className = "tag-chip";
    s.textContent = tg;
    tagsEl.appendChild(s);
  });
  const memChip = $("#stance-mem");
  const parts = [];
  if (run.mode === "ladder") parts.push(`第 ${run.game}/3 局`);
  if (shouldShowFights() && p.npc.fights > 0) parts.push(`交手 ${p.npc.fights} 次`);
  if (run.mode === "free" && !freeMem && identity?.mode === "account") parts.push("记忆关");
  memChip.textContent = parts.join(" · ");
  hideScreens("stance-screen");
  $("#stance-screen").classList.remove("hidden");
}

async function newGame(tier, stance, topicId) {
  // 防重入：请求未返回前锁定，杜绝连点「开辩」重复建房/重复生成开场白
  if (state.busy) return;
  clearWeakHitOverflow();
  const version = ++roundVersion;
  screenVersion++;
  resetMatchHints();
  activeRound = false;
  state.sid = null;
  stopVoice();
  stopMic();
  clearObjection();
  closeNpcInfo();
  clearTimeout(window.__recallTimer);
  $("#recall-toast").classList.add("hidden");
  const btn = $("#stance-start");
  const promptEl = $("#stance-prompt");
  const promptBackup = promptEl ? promptEl.textContent : "";
  state.busy = true;
  $("#stance-back").disabled = true;
  $("#stance-reroll").disabled = true;
  if (btn) { btn.disabled = true; btn.textContent = "对手准备中…"; }
  if (promptEl) promptEl.textContent = "对手正在准备开场立论，请稍候…";
  try {
    clearInterval(timerInterval);
    resultLocked = false;
    $("#dialogue").innerHTML = "";
    const isGuestMode = isGuest();
    const body = { tier: tier || 1, stance, topic_id: topicId, mode: run?.mode || "ladder" };
    if (run && run.npcId) body.npc_id = run.npcId;
    body.memory_on = isGuestMode ? false : (run && run.mode === "ladder") ? true : freeMem;
    const d = await api("/api/new_session", body);
    if (version !== roundVersion) return;
    if (d.connection_error || d.next?.status === "INVALID_LLM") {
      alert("连接超时，请F5刷新重试。");
      return;
    }
    if (promptEl) promptEl.textContent = promptBackup;
    state.sid = d.sid;
    rememberActiveMatch(d.sid);
    state.topic = d.topic;
    state.stance = d.player_stance;
    state.dimensions = d.dimensions;
    state.confidence = d.confidence;
    state.token = d.token_remaining;
    state.quota = d.token_quota;
    state.npcName = d.npc.name;
    state.tier = d.npc.tier || 1;
    state.npcId = d.npc.npc_id || (run && run.npcId) || "L1_A";

    $("#topic-domain").textContent = d.topic.domain;
    $("#topic-text").textContent = d.topic.topic;
    $("#npc-name2").textContent = d.npc.name;
    characterViews.npc?.setCharacter(state.npcId);
    characterViews.npc?.reset();
    characterViews.player?.reset();
    state.npcWeakness = d.npc.weakness || [];
    state.npcTags = d.npc.tags || [];
    renderStanceChips();
    activeRound = true;
    updateHintButton();
    startTimer(d.time_limit_s || 480);

    // 系列赛横幅
    const bar = $("#series-bar");
    if (run && run.mode === "ladder") {
      bar.classList.remove("hidden");
      $("#series-text").textContent =
        `天梯 · ${run.npcName}｜第 ${run.game}/3 局｜你 ${run.score[0]} : ${run.score[1]} ${run.npcName}`;
    } else {
      bar.classList.add("hidden");
    }

    hideScreens();
    // 翻旧账（S7）：NPC 记得你 → 开局金色小字浮现，稍后淡出
    if (d.memory_recall) {
      const toast = $("#recall-toast");
      toast.textContent = `「${state.npcName}」还记得上次：${d.memory_recall}`;
      toast.classList.remove("hidden");
      clearTimeout(window.__recallTimer);
      window.__recallTimer = setTimeout(() => toast.classList.add("hidden"), 3400);
    }
    renderRadar(state.dimensions, null);
    renderConfidence();
    renderToken();
    renderEmotion("得意", "从容");
    addMsg("npc", d.opening);
    speak(d.opening, d.npc.npc_id);
  } catch (e) {
    if (version !== roundVersion) return;
    // 开局失败：留在选边屏、按钮恢复，给出原因后可重试
    if (promptEl) promptEl.textContent = "开局失败：" + e.message + "（确认后端已启动后重试）";
    else alert("开局失败：" + e.message);
  } finally {
    if (version === roundVersion) {
      characterViews.player?.setSpeaking(false);
      characterViews.player?.endStatement?.();
      state.busy = false;
      updateHintButton();
      $("#send").disabled = !activeRound;
      $("#stance-back").disabled = false;
      $("#stance-reroll").disabled = false;
      if (btn) { btn.disabled = false; btn.textContent = "开 辩"; }
    }
  }
}

/* ---------------- 发言 ---------------- */
async function send() {
  if (state.busy || !activeRound || resultLocked || !state.sid) return;
  const input = $("#input");
  const text = input.value.trim();
  if (!text) return;
  if (Date.now() >= deadline) { handleTimeout(); return; }
  const version = roundVersion;
  state.busy = true;
  $("#send").disabled = true;
  input.value = "";
  characterViews.player?.setSpeaking(true);
  addMsg("player", text);
  addMsg("sys", "判定中…");
  try {
    const d = await api("/api/message", { sid: state.sid, text });
    if (version !== roundVersion || !activeRound) return;
    if (d.connection_error || d.next?.status === "INVALID_LLM") {
      clearInterval(timerInterval);
      activeRound = false;
      state.sid = null;
      forgetActiveMatch();
      applyMatchSettlement(d.account_settlement);
      alert("连接超时，请F5刷新重试。");
      return;
    }
    const jl = d.judge.dimension_label;
    const feedback = d.settlement.direction === "weak"
      ? `⚔️ 命中薄弱点「${jl}」L${d.judge.strength.slice(1)}`
      : d.settlement.direction === "strong"
        ? `🛡 命中 TA 的强项「${jl}」，被反驳`
        : d.judge.strength === "L0" ? "无效发言" : `「${jl}」普通命中`;
    const fbCls = d.settlement.direction === "weak" ? "weak-hit"
      : d.settlement.direction === "strong" ? "strong-hit" : "";
    setLastSysMsg(feedback, fbCls);
    state.confidence = d.settlement.confidence;
    state.token = d.settlement.token_remaining;
    state.dimensions = d.dimensions;
    const finished = d.next.status !== "ONGOING";
    if (finished) { clearInterval(timerInterval); pendingTimeout = false; }
    renderConfidence();
    renderToken();
    renderRadar(state.dimensions, d.judge.dimension);
    renderEmotion(d.emotion.npc, d.emotion.player);
    if (d.objection_event && d.objection_event.side !== "none") objection(d.objection_event.side, d.objection_event);
    const beatTag = { YIELD: "动摇", REBUTTAL: "反驳", OBJECTION: "反击", HOOK: "追问", BRUSH_OFF: "无视", DISMISS: "不耐烦", CONCEDE: "被说服" }[d.beat];
    characterViews.player?.setSpeaking(false);
    speak(d.npc_reply, state.npcId);
    await addMsgNpc(d.npc_reply, beatTag, version);
    hideNpcThinking(version);
    if (version !== roundVersion || !activeRound) return;
    // 空回复兜底：本轮给的是"思考垫话"，后台继续拉真正回复，每句按独立气泡展示
    if (d.pending) {
      const merged = await pullPendingReply(state.sid, version);
      if (merged) {
        await addMsgNpc(merged, "", version);
      }
    }
    if (version !== roundVersion || !activeRound) return;
    if (finished) {
      if (d.next.status === "WIN") await new Promise((resolve) => setTimeout(resolve, 2000));
      applyMatchSettlement(d.account_settlement);
      if (version === roundVersion && activeRound) showResult(d.next.status, d.retrospect);
    }
  } catch (e) {
    if (version !== roundVersion) return;
    setLastSysMsg("出错了：" + e.message);
  } finally {
    if (version === roundVersion) {
      hideNpcThinking(version);
      characterViews.player?.setSpeaking(false);
      characterViews.player?.endStatement?.();
      state.busy = false;
      $("#send").disabled = !activeRound;
      if (activeRound && (pendingTimeout || Date.now() >= deadline)) handleTimeout();
      else if (activeRound) input.focus();
    }
  }
}

async function askHint() {
  if (!state.sid || state.busy || !activeRound) return;
  const version = roundVersion;
  if (state.hintsLeft <= 0) {
    if (state.hintAdLeft <= 0) return;
    await simulateWatchHintAd();
    return;
  }
  try {
    const d = await api("/api/hint", { sid: state.sid });
    if (version !== roundVersion || !activeRound) return;
    if (d.hint) {
      state.hintsLeft = Math.max(0, state.hintsLeft - 1);
      const div = document.createElement("div");
      div.className = "msg hint";
      div.innerHTML = `<div class="who">💡 教练提示</div>${esc(d.hint)}`;
      $("#dialogue").appendChild(div);
      $("#dialogue").scrollTop = $("#dialogue").scrollHeight;
    }
    updateHintButton();
  } catch (e) {
    if (version !== roundVersion || !activeRound) return;
    addMsg("sys", "出错了：" + e.message);
  }
}

/* ---------------- 结算（含系列赛比分） ---------------- */
function showResult(status, retrospect) {
  clearInterval(timerInterval);
  forgetActiveMatch();
  const win = status === "WIN";
  const subMap = {
    LOSE_TOKEN: "token 用尽，未能说服 TA。",
    LOSE_TIME: "时间到，未能说服 TA。",
    LOSE_TURN: "回合用尽，未能说服 TA。",
    LOSE_SURRENDER: "这局认输，下次想清楚再出手。",
  };
  openResult({
    win,
    title: win ? "说服成功！" : status === "LOSE_SURRENDER" ? "你投降了" : "辩论失败",
    sub: win ? `${state.npcName}被你说服了，自信度归零。` : (subMap[status] || "未能说服 TA。"),
    retrospect,
    status,
  });
}

async function surrender() {
  if (state.busy || !activeRound) return;
  const version = roundVersion;
  state.busy = true;
  $("#send").disabled = true;
  stopVoice();
  try {
    const d = await api("/api/surrender", { sid: state.sid });
    if (version !== roundVersion || !activeRound) return;
    applyMatchSettlement(d.account_settlement);
    if (d.npc_reply) addMsg("npc", d.npc_reply);
    if (d.emotion) renderEmotion(d.emotion.npc, d.emotion.player);
    showResult(d.result, d.retrospect);
  } catch (error) {
    if (version === roundVersion) addMsg("sys", "投降未完成：" + error.message);
  } finally {
    if (version === roundVersion) {
      characterViews.player?.setSpeaking(false);
      characterViews.player?.endStatement?.();
      state.busy = false;
      $("#send").disabled = !activeRound;
      if (activeRound && (pendingTimeout || Date.now() >= deadline)) handleTimeout();
    }
  }
}

function openResult({ win, title, sub, retrospect, status = "" }) {
  clearInterval(timerInterval);
  clearWeakHitOverflow();
  if (resultLocked) return;
  appendMatchRecord(win, status);
  resultLocked = true;
  activeRound = false;
  pendingTimeout = false;
  updateHintButton();
  $("#send").disabled = true;
  stopMic();
  clearObjection();
  closeNpcInfo();
  updateVignette();
  updateCharacterVisibility();
  state.busy = true;
  let seriesOutcome = null;   // 'pass' | 'fail' | null（仅系列赛结束时有值）

  // 更新系列赛比分 / 结算标题
  const seriesBox = $("#result-series");
  seriesBox.textContent = "";
  const restart = $("#restart");
  let nextTxt = "返回主界面";
  if (run) {
    if (run.mode === "ladder") {
      if (win) run.score[0]++; else run.score[1]++;
      const done = run.score[0] >= 2 || run.score[1] >= 2;
      if (done) {
        const passed = run.score[0] > run.score[1];
        if (passed) api("/api/progress", { tier: run.tier, mode: run.mode || "ladder" }).catch(reportUiError);
        seriesOutcome = passed ? "pass" : "fail";
        title = passed ? "晋级成功！" : "挑战失败";
        sub = `${run.npcName} 系列赛结束：你 ${run.score[0]} : ${run.score[1]} ${run.npcName}。${passed ? "三局两胜过关，下一关等你。" : "这套打法还没压住 TA，回主界面再练练。"}`;
        nextTxt = "返回主界面";
      } else {
        run.game++;
        seriesBox.textContent = `第 ${run.game - 1}/3 局 ${win ? "胜" : "负"}｜当前你 ${run.score[0]} : ${run.score[1]} ${run.npcName}`;
        nextTxt = `进行第 ${run.game} 局`;
      }
    } else { // free
      nextTxt = "再练一局";
      seriesBox.textContent = freeMem
        ? (win ? "你赢了，TA 会记住这次交手。" : "你输了，TA 记住了你的破绽。")
        : "自由切磋 · 记忆已关";
    }
  }
  restart.textContent = nextTxt;

  const box = $("#result-overlay");
  const titleEl = $("#result-title");
  titleEl.textContent = title;
  titleEl.className = win ? "win" : "lose";
  $("#result-sub").textContent = sub;
  const ret = $("#result-retrospect");
  if (ret) {
    if (retrospect) {
      ret.style.display = "";
      ret.textContent = "复盘：" + retrospect;
    } else {
      ret.style.display = "none";
      ret.textContent = "";
    }
  }
  box.classList.remove("hidden");
  // 系列赛结局演出：晋级金印落下 + 胜利粒子；淘汰灰暗化
  const stamp = $("#result-stamp");
  const boxEl = $("#result-box");
  if (stamp && boxEl) {
    boxEl.classList.remove("grayscale");
    stamp.classList.add("hidden");
    stamp.classList.remove("drop");
    if (seriesOutcome === "pass" && fx.flash) {
      stamp.classList.remove("hidden");
      void stamp.offsetWidth;
      stamp.classList.add("drop");
      spawnParticles();
    } else if (seriesOutcome === "fail") {
      boxEl.classList.add("grayscale");
    }
  }
  state.busy = false;
}

/* 胜利金粒子：≤24 个 DOM span + CSS transform，动画结束自清理 */
function spawnParticles() {
  if (!fx.particles || _reducedMotion) return;
  const box = $("#result-box");
  if (!box) return;
  for (let i = 0; i < 24; i++) {
    const p = document.createElement("span");
    p.className = "particle";
    const ang = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 160;
    p.style.setProperty("--dx", `${Math.cos(ang) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(ang) * dist - 70}px`);
    p.style.animationDelay = `${Math.random() * 0.25}s`;
    box.appendChild(p);
    p.addEventListener("animationend", () => p.remove());
  }
}

function restartAction() {
  stopVoice();
  if (run && run.mode === "ladder" && run.score[0] < 2 && run.score[1] < 2) {
    showStance().catch(reportUiError); // 继续下一局（换题）
  } else if (run && run.mode === "free") {
    showStance().catch(reportUiError); // 再练一局（同对手换题）
  } else {
    showMode();
  }
}

function bootstrapIdentity() {
  identity = loadIdentity();
  if (identity?.mode === "account" && identity.accountId && identity.setupDone) {
    enterMainWithLoading({ beforeAssets: recoverAbandonedMatch() }).catch(reportUiError);
    return;
  }
  showEntry();
  recoverAbandonedMatch().catch(() => {});
}

/* ---------------- 语音转文字（Web Speech API） ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
function initMic() {
  const btn = $("#mic");
  if (!btn) return;
  if (!SR) { btn.style.display = "none"; return; }
  try {
    recognition = new SR();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (e) => {
      let finalT = "", interimT = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalT += r[0].transcript; else interimT += r[0].transcript;
      }
      const val = (finalT || interimT).trim();
      if (val) $("#input").value = val;
    };
    recognition.onend = () => setMicState(false);
    recognition.onerror = () => setMicState(false);
  } catch (e) {
    btn.style.display = "none";
  }
}
function setMicState(on) {
  const btn = $("#mic");
  if (!btn) return;
  btn.classList.toggle("rec", on);
  btn.textContent = on ? "🎙️" : "🎤";
  $("#input").placeholder = on ? "正在听，请说话…" : "输入你的论点，命中 TA 的薄弱点…";
}
function startMic() {
  if (!recognition || !activeRound || state.busy) return;
  try { recognition.start(); setMicState(true); } catch (e) {}
}
function stopMic() {
  if (!recognition) return;
  try { recognition.stop(); } catch (e) {}
}

/* ---------------- 事件绑定 ---------------- */
function reportUiError(error) { alert("操作失败：" + error.message); }
$("#mode-ladder").addEventListener("click", () => loadTiers().catch(reportUiError));
$("#mode-free").addEventListener("click", () => {
  const permissionMessage = requirePermissionMessage("free_mode", "自由切磋");
  if (permissionMessage) {
    alert(permissionMessage);
    return;
  }
  clearInterval(timerInterval);
  renderFreeList().then((current) => {
    if (!current) return;
    hideScreens("free-screen");
    $("#free-screen").classList.remove("hidden");
  }).catch(reportUiError);
});
$("#tier-back").addEventListener("click", showMode);
$("#free-back").addEventListener("click", showMode);
$("#free-mem-switch").addEventListener("click", toggleFreeMem);
$("#mode-reset").addEventListener("click", async () => {
  const permissionMessage = requirePermissionMessage("progress_reset", "进度重置（NPC记忆与成长）");
  if (permissionMessage) {
    alert(permissionMessage);
    return;
  }
  const cost = Number(identity?.permissions?.progress_reset?.cost || ACCOUNT_FEATURE_DEFAULTS.progress_reset?.cost || 0);
  const token = Number(identity?.accountToken || 0);
  const confirmMessage = [
    "确认执行进度重置？",
    "",
    "本次操作会：",
    "• 清空所有 NPC 的记忆与成长",
    "• 清空并重置天梯进度（含已通关层级）",
    "",
    `当前代币：${token}（该功能已满足 ${cost} 代币解锁门槛，可继续执行）。`,
    "",
    "该操作不可恢复，确认继续？"
  ].join("\n");
  if (!window.confirm(confirmMessage)) {
    return;
  }
  const confirmKeyword = "确认清空";
  const typed = window.prompt("请在下方输入确认短语以继续：\n\n确认清空");
  if (typed?.trim() !== confirmKeyword) {
    if (typed !== null) {
      alert("确认短语不匹配，已取消清空。");
    }
    return;
  }
  try {
    await api("/api/npc_reset", {});
    await api("/api/progress", { reset: true });
    alert("已重置所有 NPC 的记忆、成长与天梯进度");
  } catch (error) { reportUiError(error); }
});
/* 演出设置（S3）：主界面开关面板 */
function syncFxUI() {
  const m = $("#fx-master"), s = $("#fx-shake"), motion = $("#fx-motion");
  if (m) m.classList.toggle("on", fx.flash);
  if (s) s.classList.toggle("on", fx.shake);
  if (motion) motion.classList.toggle("on", fx.motion);
  const speakingDuration = $("#fx-npc-speaking-ms");
  if (speakingDuration) speakingDuration.value = String(getNpcSpeakDurationMs());
  const note = $("#fx-note");
  if (note) note.textContent = _reducedMotion
    ? "系统已开启「减少动态效果」，角色动态、震动与粒子暂停。"
    : "主开关控制闪屏·金印；震动可单独关。";
}
const _fxBtn = $("#mode-fx");
if (_fxBtn) _fxBtn.addEventListener("click", () => $("#fx-panel").classList.toggle("hidden"));
const _fxMaster = $("#fx-master");
if (_fxMaster) _fxMaster.addEventListener("click", () => {
  fx.flash = !fx.flash;
  fx.particles = fx.flash;
  savePreference("bianyi_fx", JSON.stringify(fx));
  syncFxUI(); applyFx();
});
const _fxShake = $("#fx-shake");
if (_fxShake) _fxShake.addEventListener("click", () => {
  fx.shake = !fx.shake;
  savePreference("bianyi_fx", JSON.stringify(fx));
  syncFxUI(); applyFx();
});
const _fxMotion = $("#fx-motion");
if (_fxMotion) _fxMotion.addEventListener("click", () => {
  fx.motion = !fx.motion;
  savePreference("bianyi_fx", JSON.stringify(fx));
  syncFxUI(); applyFx();
});
const _fxNpcSpeakMs = $("#fx-npc-speaking-ms");
if (_fxNpcSpeakMs) {
  const onSpeechDurationChange = () => {
    const next = Number(_fxNpcSpeakMs.value);
    if (!Number.isFinite(next)) return;
    setNpcSpeakDurationMs(next);
    syncFxUI();
  };
  _fxNpcSpeakMs.addEventListener("change", onSpeechDurationChange);
  _fxNpcSpeakMs.addEventListener("blur", onSpeechDurationChange);
}
motionPreference?.addEventListener?.("change", (event) => {
  _reducedMotion = event.matches;
  applyFx(); syncFxUI();
});
document.addEventListener("visibilitychange", updateCharacterVisibility);
window.addEventListener("pagehide", () => {
  if (activeRound && state.sid) {
    const body = JSON.stringify(playerCtxPayload({ sid: state.sid }));
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/abandon", new Blob([body], { type: "application/json" }));
    }
  }
  stopVoice();
  stopMic();
  for (const view of Object.values(characterViews)) view.pause(true);
});
window.addEventListener("pageshow", () => {
  updateCharacterVisibility();
  if (activeRound) tickTimer();
});
syncFxUI();
$("#send").addEventListener("click", send);
$("#surrender").addEventListener("click", surrender);
$("#restart").addEventListener("click", restartAction);
$("#hint").addEventListener("click", askHint);
const micBtn = $("#mic");
if (micBtn) {
  micBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); startMic(); });
  micBtn.addEventListener("pointerup", stopMic);
  micBtn.addEventListener("pointerleave", stopMic);
  micBtn.addEventListener("pointercancel", stopMic);
}
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) send();
});
$("#entry-guest").addEventListener("click", confirmGuestEntry);
$("#entry-account").addEventListener("click", openAuthPanel);

$("#identity-ad-reward").addEventListener("click", () => {
  simulateWatchAdReward().catch(reportUiError);
});
$("#identity-buy").addEventListener("click", () => {
  simulatePurchaseTokenPack().catch(reportUiError);
});
$("#auth-back").addEventListener("click", showEntry);
$("#auth-method-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-auth-method]");
  if (!button) return;
  authMethod = button.dataset.authMethod;
  renderAuthPanel();
});
$("#auth-switch-mode").addEventListener("click", () => { authMode = authMode === "login" ? "register" : "login"; renderAuthPanel(); });
$("#auth-send-code").addEventListener("click", sendAuthCode);
$("#auth-submit").addEventListener("click", submitAuth);
$("#auth-forgot").addEventListener("click", () => setAuthStatus("忘记密码功能将在下一阶段开放。"));
$("#entry-account-panel").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) submitAuth(); });
$("#identity-switch").addEventListener("click", () => {
  showEntry();
});
$("#stance-start").addEventListener("click", () => { if (run) newGame(run.tier, null, pendingStance.topicId); });
$("#stance-back").addEventListener("click", () => {
  screenVersion++;
  if (run && run.mode === "free") {
    hideScreens("free-screen");
    $("#free-screen").classList.remove("hidden");
  } else {
    loadTiers().catch(reportUiError);
  }
});
$("#stance-reroll").addEventListener("click", () => showStance().catch(reportUiError));
const muteBtn = $("#mute-btn");
if (muteBtn) {
  muteBtn.addEventListener("click", toggleMute);
  muteBtn.classList.add("hidden");   // 初始隐藏，initTts 确认语音可用后再显示
}
$("#npc-info-btn").addEventListener("click", openNpcInfo);
$("#npc-info-close").addEventListener("click", closeNpcInfo);
$("#npc-info-overlay").addEventListener("click", (e) => {
  if (e.target.id === "npc-info-overlay") closeNpcInfo();
});

initMic();
initTts();
bootstrapIdentity();
