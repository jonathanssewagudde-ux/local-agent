import { useEffect, useRef, useState } from "react";
import { card, lead } from "./card";
import { SPRITES, PIXEL_ART } from "./officeAssets";
import { useMissionControl } from "./useMissionControl";
import Terminal from "./components/Terminal";
import NeedsYouBar, { PlanModal, useNotice } from "./components/NeedsYou";
import Office from "./screens/Office";
import Projects from "./screens/Projects";
import { Tasks, Decisions, Brief, phase } from "./screens/Boards";
import Timeline from "./screens/Timeline";

const TABS = ["Office", "Projects", "Tasks", "Decisions", "Brief", "Timeline"] as const;
type Tab = (typeof TABS)[number];
const ICON: Record<Tab, string> = { Office: "🏢", Projects: "📁", Tasks: "🗂", Decisions: "⚖", Brief: "📄", Timeline: "🕒" };
const store = { get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} } };

export default function App() {
  const { state, events, terminal, connected, error } = useMissionControl();
  const [tab, setTab] = useState<Tab>(() => (TABS.includes(store.get("mc-tab", "Office") as Tab) ? (store.get("mc-tab", "Office") as Tab) : "Office"));
  const [dock, setDock] = useState(() => store.get("mc-dock", "open") === "open");
  const [dockH, setDockH] = useState(() => Number(store.get("mc-dock-h", "260")) || 260);
  const [notice, setNotice] = useNotice();
  const [sweep, setSweep] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [pillOpen, setPillOpen] = useState(false);
  const prevActive = useRef<string | null | undefined>(undefined);

  useEffect(() => store.set("mc-tab", tab), [tab]);
  useEffect(() => store.set("mc-dock", dock ? "open" : "closed"), [dock]);
  useEffect(() => store.set("mc-dock-h", String(dockH)), [dockH]);

  const active = state?.active ?? null;
  const project = state?.registry.projects.find((p) => p.slug === state?.config.activeProject) ?? null;
  // project changed → lights-off → lights-on sweep + toast
  useEffect(() => {
    const slug = state?.config.activeProject;
    if (state && prevActive.current !== undefined && prevActive.current !== slug && project) {
      setSweep((s) => s + 1); setToast(`Now working on ${project.name}`);
      const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t);
    }
    if (state) prevActive.current = slug;
  }, [state?.config.activeProject, project?.name]);

  const plan = active?.plan;
  const ph = phase(active?.tasks.tasks ?? []);
  const lit = !!state?.telemetry.liveSession;

  const startDrag = (e: React.MouseEvent) => {
    const y0 = e.clientY, h0 = dockH;
    const mv = (ev: MouseEvent) => setDockH(Math.max(140, Math.min(window.innerHeight - 200, h0 + (y0 - ev.clientY))));
    const up = () => { removeEventListener("mousemove", mv); removeEventListener("mouseup", up); };
    addEventListener("mousemove", mv); addEventListener("mouseup", up);
  };

  return (
    <div className="flex h-full">
      <nav className="flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-3">
        <img src="/assets/icon_64.png" alt="" className="mb-2 h-10 w-10" style={{ imageRendering: PIXEL_ART ? "pixelated" : "auto" }} onError={(e) => (e.currentTarget.style.display = "none")} />
        {TABS.map((t) => (
          <button key={t} data-tab={t} onClick={() => setTab(t)} className={`flex w-16 flex-col items-center rounded-lg py-2 text-[10px] ${tab === t ? "bg-accent/20 text-white" : "text-slate-400 hover:bg-panel2"}`}>
            <span className="text-lg leading-none">{ICON[t]}</span>{t}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* HUD */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
          <h1 data-testid="app-name" className="font-bold tracking-wide" style={{ color: card.uiAccent }}>{card.appName}</h1>
          <span data-testid="working-on" className="text-sm text-slate-300">{project ? <>working on <b>{project.name}</b></> : <span className="text-amber-300">no project loaded</span>}</span>
          {ph && <span className="rounded bg-panel2 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-300">{ph}</span>}
          {plan && plan.status !== "awaiting-approval" && (
            <button data-testid="plan-pill" onClick={() => setPillOpen(true)} className={`max-w-[280px] truncate rounded-full px-3 py-0.5 text-xs ${plan.status === "approved" ? "bg-emerald-600/25 text-emerald-200" : plan.status === "rejected" ? "bg-rose-600/25 text-rose-200" : "bg-amber-600/25 text-amber-200"}`}>📋 {plan.title} · {plan.status}</button>
          )}
          <span className="ml-auto" />
          <span className="flex items-center gap-1.5 text-xs text-slate-400" title="Lights come on when a real Claude session starts">
            <img src={SPRITES[lead.name]?.portrait} className="h-6 w-6 rounded" style={{ imageRendering: PIXEL_ART ? "pixelated" : "auto", opacity: lit ? 1 : 0.4 }} />
            {lit ? "session live" : "no session"}
          </span>
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-500"}`} title={connected ? "daemon connected" : "daemon not reachable"} />
        </header>
        {!connected && error && <div className="border-b border-rose-500/40 bg-rose-500/10 px-4 py-1.5 text-sm text-rose-200">Can't reach the daemon on port 4317 — is the server running? ({error})</div>}
        <NeedsYouBar state={state} onNotice={setNotice} />
        <main className="relative min-h-0 flex-1 overflow-auto">
          {tab === "Office" && <Office state={state} events={events} />}
          {tab === "Projects" && <Projects state={state} terminal={terminal} onSwitched={() => {}} onNotice={setNotice} />}
          {tab === "Tasks" && <Tasks state={state} />}
          {tab === "Decisions" && <Decisions state={state} />}
          {tab === "Brief" && <Brief state={state} onNotice={setNotice} />}
          {tab === "Timeline" && <Timeline state={state} liveTick={events.length ? events[events.length - 1].t : 0} />}
          {sweep > 0 && <div key={sweep} className="pointer-events-none absolute inset-0 z-[1000] bg-black" style={{ animation: "sweep 900ms ease-out forwards" }} />}
        </main>
        {/* terminal dock — always mounted so the session survives tab switches */}
        <div className="shrink-0 border-t border-line bg-[#0b0d12]" style={{ height: dock ? dockH : 32 }}>
          <div className="flex h-8 cursor-row-resize items-center gap-2 border-b border-line px-3 text-xs text-slate-400" onMouseDown={dock ? startDrag : undefined}>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setDock((d) => !d)} className="rounded bg-panel2 px-2 py-0.5">{dock ? "▾ hide terminal" : "▸ terminal"}</button>
            <span>{terminal.claudeRunning ? <span className="text-emerald-400">claude is running</span> : "claude not running"}</span>
          </div>
          <div className="h-[calc(100%-32px)]" style={{ display: dock ? "block" : "none" }}><Terminal open={dock} claudeRunning={terminal.claudeRunning} /></div>
        </div>
      </div>
      {notice && <div data-testid="notice" className="fixed bottom-6 left-1/2 z-[4000] rounded-lg border border-line bg-panel2 px-4 py-2 text-sm shadow-xl" style={{ animation: "toast-in 200ms ease-out", transform: "translateX(-50%)" }}>{notice}</div>}
      {toast && <div className="fixed top-16 left-1/2 z-[4000] rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-xl" style={{ animation: "toast-in 200ms ease-out", transform: "translateX(-50%)" }}>{toast}</div>}
      {pillOpen && plan && active && <PlanModal slug={active.slug} plan={plan} onClose={() => setPillOpen(false)} onNotice={setNotice} />}
    </div>
  );
}
