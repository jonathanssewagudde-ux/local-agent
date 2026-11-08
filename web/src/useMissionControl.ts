import { useCallback, useEffect, useRef, useState } from "react";

export type AgentState = "idle" | "working" | "completed" | "briefing" | "meeting" | "approval" | "blocked";
export type Agent = { state?: AgentState; task?: string | null; say?: string | null; since?: string; heartbeat?: string; intendedRoom?: string | null; directiveAt?: string | null; voice?: string | null };
export type Task = { id: string; title: string; owner: string; files?: string[]; status?: string; verified?: boolean; updatedAt?: string };
export type Plan = { status: "awaiting-approval" | "approved" | "changes-requested" | "rejected"; title: string; scope?: string; risks?: string[]; tasks: Task[]; decidedAt?: string; note?: string };
export type Approval = { id: string; title: string; risk: string; reason: string; status: "pending" | "approved" | "rejected" | "discuss"; createdAt: string; decidedAt?: string; note?: string };
export type Decision = { ts: string; kind: "plan" | "approval"; ref: string; title: string; decision: string; note?: string };
export type ProjectData = {
  slug: string;
  agents: { agents: Record<string, Agent> };
  tasks: { tasks: Task[] };
  plan: Plan | null;
  approvals: { approvals: Approval[] };
  mission: { summary?: string; updatedAt?: string } | null;
  decisions: { decisions: Decision[] };
};
export type Project = { slug: string; name: string; path: string };
export type SEvent = { ts: string; agent: string | null; type: string; project: string | null; payload: Record<string, any>; cursor: string; t: number };
export type State = {
  config: { activeProject: string | null; projectsFolder: string };
  registry: { projects: Project[] };
  telemetry: { lastEventTs: string | null; liveSession: boolean; openSessions: number };
  spawnQueue: Record<string, { description?: string; ts: string; project?: string | null }[]>;
  active: ProjectData | null;
};
export type TerminalStatus = { attached: boolean; sessions: number; claudeRunning: boolean };

export async function api<T = any>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j });
  return j as T;
}

export function useMissionControl() {
  const [state, setState] = useState<State | null>(null);
  const [events, setEvents] = useState<SEvent[]>([]);
  const [terminal, setTerminal] = useState<TerminalStatus>({ attached: false, sessions: 0, claudeRunning: false });
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  const timers = useRef<Record<string, number>>({});

  const debounce = (key: string, fn: () => void, ms = 60) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(fn, ms);
  };

  const loadState = useCallback(async () => {
    try {
      const s = await api<State>("/api/state");
      activeRef.current = s.active?.slug ?? null;
      setState(s); setError(null);
    } catch (e: any) { setError(String(e.message || e)); }
  }, []);
  const loadProject = useCallback(async (slug: string) => {
    try {
      const p = await api<ProjectData>(`/api/projects/${slug}`);
      setState((s) => (s && s.active?.slug === slug ? { ...s, active: p } : s));
    } catch { loadState(); }
  }, [loadState]);
  const loadEvents = useCallback(async () => {
    try {
      const [e, t] = await Promise.all([api<{ events: SEvent[] }>("/api/events/recent?limit=200"), api<State["telemetry"]>("/api/telemetry-status")]);
      setEvents(e.events);
      setState((s) => (s ? { ...s, telemetry: t } : s));
    } catch {}
  }, []);

  useEffect(() => {
    loadState(); loadEvents();
    const es = new EventSource("/api/stream");
    es.onopen = () => { setConnected(true); loadState(); loadEvents(); };
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      let msg: { kind: string; project: string | null };
      try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.kind === "events") debounce("events", loadEvents);
      else if (msg.project && msg.project === activeRef.current) debounce("project", () => loadProject(msg.project!));
      else if (!msg.project) debounce("state", loadState);
    };
    const poll = async () => { try { setTerminal(await api<TerminalStatus>("/api/terminal-status")); } catch {} };
    poll();
    const iv = window.setInterval(poll, 3000);
    return () => { es.close(); clearInterval(iv); };
  }, [loadState, loadEvents, loadProject]);

  return { state, events, terminal, connected, error, reload: loadState };
}
