import { useEffect, useRef, useState } from "react";
import { lead, isMember } from "../card";
import { SPRITES, PIXEL_ART } from "../officeAssets";
import { api, type Approval, type Plan, type State } from "../useMissionControl";

const STALL_MS = 20 * 60e3;

function beep() {
  try {
    const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.06; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.15);
  } catch {}
}

export function planConflicts(plan: Plan | null) {
  const m = new Map<string, string[]>();
  for (const t of plan?.tasks ?? []) for (const f of t.files ?? []) { const k = f.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase(); m.set(k, [...(m.get(k) ?? []), t.id]); }
  return [...m.entries()].filter(([, ids]) => ids.length > 1).map(([file, tasks]) => ({ file, tasks }));
}

export function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(t); }, [notice]);
  return [notice, setNotice] as const;
}
export const relayNotice = (r: { injected?: boolean }) => (r.injected ? "Sent to the terminal ✓" : `No live terminal — tell ${lead.name} yourself.`);

export function PlanModal({ slug, plan, onClose, onNotice }: { slug: string; plan: Plan; onClose: () => void; onNotice: (s: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverConflicts, setServerConflicts] = useState<{ file: string; tasks: string[] }[] | null>(null);
  const conflicts = serverConflicts ?? planConflicts(plan);
  const badOwners = plan.tasks.filter((t) => !isMember(t.owner));
  const readOnly = plan.status !== "awaiting-approval";
  const decide = async (decision: "approve" | "changes" | "reject") => {
    setBusy(true);
    try {
      const r = await api(`/api/projects/${slug}/plan/decision`, { decision, note });
      onNotice(`Plan ${r.status}. ${relayNotice(r)}`); onClose();
    } catch (e: any) {
      if (e.status === 409 && e.body?.conflicts) setServerConflicts(e.body.conflicts);
      onNotice(`Could not save: ${e.message}`);
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div data-testid="plan-modal" className="max-h-full w-[720px] max-w-full overflow-auto rounded-xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wide text-slate-500">Plan · {plan.status}</div>
            <h2 className="text-lg font-bold">{plan.title}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        {plan.scope && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{plan.scope}</p>}
        <h3 className="mt-4 mb-1 text-sm font-semibold">Tasks</h3>
        <div className="space-y-1.5">
          {plan.tasks.map((t) => (
            <div key={t.id} className="flex items-start gap-2 rounded border border-line bg-panel2 p-2 text-sm">
              {SPRITES[t.owner] ? <img src={SPRITES[t.owner].portrait} className="h-8 w-8 rounded" style={{ imageRendering: PIXEL_ART ? "pixelated" : "auto" }} /> : <div className="h-8 w-8 rounded bg-rose-900" />}
              <div className="min-w-0 flex-1">
                <div><span className="font-mono text-xs text-slate-500">{t.id}</span> {t.title} — <b style={{ color: SPRITES[t.owner]?.colour }}>{t.owner}</b>{!isMember(t.owner) && <span className="text-rose-400"> (not on the card)</span>}</div>
                {!!t.files?.length && <div className="mt-0.5 font-mono text-[11px] text-slate-400">{t.files.join(" · ")}</div>}
              </div>
            </div>
          ))}
        </div>
        {!!plan.risks?.length && (<><h3 className="mt-4 mb-1 text-sm font-semibold">Risks</h3><ul className="list-disc pl-5 text-sm text-slate-300">{plan.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></>)}
        {conflicts.length > 0 && (
          <div data-testid="conflicts" className="mt-4 rounded border border-rose-500/50 bg-rose-500/10 p-2 text-sm text-rose-200">
            <b>File conflict — two tasks claim the same file, so this plan can't be approved:</b>
            {conflicts.map((c) => <div key={c.file} className="font-mono text-xs">{c.file} ← {c.tasks.join(", ")}</div>)}
          </div>
        )}
        {readOnly ? (
          <p className="mt-4 text-sm text-slate-400">Decided {plan.decidedAt ? new Date(plan.decidedAt).toLocaleString() : ""}{plan.note ? ` — “${plan.note}”` : ""}</p>
        ) : (
          <>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (required context for 'Request changes')" className="mt-4 h-16 w-full rounded border border-line bg-panel2 p-2 text-sm" />
            <div className="mt-2 flex gap-2">
              <button data-testid="approve-plan" disabled={busy || conflicts.length > 0 || badOwners.length > 0} onClick={() => decide("approve")} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Approve & start</button>
              <button disabled={busy || !note.trim()} onClick={() => decide("changes")} className="rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40" title={note.trim() ? "" : "Write a note first"}>Request changes</button>
              <button disabled={busy} onClick={() => decide("reject")} className="rounded bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Reject</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ApprovalCard({ slug, a, onNotice }: { slug: string; a: Approval; onNotice: (s: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (decision: "approve" | "reject" | "discuss") => {
    setBusy(true);
    try { const r = await api(`/api/projects/${slug}/approvals/${a.id}`, { decision, note }); onNotice(`${a.id} ${decision}d. ${relayNotice(r)}`); }
    catch (e: any) { onNotice(`Could not save: ${e.message}`); } finally { setBusy(false); }
  };
  const risk = a.risk === "high" ? "bg-rose-600" : a.risk === "med" ? "bg-amber-600" : "bg-emerald-700";
  return (
    <div data-testid={`approval-${a.id}`} className="rounded-lg border border-line bg-panel2 p-2.5 text-sm">
      <div className="flex items-center gap-2"><span className={`rounded px-1.5 text-[10px] font-bold uppercase text-white ${risk}`}>{a.risk}</span><b>🔔 {a.title}</b><span className="font-mono text-[10px] text-slate-500">{a.id}</span></div>
      <div className="mt-0.5 text-xs text-slate-400">{a.reason}</div>
      <div className="mt-2 flex gap-1.5">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" className="min-w-0 flex-1 rounded border border-line bg-panel px-2 py-1 text-xs" />
        <button disabled={busy} onClick={() => go("approve")} className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">Approve</button>
        <button disabled={busy} onClick={() => go("reject")} className="rounded bg-rose-700 px-2 py-1 text-xs font-semibold text-white">Reject</button>
        <button disabled={busy} onClick={() => go("discuss")} className="rounded bg-slate-600 px-2 py-1 text-xs font-semibold text-white">Discuss</button>
      </div>
    </div>
  );
}

/** Shown ONLY when something is waiting for me. Pulses; beeps once when the count grows. */
export default function NeedsYouBar({ state, onNotice }: { state: State | null; onNotice: (s: string) => void }) {
  const d = state?.active;
  const [open, setOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const last = useRef<number | null>(null);
  const plan = d?.plan?.status === "awaiting-approval" ? d.plan : null;
  const approvals = (d?.approvals.approvals ?? []).filter((a) => a.status === "pending");
  const now = Date.now();
  const alerts = (d?.tasks.tasks ?? []).flatMap((t) => {
    const s = (t.status ?? "").toLowerCase().replace(/[\s_]+/g, "-");
    if (s === "blocked") return [{ t, kind: "blocked" }];
    if (s === "in-progress" && t.updatedAt && now - Date.parse(t.updatedAt) > STALL_MS) return [{ t, kind: "stalled" }];
    return [];
  });
  const count = (plan ? 1 : 0) + approvals.length + alerts.length;
  useEffect(() => {
    if (last.current !== null && count > last.current) beep();
    last.current = count;
  }, [count]);
  if (!d || count === 0) return null;
  return (
    <>
      <div data-testid="needs-you" className="relative z-[1500] border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5" style={{ animation: "pulse-bar 2s infinite" }}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <b className="text-amber-300">Needs you ({count})</b>
          {plan && <button data-testid="open-plan" onClick={() => setPlanOpen(true)} className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-black">📋 Plan: {plan.title}</button>}
          {approvals.length > 0 && <button onClick={() => setOpen((o) => !o)} className="rounded bg-amber-600/80 px-2 py-0.5 text-xs font-bold text-white">🔔 {approvals.length} approval{approvals.length > 1 ? "s" : ""}</button>}
          {alerts.map(({ t, kind }) => <span key={t.id} className={`rounded px-2 py-0.5 text-xs ${kind === "blocked" ? "bg-rose-600/80 text-white" : "bg-slate-600 text-white"}`}>{kind === "blocked" ? "⛔ blocked" : "⏳ stalled"}: {t.title} ({t.owner})</span>)}
        </div>
        {open && approvals.length > 0 && <div className="mt-2 grid gap-2 md:grid-cols-2">{approvals.map((a) => <ApprovalCard key={a.id} slug={d.slug} a={a} onNotice={onNotice} />)}</div>}
      </div>
      {planOpen && plan && <PlanModal slug={d.slug} plan={plan} onClose={() => setPlanOpen(false)} onNotice={onNotice} />}
    </>
  );
}
