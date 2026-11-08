import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import chokidar from "chokidar";
import { ROOT, SATORU, readJson, writeJson, lockedUpdateJson, appendEvent, projectFile, redact, exists } from "./lib.js";
import * as term from "./pty.js";
import {
  CONFIG, REGISTRY, SPAWN_QUEUE, getConfig, getRegistry, projectData, projectsFolder, recentEvents, telemetryStatus, timeline,
  gitInfo, gitInit, slugify, type Config, type Plan, type Approval, type Decision, type Task, type Project,
} from "./state.js";

const PORT = Number(process.env.MC_SERVER_PORT || 4317);
const ALLOWED_ORIGIN = "http://localhost:4316";
const card = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "src", "card.generated.json"), "utf8")) as {
  appName: string; team: { name: string; role: string }[];
};
const LEAD = card.team[0].name;
const isMember = (n: unknown) => typeof n === "string" && card.team.some((m) => m.name === n);

// ---------- bootstrap .satoru ----------
for (const d of ["events", "projects"]) fs.mkdirSync(path.join(SATORU, d), { recursive: true });
if (!exists(CONFIG())) await writeJson(CONFIG(), { activeProject: null });
if (!exists(REGISTRY())) await writeJson(REGISTRY(), { projects: [] });

const app = express();
// Pinned origin. Browsers always send Origin on cross-site requests, so anything else is refused outright —
// a random website must never be able to drive this daemon (it can type into your terminal).
app.use((req: Request, res: Response, next: NextFunction) => {
  const o = req.headers.origin;
  if (o && o !== ALLOWED_ORIGIN) return res.status(403).json({ error: "origin not allowed" });
  next();
});
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "256kb" }));

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
  fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: String(e?.message || e) }); });

async function activeSlugOr404(req: Request, res: Response): Promise<string | null> {
  const slug = String(req.params.slug);
  const reg = await getRegistry();
  if (!reg.projects.some((p) => p.slug === slug)) { res.status(404).json({ error: `unknown project ${slug}` }); return null; }
  return slug;
}

async function tell(text: string) {
  const r = await term.inject(text);
  return r.injected ? { injected: true } : { injected: false, reason: r.reason };
}

async function logDecision(slug: string, d: Omit<Decision, "ts">) {
  const entry: Decision = { ts: new Date().toISOString(), ...d, note: d.note ? redact(d.note) : undefined };
  await lockedUpdateJson<{ decisions: Decision[] }>(projectFile(slug, "decisions.json"), { decisions: [] }, (cur) => { cur.decisions.push(entry); });
  await appendEvent({ agent: null, type: "note", project: slug, payload: { text: `${d.kind} "${d.title}" → ${d.decision}${d.note ? ` (${d.note})` : ""}`, source: "dashboard" } });
}

// ---------- read API ----------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/state", wrap(async (_req, res) => {
  const [config, registry, telemetry, spawnQueue] = await Promise.all([getConfig(), getRegistry(), telemetryStatus(), readJson(SPAWN_QUEUE(), {})]);
  const active = config.activeProject && registry.projects.some((p) => p.slug === config.activeProject) ? await projectData(config.activeProject) : null;
  res.json({ config: { ...config, projectsFolder: projectsFolder(config) }, registry, telemetry, spawnQueue, active });
}));

app.get("/api/projects/:slug", wrap(async (req, res) => {
  const slug = await activeSlugOr404(req, res); if (!slug) return;
  res.json(await projectData(slug));
}));

app.get("/api/projects", wrap(async (_req, res) => {
  const reg = await getRegistry();
  res.json({ projects: await Promise.all(reg.projects.map(async (p) => ({ ...p, git: await gitInfo(p.path) }))) });
}));

app.get("/api/events/recent", wrap(async (req, res) => {
  res.json({ events: await recentEvents(Number(req.query.limit) || 200) });
}));

app.get("/api/timeline", wrap(async (req, res) => {
  const q = (k: string) => (typeof req.query[k] === "string" && req.query[k] ? String(req.query[k]) : undefined);
  res.json(await timeline({ before: q("before"), limit: Number(q("limit")) || 100, project: q("project"), member: q("member"), type: q("type") }));
}));

app.get("/api/telemetry-status", wrap(async (_req, res) => res.json(await telemetryStatus())));
app.get("/api/terminal-status", wrap(async (_req, res) => res.json(await term.terminalStatus())));

app.post("/api/terminal/inject", wrap(async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ injected: false, reason: "empty text" });
  res.json(await tell(text));
}));

// ---------- projects ----------
async function setActive(slug: string | null) {
  await lockedUpdateJson<Config>(CONFIG(), { activeProject: null }, (c) => { c.activeProject = slug; });
}

app.post("/api/active", wrap(async (req, res) => {
  const slug = req.body?.slug ?? null;
  const reg = await getRegistry();
  const p = reg.projects.find((x) => x.slug === slug);
  if (slug !== null && !p) return res.status(404).json({ error: "unknown project" });
  await setActive(slug);
  const told = p ? await tell(`Mission Control: switch to project "${p.name}" at ${p.path} (slug ${p.slug}). Write plans to .satoru/projects/${p.slug}/plan.json in the Mission Control folder.`) : { injected: false };
  res.json({ ok: true, ...told });
}));

async function register(p: Project) {
  await lockedUpdateJson<{ projects: Project[] }>(REGISTRY(), { projects: [] }, (r) => {
    if (!r.projects.some((x) => x.slug === p.slug)) r.projects.push(p);
  });
  await fsp.mkdir(path.join(SATORU, "projects", p.slug), { recursive: true });
}

async function uniqueSlug(base: string) {
  const reg = await getRegistry();
  let s = base, i = 2;
  while (reg.projects.some((p) => p.slug === s)) s = `${base}-${i++}`;
  return s;
}

app.post("/api/projects", wrap(async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name || name.length > 80) return res.status(400).json({ error: "give the project a name (max 80 characters)" });
  const cfg = await getConfig();
  const folder = path.join(projectsFolder(cfg), slugify(name));
  if (exists(folder)) return res.status(409).json({ error: `folder already exists: ${folder}` });
  await fsp.mkdir(folder, { recursive: true });
  await gitInit(folder);
  await fsp.writeFile(path.join(folder, "README.md"), `# ${name}\n\nCreated from ${card.appName}.\n`, "utf8");
  const slug = await uniqueSlug(slugify(name));
  await register({ slug, name, path: folder });
  await setActive(slug);
  const told = await tell(`Mission Control: new project "${name}" created at ${folder} (slug ${slug}). It is now the active project.`);
  res.json({ ok: true, slug, path: folder, ...told });
}));

app.post("/api/projects/existing", wrap(async (req, res) => {
  const raw = String(req.body?.path ?? "").trim().replace(/^["']|["']$/g, "");
  if (!raw || !path.isAbsolute(raw)) return res.status(400).json({ error: "paste the FULL path of the folder" });
  const p = path.resolve(raw);
  let st: fs.Stats | null = null;
  try { st = fs.statSync(p); } catch {}
  if (!st?.isDirectory()) return res.status(400).json({ error: `not a folder: ${p}` });
  const reg = await getRegistry();
  const already = reg.projects.find((x) => path.resolve(x.path).toLowerCase() === p.toLowerCase());
  const slug = already?.slug ?? (await uniqueSlug(slugify(path.basename(p))));
  if (!already) await register({ slug, name: path.basename(p), path: p });
  await setActive(slug);
  res.json({ ok: true, slug, path: p });
}));

app.post("/api/config/projects-folder", wrap(async (req, res) => {
  const p = String(req.body?.path ?? "").trim();
  if (p && !path.isAbsolute(p)) return res.status(400).json({ error: "use a full path" });
  await lockedUpdateJson<Config>(CONFIG(), { activeProject: null }, (c) => { c.projectsFolder = p || undefined; });
  res.json({ ok: true });
}));

// ---------- plan + approvals ----------
export function planConflicts(plan: Plan | null) {
  const owners = new Map<string, string[]>();
  for (const t of plan?.tasks ?? []) for (const f of t.files ?? []) {
    const k = f.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
    owners.set(k, [...(owners.get(k) ?? []), t.id]);
  }
  return [...owners.entries()].filter(([, ids]) => ids.length > 1).map(([file, tasks]) => ({ file, tasks }));
}

app.get("/api/projects/:slug/plan/conflicts", wrap(async (req, res) => {
  const slug = await activeSlugOr404(req, res); if (!slug) return;
  res.json({ conflicts: planConflicts(await readJson<Plan | null>(projectFile(slug, "plan.json"), null)) });
}));

app.post("/api/projects/:slug/plan/decision", wrap(async (req, res) => {
  const slug = await activeSlugOr404(req, res); if (!slug) return;
  const decision = String(req.body?.decision);
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 2000) : "";
  const status = ({ approve: "approved", changes: "changes-requested", reject: "rejected" } as const)[decision as "approve"];
  if (!status) return res.status(400).json({ error: "decision must be approve | changes | reject" });
  let conflict: ReturnType<typeof planConflicts> = [];
  let bad: string[] = [];
  let title = "";
  try {
    await lockedUpdateJson<Plan | null>(projectFile(slug, "plan.json"), null, (plan) => {
      if (!plan) throw Object.assign(new Error("no plan"), { http: 404 });
      if (plan.status !== "awaiting-approval") throw Object.assign(new Error(`plan is already ${plan.status}`), { http: 409 });
      title = plan.title;
      if (status === "approved") {
        conflict = planConflicts(plan);
        bad = plan.tasks.filter((t) => !isMember(t.owner)).map((t) => `${t.id}: ${t.owner}`);
        if (conflict.length || bad.length) throw Object.assign(new Error("conflict"), { http: 409 });
      }
      plan.status = status;
      plan.decidedAt = new Date().toISOString();
      plan.note = note || undefined;
      return plan;
    });
  } catch (e: any) {
    if (e.http === 409 && (conflict.length || bad.length)) return res.status(409).json({ error: "plan has conflicts", conflicts: conflict, badOwners: bad });
    if (e.http) return res.status(e.http).json({ error: e.message });
    throw e;
  }
  if (status === "approved") {
    const plan = await readJson<Plan | null>(projectFile(slug, "plan.json"), null);
    const now = new Date().toISOString();
    await lockedUpdateJson<{ tasks: Task[] }>(projectFile(slug, "tasks.json"), { tasks: [] }, (cur) => {
      for (const t of plan?.tasks ?? []) {
        const ex = cur.tasks.find((x) => x.id === t.id);
        if (ex) Object.assign(ex, { title: t.title, owner: t.owner, files: t.files });
        else cur.tasks.push({ id: t.id, title: t.title, owner: t.owner, files: t.files ?? [], status: "planned", verified: false, updatedAt: now });
      }
    });
  }
  await logDecision(slug, { kind: "plan", ref: "plan", title, decision: status, note });
  const msg = status === "approved" ? `Plan approved in ${card.appName}: ${title}. Proceed.`
    : status === "changes-requested" ? `Plan changes requested in ${card.appName}: ${title}.${note ? ` Note: ${note}` : ""} Revise the plan and write it again.`
    : `Plan rejected in ${card.appName}: ${title}.${note ? ` Note: ${note}` : ""} Do not start it.`;
  res.json({ ok: true, status, ...(await tell(msg)) });
}));

app.post("/api/projects/:slug/approvals/:id", wrap(async (req, res) => {
  const slug = await activeSlugOr404(req, res); if (!slug) return;
  const decision = String(req.body?.decision);
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 2000) : "";
  const status = ({ approve: "approved", reject: "rejected", discuss: "discuss" } as const)[decision as "approve"];
  if (!status) return res.status(400).json({ error: "decision must be approve | reject | discuss" });
  let found: Approval | null = null;
  await lockedUpdateJson<{ approvals: Approval[] }>(projectFile(slug, "approvals.json"), { approvals: [] }, (cur) => {
    const a = cur.approvals.find((x) => x.id === req.params.id);
    if (a && a.status === "pending") { a.status = status; a.decidedAt = new Date().toISOString(); a.note = note || undefined; found = { ...a }; }
  });
  if (!found) return res.status(404).json({ error: "no pending approval with that id" });
  const a = found as Approval;
  await logDecision(slug, { kind: "approval", ref: a.id, title: a.title, decision: status, note });
  const verb = status === "approved" ? "approved" : status === "rejected" ? "rejected" : "needs discussion";
  res.json({ ok: true, ...(await tell(`Approval ${a.id} ${verb} in ${card.appName}: ${a.title}.${note ? ` Note: ${note}` : ""}`)) });
}));

app.post("/api/projects/:slug/mission", wrap(async (req, res) => {
  const slug = await activeSlugOr404(req, res); if (!slug) return;
  const summary = redact(String(req.body?.summary ?? "").slice(0, 20000));
  await lockedUpdateJson<{ summary?: string; updatedAt?: string }>(projectFile(slug, "mission.json"), {}, () => ({ summary, updatedAt: new Date().toISOString() }));
  res.json({ ok: true });
}));

app.get("/api/projects/:slug/readme", wrap(async (req, res) => {
  const slug = await activeSlugOr404(req, res); if (!slug) return;
  const p = (await getRegistry()).projects.find((x) => x.slug === slug)!;
  let text = "";
  try { text = (await fsp.readFile(path.join(p.path, "README.md"), "utf8")).slice(0, 8000); } catch {}
  res.json({ text });
}));

// ---------- SSE: say WHAT changed; the browser re-fetches ----------
const clients = new Set<Response>();
app.get("/api/stream", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`retry: 2000\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(`: ping\n\n`), 20000);
  req.on("close", () => { clearInterval(ping); clients.delete(res); });
});
function broadcast(msg: { kind: string; project: string | null; file: string }) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const c of clients) c.write(line);
}

const watcher = chokidar.watch(SATORU, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 25 },
  ignored: (p: string) => /\.lock$|\.tmp-[0-9a-f]+$|\.gitkeep$/.test(p),
});
watcher.on("all", (_ev, file) => {
  const rel = path.relative(SATORU, file).split(path.sep);
  if (rel[0] === "events") return broadcast({ kind: "events", project: null, file: rel.join("/") });
  if (rel[0] === "projects" && rel.length >= 3) return broadcast({ kind: rel[2].replace(/\.json$/, ""), project: rel[1], file: rel.join("/") });
  broadcast({ kind: rel[rel.length - 1].replace(/\.json$/, ""), project: null, file: rel.join("/") });
});

// ---------- HTTP + WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin;
  if (!req.url?.startsWith("/pty") || (origin && origin !== ALLOWED_ORIGIN)) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => term.attach(ws));
});

server.listen(PORT, "127.0.0.1", () => console.log(`${card.appName} daemon on http://127.0.0.1:${PORT} (lead: ${LEAD}, shell: ${term.hostShell()})`));

const shutdown = () => { term.killAll(); watcher.close(); server.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
