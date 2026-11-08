// "What did the team do while I was away?" — events/*.ndjson (≤14 days), newest first, grouped by local day.
import { useEffect, useState } from "react";
import { card } from "../card";
import { SPRITES } from "../officeAssets";
import { describe } from "../officeLogic";
import { api, type SEvent, type State } from "../useMissionControl";

const TYPES = ["session_start", "session_end", "prompt", "idle", "spawn", "done", "file_touch", "command", "stage", "note"];

export default function Timeline({ state, liveTick }: { state: State | null; liveTick: number }) {
  const [project, setProject] = useState("");
  const [memberF, setMember] = useState("");
  const [type, setType] = useState("");
  const [events, setEvents] = useState<SEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const qs = (before?: string) => new URLSearchParams({ limit: "100", ...(project && { project }), ...(memberF && { member: memberF }), ...(type && { type }), ...(before && { before }) }).toString();

  const loadFirst = async () => { const r = await api<{ events: SEvent[]; next: string | null }>(`/api/timeline?${qs()}`); setEvents(r.events); setNext(r.next); };
  useEffect(() => { loadFirst().catch(() => {}); }, [project, memberF, type]);
  // live: new events arrive at the top (only refresh the first page if we haven't paged further)
  useEffect(() => { if (events.length <= 100) loadFirst().catch(() => {}); }, [liveTick]);

  const older = async () => {
    if (!next) return; setLoading(true);
    try { const r = await api<{ events: SEvent[]; next: string | null }>(`/api/timeline?${qs(next)}`); setEvents((e) => [...e, ...r.events]); setNext(r.next); } finally { setLoading(false); }
  };

  const days = new Map<string, SEvent[]>();
  for (const e of events) { const k = new Date(e.ts).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" }); days.set(k, [...(days.get(k) ?? []), e]); }
  const sel = "rounded border border-line bg-panel2 px-2 py-1 text-sm";
  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-bold">Timeline</h1>
        <select data-testid="f-project" value={project} onChange={(e) => setProject(e.target.value)} className={sel}><option value="">all projects</option>{state?.registry.projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}<option value="unattributed">unattributed</option></select>
        <select data-testid="f-member" value={memberF} onChange={(e) => setMember(e.target.value)} className={sel}><option value="">all members</option>{card.team.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}<option value="unattributed">unattributed</option></select>
        <select data-testid="f-type" value={type} onChange={(e) => setType(e.target.value)} className={sel}><option value="">all types</option>{TYPES.map((t) => <option key={t}>{t}</option>)}<option value="unattributed">unattributed</option></select>
        <span className="ml-auto text-xs text-slate-500" data-testid="tl-count">{events.length} shown</span>
      </div>
      {events.length === 0 && <p className="text-sm text-slate-500">Nothing recorded for these filters in the last 14 days.</p>}
      {[...days.entries()].map(([day, list]) => (
        <section key={day} className="mb-4">
          <h2 className="sticky top-0 bg-base/90 py-1 text-sm font-semibold text-slate-300 backdrop-blur">{day}</h2>
          <div className="space-y-0.5 border-l border-line pl-3">
            {list.map((e) => (
              <div key={e.cursor} data-cursor={e.cursor} className="flex gap-2 text-[12.5px]">
                <span className="w-20 shrink-0 font-mono text-slate-500">{new Date(e.ts).toLocaleTimeString()}</span>
                <span className="w-20 shrink-0 font-mono text-[11px] text-slate-500">{e.type}</span>
                <span className="min-w-0" style={{ color: e.agent ? SPRITES[e.agent]?.colour : "#9aa0ab" }}>{describe(e)}</span>
                <span className="ml-auto shrink-0 text-[11px] text-slate-600">{e.project ?? "unattributed"}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      {next && <button data-testid="load-older" disabled={loading} onClick={older} className="rounded bg-panel2 px-3 py-1.5 text-sm">{loading ? "Loading…" : "Load older"}</button>}
    </div>
  );
}
