// Tasks, Decisions and Brief tabs — all live (SSE-driven) or actionable.
import { useEffect, useState } from "react";
import { member } from "../card";
import { SPRITES, PIXEL_ART } from "../officeAssets";
import { api, type State, type Task } from "../useMissionControl";

const COLS = [["planned", "Planned"], ["in-progress", "In progress"], ["review", "Review"], ["blocked", "Blocked"], ["done", "Done"]] as const;
const norm = (s?: string) => (s ?? "planned").toLowerCase().replace(/[\s_]+/g, "-");
const NoProject = () => <p className="p-6 text-sm text-slate-400">No project loaded — open <b>Projects</b> first.</p>;

export function Tasks({ state }: { state: State | null }) {
  const d = state?.active;
  if (!d) return <NoProject />;
  const tasks = d.tasks.tasks ?? [];
  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {COLS.map(([k, label]) => {
        const list = tasks.filter((t) => (norm(t.status) === k) || (k === "planned" && !COLS.some(([c]) => c === norm(t.status))));
        return (
          <div key={k} data-testid={`col-${k}`} className="flex w-64 shrink-0 flex-col rounded-lg border border-line bg-panel">
            <div className="border-b border-line px-3 py-2 text-sm font-semibold">{label} <span className="text-slate-500">{list.length}</span></div>
            <div className="space-y-2 overflow-auto p-2">{list.map((t) => <TaskCard key={t.id} t={t} />)}</div>
          </div>
        );
      })}
      {tasks.length === 0 && <p className="text-sm text-slate-400">No tasks yet — they appear when you approve a plan.</p>}
    </div>
  );
}
function TaskCard({ t }: { t: Task }) {
  const s = SPRITES[t.owner];
  return (
    <div className="rounded border border-line bg-panel2 p-2 text-sm">
      <div className="flex items-start gap-2">
        {s && <img src={s.portrait} className="h-7 w-7 rounded" style={{ imageRendering: PIXEL_ART ? "pixelated" : "auto" }} />}
        <div className="min-w-0 flex-1"><div>{t.title}</div><div className="text-xs" style={{ color: s?.colour }}>{t.owner}{!member(t.owner) && " (not on card)"} · <span className="font-mono text-slate-500">{t.id}</span></div></div>
      </div>
      {norm(t.status) === "done" && <div className={`mt-1 text-xs font-semibold ${t.verified ? "text-emerald-400" : "text-amber-300"}`}>{t.verified ? "✓ verified" : "⚠ unverified"}</div>}
    </div>
  );
}

export function Decisions({ state }: { state: State | null }) {
  const d = state?.active;
  if (!d) return <NoProject />;
  const pending = [
    ...(d.plan?.status === "awaiting-approval" ? [{ key: "plan", title: `📋 Plan: ${d.plan.title}`, sub: "awaiting your approval", ts: "" }] : []),
    ...d.approvals.approvals.filter((a) => a.status === "pending").map((a) => ({ key: a.id, title: `🔔 ${a.title}`, sub: `${a.risk} risk · ${a.reason}`, ts: a.createdAt })),
  ];
  const decided = [...d.decisions.decisions].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  const colour = (x: string) => (/approv/.test(x) ? "text-emerald-400" : /reject/.test(x) ? "text-rose-400" : "text-amber-300");
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-lg font-bold">Decisions</h1>
      <section>
        <h2 className="mb-1 text-sm font-semibold text-amber-300">Pending ({pending.length})</h2>
        {pending.length === 0 && <p className="text-sm text-slate-500">Nothing waiting for you.</p>}
        {pending.map((p) => <div key={p.key} className="mb-1 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-sm"><b>{p.title}</b><div className="text-xs text-slate-400">{p.sub}{p.ts && ` · ${new Date(p.ts).toLocaleString()}`} — decide it in the Needs-You bar</div></div>)}
      </section>
      <section>
        <h2 className="mb-1 text-sm font-semibold">History</h2>
        {decided.length === 0 && <p className="text-sm text-slate-500">No decisions yet.</p>}
        {decided.map((x, i) => (
          <div key={i} className="mb-1 rounded border border-line bg-panel p-2 text-sm">
            <div><span className={`font-semibold ${colour(x.decision)}`}>{x.decision}</span> · {x.kind === "plan" ? "📋" : "🔔"} {x.title} <span className="font-mono text-[10px] text-slate-500">{x.ref}</span></div>
            <div className="text-xs text-slate-500">{new Date(x.ts).toLocaleString()}{x.note && <> — “{x.note}”</>}</div>
          </div>
        ))}
      </section>
    </div>
  );
}

/** Phase from tasks: some not done → executing; all done but not all verified → validation; all done and verified → ready. No tasks → no chip. */
export function phase(tasks: Task[]): "executing" | "validation" | "ready" | null {
  if (!tasks.length) return null;
  if (tasks.some((t) => norm(t.status) !== "done")) return "executing";
  if (tasks.some((t) => !t.verified)) return "validation";
  return "ready";
}

export function Brief({ state, onNotice }: { state: State | null; onNotice: (s: string) => void }) {
  const d = state?.active;
  const [text, setText] = useState("");
  const [readme, setReadme] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(d?.mission?.summary ?? ""); }, [d?.mission?.summary, editing]);
  useEffect(() => { if (d) api<{ text: string }>(`/api/projects/${d.slug}/readme`).then((r) => setReadme(r.text)).catch(() => {}); }, [d?.slug]);
  if (!d) return <NoProject />;
  const p = phase(d.tasks.tasks ?? []);
  const project = state?.registry.projects.find((x) => x.slug === d.slug);
  const chip = p === "ready" ? "bg-emerald-600" : p === "validation" ? "bg-amber-600" : "bg-sky-600";
  const save = async () => { try { await api(`/api/projects/${d.slug}/mission`, { summary: text }); setEditing(false); onNotice("Brief saved"); } catch (e: any) { onNotice(e.message); } };
  const done = (d.tasks.tasks ?? []).filter((t) => norm(t.status) === "done").length;
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold">{project?.name ?? d.slug}</h1>
        {p && <span data-testid="phase" className={`rounded px-2 py-0.5 text-xs font-bold uppercase text-white ${chip}`}>{p}</span>}
        <span className="text-xs text-slate-500">{done}/{d.tasks.tasks.length} tasks done</span>
      </div>
      <div className="font-mono text-xs text-slate-500">{project?.path}</div>
      <div className="rounded-lg border border-line bg-panel p-3">
        <div className="mb-2 flex items-center"><h2 className="text-sm font-semibold">One-page summary</h2><span className="ml-auto" />
          {editing ? <><button onClick={save} className="rounded bg-accent px-2 py-1 text-xs font-semibold text-white">Save</button><button onClick={() => setEditing(false)} className="ml-1 rounded bg-panel2 px-2 py-1 text-xs">Cancel</button></>
            : <button onClick={() => setEditing(true)} className="rounded bg-panel2 px-2 py-1 text-xs">Edit</button>}
        </div>
        {editing ? <textarea value={text} onChange={(e) => setText(e.target.value)} className="h-64 w-full rounded border border-line bg-panel2 p-2 text-sm" placeholder="Goal, users, constraints, what 'done' means…" />
          : text ? <p className="whitespace-pre-wrap text-sm text-slate-200">{text}</p> : <p className="text-sm text-slate-500">No summary yet. Click Edit, or ask the lead to write .satoru/projects/{d.slug}/mission.json.</p>}
        {d.mission?.updatedAt && !editing && <p className="mt-2 text-[10px] text-slate-600">updated {new Date(d.mission.updatedAt).toLocaleString()}</p>}
      </div>
      {readme && <details className="rounded-lg border border-line bg-panel p-3"><summary className="cursor-pointer text-sm font-semibold">README.md</summary><pre className="mt-2 whitespace-pre-wrap text-xs text-slate-300">{readme}</pre></details>}
    </div>
  );
}
