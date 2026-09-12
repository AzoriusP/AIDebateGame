/* Lobby composition reuses the existing game and identity controllers. */
(() => {
  const host = document.getElementById("mode-inner");
  const element = (tag, id, text) => {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (text) node.textContent = text;
    if (tag === "button") node.type = "button";
    return node;
  };
  const account = element("div", "lobby-account");
  const identityButton = element("button", "lobby-identity", "游客登录");
  identityButton.title = "切换登录身份";
  identityButton.onclick = () => showEntry();
  const wallet = element("div", "lobby-wallet");
  const coin = element("span", null, "◇");
  coin.className = "lobby-coin";
  coin.setAttribute("aria-hidden", "true");
  const balance = element("span", "lobby-balance", "0");
  balance.setAttribute("aria-label", "账号代币余额");
  const topup = element("button", "lobby-topup", "+");
  topup.setAttribute("aria-label", "获取账号代币");
  wallet.append(coin, balance, topup);
  account.append(identityButton, wallet);
  const brand = element("div", "lobby-brand");
  brand.append(document.getElementById("game-title"), document.getElementById("game-sub"));
  const tools = element("div", "lobby-tools");
  const history = element("button", "lobby-history", "对局记录");
  history.dataset.kicker = "BATTLE ARCHIVE";
  const icons = element("div", "lobby-icon-stack");
  const settings = element("button", "lobby-settings", "游戏设置");
  settings.dataset.kicker = "SYSTEM OPTION";
  settings.setAttribute("aria-label", "设置");
  const help = element("button", "lobby-help", "?");
  help.setAttribute("aria-label", "帮助");
  const menu = document.getElementById("mode-cards");
  menu.append(history, settings);
  icons.append(help);
  tools.append(icons);
  host.prepend(account, brand);
  host.append(tools);

  const modeCards = [...document.querySelectorAll("#mode-cards .mode-card")];
  const kickers = ["RANKED DEBATE", "FREE SESSION"];
  modeCards.forEach((card, index) => {
    card.dataset.kicker = kickers[index] || "DEBATE MENU";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && card.getAttribute("aria-disabled") !== "true") {
        event.preventDefault();
        card.click();
      }
    });
  });

  const parking = element("div", "lobby-panels");
  parking.hidden = true;
  const identityPanel = document.getElementById("identity-strip");
  const fxPanel = document.getElementById("fx-panel");
  const reset = document.getElementById("mode-reset");
  const summary = document.getElementById("identity-summary");
  parking.append(identityPanel, fxPanel, reset, summary, document.getElementById("mode-bottom"));
  document.body.append(parking);
  const dialog = element("dialog", "lobby-dialog");
  const close = element("button", "lobby-dialog-close", "×");
  close.setAttribute("aria-label", "关闭");
  const title = element("h2", "lobby-dialog-title");
  dialog.setAttribute("aria-labelledby", title.id);
  const content = element("div", "lobby-dialog-content");
  dialog.append(close, title, content);
  document.body.append(dialog);
  close.onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    for (const panel of [identityPanel, fxPanel, reset, summary]) parking.append(panel);
    content.replaceChildren();
  });
  const runTokenAction = async (button, taskFactory) => {
    const originalText = button.textContent;
    button.disabled = true;
    button.classList.add("identity-token-loading");
    button.textContent = "处理中…";
    try {
      await taskFactory();
    } finally {
      button.disabled = false;
      button.classList.remove("identity-token-loading");
      button.textContent = originalText;
    }
  };
  function open(titleText) {
    title.textContent = titleText;
    content.replaceChildren();
    dialog.showModal();
  }
  settings.onclick = () => {
    open("设置");
    fxPanel.classList.remove("hidden");
    content.append(fxPanel, reset);
  };
  help.onclick = () => {
    open("游戏帮助");
    content.innerHTML = `
      <p>玩法规则（核心）：你在每轮输入辩论内容，系统会给出判定。每条发言会消耗自身的 token，先将 TA 的「自信度」打到 0 即可获胜。</p>
      <p>AI Native 特色：</p>
      <ul>
        <li>每一位 NPC 都是可对话的 AI 角色，具备独立人格参数（六维雷达）、可学习的记忆与成长。</li>
        <li>对局判定与 NPC 回合由 LLM 推理生成，不是静态脚本，攻守转换更有动态性。</li>
        <li>每局会记录你在不同维度上的触发结果，后续可通过长期对局建立“对 TA 的观察与反应节奏”。</li>
        <li>提示系统按次数受限，鼓励你用策略打出关键一击，而非无脑刷字。</li>
      </ul>
      <p>游客模式用于体验，账号模式可保留历史与积分，解锁自由切磋与重置进度功能。</p>
      <p>反馈与求助：</p>
      <ul>
        <li>遇到 BUG 或有任何建议，点主界面上的「🐞 反馈 / 报 BUG」按钮直接提交即可，这是最快的主渠道。</li>
        <li>如果想详细描述（复现步骤、附件思路等），也可以直接发邮件到 <a href="mailto:wdy0wb@agent.qq.com">wdy0wb@agent.qq.com</a>。</li>
      </ul>
    `;
  };
  topup.onclick = () => {
    open("账号代币");
    if (identity?.mode !== "account") {
      content.textContent = "游客暂不能购买代币或领取广告奖励，请先使用账号登录。";
      return;
    }
    content.replaceChildren();
    const tokenRow = document.createElement("div");
    tokenRow.className = "identity-token";
    const tokenLabel = document.createElement("span");
    tokenLabel.textContent = "账号代币：";
    const tokenValue = document.createElement("b");
    tokenValue.textContent = String(identity?.accountToken ?? 0);
    tokenRow.append(tokenLabel, tokenValue);
    const actionPanel = document.createElement("div");
    actionPanel.className = "identity-token-actions";
    const sourceActions = document.getElementById("identity-token-actions");
    if (sourceActions) {
      const watchBtn = sourceActions.querySelector("#identity-ad-reward");
      const buyBtn = sourceActions.querySelector("#identity-buy");
      if (watchBtn) {
        const copy = watchBtn.cloneNode(true);
        copy.onclick = () => runTokenAction(copy, () => simulateWatchAdReward().catch(reportUiError));
        actionPanel.append(copy);
      }
      if (buyBtn) {
        const copy = buyBtn.cloneNode(true);
        copy.onclick = () => runTokenAction(copy, () => simulatePurchaseTokenPack().catch(reportUiError));
        actionPanel.append(copy);
      }
    }
    content.append(tokenRow, actionPanel);
  };
  history.onclick = () => {
    open("对局记录");
    if (identity?.mode !== "account") {
      content.textContent = "游客对局不保存记录。登录账号后可查看自己的对局记录。";
      return;
    }
    const records = identity.history || [];
    if (!records.length) content.textContent = "还没有对局记录，开始你的第一场辩论吧。";
    for (const record of records) {
      const row = element("div");
      row.className = "lobby-record";
      row.textContent = [record.npc || "对手", record.result || "已结束", record.topic || ""].filter(Boolean).join(" · ");
      content.append(row);
    }
  };
  function sync() {
    identityButton.textContent = identity?.mode === "account" ? identity.playerName || identity.accountId : "游客登录";
    balance.textContent = String(identity?.accountToken ?? 0);
  }
  new MutationObserver(sync).observe(identityPanel, { childList: true, subtree: true, characterData: true, attributes: true });
  sync();
})();
