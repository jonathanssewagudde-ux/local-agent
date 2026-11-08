// Step-by-step browser driver for the C1 verification pass.
// usage: node drive.cjs <outdir> action... where action is one of:
//   type:<text>  key:<enter|esc|down|up|tab|y|n|1|2>  wait:<ms>  shot:<file>  term[:<lines>]  click:<css>  office  roster  needs  tab:<name>
const { chromium } = require("playwright");
const KEYS = { enter: "\r", esc: "\x1b", down: "\x1b[B", up: "\x1b[A", tab: "\t", y: "y", n: "n", 1: "1", 2: "2", 3: "3" };
(async () => {
  const [out, ...actions] = process.argv.slice(2);
  // persistent profile: like a real browser, localStorage (and so the terminal's session id) survives between runs
  const b = await chromium.launchPersistentContext(`${out}/browser-profile`, { viewport: { width: 1500, height: 1000 } });
  const p = b.pages()[0] ?? (await b.newPage());
  await p.goto("http://localhost:4316/");
  await p.evaluate(() => { localStorage.setItem("mc-dock", "open"); localStorage.setItem("mc-dock-h", "330"); });
  await p.reload();
  await p.waitForSelector("[data-testid=terminal] .xterm");
  await p.waitForTimeout(1200);
  for (const a of actions) {
    const [cmd, ...rest] = a.split(":"); const arg = rest.join(":");
    if (cmd === "type") { await p.evaluate((t) => window.__mcTerminal.type(t), arg); await p.waitForTimeout(150); }
    else if (cmd === "key") { await p.evaluate((t) => window.__mcTerminal.type(t), KEYS[arg] ?? arg); await p.waitForTimeout(150); }
    else if (cmd === "wait") await p.waitForTimeout(Number(arg));
    else if (cmd === "shot") await p.screenshot({ path: `${out}/${arg}` });
    else if (cmd === "term") { const t = await p.evaluate(() => window.__mcTerminal.text()); const lines = t.split("\n").filter((l) => l.trim()); console.log("----- terminal -----\n" + lines.slice(-(Number(arg) || 30)).join("\n")); }
    else if (cmd === "click") { await p.click(arg); await p.waitForTimeout(300); }
    else if (cmd === "tab") { await p.click(`[data-tab=${arg}]`); await p.waitForTimeout(500); }
    else if (cmd === "office") console.log("office:", (await p.$$eval("[data-agent]", (els) => els.map((e) => `${e.dataset.agent}@${e.dataset.room}${e.dataset.moving === "1" ? "(walking)" : ""}`))).join(" "));
    else if (cmd === "roster") console.log((await p.$$eval("[data-testid=roster] button", (els) => els.map((e) => "  " + e.innerText.replace(/\s*\n\s*/g, " | ")))).join("\n"));
    else if (cmd === "needs") console.log("needs-you:", (await p.$$eval("[data-testid=needs-you]", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")))).join("") || "(hidden)");
    else if (cmd === "ticker") console.log("ticker:\n  " + (await p.$eval("[data-testid=ticker]", (e) => e.innerText)).split("\n").join("\n  "));
    else if (cmd === "notice") console.log("notice:", await p.$eval("[data-testid=notice]", (e) => e.innerText).catch(() => "(none)"));
    else if (cmd === "lights") console.log("lights:", await p.$eval("[data-testid=office] img", (e) => e.style.filter || "none"));
  }
  await b.close();
})();
