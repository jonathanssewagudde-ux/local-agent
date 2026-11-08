import { useEffect, useState } from "react";
import { api, type State, type TerminalStatus } from "../useMissionControl";

type Row = { slug: string; name: string; path: string; git: { exists: boolean; branch: string | null; dirty: boolean | null } };

export default function Projects({ state, terminal, onSwitched, onNotice }: { state: State | null; terminal: TerminalStatus; onSwitched: (name: string) => void; onNotice: (s: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [newName, setNewName] = useState("");
  const [existing, setExisting] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const active = state?.config.activeProject;
  const live = terminal.claudeRunning;
  const why = live ? "" : "Launch Claude in the terminal first, so the lead hears about the switch";

  const load = async () => { try { setRows((await api<{ projects: Row[] }>("/api/projects")).projects); } catch {} };
  useEffect(() => { load(); }, [state?.registry.projects.length, active]);
  useEffect(() => { setFolder(state?.config.projectsFolder ?? ""); }, [state?.config.projectsFolder]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e: any) { onNotice(e.message); } finally { setBusy(false); load(); } };
  const loadProject = (r: Row) => run(async () => { const res = await api("/api/active", { slug: r.slug }); onSwitched(r.name); if (!res.injected) onNotice(`Loaded ${r.name}. No live terminal — tell the lead yourself.`); });
  const create = () => run(async () => { const res = await api("/api/projects", { name: newName }); setNewName(""); onSwitched(newName); onNotice(`Created ${res.path}`); });
  const add = () => run(async () => { const res = await api("/api/projects/existing", { path: existing }); setExisting(""); onSwitched(res.slug); });
  const saveFolder = () => run(async () => { await api("/api/config/projects-folder", { path: folder }); onNotice("Projects folder saved"); });

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <h1 className="text-lg font-bold">Projects</h1>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-slate-400">No projects yet. Create one, or add a folder you already have.</p>}
        {rows.map((r) => (
          <div key={r.slug} data-testid={`project-${r.slug}`} className={`flex items-center gap-3 rounded-lg border p-3 ${r.slug === active ? "border-accent bg-accent/10" : "border-line bg-panel"}`}>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{r.name} {r.slug === active && <span className="ml-1 rounded bg-accent px-1.5 text-[10px] text-white">ACTIVE</span>}</div>
              <div className="truncate font-mono text-xs text-slate-400">{r.path}</div>
              <div className="text-xs">{!r.git.exists ? <span className="text-rose-400">folder missing</span> : r.git.branch === null ? <span className="text-slate-500">not a git repo</span> : <><span className="text-sky-300">⎇ {r.git.branch}</span> · {r.git.dirty ? <span className="text-amber-300">uncommitted changes</span> : <span className="text-emerald-400">clean</span>}</>}</div>
            </div>
            <button disabled={busy || !live || r.slug === active} title={why} onClick={() => loadProject(r)} className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Load</button>
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-line bg-panel p-3">
          <h2 className="mb-2 text-sm font-semibold">+ New project</h2>
          <input data-testid="new-project-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Project name" className="w-full rounded border border-line bg-panel2 px-2 py-1.5 text-sm" />
          <p className="mt-1 truncate text-xs text-slate-500">Creates a folder in {state?.config.projectsFolder}, runs git init and adds a README.</p>
          <button data-testid="create-project" disabled={busy || !live || !newName.trim()} title={why} onClick={create} className="mt-2 rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Create</button>
        </div>
        <div className="rounded-lg border border-line bg-panel p-3">
          <h2 className="mb-2 text-sm font-semibold">+ Add existing folder</h2>
          <input value={existing} onChange={(e) => setExisting(e.target.value)} placeholder="Full path, e.g. C:\Users\you\code\my-app" className="w-full rounded border border-line bg-panel2 px-2 py-1.5 font-mono text-sm" />
          <p className="mt-1 text-xs text-slate-500">Registers it and makes it active. Nothing inside it is moved or changed.</p>
          <button disabled={busy || !existing.trim()} onClick={add} className="mt-2 rounded bg-panel2 px-3 py-1.5 text-sm font-semibold disabled:opacity-40">Add</button>
        </div>
      </div>
      {!live && <p className="text-xs text-amber-300">Load and Create unlock once Claude is running in the embedded terminal (so {`the lead`} is told about the switch).</p>}
      <div className="rounded-lg border border-line bg-panel p-3">
        <h2 className="mb-2 text-sm font-semibold">Projects folder</h2>
        <div className="flex gap-2">
          <input value={folder} onChange={(e) => setFolder(e.target.value)} className="min-w-0 flex-1 rounded border border-line bg-panel2 px-2 py-1.5 font-mono text-sm" />
          <button disabled={busy} onClick={saveFolder} className="rounded bg-panel2 px-3 py-1.5 text-sm">Save</button>
        </div>
      </div>
    </div>
  );
}
