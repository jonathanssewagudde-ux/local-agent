// B4 proof: type `echo hello` into the embedded terminal, reload, and show the same session + scrollback came back.
const { chromium } = require("playwright");
(async () => {
  const out = process.argv[2] || ".";
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto("http://localhost:4316/");
  await p.waitForSelector("[data-testid=terminal] .xterm");
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.__mcTerminal.type("echo hello-from-mission-control; echo PID=$$\r"));
  await p.waitForTimeout(800);
  const before = await p.evaluate(() => window.__mcTerminal.text());
  const pid1 = (before.match(/PID=(\d+)/) || [])[1];
  await p.screenshot({ path: `${out}/b1-shell.png` });
  await p.reload();
  await p.waitForSelector("[data-testid=terminal] .xterm");
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.__mcTerminal.type("echo PID=$$\r"));
  await p.waitForTimeout(800);
  const after = await p.evaluate(() => window.__mcTerminal.text());
  const pids = [...after.matchAll(/PID=(\d+)/g)].map((m) => m[1]);
  console.log("before reload PID:", pid1);
  console.log("scrollback after reload still has 'hello-from-mission-control':", after.includes("hello-from-mission-control"));
  console.log("PIDs seen after reload:", pids.join(", "), "→ same shell:", pids.every((x) => x === pid1));
  await p.screenshot({ path: `${out}/b4-after-reload.png` });
  await b.close();
})();
