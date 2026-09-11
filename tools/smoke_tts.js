// 真机冒烟：验证开局流程（const 赋值修复）+ 服务端 TTS 请求是否触发
const { chromium } = require("playwright-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  const errs = [];
  const tts = [];
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => errs.push("PAGE_ERR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE: " + m.text()); });
  page.on("response", (r) => { if (r.url().includes("/api/tts")) tts.push(r.status() + " " + r.url().slice(0, 70)); });

  // 必须等 networkidle：domcontentloaded 就点会抢跑（事件未挂载 → 天梯列表不渲染，假失败）
  await page.goto("http://localhost:8787", { waitUntil: "networkidle" });
  await page.waitForSelector("#mode-ladder", { timeout: 10000 });
  await page.click("#mode-ladder");
  await page.waitForSelector(".tier-card", { timeout: 10000 });
  await page.click(".tier-card:not(.locked)");
  await page.waitForSelector("#stance-start", { timeout: 10000 });
  await page.click("#stance-start");
  await page.waitForTimeout(6000);

  const d1 = (await page.textContent("#dialogue")) || "";
  console.log("DIALOGUE_LEN_AFTER_START", d1.trim().length);
  console.log("DIALOGUE_HEAD", d1.trim().slice(0, 50).replace(/\s+/g, " "));

  await page.fill("#input", "你说得我都同意，可你有没有拿出过硬的数据呢？");
  await page.click("#send");
  await page.waitForTimeout(15000);

  const d2 = (await page.textContent("#dialogue")) || "";
  console.log("DIALOGUE_LEN_AFTER_TURN", d2.trim().length);
  console.log("MUTE_BTN_HIDDEN", await page.evaluate(() => document.querySelector("#mute-btn").classList.contains("hidden")));
  console.log("TTS", JSON.stringify(tts));
  console.log("ERRORS", JSON.stringify(errs));
  await browser.close();
})().catch((e) => { console.log("SMOKE_FAIL", e.message); process.exit(1); });
