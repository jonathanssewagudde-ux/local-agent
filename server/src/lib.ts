// State layer: torn-read-safe reads, atomic writes, and a lock convention shared with hooks/telemetry.mjs.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SATORU = process.env.SATORU_DIR ? path.resolve(process.env.SATORU_DIR) : path.join(ROOT, ".satoru");
export const EVENTS_DIR = () => path.join(SATORU, "events");
export const PROJECTS_DIR = () => path.join(SATORU, "projects");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read JSON; on a missing or half-written file retry twice, then return the fallback. Never throws. */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const txt = await fsp.readFile(file, "utf8");
      return JSON.parse(txt) as T;
    } catch (e: any) {
      if (e?.code === "ENOENT") return fallback;
      if (attempt < 2) await sleep(25 + attempt * 25);
    }
  }
  return fallback;
}

/** Atomic write: <file>.tmp-<random>, then rename over the target. */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${crypto.randomBytes(6).toString("hex")}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await renameWithRetry(tmp, file);
}

// Windows can briefly refuse a rename while another process has the target open (EPERM/EBUSY/EACCES).
async function renameWithRetry(from: string, to: string) {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (e: any) {
      if (i < 20 && ["EPERM", "EBUSY", "EACCES"].includes(e?.code)) { await sleep(10 + i * 5); continue; }
      try { await fsp.unlink(from); } catch {}
      throw e;
    }
  }
}

const LOCK_WAIT_MS = 2000;
const LOCK_STALE_MS = 10_000;

/** Exclusive lock via <file>.lock created with 'wx'. Same convention as hooks/telemetry.mjs. */
export async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let handle: fsp.FileHandle | null = null;
  while (!handle) {
    try {
      handle = await fsp.open(lock, "wx");
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}`);
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
      try {
        const st = await fsp.stat(lock);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) { await fsp.unlink(lock).catch(() => {}); continue; }
      } catch { continue; }
      if (Date.now() > deadline) throw new Error(`lock timeout: ${lock}`);
      await sleep(5 + Math.random() * 15);
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await fsp.unlink(lock).catch(() => {});
  }
}

/** Lock, read, apply fn, write atomically, release. fn may mutate and/or return the new value. */
export async function lockedUpdateJson<T>(file: string, fallback: T, fn: (cur: T) => T | void | Promise<T | void>): Promise<T> {
  return withLock(file, async () => {
    const cur = await readJson<T>(file, structuredClone(fallback));
    const next = ((await fn(cur)) ?? cur) as T;
    await writeJson(file, next);
    return next;
  });
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_\-]{16,}/g, "[REDACTED]"],
  [/\bsk-ant-[A-Za-z0-9_\-]{16,}/g, "[REDACTED]"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[REDACTED]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/\-]{12,}=*/gi, "$1 [REDACTED]"],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1$2[REDACTED]"],
  [/\b[a-f0-9]{32,}\b/gi, "[REDACTED]"],
];
// Long base64-looking runs: only when they look like key material (mixed case + digits, not a file path).
const B64 = /[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g;
const looksLikeKey = (m: string) => /[0-9]/.test(m) && /[A-Z]/.test(m) && /[a-z]/.test(m) && (m.match(/\//g) || []).length < 3;

export function redact(s: string): string {
  let out = s;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out.replace(B64, (m) => (looksLikeKey(m) ? "[REDACTED]" : m));
}

export function redactDeep<T>(v: T): T {
  if (typeof v === "string") return redact(v) as T;
  if (Array.isArray(v)) return v.map(redactDeep) as T;
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) o[k] = redactDeep(x);
    return o;
  }
  return v;
}

/** Local date as YYYY-MM-DD (event files are named by the local day). */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type EventType = "session_start" | "session_end" | "prompt" | "idle" | "spawn" | "done" | "file_touch" | "command" | "stage" | "note";
export type SatoruEvent = { ts: string; agent: string | null; type: EventType; project: string | null; payload: Record<string, unknown> };

export async function appendEvent(ev: Omit<SatoruEvent, "ts"> & { ts?: string }): Promise<void> {
  const full = redactDeep({ ts: ev.ts ?? new Date().toISOString(), agent: ev.agent, type: ev.type, project: ev.project, payload: ev.payload });
  await fsp.mkdir(EVENTS_DIR(), { recursive: true });
  await fsp.appendFile(path.join(EVENTS_DIR(), `${localDate()}.ndjson`), JSON.stringify(full) + "\n", "utf8");
}

export function projectFile(slug: string, name: string) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) throw new Error(`bad project slug: ${slug}`);
  return path.join(PROJECTS_DIR(), slug, name);
}

export const exists = (p: string) => fs.existsSync(p);
