#!/usr/bin/env node
// Mission Control telemetry hook. Pure Node: no jq, no bash/PowerShell — works on Windows, macOS and Linux.
// Called from .claude/settings.json as:  node "$CLAUDE_PROJECT_DIR/hooks/telemetry.mjs" <event>
// (or from ~/.claude/settings.json with an absolute path and --user).
// Rules: NEVER fail the session (always exit 0), NEVER print to stdout.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SATORU = process.env.SATORU_DIR ? path.resolve(process.env.SATORU_DIR) : path.join(ROOT, ".satoru");
const CARD_JSON = path.join(ROOT, "web", "src", "card.generated.json");
const ROOM_KEYS = ["briefing", "meeting", "approval", "workspace", "command", "server", "pantry", "lounge", "done"];
const EVENT_TYPES = ["session_start", "session_end", "prompt", "idle", "spawn", "done", "file_touch", "command", "stage", "note"];
const ACTIVE_FALLBACK = new Set(["spawn", "done", "prompt", "idle", "stage"]);
const HOUR = 3600e3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const short = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const tail = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? "…" + s.slice(-(n - 1)) : s; };
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------- secrets ----------
const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9_\-]{16,}/g, "[REDACTED]"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[REDACTED]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/\-]{12,}=*/gi, "$1 [REDACTED]"],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1$2[REDACTED]"],
  [/\b[a-f0-9]{32,}\b/gi, "[REDACTED]"],
];
const B64 = /[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g;
const looksLikeKey = (m) => /[0-9]/.test(m) && /[A-Z]/.test(m) && /[a-z]/.test(m) && (m.match(/\//g) || []).length < 3;
export function redact(s) {
  let out = String(s);
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out.replace(B64, (m) => (looksLikeKey(m) ? "[REDACTED]" : m));
}
const redactDeep = (v) =>
  typeof v === "string" ? redact(v) : Array.isArray(v) ? v.map(redactDeep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)])) : v;

// ---------- files: torn-read-safe reads, atomic writes, shared lock convention ----------
async function readJson(file, fallback) {
  for (let i = 0; i < 3; i++) {
    try { return JSON.parse(await fsp.readFile(file, "utf8")); }
    catch (e) { if (e?.code === "ENOENT") return fallback; if (i < 2) await sleep(25 + i * 25); }
  }
  return fallback;
}
async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${crypto.randomBytes(6).toString("hex")}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8" });
  for (let i = 0; ; i++) {
    try { await fsp.rename(tmp, file); return; }
    catch (e) {
      if (i < 20 && ["EPERM", "EBUSY", "EACCES"].includes(e?.code)) { await sleep(10 + i * 5); continue; }
      await fsp.unlink(tmp).catch(() => {}); throw e;
    }
  }
}
async function withLock(file, fn) {
  const lock = `${file}.lock`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + 2000;
  let h = null;
  while (!h) {
    try { h = await fsp.open(lock, "wx"); await h.writeFile(`${process.pid} ${nowIso()}`, { encoding: "utf8" }); }
    catch (e) {
      if (e?.code !== "EEXIST") throw e;
      try { const st = await fsp.stat(lock); if (Date.now() - st.mtimeMs > 10_000) { await fsp.unlink(lock).catch(() => {}); continue; } } catch { continue; }
      if (Date.now() > deadline) throw new Error(`lock timeout ${lock}`);
      await sleep(5 + Math.random() * 15);
    }
  }
  try { return await fn(); } finally { await h.close().catch(() => {}); await fsp.unlink(lock).catch(() => {}); }
}
/** fn returns false to skip the write (nothing changed). */
async function lockedUpdate(file, fallback, fn) {
  return withLock(file, async () => {
    const cur = await readJson(file, structuredClone(fallback));
    const r = await fn(cur);
    if (r !== false) await writeJson(file, cur);
    return cur;
  });
}

// ---------- context ----------
function loadCard() {
  try { return JSON.parse(fs.readFileSync(CARD_JSON, "utf8")); } catch { return { appName: "Mission Control", team: [] }; }
}
const isInside = (child, parent) => {
  if (!child || !parent) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
};
const samePathCI = process.platform === "win32" || process.platform === "darwin";
const insideCI = (c, p) => (samePathCI ? isInside(String(c).toLowerCase(), String(p).toLowerCase()) : isInside(c, p));

async function readStdin() {
  if (process.stdin.isTTY) return "";
  process.stdin.setEncoding("utf8");
  let data = "";
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(data), 3000);
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => { clearTimeout(t); resolve(data); });
    process.stdin.on("error", () => { clearTimeout(t); resolve(data); });
  });
}

// ---------- transcripts ----------
async function readTail(file, bytes = 768 * 1024) {
  try {
    const h = await fsp.open(file, "r");
    try {
      const { size } = await h.stat();
      const start = Math.max(0, size - bytes);
      const buf = Buffer.alloc(size - start);
      await h.read(buf, 0, buf.length, start);
      let txt = buf.toString("utf8");
      if (start > 0) txt = txt.slice(txt.indexOf("\n") + 1);
      return txt;
    } finally { await h.close(); }
  } catch { return ""; }
}
const isRealUserTurn = (e) => {
  if (e?.type !== "user" || e.isMeta) return false;
  const c = e.message?.content;
  if (typeof c === "string") return true;
  return Array.isArray(c) && c.some((b) => b?.type !== "tool_result");
};
/** All assistant text since the last real user turn (the whole final turn). */
export async function lastAssistantText(file) {
  if (!file) return "";
  const lines = (await readTail(file)).split("\n").filter(Boolean);
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e; try { e = JSON.parse(lines[i]); } catch { continue; }
    if (isRealUserTurn(e)) break;
    if (e?.type === "assistant" && Array.isArray(e.message?.content)) {
      const txt = e.message.content.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
      if (txt.trim()) parts.unshift(txt);
    }
  }
  return parts.join("\n");
}

// ---------- 🎬 / 🔔 parsing (ignores fenced code blocks and inline code) ----------
export function parseDirectives(text, members) {
  const stripped = String(text || "").replace(/```[\s\S]*?(```|$)/g, "").replace(/~~~[\s\S]*?(~~~|$)/g, "");
  const directives = [], approvals = [];
  let projectTag = null;
  for (const raw of stripped.split(/\r?\n/)) {
    const line = raw.replace(/`[^`\n]*`/g, "").trim();
    if (!line) continue;
    let m = line.match(/^🎬\s*@([a-z0-9][a-z0-9._-]*)\s*$/i);
    if (m) { projectTag = m[1].toLowerCase(); continue; }
    m = line.match(/^🎬\s*(?:@([a-z0-9][a-z0-9._-]*)\s+)?([a-z][a-z0-9]*)\s*(?:→|->|=>)\s*([a-z]+)\s*(?:[·•|:-]\s*["“]?(.*?)["”]?)?\s*$/i);
    if (m) {
      if (m[1]) projectTag = m[1].toLowerCase();
      const name = m[2].toLowerCase(), room = m[3].toLowerCase();
      if (members.includes(name) && ROOM_KEYS.includes(room)) directives.push({ name, room, voice: short(m[4] || "", 160) });
      continue;
    }
    m = line.match(/^🔔\s*approval\s*:\s*(.+?)\s*\|\s*risk\s*:\s*(low|med|medium|high)\s*\|\s*(.+)$/i);
    if (m) approvals.push({ title: short(m[1], 140), risk: m[2].toLowerCase().startsWith("med") ? "med" : m[2].toLowerCase(), reason: short(m[3], 300) });
  }
  return { directives, approvals, projectTag };
}

// ---------- main ----------
async function appendEvent(ev) {
  const line = JSON.stringify(redactDeep({ ts: nowIso(), agent: ev.agent ?? null, type: ev.type, project: ev.project ?? null, payload: ev.payload ?? {} }));
  await fsp.mkdir(path.join(SATORU, "events"), { recursive: true });
  await fsp.appendFile(path.join(SATORU, "events", `${localDate()}.ndjson`), line + "\n", { encoding: "utf8" });
}

const AGENTS_FALLBACK = { agents: {} };
const pfile = (slug, f) => path.join(SATORU, "projects", slug, f);

async function run(type, p, userLevel) {
  const card = loadCard();
  const members = (card.team || []).map((m) => m.name);
  const lead = members[0] || "lead";
  const registry = await readJson(path.join(SATORU, "registry.json"), { projects: [] });
  const projects = Array.isArray(registry.projects) ? registry.projects : [];
  const cwd = p.cwd || process.cwd();

  if (userLevel) {
    // User-level copy: the project-level hooks already cover this folder; stay silent for unrelated folders.
    if (insideCI(cwd, ROOT)) return;
    if (!projects.some((x) => insideCI(cwd, x.path))) return;
  }

  const sid = String(p.session_id || "");
  const sessionMapFile = path.join(SATORU, "session-map.json");
  const sessionMap = await readJson(sessionMapFile, {});
  const needText = type === "idle";
  const text = needText ? (await lastAssistantText(p.transcript_path)) || String(p.last_assistant_message || "") : "";
  const parsed = needText ? parseDirectives(text, members) : { directives: [], approvals: [], projectTag: null };

  // ---- which project? ----
  let project = null, via = null;
  const byPath = (x) => projects.find((pr) => insideCI(x, pr.path));
  const touched = p.tool_input?.file_path || p.tool_input?.notebook_path;
  if (byPath(cwd)) { project = byPath(cwd).slug; via = "cwd"; }
  else if (type === "file_touch" && touched && path.isAbsolute(touched) && byPath(touched)) { project = byPath(touched).slug; via = "file"; }
  else if (sid && sessionMap[sid] && projects.some((x) => x.slug === sessionMap[sid])) { project = sessionMap[sid]; via = "session"; }
  else if (parsed.projectTag && projects.some((x) => x.slug === parsed.projectTag)) { project = parsed.projectTag; via = "tag"; }
  else if (ACTIVE_FALLBACK.has(type)) {
    const cfg = await readJson(path.join(SATORU, "config.json"), { activeProject: null });
    if (cfg.activeProject && projects.some((x) => x.slug === cfg.activeProject)) { project = cfg.activeProject; via = "active"; }
  }
  if (sid && (via === "cwd" || via === "tag") && sessionMap[sid] !== project) {
    await lockedUpdate(sessionMapFile, {}, (m) => { m[sid] = project; });
  }

  // ---- which agent? ----
  let agent = null;
  const payload = { session_id: sid || undefined, via: via || undefined };
  if (type === "spawn") {
    const st = String(p.tool_input?.subagent_type || "");
    agent = members.includes(st) ? st : null;
    payload.subagent_type = st || undefined;
    payload.description = short(p.tool_input?.description || "", 120);
  } else if (type === "done") {
    const at = String(p.agent_type ?? "");
    if (!at) payload.phantom = true;
    agent = members.includes(at) ? at : null;
    payload.agent_type = at || undefined;
  } else if (p.agent_type) {
    agent = members.includes(String(p.agent_type)) ? String(p.agent_type) : null; // a subagent's own tool call
  } else {
    agent = lead; // main-session events belong to the lead
  }
  // Claude Code reports background-agent completions as a <task-notification> "prompt" — that is not the user talking.
  const notification = type === "prompt" && /^\s*<task-notification>/.test(String(p.prompt || ""));
  if (type === "prompt") {
    if (notification) { payload.system = true; payload.prompt = short((String(p.prompt).match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || "background task finished", 200); }
    else payload.prompt = short(p.prompt, 300);
  }
  if (type === "file_touch") { payload.tool = p.tool_name; payload.file = touched ? String(touched) : undefined; }
  if (type === "command") { payload.command = short(p.tool_input?.command, 200); payload.description = short(p.tool_input?.description || "", 120) || undefined; }
  if (type === "session_start") payload.source = p.source;
  if (type === "session_end") payload.reason = p.reason;
  if (type === "spawn" && !agent) payload.note = "subagent not on the card";

  const queueFile = path.join(SATORU, "spawn-queue.json");
  const now = nowIso();
  const notes = [];

  // ---- board updates (only for card members with a known project) ----
  if (project && type === "spawn" && agent) {
    await lockedUpdate(queueFile, {}, (q) => { (q[agent] ||= []).push({ description: payload.description, ts: now, project }); });
    await lockedUpdate(pfile(project, "agents.json"), AGENTS_FALLBACK, (b) => {
      const a = (b.agents ||= {})[agent] ||= {};
      Object.assign(a, { state: "working", task: payload.description || "working", say: null, since: now, heartbeat: now });
    });
  }
  if (type === "done" && !payload.phantom && agent) {
    const finalText = (await lastAssistantText(p.agent_transcript_path)) || String(p.last_assistant_message || "");
    payload.say = tail(finalText, 120) || undefined;
    let qproject = null;
    await lockedUpdate(queueFile, {}, (q) => {
      const list = q[agent] || [];
      if (!list.length) return false;
      qproject = list.shift().project || null;
      if (!list.length) delete q[agent];
    });
    project ||= qproject;
    if (project) {
      await lockedUpdate(pfile(project, "agents.json"), AGENTS_FALLBACK, (b) => {
        const a = (b.agents ||= {})[agent] ||= {};
        Object.assign(a, { state: "completed", say: payload.say || "done", since: now, heartbeat: now });
      });
    }
  }
  if (project && agent && (type === "file_touch" || type === "command")) {
    await lockedUpdate(pfile(project, "agents.json"), AGENTS_FALLBACK, (b) => {
      const a = b.agents?.[agent];
      if (!a) return false;
      a.heartbeat = now;
    });
  }
  if (project && type === "prompt" && !notification) {
    await lockedUpdate(pfile(project, "agents.json"), AGENTS_FALLBACK, (b) => {
      const a = (b.agents ||= {})[lead] ||= {};
      Object.assign(a, { state: "working", task: short(p.prompt, 80), say: null, since: now, heartbeat: now });
    });
  }
  if (project && type === "idle") {
    const say = tail(parsed.directives.length || parsed.approvals.length ? "" : text, 120);
    await lockedUpdate(pfile(project, "agents.json"), AGENTS_FALLBACK, (b) => {
      const ag = (b.agents ||= {});
      const a = ag[lead] ||= {};
      Object.assign(a, { state: "idle", since: now, heartbeat: now, task: a.task || null, say: say || a.say || null });
      for (const d of parsed.directives) {
        const x = ag[d.name] ||= { state: "idle", since: now };
        if (d.room === "done") { x.intendedRoom = null; x.directiveAt = null; }
        else { x.intendedRoom = d.room; x.directiveAt = now; }
        x.voice = d.voice || null;
        x.heartbeat = now;
      }
    });
    for (const d of parsed.directives) await appendEvent({ agent: d.name, type: "stage", project, payload: { room: d.room, voice: d.voice, session_id: sid || undefined } });
    if (parsed.approvals.length) {
      const date = localDate();
      await lockedUpdate(pfile(project, "approvals.json"), { approvals: [] }, (b) => {
        const list = (b.approvals ||= []);
        let changed = false;
        for (const ap of parsed.approvals) {
          const id = "A-" + crypto.createHash("md5").update(ap.title + date).digest("hex").slice(0, 8);
          if (list.some((x) => x.id === id)) continue;
          list.push({ id, title: ap.title, risk: ap.risk, reason: ap.reason, status: "pending", createdAt: now });
          changed = true;
        }
        return changed;
      });
    }
  }

  // ---- reconcile (idle + session_start), one locked write, skipped if nothing changed ----
  if (project && (type === "idle" || type === "session_start")) {
    const queue = await readJson(queueFile, {});
    const approvals = await readJson(pfile(project, "approvals.json"), { approvals: [] });
    const pending = (approvals.approvals || []).filter((a) => a.status === "pending").length;
    await lockedUpdate(pfile(project, "agents.json"), AGENTS_FALLBACK, (b) => {
      let changed = false;
      for (const [name, a] of Object.entries(b.agents || {})) {
        const hb = Date.parse(a.heartbeat || a.since || "");
        if (a.state === "working" && !Number.isNaN(hb) && Date.now() - hb > HOUR && !(queue[name] || []).length) {
          a.state = "completed"; // keep the OLD since
          notes.push(`${name}: working with no heartbeat for over 60 min and no live spawn → completed`);
          changed = true;
        }
        if (a.intendedRoom === "approval" && pending === 0) {
          a.intendedRoom = null; a.directiveAt = null;
          notes.push(`${name}: released from the approval room (no pending approvals)`);
          changed = true;
        }
        const da = Date.parse(a.directiveAt || "");
        if (a.intendedRoom && !Number.isNaN(da) && Date.now() - da > 2 * HOUR) {
          notes.push(`${name}: directive to ${a.intendedRoom} expired after 2 h`);
          a.intendedRoom = null; a.directiveAt = null;
          changed = true;
        }
      }
      return changed;
    });
  }

  await appendEvent({ agent, type, project, payload });
  for (const n of notes) await appendEvent({ agent: null, type: "note", project, payload: { text: n, source: "reconcile" } });
}

async function main() {
  const [type, ...rest] = process.argv.slice(2);
  if (type === "__lock-selftest") { // used by server/test/lock.test.ts to prove the shared lock convention
    const [file, n] = rest;
    await Promise.all(Array.from({ length: Number(n) }, () => lockedUpdate(file, { n: 0 }, (c) => { c.n++; })));
    return;
  }
  const userLevel = rest.includes("--user");
  if (!EVENT_TYPES.includes(type)) return;
  if (!fs.existsSync(SATORU)) return; // not set up: stay silent
  let payload = {};
  try { payload = JSON.parse((await readStdin()) || "{}"); } catch { payload = {}; }
  await run(type, payload, userLevel);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .catch((e) => {
      try { fs.appendFileSync(path.join(SATORU, "hook-errors.log"), `${nowIso()} ${process.argv[2]} ${e?.stack || e}\n`, { encoding: "utf8" }); } catch {}
    })
    .finally(() => process.exit(0));
}
