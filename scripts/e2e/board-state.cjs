// B9 proof (demo OFF): write fake state by hand and report which room each member went to and why.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const SAT = path.resolve(__dirname, "..", "..", ".satoru");
const write = (f, d) => { const p = path.join(SAT, "projects", "office-test", f); fs.writeFileSync(p + ".tmp", JSON.stringify(d, null, 2)); fs.renameSync(p + ".tmp", p); };
(async () => {
  const out = process.argv[2] || ".";
  const ok = await fetch("http://localhost:4316/api/projects/existing", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:4316" }, body: JSON.stringify({ path: path.join(SAT, "..", "..", "office-test") }) }).catch(() => null);
  if (!fs.existsSync(path.join(SAT, "projects", "office-test"))) { console.log("register failed", ok && (await ok.text())); process.exit(1); }
  const now = Date.now(), iso = (ms) => new Date(now - ms).toISOString();
  for (const f of ["agents.json", "tasks.json", "approvals.json", "plan.json"]) try { fs.unlinkSync(path.join(SAT, "projects", "office-test", f)); } catch {}
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  await p.goto("http://localhost:4316/");
  await p.evaluate(() => { localStorage.setItem("mc-dock", "closed"); localStorage.removeItem("mc-farewells-played"); });
  const report = async (label, file) => {
    await p.waitForTimeout(3500);
    const rows = await p.$$eval("[data-testid=roster] button", (els) => els.map((e) => e.innerText.split("\n").join(" | ")));
    const rooms = await p.$$eval("[data-agent]", (els) => els.map((e) => `${e.dataset.agent}@${e.dataset.room}`));
    console.log(`\n## ${label}\n  ${rooms.join("  ")}\n  ` + rows.map((r) => r.replace(/\s+/g, " ")).join("\n  "));
    await p.screenshot({ path: `${out}/${file}` });
  };
  // 1. a working agent (live spawn)
  write("agents.json", { agents: { grim: { state: "working", task: "Build the users API", since: iso(60e3), heartbeat: iso(30e3) } } });
  await p.reload(); await p.waitForSelector("[data-agent]");
  await report("1. grim working (live spawn)", "b9-1-working.png");
  // 2. a blocked task
  write("tasks.json", { tasks: [{ id: "T1", title: "Wire checkout form", owner: "lumi", status: "blocked", verified: false, updatedAt: iso(5 * 60e3) }] });
  await report("2. + lumi's task blocked", "b9-2-blocked.png");
  // 3. a pending approval
  write("approvals.json", { approvals: [{ id: "A-1234abcd", title: "Drop legacy users table", risk: "high", reason: "irreversible schema change", status: "pending", createdAt: iso(60e3) }] });
  await report("3. + pending approval", "b9-3-approval.png");
  // 4. a completion from 3 hours ago (must NOT play a goodbye; settles straight into a break room)
  write("agents.json", { agents: { grim: { state: "working", task: "Build the users API", since: iso(60e3), heartbeat: iso(30e3) }, bug: { state: "completed", say: "All 14 tests pass.", since: iso(3 * 3600e3), heartbeat: iso(3 * 3600e3) } } });
  await p.reload(); await p.waitForSelector("[data-agent]");
  await p.waitForTimeout(400);
  const bugEarly = await p.$eval("[data-agent=bug]", (e) => e.dataset.room);
  await report(`4. + bug completed 3 h ago (room 400 ms after load: ${bugEarly})`, "b9-4-old-completion.png");
  await b.close();
})();
