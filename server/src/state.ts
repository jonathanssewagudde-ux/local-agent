import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { SATORU, EVENTS_DIR, PROJECTS_DIR, readJson, projectFile, localDate, type SatoruEvent } from "./lib.js";

export type Config = { activeProject: string | null; projectsFolder?: string };
export type Project = { slug: string; name: string; path: string };
export type Task = { id: string; title: string; owner: string; files?: string[]; status?: string; verified?: boolean; updatedAt?: string };
export type Plan = { status: "awaiting-approval" | "approved" | "changes-requested" | "rejected"; title: string; scope?: string; risks?: string[]; tasks: Task[]; decidedAt?: string; note?: string; createdAt?: string };
export type Approval = { id: string; title: string; risk: string; reason: string; status: "pending" | "approved" | "rejected" | "discuss"; createdAt: string; decidedAt?: string; note?: string };
export type Decision = { ts: string; kind: "plan" | "approval"; ref: string; title: string; decision: string; note?: string };

export const CONFIG = () => path.join(SATORU, "config.json");
export const REGISTRY = () => path.join(SATORU, "registry.json");
export const SPAWN_QUEUE = () => path.join(SATORU, "spawn-queue.json");

export const getConfig = () => readJson<Config>(CONFIG(), { activeProject: null });
export const getRegistry = () => readJson<{ projects: Project[] }>(REGISTRY(), { projects: [] });
export const projectsFolder = (c: Config) => (c.projectsFolder && c.projectsFolder.trim()) || path.join(os.homedir(), "projects");

export async function projectData(slug: string) {
  const [agents, tasks, plan, approvals, mission, decisions] = await Promise.all([
    readJson(projectFile(slug, "agents.json"), { agents: {} }),
    readJson<{ tasks: Task[] }>(projectFile(slug, "tasks.json"), { tasks: [] }),
    readJson<Plan | null>(projectFile(slug, "plan.json"), null),
    readJson<{ approvals: Approval[] }>(projectFile(slug, "approvals.json"), { approvals: [] }),
    readJson<{ summary?: string; updatedAt?: string } | null>(projectFile(slug, "mission.json"), null),
    readJson<{ decisions: Decision[] }>(projectFile(slug, "decisions.json"), { decisions: [] }),
  ]);
  return { slug, agents, tasks, plan, approvals, mission, decisions };
}

// ---------- events ----------
export function eventFiles(maxDays = 14): string[] {
  try {
    const files = fs.readdirSync(EVENTS_DIR()).filter((f) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).sort().reverse();
    const cutoff = localDate(new Date(Date.now() - (maxDays - 1) * 864e5));
    return files.filter((f) => f.slice(0, 10) >= cutoff); // file names are dates, so lexical order is date order
  } catch {
    return [];
  }
}

export type LocatedEvent = SatoruEvent & { cursor: string; t: number; file: string; line: number };

export async function readDay(file: string): Promise<LocatedEvent[]> {
  let txt = "";
  try { txt = await fsp.readFile(path.join(EVENTS_DIR(), file), "utf8"); } catch { return []; }
  const out: LocatedEvent[] = [];
  txt.split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    try {
      const e = JSON.parse(l) as SatoruEvent;
      const t = Date.parse(e.ts);
      if (Number.isNaN(t)) return;
      out.push({ ...e, t, file, line: i + 1, cursor: `${e.ts}|${file}#${i + 1}` });
    } catch {}
  });
  return out;
}

// Newest-first ordering key: (time desc, day file desc, line desc). Unique per event, so paging never drops ties.
const cmp = (a: { t: number; file: string; line: number }, b: { t: number; file: string; line: number }) =>
  b.t - a.t || (a.file < b.file ? 1 : a.file > b.file ? -1 : 0) || b.line - a.line;

export function parseCursor(c: string): { t: number; file: string; line: number } | null {
  const m = c.match(/^(.+)\|(\d{4}-\d{2}-\d{2}\.ndjson)#(\d+)$/);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isNaN(t) ? null : { t, file: m[2], line: Number(m[3]) };
}

export async function timeline(opts: { before?: string; limit?: number; project?: string; member?: string; type?: string }) {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  const before = opts.before ? parseCursor(opts.before) : null;
  const all: LocatedEvent[] = [];
  for (const f of eventFiles(14)) all.push(...(await readDay(f)));
  all.sort(cmp);
  const match = (e: LocatedEvent) =>
    (!opts.project || (opts.project === "unattributed" ? !e.project : e.project === opts.project)) &&
    (!opts.member || (opts.member === "unattributed" ? !e.agent : e.agent === opts.member)) &&
    (!opts.type || (opts.type === "unattributed" ? !e.agent || !e.project : e.type === opts.type));
  const filtered = all.filter((e) => (!before || cmp(before, e) < 0) && match(e)); // strictly after the cursor in newest-first order
  const page = filtered.slice(0, limit);
  return { events: page, next: filtered.length > limit ? page[page.length - 1].cursor : null };
}

export async function recentEvents(limit = 200) {
  const out: LocatedEvent[] = [];
  for (const f of eventFiles(2)) out.push(...(await readDay(f)));
  out.sort(cmp);
  return out.slice(0, limit).reverse(); // oldest → newest
}

/** Lights: is there a Claude session that started and hasn't ended? */
export async function telemetryStatus() {
  const evs = await recentEvents(5000);
  const open = new Map<string, number>();
  let lastEventTs: string | null = null;
  for (const e of evs) {
    lastEventTs = e.ts;
    const sid = String((e.payload as any)?.session_id ?? "default");
    if (e.type === "session_start") open.set(sid, e.t);
    else if (e.type === "session_end") open.delete(sid);
    else if (open.has(sid)) open.set(sid, e.t);
  }
  const fresh = [...open.values()].filter((t) => Date.now() - t < 12 * 3600e3);
  return { lastEventTs, liveSession: fresh.length > 0, openSessions: fresh.length };
}

// ---------- git ----------
const git = (cwd: string, args: string[]) =>
  new Promise<string | null>((r) => execFile("git", ["-C", cwd, ...args], { timeout: 4000, windowsHide: true }, (e, out) => r(e ? null : out.trim())));

export async function gitInfo(p: string) {
  if (!fs.existsSync(p)) return { exists: false, branch: null, dirty: null };
  const branch = await git(p, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = branch === null ? null : await git(p, ["status", "--porcelain"]);
  return { exists: true, branch, dirty: status === null ? null : status.length > 0 };
}

export const gitInit = (p: string) => git(p, ["init", "-q"]);

export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "project";

export { PROJECTS_DIR };
