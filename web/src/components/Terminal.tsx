import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { lead } from "../card";

const SID_KEY = "mc-terminal-sid";
function sid() {
  try {
    let s = localStorage.getItem(SID_KEY);
    if (!s) { s = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, ""); localStorage.setItem(SID_KEY, s); }
    return s;
  } catch { return "fallback-session-sid"; }
}

export default function Terminal({ open, claudeRunning }: { open: boolean; claudeRunning: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting" | "exited">("connecting");
  const exitedRef = useRef(false);

  useEffect(() => {
    const term = new XTerm({
      fontFamily: '"Cascadia Mono", "SF Mono", Menlo, Consolas, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000, allowProposedApi: false,
      theme: { background: "#0b0d12", foreground: "#d6d9e0", cursor: "#c4b5fd", selectionBackground: "#3b3f55" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    termRef.current = term; fitRef.current = fit;
    try { fit.fit(); } catch {}

    let closed = false, retry = 0, timer = 0, replaying = false;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/pty`);
      wsRef.current = ws;
      ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: "hello", sid: sid(), cols: term.cols, rows: term.rows })); };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.t === "out") term.write(msg.d);
        else if (msg.t === "replay") {
          // While replaying old output, xterm would answer old capability queries (e.g. ESC[c) and type
          // the answers (like "1;2c") into the live shell — so mute input until the replay is written.
          replaying = true; term.reset(); term.write(msg.d, () => { replaying = false; });
        }
        else if (msg.t === "ready") { exitedRef.current = false; setStatus("live"); }
        else if (msg.t === "exit") { exitedRef.current = true; setStatus("exited"); term.write("\r\n\x1b[90m[shell exited — press Enter for a new one]\x1b[0m\r\n"); }
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus("reconnecting");
        timer = window.setTimeout(connect, Math.min(5000, 400 * 2 ** retry++));
      };
    };
    connect();
    const send = (d: string) => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ t: "in", d }));
    const disp = term.onData((d) => {
      if (replaying) return;
      if (exitedRef.current) { exitedRef.current = false; wsRef.current?.close(); return; } // reconnect → fresh shell
      send(d);
    });
    const onResize = () => {
      try { fit.fit(); } catch {}
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ t: "resize", cols: term.cols, rows: term.rows }));
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host.current!);
    (window as any).__mcTerminal = { type: (s: string) => send(s), text: () => { const b = term.buffer.active; let out = ""; for (let i = 0; i < b.length; i++) out += (b.getLine(i)?.translateToString(true) ?? "") + "\n"; return out; } };
    return () => { closed = true; clearTimeout(timer); ro.disconnect(); disp.dispose(); wsRef.current?.close(); term.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (open) setTimeout(() => { try { fitRef.current?.fit(); } catch {} termRef.current?.focus(); }, 50); }, [open]);

  const type = (s: string, enter = true) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: "in", d: s }));
    if (enter) setTimeout(() => ws.send(JSON.stringify({ t: "in", d: "\r" })), 150); // Enter as a separate write
    termRef.current?.focus();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs">
        <span className={`h-2 w-2 rounded-full ${status === "live" ? "bg-emerald-400" : status === "exited" ? "bg-slate-500" : "bg-amber-400"}`} />
        <span className="text-slate-400">terminal · {status}{claudeRunning ? " · claude running" : ""}</span>
        <span className="ml-auto" />
        <button onClick={() => type("claude")} disabled={claudeRunning} className="rounded bg-accent px-2.5 py-1 font-semibold text-white disabled:opacity-40" title={claudeRunning ? "Claude is already running here" : "Types `claude` into the terminal"}>Launch Claude</button>
        <button onClick={() => type(`Hi ${lead.name} — what's the status?`)} disabled={!claudeRunning} className="rounded bg-panel2 px-2.5 py-1 disabled:opacity-40" title={claudeRunning ? "" : "Launch Claude first"}>Wake {lead.name}</button>
      </div>
      <div ref={host} data-testid="terminal" className="min-h-0 flex-1 px-2 py-1" />
    </div>
  );
}
