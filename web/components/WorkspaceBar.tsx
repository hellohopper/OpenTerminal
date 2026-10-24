"use client";
import { useI18n } from "../lib/use-i18n";

import { useRef, useState } from "react";
import { useTerminal } from "../store/terminal";
import { exportWorkspace, importWorkspace, PRESETS, type Preset } from "../lib/workspaces";
import { useDisplay } from "../store/display";

export default function WorkspaceBar() {
  const { t: ui } = useI18n();

  const st = useTerminal();
  const hiddenPanels = useDisplay((state) => state.hiddenPanels);
  const visibleCount = st.widgets.filter((widget) => !(hiddenPanels[st.activeWorkspaceId] ?? []).includes(widget.id)).length;
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<Preset>("daily");
  const [error, setError] = useState("");
  const [includeAppearance, setIncludeAppearance] = useState(false);
  const [saveAs, setSaveAs] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const current = st.workspaces.find((w) => w.id === st.activeWorkspaceId)!;
  const run = (action: () => void) => { try { action(); setError(""); } catch (err) { setError((err as Error).message); } };
  return <div className="flex gap-2 items-center flex-wrap px-3 py-1 border-b border-[var(--border)] bg-[var(--panel)]">
    <label className="dim" htmlFor="workspace-select">{ui("WORKSPACE")}</label>
    <select id="workspace-select" value={st.activeWorkspaceId} onChange={(e) => st.switchWorkspace(e.target.value)}>
      {st.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
    <button className="term-btn" aria-pressed={st.layoutEditing} onClick={() => st.setLayoutEditing(!st.layoutEditing)}>{ui(st.layoutEditing ? "Finish editing" : "Edit layout")}</button>
    <button className="term-btn" onClick={() => { setName(`${current.name.slice(0, 57)} (copy)`); setIncludeAppearance(!!current.presentation?.appearance); setSaveAs(true); }}>{ui("Save layout as…")}</button>
    {saveAs && <div className="layout-save-form" role="group" aria-label={ui("Save layout as…")}>
      <label>{ui("Name")} <input aria-label={ui("New layout name")} maxLength={64} value={name} onChange={e => setName(e.target.value)} /></label>
      <label><input type="checkbox" checked={includeAppearance} onChange={e => setIncludeAppearance(e.target.checked)} /> {ui("Include font, language and density")}</label>
      <button className="term-btn" onClick={() => run(() => { st.saveWorkspaceAs(name, includeAppearance); setSaveAs(false); setName(""); })}>{ui("Save new layout")}</button>
      <button className="term-btn" onClick={() => setSaveAs(false)}>{ui("Cancel")}</button>
    </div>}
    <details className="relative">
      <summary className="cursor-pointer amber">{ui("Manage")}</summary>
      <div className="absolute top-full left-0 z-50 w-72 max-w-[80vw] p-3 space-y-3 border border-[var(--border)] bg-[var(--panel-2)] shadow-xl">
        <label className="block">{ui("Name")}<input aria-label={ui("Workspace name")} className="block w-full mt-1" maxLength={64} value={name} placeholder={current.name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block">{ui("Preset")}<select aria-label={ui("Workspace preset")} className="ml-2" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>{Object.entries(PRESETS).map(([id, label]) => <option key={id} value={id}>{ui(label)}</option>)}</select></label>
        <div className="flex gap-2 flex-wrap">
          <button className="term-btn" onClick={() => run(() => { st.createWorkspace(name || ui(PRESETS[preset]), preset); setName(""); })}>{ui("Create")}</button>
          <button className="term-btn" onClick={() => run(() => { st.renameWorkspace(name); setName(""); })}>{ui("Rename")}</button>
          <button className="term-btn" onClick={() => run(st.duplicateWorkspace)}>{ui("Duplicate")}</button>
          <button className="term-btn" disabled={st.workspaces.length === 1} onClick={() => { if (confirm(ui("Delete workspace “{name}”?", { name: current.name }))) run(st.deleteWorkspace); }}>{ui("Delete")}</button>
        </div>
        <div className="flex gap-2">
          <button className="term-btn" onClick={() => run(() => {
            st.savePresentation();
            const saved = useTerminal.getState().workspaces.find(w => w.id === st.activeWorkspaceId)!;
            const url = URL.createObjectURL(new Blob([exportWorkspace(saved)], { type: "application/json" }));
            const a = document.createElement("a"); a.href = url; a.download = "openterminal-workspace.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          })}>{ui("Export JSON")}</button>
          <button className="term-btn" onClick={() => file.current?.click()}>{ui("Import JSON")}</button>
        </div>
        <p className="dim">{ui("Changes save automatically on this browser. Imports create a new workspace.")}</p>
      </div>
    </details>
    <input ref={file} hidden type="file" accept=".json,application/json" aria-label={ui("Import workspace")} onChange={async (e) => {
      const selected = e.target.files?.[0]; e.target.value = ""; if (!selected) return;
      try { if (selected.size > 262144) throw new Error("Workspace files must be smaller than 256 KB."); const text = await selected.text(); run(() => st.importWorkspace(importWorkspace(text))); } catch (err) { setError((err as Error).message); }
    }} />
    <span className="dim ml-auto">{visibleCount === st.widgets.length ? ui("{count} panels", { count: st.widgets.length }) : ui("{count}/{total} panels shown", { count: visibleCount, total: st.widgets.length })} {ui("· auto-saved")}</span>
    {error && <span role="alert" className="down w-full">{error}</span>}
  </div>;
}
