import { useEffect, useMemo, useRef, useState } from "react";
import { card, lead, member, ROOM_KEYS, type RoomKey } from "../card";
import { OFFICE_MAP, OFFICE_ASPECT, PIXEL_ART, ROOM_REGIONS, ROOM_SEATS, NODES, EDGES, SPRITES, WORK_HOME, SEAT_PROBLEMS, type Pt } from "../officeAssets";
import { decide, assignSeats, route, legMs, facingFor, ago, describe, BREAK_ROOMS, FAREWELL_MS, STALE_MS, REPLAY_WINDOW_MS, type Facing, type Placement } from "../officeLogic";
import type { SEvent, State } from "../useMissionControl";

const PLAYED_KEY = "mc-farewells-played";
const loadPlayed = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]")); } catch { return new Set(); } };
const savePlayed = (s: Set<string>) => { try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...s].slice(-200))); } catch {} };

type Shown = Placement & { seat: Pt; seatId: string; farewell?: boolean; walkingOut?: boolean };

// ------------------------------------------------------------------ one character
function Character(props: {
  name: string; target: Shown; height: number; dim: boolean; ageTag: string | null; onClick: () => void; onArrive: () => void;
}) {
  const { name, target, height } = props;
  const sprite = SPRITES[name];
  const [pos, setPos] = useState<Pt>(target.seat);
  const [ms, setMs] = useState(0);
  const [facing, setFacing] = useState<Facing>("front");
  const [moving, setMoving] = useState(false);
  const at = useRef<{ room?: RoomKey; node?: string }>({ room: target.room });
  const cur = useRef<Pt>(target.seat);
  const legEnd = useRef(0);
  const gen = useRef(0);
  const timers = useRef<number[]>([]);
  const first = useRef(true);
  const onArrive = useRef(props.onArrive);
  onArrive.current = props.onArrive;

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const g = ++gen.current;
    timers.current.forEach(clearTimeout); timers.current = [];
    const start = () => {
      if (g !== gen.current) return;
      const pts = route(at.current, { room: target.room, seat: target.seat });
      let i = 0;
      const step = () => {
        if (g !== gen.current) return;
        if (i >= pts.length) { setMoving(false); setFacing("front"); setMs(0); at.current = { room: target.room }; onArrive.current(); return; }
        const next = pts[i++];
        const d = legMs(cur.current, next);
        setFacing(facingFor(cur.current, next));
        setMoving(true); setMs(d); setPos({ x: next.x, y: next.y });
        cur.current = { x: next.x, y: next.y };
        at.current = next.node ? { node: next.node } : { room: target.room };
        legEnd.current = Date.now() + d;
        timers.current.push(window.setTimeout(step, d));
      };
      step();
    };
    // let the current leg finish (it is already sliding there), then re-plan from where it ends
    const wait = Math.max(0, legEnd.current - Date.now());
    if (wait) timers.current.push(window.setTimeout(start, wait)); else start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.room, target.seatId, target.seat.x, target.seat.y]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const src = facing === "back" ? sprite.back : facing === "front" ? sprite.front : sprite.side;
  const bubble = target.bubble;
  const opacity = target.walkingOut && moving ? 0.72 : props.dim ? 0.55 : 1;
  return (
    <div data-agent={name} data-room={target.room} data-facing={facing} data-moving={moving ? "1" : "0"}
      className="absolute cursor-pointer" onClick={props.onClick}
      style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -100%)", zIndex: Math.round(pos.y * 10),
        transition: `left ${ms}ms linear, top ${ms}ms linear, opacity 300ms`, opacity, filter: props.dim ? "saturate(0.5)" : undefined }}>
      {bubble ? (
        <div key={bubble} className="absolute bottom-full mb-1 w-max max-w-[220px] rounded-md border-2 bg-[#11131a]/95 px-2 py-1 text-[11px] leading-snug text-slate-100 shadow-lg"
          style={{ borderColor: sprite.colour, animation: "pop 160ms ease-out",
            // keep bubbles on the map near its edges
            ...(pos.x < 14 ? { left: 0 } : pos.x > 86 ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" }) }}>{bubble}</div>
      ) : target.resting && !moving ? <div className="absolute bottom-full left-1/2 -translate-x-1/2 text-sm">☕</div> : null}
      {target.badge && <div className={`absolute -right-1 top-0 z-10 flex h-5 w-5 items-center justify-center rounded-full text-xs font-black text-black ${target.badge === "amber" ? "bg-amber-400" : "bg-rose-500 text-white"}`}>!</div>}
      {props.ageTag && <div className="absolute -left-2 top-1 rounded bg-black/70 px-1 text-[10px] text-amber-300">{props.ageTag}</div>}
      <img src={src} alt={name} draggable={false}
        style={{ height, width: height, imageRendering: PIXEL_ART ? "pixelated" : "auto", transform: facing === "side-right" ? "scaleX(-1)" : undefined,
          animation: moving ? "none" : "bob 2.4s ease-in-out infinite", filter: "drop-shadow(0 3px 2px rgba(0,0,0,.55))" }} />
      <div className="pointer-events-none absolute left-1/2 top-full -translate-x-1/2 -translate-y-1 whitespace-nowrap rounded bg-black/60 px-1 text-[10px] font-semibold" style={{ color: sprite.colour }}>{name}</div>
    </div>
  );
}

// ------------------------------------------------------------------ debug overlay (?overlay=1): seats, owners, door/corridor graph
const overlay = typeof location !== "undefined" && new URLSearchParams(location.search).has("overlay");
function Overlay() {
  const owner = Object.fromEntries(Object.entries(WORK_HOME).map(([n, s]) => [s.id, n]));
  return (
    <div className="pointer-events-none absolute inset-0 z-[900]">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {EDGES.map(([a, b], i) => NODES[a] && NODES[b] ? <line key={i} x1={NODES[a].x} y1={NODES[a].y} x2={NODES[b].x} y2={NODES[b].y} stroke="#facc15" strokeWidth={3} vectorEffect="non-scaling-stroke" /> : null)}
      </svg>
      {Object.entries(NODES).map(([id, p]) => <span key={id} className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-yellow-400 px-1 text-[9px] font-bold text-black" style={{ left: `${p.x}%`, top: `${p.y}%` }}>{id}</span>)}
      {Object.values(ROOM_SEATS).flat().map((s) => (
        <span key={s.id} className="absolute -translate-x-1/2 -translate-y-1/2 rounded px-1 text-[9px] font-bold" style={{ left: `${s.x}%`, top: `${s.y}%`, background: owner[s.id] ? SPRITES[owner[s.id]].colour : "#34d399", color: "#000" }}>{owner[s.id] ?? s.id}</span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ the office
export default function Office({ state, events }: { state: State | null; events: SEvent[] }) {
  const data = state?.active ?? null;
  const lit = !!state?.telemetry.liveSession;
  const [now, setNow] = useState(Date.now());
  const [demo, setDemo] = useState(false);
  const [demoRooms, setDemoRooms] = useState<Record<string, RoomKey>>({});
  const [wander, setWander] = useState<Record<string, number>>({});
  const [farewell, setFarewell] = useState<Record<string, number>>({}); // name → ends at
  const [walkingOut, setWalkingOut] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverRoom, setHoverRoom] = useState<string | null>(null);
  const played = useRef<Set<string>>(loadPlayed());
  const prevSeats = useRef<Record<string, { room: RoomKey; seatId: string }>>({});
  const floor = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  // fit the 4:3 floor inside the space we have (CSS aspect-ratio + max-height would squash it)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      const { width: aw, height: ah } = e.contentRect;
      const w = Math.max(200, Math.min(aw, ah * OFFICE_ASPECT));
      setSize({ w, h: w / OFFICE_ASPECT }); setWidth(w);
    });
    if (area.current) ro.observe(area.current);
    return () => ro.disconnect();
  }, []);

  // resting members wander between break seats every few seconds
  useEffect(() => {
    const iv = setInterval(() => {
      const names = card.team.map((m) => m.name).filter((n) => n !== lead.name);
      const n = names[Math.floor(Math.random() * names.length)];
      setWander((w) => ({ ...w, [n]: (w[n] ?? 0) + 1 }));
    }, 6000);
    return () => clearInterval(iv);
  }, []);

  // DEMO: clearly labelled; random rooms
  useEffect(() => {
    if (!demo) { setDemoRooms({}); return; }
    const shuffle = () => setDemoRooms(Object.fromEntries(card.team.map((m) => [m.name, ROOM_KEYS[Math.floor(Math.random() * ROOM_KEYS.length)]])));
    shuffle();
    const iv = setInterval(() => {
      const m = card.team[Math.floor(Math.random() * card.team.length)];
      setDemoRooms((r) => ({ ...r, [m.name]: ROOM_KEYS[Math.floor(Math.random() * ROOM_KEYS.length)] }));
    }, 2500);
    return () => clearInterval(iv);
  }, [demo]);

  // completions: closing line at the desk for ~2.4 s, then walk out — but never replay on reload
  const agents = data?.agents.agents ?? {};
  useEffect(() => {
    for (const m of card.team) {
      const a = agents[m.name];
      if (a?.state !== "completed" || !a.since) continue;
      const key = `${data?.slug}|${m.name}|${a.since}`;
      if (played.current.has(key)) continue;
      played.current.add(key); savePlayed(played.current);
      if (Date.now() - Date.parse(a.since) > REPLAY_WINDOW_MS) continue; // old news: settle straight into the break room
      if (m.name === lead.name) continue;
      setFarewell((f) => ({ ...f, [m.name]: Date.now() + FAREWELL_MS }));
      setTimeout(() => { setFarewell((f) => { const { [m.name]: _, ...rest } = f; return rest; }); setWalkingOut((w) => ({ ...w, [m.name]: true })); }, FAREWELL_MS);
    }
  }, [agents, data?.slug]);

  const placements: Record<string, Placement & { farewell?: boolean }> = useMemo(() => {
    const out: Record<string, Placement & { farewell?: boolean }> = {};
    card.team.forEach((m, i) => {
      if (demo) { const r = demoRooms[m.name] ?? "lounge"; out[m.name] = { room: r, reason: "DEMO", working: r === WORK_HOME[m.name]?.room, resting: BREAK_ROOMS.includes(r), bubble: null }; return; }
      if (farewell[m.name]) { out[m.name] = { room: (WORK_HOME[m.name]?.room ?? m.worksIn) as RoomKey, reason: "finishing", working: false, resting: false, bubble: agents[m.name]?.say ?? "done", farewell: true }; return; }
      const p = decide(m.name, data, state?.spawnQueue ?? {}, now);
      if (p.resting && BREAK_ROOMS.includes(p.room) && !agents[m.name]?.intendedRoom) p.room = BREAK_ROOMS[((wander[m.name] ?? 0) + i) % 2];
      out[m.name] = p;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, demoRooms, farewell, data, state?.spawnQueue, wander, Math.floor(now / 15000)]);

  const shown: Record<string, Shown> = useMemo(() => {
    const seats = assignSeats(Object.fromEntries(Object.entries(placements).map(([n, p]) => [n, p.room])), prevSeats.current, wander);
    prevSeats.current = Object.fromEntries(Object.entries(seats).map(([n, s]) => [n, { room: s.room, seatId: s.seatId }]));
    return Object.fromEntries(Object.entries(placements).map(([n, p]) => [n, { ...p, ...seats[n], walkingOut: !!walkingOut[n] }]));
  }, [placements, wander, walkingOut]);

  const charHeight = Math.round(Math.max(52, Math.min(100, width * 0.075)));
  const ticker = events.filter((e) => !(e.type === "done" && e.payload?.phantom)).slice(-7).reverse();
  const sel = selected ? member(selected) : null;

  return (
    <div className="flex h-full min-h-0 gap-3 p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded px-2 py-0.5 font-semibold ${lit ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/40 text-slate-400"}`}>{lit ? "● lights on — Claude session live" : "○ lights off — no live Claude session"}</span>
          {SEAT_PROBLEMS.length > 0 && <span className="rounded bg-rose-500/20 px-2 py-0.5 text-rose-300">{SEAT_PROBLEMS.join(" · ")}</span>}
          <span className="ml-auto" />
          <label className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 font-bold ${demo ? "bg-fuchsia-600 text-white" : "bg-panel2 text-slate-400"}`}>
            <input data-testid="demo" type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> DEMO {demo && "— simulated, not real work"}
          </label>
        </div>
        <div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center">
          <div ref={floor} data-testid="office" className="relative rounded-lg border border-line" style={size ? { width: size.w, height: size.h } : { width: "100%", aspectRatio: `${OFFICE_ASPECT}` }}>
            <img src={OFFICE_MAP} draggable={false} className="absolute inset-0 h-full w-full"
              style={{ imageRendering: PIXEL_ART ? "pixelated" : "auto", filter: lit || demo ? "none" : "brightness(0.28) saturate(0.4)", transition: "filter 700ms" }} />
            {ROOM_KEYS.map((k) => { const r = ROOM_REGIONS[k]; if (!r) return null; return (
              <div key={k} className="absolute" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }} onMouseEnter={() => setHoverRoom(k)} onMouseLeave={() => setHoverRoom(null)}>
                <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-slate-200 transition-opacity duration-200" style={{ opacity: hoverRoom === k ? 1 : 0 }}>{card.rooms[k]}</span>
              </div>); })}
            {state && card.team.map((m) => { // wait for the first real state so nobody "walks in" on page load
              const t = shown[m.name]; if (!t) return null;
              const a = agents[m.name];
              const hb = Date.parse(a?.heartbeat || a?.since || "");
              const stale = !demo && t.working && !Number.isNaN(hb) && now - hb > STALE_MS;
              return <Character key={m.name} name={m.name} target={t} height={charHeight} dim={stale} ageTag={stale ? ago(a?.heartbeat || a?.since, now) : null}
                onClick={() => setSelected(m.name)} onArrive={() => walkingOut[m.name] && setWalkingOut((w) => ({ ...w, [m.name]: false }))} />;
            })}
            {overlay && <Overlay />}
            {!data && !demo && (
              <div className="absolute inset-x-0 top-3 mx-auto w-max rounded-lg border border-amber-500/40 bg-black/75 px-4 py-2 text-sm text-amber-200">No project loaded — open <b>Projects</b> to load or create one.</div>
            )}
          </div>
        </div>
        <div data-testid="ticker" className="h-[118px] shrink-0 overflow-hidden rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[11.5px]">
          {ticker.length === 0 && <div className="text-slate-500">No events yet. Start Claude in the terminal below — real work shows up here.</div>}
          {ticker.map((e) => (
            <div key={e.cursor} className="truncate">
              <span className="text-slate-500">{new Date(e.ts).toLocaleTimeString()} </span>
              <span style={{ color: e.agent ? SPRITES[e.agent]?.colour : "#8b919c" }}>{describe(e)}</span>
              {!e.project && <span className="text-slate-600"> · unattributed</span>}
            </div>
          ))}
        </div>
      </div>

      {/* roster */}
      <aside data-testid="roster" className="w-64 shrink-0 space-y-1.5 overflow-auto">
        {card.team.map((m) => {
          const a = agents[m.name]; const t = shown[m.name];
          const dot = t?.badge === "red" ? "bg-rose-500" : t?.working ? "bg-emerald-400" : t?.badge === "amber" ? "bg-amber-400" : a?.state === "completed" ? "bg-sky-400" : "bg-slate-500";
          return (
            <button key={m.name} onClick={() => setSelected(m.name)} className="flex w-full items-center gap-2 rounded-lg border border-line bg-panel p-2 text-left hover:border-accent/60">
              <img src={SPRITES[m.name].portrait} className="h-10 w-10 rounded bg-panel2" style={{ imageRendering: PIXEL_ART ? "pixelated" : "auto" }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold"><span className={`h-2 w-2 rounded-full ${dot}`} /><span style={{ color: SPRITES[m.name].colour }}>{m.name}</span><span className="truncate text-xs font-normal text-slate-500">{m.role}</span></div>
                <div className="truncate text-xs text-slate-400">{t?.working ? (a?.task || t.bubble || "working") : t?.reason}</div>
                <div className="text-[10px] text-slate-600">{a?.since ? `${a.state ?? ""} · ${ago(a.since, now)} ago` : "no activity yet"} · {t ? card.rooms[t.room] : ""}</div>
              </div>
            </button>
          );
        })}
      </aside>

      {sel && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4" onClick={() => setSelected(null)}>
          <div data-testid="agent-modal" className="max-h-full w-[640px] max-w-full overflow-auto rounded-xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-4">
              <img src={SPRITES[sel.name].portraitLarge} className="h-40 w-40 rounded-lg bg-panel2" style={{ imageRendering: PIXEL_ART ? "pixelated" : "auto", border: `2px solid ${SPRITES[sel.name].colour}` }} />
              <div className="min-w-0 flex-1">
                <div className="text-xl font-bold" style={{ color: SPRITES[sel.name].colour }}>{sel.name}</div>
                <div className="text-sm text-slate-300">{sel.role}{sel.name === lead.name ? " · main Claude session" : " · subagent"}</div>
                <div className="mt-1 text-xs text-slate-500">{sel.character}</div>
                <div className="mt-3 text-sm"><b>Status:</b> {agents[sel.name]?.state ?? "idle"} — {shown[sel.name]?.reason}</div>
                <div className="text-sm"><b>Task:</b> {agents[sel.name]?.task || "—"}</div>
                {agents[sel.name]?.say && <div className="text-sm"><b>Last said:</b> “{agents[sel.name]?.say}”</div>}
              </div>
              <button onClick={() => setSelected(null)} className="self-start text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="mt-4 flex gap-3">
              {(["front", "side", "back"] as const).map((p) => <img key={p} src={SPRITES[sel.name][p]} title={p} className="h-24 w-24 rounded bg-panel2" style={{ imageRendering: PIXEL_ART ? "pixelated" : "auto" }} />)}
            </div>
            <h3 className="mt-4 mb-1 text-sm font-semibold">Last 10 events</h3>
            <div className="space-y-0.5 font-mono text-xs">
              {events.filter((e) => e.agent === sel.name).slice(-10).reverse().map((e) => <div key={e.cursor}><span className="text-slate-500">{new Date(e.ts).toLocaleString()} </span>{describe(e)}</div>)}
              {!events.some((e) => e.agent === sel.name) && <div className="text-slate-500">No events in the last two days.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
