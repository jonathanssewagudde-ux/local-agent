#!/usr/bin/env node
// Board helper for the lead. Safe writes (lock + temp file + rename), validated against the card.
//
//   node scripts/board.mjs plan <draft.json>                  validate a plan draft and publish it as plan.json (status awaiting-approval)
//   node scripts/board.mjs task <id> <status> [verified]      planned | in-progress | review | blocked | done; add "verified" once checked
//   node scripts/board.mjs show                               print the active project's plan and tasks
//   --project <slug>                                          defaults to activeProject in .satoru/config.json
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SATORU = path.join(ROOT, ".satoru");
const STATUSES = ["planned", "in-progress", "review", "blocked", "done"];
const card = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "src", "card.generated.json"), "utf8"));
const members = card.team.map((m) => m.name);
const die = (msg) => { console.error("✖ " + msg); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withLock(file, fn) {
  const lock = `${file}.lock`; const deadline = Date.now() + 3000; let h = null;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  while (!h) {
    try { h = await fsp.open(lock, "wx"); }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      try { if (Date.now() - (await fsp.stat(lock)).mtimeMs > 10_000) { await fsp.unlink(lock).catch(() => {}); continue; } } catch { continue; }
      if (Date.now() > deadline) die(`lock busy: ${lock}`);
      await sleep(15);
    }
  }
  try { return await fn(); } finally { await h.close().catch(() => {}); await fsp.unlink(lock).catch(() => {}); }
}
async function writeJson(file, data) {
  const tmp = `${file}.tmp-${crypto.randomBytes(6).toString("hex")}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, file);
}
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

const args = process.argv.slice(2);
const pi = args.indexOf("--project");
let slug = pi >= 0 ? args.splice(pi, 2)[1] : readJson(path.join(SATORU, "config.json"), {}).activeProject;
if (!slug) die("no active project — load one in the dashboard (Projects tab) or pass --project <slug>");
const registry = readJson(path.join(SATORU, "registry.json"), { projects: [] });
if (!registry.projects.some((p) => p.slug === slug)) die(`project "${slug}" is not registered`);
const dir = path.join(SATORU, "projects", slug);
const [cmd, ...rest] = args;

if (cmd === "plan") {
  const draft = rest[0] ? readJson(path.resolve(rest[0]), null) : null;
  if (!draft) die("usage: board.mjs plan <draft.json>  (the file must be valid JSON)");
  const problems = [];
  if (!draft.title) problems.push("title is missing");
  if (!Array.isArray(draft.tasks) || !draft.tasks.length) problems.push("tasks must be a non-empty array");
  const files = new Map();
  for (const t of draft.tasks ?? []) {
    if (!t.id || !t.title) problems.push(`task ${JSON.stringify(t)} needs id and title`);
    if (!members.includes(t.owner)) problems.push(`task ${t.id}: owner "${t.owner}" is not on the card (${members.join(", ")})`);
    for (const f of t.files ?? []) { const k = f.replace(/\\/g, "/").toLowerCase(); if (files.has(k)) problems.push(`file conflict: ${f} is claimed by ${files.get(k)} and ${t.id}`); files.set(k, t.id); }
  }
  if (problems.length) die("plan rejected:\n  - " + problems.join("\n  - "));
  const plan = { status: "awaiting-approval", title: draft.title, scope: draft.scope ?? "", risks: draft.risks ?? [], tasks: draft.tasks.map((t) => ({ id: t.id, title: t.title, owner: t.owner, files: t.files ?? [] })), createdAt: new Date().toISOString() };
  const file = path.join(dir, "plan.json");
  await withLock(file, () => writeJson(file, plan));
  console.log(`plan "${plan.title}" published with ${plan.tasks.length} task(s) — awaiting approval in the dashboard. STOP here until it is approved.`);
} else if (cmd === "task") {
  const [id, status, verified] = rest;
  if (!id || !STATUSES.includes(status)) die(`usage: board.mjs task <id> <${STATUSES.join("|")}> [verified]`);
  const file = path.join(dir, "tasks.json");
  await withLock(file, async () => {
    const d = readJson(file, { tasks: [] });
    const t = d.tasks.find((x) => x.id === id);
    if (!t) die(`no task ${id} in tasks.json (tasks appear when the plan is approved)`);
    t.status = status; t.updatedAt = new Date().toISOString();
    if (verified !== undefined) t.verified = verified === "verified" || verified === "true";
    await writeJson(file, d);
    console.log(`${id} → ${status}${t.verified ? " ✓ verified" : ""}`);
  });
} else if (cmd === "show") {
  console.log(JSON.stringify({ plan: readJson(path.join(dir, "plan.json"), null), tasks: readJson(path.join(dir, "tasks.json"), { tasks: [] }).tasks }, null, 2));
} else {
  die("usage: board.mjs plan <draft.json> | task <id> <status> [verified] | show   [--project <slug>]");
}
