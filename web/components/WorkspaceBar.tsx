"use client";
import { useRef, useState } from "react";
import { useTerminal } from "../store/terminal";
import { exportWorkspace, importWorkspace, PRESETS, type Preset } from "../lib/workspaces";

export default function WorkspaceBar() {
  const st = useTerminal();
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<Preset>("daily");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const current = st.workspaces.find((w) => w.id === st.activeWorkspaceId)!;
  const run = (action: () => void) => { try { action(); setError(""); } catch (err) { setError((err as Error).message); } };
  return <div className="flex gap-2 items-center flex-wrap px-3 py-1 border-b border-[var(--border)] bg-[var(--panel)]">
    <label className="dim" htmlFor="workspace-select">WORKSPACE</label>
    <select id="workspace-select" value={st.activeWorkspaceId} onChange={(e) => st.switchWorkspace(e.target.value)}>
      {st.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
    <details className="relative">
      <summary className="cursor-pointer amber">Manage</summary>
      <div className="absolute top-full left-0 z-50 w-80 p-3 space-y-3 border border-[var(--border)] bg-[var(--panel-2)] shadow-xl">
        <label className="block">Name<input aria-label="Workspace name" className="block w-full mt-1" maxLength={64} value={name} placeholder={current.name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block">Preset<select aria-label="Workspace preset" className="ml-2" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>{Object.entries(PRESETS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <div className="flex gap-2 flex-wrap">
          <button className="term-btn" onClick={() => run(() => { st.createWorkspace(name || PRESETS[preset], preset); setName(""); })}>Create</button>
          <button className="term-btn" onClick={() => run(() => { st.renameWorkspace(name); setName(""); })}>Rename</button>
          <button className="term-btn" onClick={() => run(st.duplicateWorkspace)}>Duplicate</button>
          <button className="term-btn" disabled={st.workspaces.length === 1} onClick={() => { if (confirm(`Delete workspace “${current.name}”?`)) run(st.deleteWorkspace); }}>Delete</button>
        </div>
        <div className="flex gap-2">
          <button className="term-btn" onClick={() => run(() => {
            const url = URL.createObjectURL(new Blob([exportWorkspace(current)], { type: "application/json" }));
            const a = document.createElement("a"); a.href = url; a.download = "openterminal-workspace.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          })}>Export JSON</button>
          <button className="term-btn" onClick={() => file.current?.click()}>Import JSON</button>
        </div>
        <p className="dim">Changes save automatically on this browser. Imports create a new workspace.</p>
      </div>
    </details>
    <input ref={file} hidden type="file" accept=".json,application/json" aria-label="Import workspace" onChange={async (e) => {
      const selected = e.target.files?.[0]; e.target.value = ""; if (!selected) return;
      try { if (selected.size > 262144) throw new Error("Workspace files must be smaller than 256 KB."); const text = await selected.text(); run(() => st.importWorkspace(importWorkspace(text))); } catch (err) { setError((err as Error).message); }
    }} />
    <span className="dim ml-auto">{st.widgets.length} panels · auto-saved</span>
    {error && <span role="alert" className="down w-full">{error}</span>}
  </div>;
}
