/* 玩家反馈 / 报 BUG：主界面常驻入口 + 表单弹窗 → POST /api/feedback。
   自包含、无框架、零依赖；任何异常都在弹窗内就地提示，绝不冒泡崩掉游戏界面。 */
(() => {
  "use strict";

  const TYPES = [
    { value: "bug", label: "🐞 Bug / 报错" },
    { value: "suggestion", label: "💡 建议 / 新点子" },
    { value: "experience", label: "🎮 体验 / 手感" },
    { value: "other", label: "📝 其他" },
  ];
  const MAX_MESSAGE = 2000;
  const MAX_CONTACT = 120;

  /* ---- 1. 入口按钮：index.html 里放在 #mode-bottom，但 lobby.js 会把 #mode-bottom
     收进隐藏的 #lobby-panels，因此这里把它重新挂到主界面可见的 #lobby-icon-stack。 ---- */
  const entry = document.getElementById("mode-feedback");
  let floatingEntry = false;
  function mountEntry() {
    if (!entry) return;
    const iconStack = document.getElementById("lobby-icon-stack");
    if (iconStack) {
      if (entry.parentElement !== iconStack) iconStack.insertBefore(entry, iconStack.firstChild);
      return;
    }
    // 兜底：万一 lobby 结构没就绪，挂成右下角常驻悬浮按钮，保证入口不丢。
    if (!entry.isConnected) {
      entry.classList.add("feedback-entry-floating");
      document.body.appendChild(entry);
      floatingEntry = true;
    }
  }
  mountEntry();

  /* ---- 2. 弹窗骨架 ---- */
  function el(tag, id, cls) {
    const n = document.createElement(tag);
    if (id) n.id = id;
    if (cls) n.className = cls;
    return n;
  }

  const dialog = el("dialog", "feedback-dialog");
  const closeBtn = el("button", "feedback-dialog-close", null);
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "关闭");
  const title = el("h2", "feedback-dialog-title");
  title.textContent = "反馈 / 报 BUG";
  const content = el("div", "feedback-dialog-content");

  const form = el("form", "feedback-form");
  form.setAttribute("novalidate", "");

  // 类型
  const typeField = el("div", "fb-field");
  typeField.append(labelFor("fb-type", "反馈类型", true));
  const typeSel = el("select", "fb-type");
  TYPES.forEach((t) => {
    const o = document.createElement("option");
    o.value = t.value;
    o.textContent = t.label;
    typeSel.append(o);
  });
  typeField.append(typeSel);

  // NPC
  const npcField = el("div", "fb-field");
  npcField.append(labelFor("fb-npc", "涉及 NPC（可选）", false));
  const npcSel = el("select", "fb-npc");
  const npcDefault = document.createElement("option");
  npcDefault.value = "";
  npcDefault.textContent = "不指定 / 不确定";
  npcSel.append(npcDefault);
  npcField.append(npcSel);

  // 模式 / 关卡
  const modeField = el("div", "fb-field");
  modeField.append(labelFor("fb-mode", "模式 / 关卡（可选）", false));
  const modeInput = el("input", "fb-mode");
  modeInput.type = "text";
  modeInput.maxLength = 64;
  modeInput.placeholder = "如：天梯第 3 关 / 自由切磋";
  modeField.append(modeInput);

  // 描述
  const msgField = el("div", "fb-field");
  msgField.append(labelFor("fb-message", "问题描述", true));
  const msgInput = el("textarea", "fb-message");
  msgInput.rows = 5;
  msgInput.maxLength = MAX_MESSAGE;
  msgInput.placeholder = "发生了什么？你期望的结果是什么？最好附上复现步骤，例如：点了哪个按钮、看到什么提示。";
  const counter = el("div", "fb-counter");
  const countNum = el("span", "fb-count");
  countNum.textContent = "0";
  counter.append(countNum, document.createTextNode("/" + MAX_MESSAGE));
  msgField.append(msgInput, counter);

  // 联系方式
  const contactField = el("div", "fb-field");
  contactField.append(labelFor("fb-contact", "联系方式（可选）", false));
  const contactInput = el("input", "fb-contact");
  contactInput.type = "text";
  contactInput.maxLength = MAX_CONTACT;
  contactInput.placeholder = "邮箱 / QQ，方便我们就问题回访";
  contactField.append(contactInput);

  const status = el("div", "fb-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const actions = el("div", "fb-actions");
  const cancelBtn = el("button", "fb-cancel");
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  const submitBtn = el("button", "fb-submit");
  submitBtn.type = "submit";
  submitBtn.textContent = "提交反馈";
  actions.append(cancelBtn, submitBtn);

  form.append(typeField, npcField, modeField, msgField, contactField, status, actions);
  content.append(form);
  dialog.append(closeBtn, title, content);
  document.body.append(dialog);

  function labelFor(forId, text, required) {
    const l = el("label", null, null);
    l.setAttribute("for", forId);
    l.textContent = text;
    if (required) {
      const s = el("span", null, "fb-req");
      s.textContent = " *";
      l.append(s);
    }
    return l;
  }

  /* ---- 3. NPC 列表（静态源，加载失败也不影响提交） ---- */
  function fillNpcs() {
    fetch("/static/characters.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const chars = (data && data.characters) || {};
        Object.keys(chars).forEach((id) => {
          if (id === "player") return;
          const o = document.createElement("option");
          o.value = id;
          o.textContent = `${chars[id].label || id}（${id}）`;
          npcSel.append(o);
        });
        preselectCurrentNpc();
      })
      .catch(() => { /* 拉不到就只留「不指定」，不阻塞 */ });
  }
  function currentNpcId() {
    try { if (typeof state !== "undefined" && state && state.npcId) return state.npcId; } catch (_) {}
    try { if (typeof run !== "undefined" && run && run.npcId) return run.npcId; } catch (_) {}
    return "";
  }
  function preselectCurrentNpc() {
    const cur = currentNpcId();
    if (cur && npcSel.querySelector('option[value="' + cur + '"]')) npcSel.value = cur;
  }
  fillNpcs();

  /* ---- 4. 打开 / 关闭 ---- */
  function resetStatus() {
    status.textContent = "";
    status.className = "fb-status";
  }
  function openDialog() {
    resetStatus();
    preselectCurrentNpc();
    countNum.textContent = String(msgInput.value.length);
    try {
      dialog.showModal();
    } catch (_) {
      // 极老浏览器不支持 <dialog>：退化成可滚动内联面板，仍可填写提交
      dialog.setAttribute("open", "");
    }
    setTimeout(() => typeSel.focus(), 30);
  }
  function closeDialog() {
    try { dialog.close(); } catch (_) { dialog.removeAttribute("open"); }
  }
  if (entry) {
    entry.addEventListener("click", (e) => { e.preventDefault(); openDialog(); });
  } else {
    // 没有入口节点（异常情况）：仍然用右下角悬浮按钮兜底
    const f = el("button", "mode-feedback-fallback", "feedback-entry-floating");
    f.type = "button";
    f.textContent = "🐞 反馈";
    f.addEventListener("click", openDialog);
    document.body.appendChild(f);
  }
  closeBtn.addEventListener("click", closeDialog);
  cancelBtn.addEventListener("click", closeDialog);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeDialog(); });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); closeDialog(); });

  /* ---- 5. 字数计数 ---- */
  msgInput.addEventListener("input", () => { countNum.textContent = String(msgInput.value.length); });

  /* ---- 6. 提交 ---- */
  function playerContext() {
    let ident = null;
    try { if (typeof identity !== "undefined") ident = identity; } catch (_) {}
    const mode = ident && ident.mode === "account" ? "account" : "guest";
    const ctx = { player_mode: mode };
    if (mode === "account") {
      ctx.account_id = ident.accountId || "";
      ctx.player_name = ident.playerName || ident.accountId || "";
    }
    return ctx;
  }
  function setStatus(text, kind) {
    status.textContent = text;
    status.className = "fb-status" + (kind ? " fb-" + kind : "");
  }

  let sending = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    const message = msgInput.value.trim();
    if (!message) {
      setStatus("请先填写问题描述再提交。", "error");
      msgInput.focus();
      return;
    }
    if (message.length > MAX_MESSAGE) {
      setStatus(`问题描述超长，请压缩到 ${MAX_MESSAGE} 字以内。`, "error");
      return;
    }
    const payload = Object.assign({
      type: TYPES.some((t) => t.value === typeSel.value) ? typeSel.value : "bug",
      npc_id: npcSel.value || "",
      mode: modeInput.value.trim(),
      message: message,
      contact: contactInput.value.trim(),
    }, playerContext());

    sending = true;
    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = "提交中…";
    setStatus("正在提交…", "pending");
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data = null;
      try { data = await r.json(); } catch (_) { data = null; }
      if (r.ok && data && data.ok) {
        setStatus(data.message || "已收到，感谢反馈！", "ok");
        msgInput.value = "";
        contactInput.value = "";
        countNum.textContent = "0";
        setTimeout(() => { if (dialog.open) closeDialog(); }, 1800);
      } else {
        const msg = (data && (data.message || data.error)) || `提交失败（${r.status}），请稍后再试。`;
        setStatus(msg, "error");
      }
    } catch (err) {
      setStatus("网络异常，提交失败，请检查网络后重试。", "error");
    } finally {
      sending = false;
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });
})();
