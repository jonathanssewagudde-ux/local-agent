// Pure logic for the office: where each member should be, and how to walk there through the doors.
import { card, lead, ROOM_KEYS, type RoomKey } from "./card";
import { NODES, EDGES, ROOM_NODE, ROOM_SEATS, WORK_HOME, OFFICE_ASPECT, type Pt } from "./officeAssets";
import type { Agent, ProjectData, State } from "./useMissionControl";

export const BREAK_ROOMS: RoomKey[] = ["lounge", "pantry"];
export const FAREWELL_MS = 2400;
export const STALE_MS = 15 * 60e3;
export const REPLAY_WINDOW_MS = 5 * 60e3;
const DIRECTIVE_TTL_MS = 2 * 3600e3;
const VOICE_TTL_MS = 10 * 60e3;

export type Placement = {
  room: RoomKey;
  reason: string;
  badge?: "amber" | "red";
  working: boolean;     // shown in a working pose (staleness dimming only applies to these)
  bubble?: string | null;
  resting: boolean;
};

const ts = (s?: string | null) => (s ? Date.parse(s) : NaN);

/** B9 precedence: 🎬 directive → board state → break room. */
export function decide(name: string, data: ProjectData | null, spawnQueue: State["spawnQueue"], now = Date.now()): Placement {
  const a: Agent = data?.agents.agents[name] ?? {};
  const isLead = name === lead.name;
  const home = (WORK_HOME[name]?.room ?? card.team.find((m) => m.name === name)?.worksIn ?? "workspace") as RoomKey;
  const rest: Placement = { room: isLead ? home : "lounge", reason: isLead ? "lead rests at own seat" : "nothing to do → break room", working: false, resting: true };
  if (!data) return { ...rest, reason: "no project loaded" };

  const tasks = data.tasks.tasks ?? [];
  const mine = tasks.filter((t) => t.owner === name);
  const status = (t: { status?: string }) => (t.status ?? "").toLowerCase().replace(/[\s_]+/g, "-");
  const liveSpawn = (spawnQueue[name] ?? []).some((q) => !q.project || q.project === data.slug) || a.state === "working";
  const inProgress = mine.some((t) => status(t) === "in-progress");
  const working = liveSpawn || inProgress;
  const voiceFresh = a.voice && (!a.directiveAt || now - ts(a.directiveAt) < VOICE_TTL_MS);
  const workText = (voiceFresh ? a.voice : null) || a.task || mine.find((t) => status(t) === "in-progress")?.title || null;

  // 1. a valid 🎬 directive
  const d = a.intendedRoom as RoomKey | undefined;
  if (d && ROOM_KEYS.includes(d) && (!a.directiveAt || now - ts(a.directiveAt) < DIRECTIVE_TTL_MS)) {
    const fresh = !a.directiveAt || now - ts(a.directiveAt) < VOICE_TTL_MS; // the line is said, not stuck over their head for hours
    return { room: d, reason: `🎬 directive → ${d}`, working: working && d === home, bubble: fresh ? a.voice || null : working ? workText : null, resting: BREAK_ROOMS.includes(d) };
  }
  // 2. board state
  const pendingApprovals = (data.approvals.approvals ?? []).filter((x) => x.status === "pending");
  if (isLead && pendingApprovals.length) return { room: "approval", reason: `${pendingApprovals.length} approval(s) pending`, badge: "amber", working: false, bubble: `Waiting on you: ${pendingApprovals[0].title}`, resting: false };
  const plan = data.plan;
  if (plan?.status === "awaiting-approval" && (isLead || plan.tasks?.some((t) => t.owner === name)))
    return { room: "briefing", reason: `plan "${plan.title}" awaiting approval`, working: false, bubble: isLead ? `Plan ready: ${plan.title}` : null, resting: false };
  if (working) return { room: home, reason: liveSpawn ? "live spawn" : "task in progress", working: true, bubble: workText, resting: false };
  if (mine.some((t) => status(t) === "blocked")) return { room: "meeting", reason: "task blocked", badge: "red", working: false, bubble: `Blocked: ${mine.find((t) => status(t) === "blocked")!.title}`, resting: false };
  if (mine.some((t) => status(t) === "review")) return { room: "meeting", reason: "task in review", working: false, bubble: `In review: ${mine.find((t) => status(t) === "review")!.title}`, resting: false };
  // 3. otherwise rest
  const leadSay = isLead && a.say && now - ts(a.since) < 10 * 60e3 ? a.say : null;
  return { ...rest, bubble: leadSay };
}

// ---------- geometry ----------
/** Distance in "x-percent" units, correcting for the map's 4:3 aspect. */
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, (a.y - b.y) / OFFICE_ASPECT);
export const legMs = (a: Pt, b: Pt) => Math.max(220, Math.min(1300, dist(a, b) * 32));

const ADJ = new Map<string, string[]>();
for (const [a, b] of EDGES) { ADJ.set(a, [...(ADJ.get(a) ?? []), b]); ADJ.set(b, [...(ADJ.get(b) ?? []), a]); }

/** Shortest path (breadth-first) over the door/corridor graph. Returns node ids including both ends. */
export function bfs(from: string, to: string): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, ""]]);
  const q = [from];
  while (q.length) {
    const n = q.shift()!;
    for (const m of ADJ.get(n) ?? []) {
      if (prev.has(m)) continue;
      prev.set(m, n);
      if (m === to) { const path = [to]; let c = n; while (c) { path.unshift(c); c = prev.get(c)!; } return path; }
      q.push(m);
    }
  }
  return null;
}

export type Waypoint = Pt & { node?: string };
/** Waypoints from where an agent is (a seat in a room, or a graph node mid-walk) to a seat in the target room:
 *  seat → own door node → graph path → target door node → seat. */
export function route(at: { room?: RoomKey; node?: string }, target: { room: RoomKey; seat: Pt }): Waypoint[] {
  const goal = ROOM_NODE[target.room];
  if (at.room === target.room && !at.node) return [target.seat];
  const start = at.node ?? (at.room ? ROOM_NODE[at.room] : undefined);
  if (!start || !goal) return [target.seat];
  const path = bfs(start, goal);
  if (!path) { console.warn(`[office] no path ${start} → ${goal}; add connections in the picker`); return [target.seat]; }
  return [...path.map((id) => ({ ...NODES[id], node: id })), target.seat];
}

export type Facing = "front" | "side-left" | "side-right" | "back";
export function facingFor(from: Pt, to: Pt): Facing {
  const dx = to.x - from.x, dy = (to.y - from.y) / OFFICE_ASPECT;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "side-right" : "side-left";
  return dy < 0 ? "back" : "front";
}

// ---------- seats: nobody ever shares one ----------
export function assignSeats(targets: Record<string, RoomKey>, prev: Record<string, { room: RoomKey; seatId: string }>, wanderSeed: Record<string, number>) {
  const taken = new Set<string>();
  const out: Record<string, { room: RoomKey; seatId: string; seat: Pt }> = {};
  const workSeatOwner = new Map(Object.entries(WORK_HOME).map(([n, s]) => [s.id, n]));
  const names = Object.keys(targets);
  // pass 1: members going to their own work seat
  for (const n of names) {
    const h = WORK_HOME[n];
    if (h && targets[n] === h.room) { out[n] = { room: h.room as RoomKey, seatId: h.id, seat: h }; taken.add(h.id); }
  }
  // pass 2: everyone else — keep the previous seat if it is still free, otherwise the first free one
  for (const n of names) {
    if (out[n]) continue;
    const room = targets[n];
    const seats = (ROOM_SEATS[room] ?? []).filter((s) => !taken.has(s.id) && (!workSeatOwner.has(s.id) || !names.includes(workSeatOwner.get(s.id)!) || targets[workSeatOwner.get(s.id)!] !== room));
    let pick = seats.find((s) => prev[n]?.room === room && prev[n].seatId === s.id && !(wanderSeed[n] && BREAK_ROOMS.includes(room)));
    if (!pick && seats.length) pick = seats[(wanderSeed[n] ?? 0) % seats.length];
    if (pick) { out[n] = { room, seatId: pick.id, seat: pick }; taken.add(pick.id); continue; }
    // no seat left: stand near the door, offset so nobody overlaps
    const door = NODES[ROOM_NODE[room]] ?? { x: 50, y: 50 };
    const k = Object.values(out).filter((o) => o.room === room).length;
    out[n] = { room, seatId: `overflow-${room}-${k}`, seat: { x: door.x + ((k % 3) - 1) * 4, y: door.y + 6 + Math.floor(k / 3) * 6 } };
  }
  return out;
}

export function ago(iso?: string | null, now = Date.now()) {
  const t = ts(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** One short human sentence for the ticker / timeline. */
export function describe(e: { type: string; agent: string | null; payload: Record<string, any> }) {
  const who = e.agent ?? "someone";
  const p = e.payload || {};
  switch (e.type) {
    case "session_start": return `Claude session started${p.source && p.source !== "startup" ? ` (${p.source})` : ""} — lights on`;
    case "session_end": return `Claude session ended — lights off`;
    case "prompt": return p.system ? `${who} got a report back: ${p.prompt ?? ""}` : `You asked ${who}: “${p.prompt ?? ""}”`;
    case "spawn": return e.agent ? `${who} picked up: ${p.description || "a task"}` : `A subagent (${p.subagent_type || "unknown"}) started: ${p.description || ""}`;
    case "done": return p.phantom ? `(harness stop — ignored)` : e.agent ? `${who} finished${p.say ? `: “${p.say}”` : ""}` : `A subagent (${p.agent_type || "unknown"}) finished`;
    case "file_touch": return `${who} edited ${String(p.file ?? "").split(/[\\/]/).slice(-2).join("/")}`;
    case "command": return `${who} ran ${p.description ? p.description : `\`${p.command}\``}`;
    case "idle": return `${who} is waiting for you`;
    case "stage": return `${who} → ${p.room}${p.voice ? ` · “${p.voice}”` : ""}`;
    case "note": return String(p.text ?? "note");
    default: return e.type;
  }
}
