// Embedded terminal: PTY sessions live on the server, keyed by a browser-held sid.
// A socket closing DETACHES; only an explicit "kill" or server shutdown ends a shell.
import os from "node:os";
import { execFile } from "node:child_process";
import fs from "node:fs";
import type { WebSocket } from "ws";
import * as pty from "node-pty";
import { ROOT } from "./lib.js";

const SCROLLBACK_MAX = 200 * 1024;

type Session = { sid: string; term: pty.IPty; scrollback: string; sockets: Set<WebSocket>; lastUsed: number; exited: boolean };
const sessions = new Map<string, Session>();

function shell(): { file: string; args: string[] } {
  if (process.platform === "win32") return { file: "powershell.exe", args: ["-NoLogo"] };
  return { file: process.env.SHELL || "bash", args: ["-l"] };
}

function spawn(sid: string, cols: number, rows: number): Session {
  const { file, args } = shell();
  const env = { ...process.env, MISSION_CONTROL: "1" } as Record<string, string>;
  delete env.CLAUDECODE; // never make the inner claude think it is nested
  const term = pty.spawn(file, args, { name: "xterm-256color", cols, rows, cwd: ROOT, env });
  const s: Session = { sid, term, scrollback: "", sockets: new Set(), lastUsed: Date.now(), exited: false };
  term.onData((d) => {
    s.scrollback += d;
    if (s.scrollback.length > SCROLLBACK_MAX) s.scrollback = s.scrollback.slice(-SCROLLBACK_MAX);
    for (const ws of s.sockets) if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "out", d }));
  });
  term.onExit(({ exitCode }) => {
    s.exited = true;
    for (const ws of s.sockets) if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "exit", code: exitCode }));
    sessions.delete(sid);
  });
  sessions.set(sid, s);
  return s;
}

export function attach(ws: WebSocket) {
  let s: Session | null = null;
  ws.on("message", (raw) => {
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.t === "hello") {
      const sid = typeof msg.sid === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(msg.sid) ? msg.sid : null;
      if (!sid) return ws.close(1008, "bad sid");
      const cols = Math.max(20, Math.min(500, Number(msg.cols) || 100));
      const rows = Math.max(5, Math.min(200, Number(msg.rows) || 30));
      const existing = sessions.get(sid);
      s = existing ?? spawn(sid, cols, rows);
      s.sockets.add(ws);
      if (existing) {
        try { s.term.resize(cols, rows); } catch {}
        ws.send(JSON.stringify({ t: "replay", d: s.scrollback }));
      }
      ws.send(JSON.stringify({ t: "ready", reattached: !!existing, pid: s.term.pid }));
      return;
    }
    if (!s) return;
    if (msg.t === "in" && typeof msg.d === "string") { s.lastUsed = Date.now(); s.term.write(msg.d); }
    else if (msg.t === "resize") { try { s.term.resize(Math.max(20, msg.cols | 0), Math.max(5, msg.rows | 0)); } catch {} }
    else if (msg.t === "kill") { try { s.term.kill(); } catch {} sessions.delete(s.sid); }
  });
  ws.on("close", () => { s?.sockets.delete(ws); }); // detach only
}

export function killAll() {
  for (const s of sessions.values()) { try { s.term.kill(); } catch {} }
  sessions.clear();
}

function mostRecent(): Session | null {
  let best: Session | null = null;
  for (const s of sessions.values()) if (!s.exited && (!best || s.lastUsed > best.lastUsed)) best = s;
  return best;
}

// ---- is `claude` running inside a PTY? Walk the PTY's process tree. ----
type Proc = { pid: number; ppid: number; cmd: string };
let procCache: { at: number; list: Proc[] } | null = null;

function listProcs(): Promise<Proc[]> {
  if (procCache && Date.now() - procCache.at < 2000) return Promise.resolve(procCache.list);
  return new Promise((resolve) => {
    const done = (list: Proc[]) => { procCache = { at: Date.now(), list }; resolve(list); };
    if (process.platform === "linux") {
      const list: Proc[] = [];
      for (const d of fs.readdirSync("/proc")) {
        if (!/^\d+$/.test(d)) continue;
        try {
          const stat = fs.readFileSync(`/proc/${d}/stat`, "utf8");
          const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
          const cmd = fs.readFileSync(`/proc/${d}/cmdline`, "utf8").replace(/\0/g, " ").trim();
          list.push({ pid: Number(d), ppid, cmd });
        } catch {}
      }
      return done(list);
    }
    if (process.platform === "win32") {
      const ps = "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name) $($_.CommandLine)\" }";
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, maxBuffer: 16 << 20, timeout: 8000 }, (err, out) => {
        if (err) return done([]);
        done(out.split(/\r?\n/).filter(Boolean).map((l) => { const [a, b, ...c] = l.split("\t"); return { pid: Number(a), ppid: Number(b), cmd: c.join(" ") }; }));
      });
      return;
    }
    execFile("ps", ["-A", "-o", "pid=,ppid=,command="], { maxBuffer: 16 << 20 }, (err, out) => {
      if (err) return done([]);
      done(out.split("\n").map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map((m) => ({ pid: +m![1], ppid: +m![2], cmd: m![3] })));
    });
  });
}

const CLAUDE_RE = /(^|[\\/\s"])claude(\.exe|\.cmd|\.ps1|\.js)?("|\s|$)|@anthropic-ai[\\/]claude-code/i;

async function claudeIn(s: Session): Promise<boolean> {
  const list = await listProcs();
  const kids = new Map<number, Proc[]>();
  for (const p of list) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid)!.push(p); }
  const stack = [...(kids.get(s.term.pid) ?? [])];
  const seen = new Set<number>();
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p.pid)) continue;
    seen.add(p.pid);
    if (CLAUDE_RE.test(p.cmd)) return true;
    stack.push(...(kids.get(p.pid) ?? []));
  }
  return false;
}

export async function terminalStatus() {
  const s = mostRecent();
  let claudeRunning = false;
  for (const x of sessions.values()) if (!x.exited && (await claudeIn(x))) { claudeRunning = true; break; }
  return { attached: !!s && s.sockets.size > 0, sessions: sessions.size, claudeRunning };
}

/** Type text into the most recently used PTY, then Enter as a SEPARATE write ~150 ms later. */
export async function inject(text: string): Promise<{ injected: boolean; reason?: string }> {
  const s = mostRecent();
  if (!s) return { injected: false, reason: "no terminal session" };
  if (!(await claudeIn(s))) return { injected: false, reason: "Claude is not running in the terminal" };
  const clean = text.replace(/[\r\n]+/g, " ").slice(0, 2000);
  s.term.write(clean);
  await new Promise((r) => setTimeout(r, 150));
  s.term.write("\r");
  s.lastUsed = Date.now();
  return { injected: true };
}

export const hostShell = () => `${shell().file} on ${os.platform()}`;
