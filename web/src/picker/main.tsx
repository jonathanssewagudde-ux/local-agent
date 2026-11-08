// Dev-only click-to-map tool: tell the app where rooms, seats, doors and corridor junctions are on the office map.
// Everything is stored as PERCENTAGES of the image (1 decimal), so it works at any display size.
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { card, ROOM_KEYS, type RoomKey } from "../card";
import initial from "../office-coordinates.json";

type Room = { x: number; y: number; w: number; h: number };
type Seat = { id: string; room: string; x: number; y: number; work?: boolean };
type Door = { id: string; room: string; x: number; y: number };
type Node = { id: string; x: number; y: number };
type Coords = { image?: { width: number; height: number }; rooms: Partial<Record<RoomKey, Room>>; seats: Seat[]; doors: Door[]; nodes: Node[]; edges: [string, string][] };
type Mode = "room" | "seat" | "door" | "node" | "connect" | "delete";

const MAP = "/assets/office/office_full_map.png";
const r1 = (v: number) => Math.round(v * 10) / 10;
const clone = (c: Coords): Coords => JSON.parse(JSON.stringify(c));

function roomAt(c: Coords, x: number, y: number): RoomKey | null {
  for (const k of ROOM_KEYS) { const r = c.rooms[k]; if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return k; }
  return null;
}
function pointById(c: Coords, id: string) { return c.doors.find((d) => d.id === id) ?? c.nodes.find((n) => n.id === id) ?? null; }

export function checklist(c: Coords) {
  const items: { ok: boolean; text: string }[] = [];
  for (const k of ROOM_KEYS) items.push({ ok: !!c.rooms[k], text: `room placed: ${k} (${card.rooms[k]})` });
  for (const k of ROOM_KEYS) items.push({ ok: c.doors.some((d) => d.room === k), text: `door: ${k}` });
  for (const room of ["workspace", "command", "server"] as const) {
    const need = card.team.filter((m) => m.worksIn === room).length, have = c.seats.filter((s) => s.room === room).length;
    items.push({ ok: have >= need, text: `${room} seats: ${have} / ${need} needed (${card.team.filter((m) => m.worksIn === room).map((m) => m.name).join(", ") || "—"})` });
  }
  for (const room of ["lounge", "pantry"] as const) items.push({ ok: c.seats.some((s) => s.room === room), text: `${room} has break seats` });
  // reachability over the door/node graph
  const adj = new Map<string, string[]>();
  for (const [a, b] of c.edges) { adj.set(a, [...(adj.get(a) ?? []), b]); adj.set(b, [...(adj.get(b) ?? []), a]); }
  const doorOf = (k: string) => c.doors.find((d) => d.room === k)?.id;
  const start = doorOf("command") ?? c.doors[0]?.id;
  const seen = new Set<string>(start ? [start] : []);
  const q = start ? [start] : [];
  while (q.length) for (const n of adj.get(q.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  const unreachable = ROOM_KEYS.filter((k) => { const d = doorOf(k); return !d || !seen.has(d); });
  items.push({ ok: unreachable.length === 0, text: unreachable.length ? `unreachable rooms: ${unreachable.join(", ")}` : "every room is reachable through the connections" });
  return items;
}

function Picker() {
  const [c, setC] = useState<Coords>(() => clone(initial as Coords));
  const [history, setHistory] = useState<Coords[]>([]);
  const [mode, setMode] = useState<Mode>("room");
  const [roomKey, setRoomKey] = useState<RoomKey>("briefing");
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState("j_");
  const [msg, setMsg] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const commit = (next: Coords) => { setHistory((h) => [...h.slice(-50), c]); setC(next); };
  const undo = () => setHistory((h) => { if (!h.length) return h; setC(h[h.length - 1]); return h.slice(0, -1); });
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); } }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); });

  const pos = (e: React.MouseEvent) => { const r = box.current!.getBoundingClientRect(); return { x: r1(((e.clientX - r.left) / r.width) * 100), y: r1(((e.clientY - r.top) / r.height) * 100) }; };
  const nextId = (prefix: string, list: { id: string }[]) => { let i = list.length + 1; while (list.some((x) => x.id === `${prefix}${i}`)) i++; return `${prefix}${i}`; };

  const onDown = (e: React.MouseEvent) => { if (mode === "room") { const p = pos(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); } };
  const onMove = (e: React.MouseEvent) => { if (drag) { const p = pos(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } };
  const onUp = () => {
    if (mode !== "room" || !drag) return;
    const r = { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: r1(Math.abs(drag.x1 - drag.x0)), h: r1(Math.abs(drag.y1 - drag.y0)) };
    setDrag(null);
    if (r.w < 1 || r.h < 1) return;
    const n = clone(c); n.rooms[roomKey] = r; commit(n);
    const nextRoom = ROOM_KEYS.find((k) => !n.rooms[k]); if (nextRoom) setRoomKey(nextRoom);
  };
  const onClick = (e: React.MouseEvent) => {
    if (mode === "room" || mode === "connect" || mode === "delete") return;
    const p = pos(e); const n = clone(c);
    if (mode === "seat") {
      const room = roomAt(c, p.x, p.y);
      if (!room) return setMsg("A seat must be inside a room rectangle — place the room first.");
      n.seats.push({ id: nextId("s", n.seats), room, ...p, ...(["workspace", "command", "server"].includes(room) ? { work: true } : {}) });
    } else if (mode === "door") {
      n.doors = n.doors.filter((d) => d.room !== roomKey);
      n.doors.push({ id: `d_${roomKey}`, room: roomKey, ...p });
    } else if (mode === "node") {
      const id = /^[a-z0-9_]+$/.test(nodeName) && !n.nodes.some((x) => x.id === nodeName) ? nodeName : nextId("j_", n.nodes);
      n.nodes.push({ id, ...p }); setNodeName("j_");
    }
    setMsg(""); commit(n);
  };
  const clickPoint = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === "delete") {
      const n = clone(c);
      n.doors = n.doors.filter((d) => d.id !== id); n.nodes = n.nodes.filter((x) => x.id !== id); n.seats = n.seats.filter((s) => s.id !== id);
      n.edges = n.edges.filter(([a, b]) => a !== id && b !== id); commit(n); return;
    }
    if (mode !== "connect") return;
    if (!pending) return setPending(id);
    if (pending !== id && !c.edges.some(([a, b]) => (a === pending && b === id) || (a === id && b === pending))) { const n = clone(c); n.edges.push([pending, id]); commit(n); }
    setPending(null);
  };
  const deleteEdge = (i: number) => { if (mode !== "delete") return; const n = clone(c); n.edges.splice(i, 1); commit(n); };
  const deleteRoom = (k: RoomKey) => { if (mode !== "delete") return; const n = clone(c); delete n.rooms[k]; commit(n); };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ image: { width: 1448, height: 1086 }, ...c }, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "office-coordinates.json"; a.click();
    setMsg("Saved office-coordinates.json — move it to web/src/office-coordinates.json, then run: npm run assets");
  };
  const importJson = async (f: File) => { try { commit(JSON.parse(await f.text())); setMsg(`Imported ${f.name}`); } catch { setMsg("That file is not valid JSON."); } };
  const items = useMemo(() => checklist(c), [c]);
  const allOk = items.every((i) => i.ok);

  const btn = (m: Mode, label: string) => <button key={m} onClick={() => { setMode(m); setPending(null); }} className={`rounded px-3 py-1.5 text-sm font-medium ${mode === m ? "bg-accent text-white" : "bg-panel2 text-slate-300 hover:bg-line"}`}>{label}</button>;
  const P = (p: { x: number; y: number }) => ({ left: `${p.x}%`, top: `${p.y}%` });

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {btn("room", "Room")}{btn("seat", "Seat")}{btn("door", "Door")}{btn("node", "Node")}{btn("connect", "Connect")}{btn("delete", "Delete")}
          {(mode === "room" || mode === "door") && (
            <select data-testid="room-key" value={roomKey} onChange={(e) => setRoomKey(e.target.value as RoomKey)} className="rounded bg-panel2 px-2 py-1.5 text-sm">
              {ROOM_KEYS.map((k) => <option key={k} value={k}>{k} — {card.rooms[k]}</option>)}
            </select>
          )}
          {mode === "node" && <input data-testid="node-name" value={nodeName} onChange={(e) => setNodeName(e.target.value)} className="w-32 rounded bg-panel2 px-2 py-1.5 font-mono text-sm" />}
          <button onClick={undo} disabled={!history.length} className="rounded bg-panel2 px-3 py-1.5 text-sm disabled:opacity-40">Undo</button>
          <button onClick={() => commit({ rooms: {}, seats: [], doors: [], nodes: [], edges: [] })} className="rounded bg-panel2 px-3 py-1.5 text-sm">Clear all</button>
          <span className="ml-auto" />
          <button onClick={() => fileRef.current?.click()} className="rounded bg-panel2 px-3 py-1.5 text-sm">Import</button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <button data-testid="export" onClick={exportJson} className={`rounded px-3 py-1.5 text-sm font-semibold ${allOk ? "bg-emerald-600 text-white" : "bg-panel2"}`}>Export JSON</button>
        </div>
        <p className="mb-2 text-xs text-slate-400">
          {mode === "room" && "Drag a rectangle over a room, with the room key chosen on the left."}
          {mode === "seat" && "Click open floor in front of a desk or chair where a character should STAND. It belongs to the room it is inside."}
          {mode === "door" && "Click exactly in the doorway gap of the chosen room (one door per room)."}
          {mode === "node" && "Click where corridors meet or turn. Give it an id like j_top, j_mid."}
          {mode === "connect" && "Click two doors/nodes to link them. Only link points a person could walk between WITHOUT crossing a wall."}
          {mode === "delete" && "Click a seat, door, node, line or room label to delete it."}
          {msg && <span className="ml-2 text-amber-300">{msg}</span>}
        </p>
        <div className="relative min-h-0 flex-1">
          <div ref={box} data-testid="map" className="relative mx-auto aspect-[1448/1086] max-h-full max-w-full select-none" style={{ height: "100%" }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onClick={onClick}>
            <img src={MAP} draggable={false} className="absolute inset-0 h-full w-full" style={{ imageRendering: card.pixelArt ? "pixelated" : "auto" }} />
            {ROOM_KEYS.map((k) => { const r = c.rooms[k]; if (!r) return null; return (
              <div key={k} className="absolute border-2 border-dashed border-sky-400/70 bg-sky-400/5" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, pointerEvents: "none" }}>
                <span onClick={(e) => { e.stopPropagation(); deleteRoom(k); }} className="pointer-events-auto absolute left-1 top-1 rounded bg-sky-900/80 px-1 text-[10px] text-sky-100">{k}</span>
              </div>); })}
            {drag && <div className="absolute border-2 border-accent bg-accent/10" style={{ left: `${Math.min(drag.x0, drag.x1)}%`, top: `${Math.min(drag.y0, drag.y1)}%`, width: `${Math.abs(drag.x1 - drag.x0)}%`, height: `${Math.abs(drag.y1 - drag.y0)}%` }} />}
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ pointerEvents: mode === "delete" ? "auto" : "none" }}>
              {c.edges.map(([a, b], i) => { const A = pointById(c, a), B = pointById(c, b); if (!A || !B) return null; return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#facc15" strokeWidth={0.5} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 3 }} onClick={(e) => { e.stopPropagation(); deleteEdge(i); }} />; })}
            </svg>
            {c.seats.map((s) => <button key={s.id} title={`${s.id} (${s.room})`} onClick={(e) => clickPoint(s.id, e)} className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black bg-emerald-400" style={P(s)} />)}
            {c.doors.map((d) => <button key={d.id} onClick={(e) => clickPoint(d.id, e)} className={`absolute -translate-x-1/2 -translate-y-1/2 rounded px-1 text-[10px] font-bold ${pending === d.id ? "bg-white text-black" : "bg-rose-500 text-white"}`} style={P(d)}>{d.id}</button>)}
            {c.nodes.map((n) => <button key={n.id} onClick={(e) => clickPoint(n.id, e)} className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-1 text-[10px] font-bold ${pending === n.id ? "bg-white text-black" : "bg-yellow-400 text-black"}`} style={P(n)}>{n.id}</button>)}
          </div>
        </div>
      </div>
      <aside className="w-80 shrink-0 overflow-auto border-l border-line bg-panel p-4">
        <h1 className="mb-1 font-semibold">{card.appName} — office picker</h1>
        <p className="mb-3 text-xs text-slate-400">{c.seats.length} seats · {c.doors.length} doors · {c.nodes.length} nodes · {c.edges.length} connections</p>
        <ul data-testid="checklist" className="space-y-1 text-xs">
          {items.map((i, k) => <li key={k} className={i.ok ? "text-emerald-400" : "text-rose-400"}>{i.ok ? "✓" : "✗"} {i.text}</li>)}
        </ul>
      </aside>
    </div>
  );
}

document.documentElement.style.setProperty("--accent", card.uiAccent);
createRoot(document.getElementById("root")!).render(<StrictMode><Picker /></StrictMode>);
