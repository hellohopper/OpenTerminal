"use client";
import { useI18n } from "../lib/use-i18n";

import { useRef, useState } from "react";
import { useTerminal } from "../store/terminal";
import { exportWorkspace, importWorkspace, layoutChanged, PRESETS, type Preset, type WorkspacePresentation } from "../lib/workspaces";
import { useDisplay } from "../store/display";
import { useInterface } from "../store/interface";
import Modal from "./Modal";

export default function WorkspaceBar() {
  const { t: ui, widgetTitle } = useI18n();

  const st = useTerminal();
  const simple = useInterface(s => s.mode === "simple");
  const hiddenPanels = useDisplay((state) => state.hiddenPanels);
  const display = useDisplay();
  const visibleCount = st.widgets.filter((widget) => !(hiddenPanels[st.activeWorkspaceId] ?? []).includes(widget.id)).length;
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<Preset>("daily");
  const [error, setError] = useState("");
  const [includeAppearance, setIncludeAppearance] = useState(false);
  const [saveAs, setSaveAs] = useState(false);
  const [preview,setPreview]=useState(false),[savedPreview,setSavedPreview]=useState(false),[confirmRestore,setConfirmRestore]=useState(false),[notice,setNotice]=useState("");
  const file = useRef<HTMLInputElement>(null);
  const current = st.workspaces.find((w) => w.id === st.activeWorkspaceId)!;
  const openSaveAs=()=>{setName(`${current.name.slice(0,57)} (copy)`);setIncludeAppearance(!!current.presentation?.appearance);setSaveAs(true);};
  const choices:WorkspacePresentation={sidebarVisible:display.sidebarVisible,workspaceBarVisible:display.workspaceBarVisible,hiddenSidebarFeatures:display.hiddenSidebarFeatures,favoriteFeatures:display.favoriteFeatures,collapsedGroups:display.collapsedGroups,hiddenPanelIds:(display.hiddenPanels[current.id]??[]).filter(id=>st.widgets.some(w=>w.id===id)),...(current.savedLayout?.presentation?.appearance?{appearance:{fontSize:display.fontSize,language:display.language,density:display.density}}:{})};
  const changed=!!current.savedLayout&&layoutChanged(st,current.savedLayout,current.savedLayout.presentation?choices:undefined);
  const shown=savedPreview&&current.savedLayout?current.savedLayout:{widgets:st.widgets,layout:st.layout,presentation:choices};
  const bottom=Math.max(1,...shown.layout.map(p=>p.y+p.h));
  const run = (action: () => void) => { try { action(); setError(""); } catch (err) { setError((err as Error).message); } };
  return <div className="flex gap-2 items-center flex-wrap px-3 py-1 border-b border-[var(--border)] bg-[var(--panel)]">
    <label className="dim" htmlFor="workspace-select">{ui("WORKSPACE")}</label>
    <select id="workspace-select" value={st.activeWorkspaceId} onChange={(e) => st.switchWorkspace(e.target.value)}>
      {st.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
    {!simple && <button className="term-btn" aria-pressed={st.layoutEditing} onClick={() => st.setLayoutEditing(!st.layoutEditing)}>{ui(st.layoutEditing ? "Finish editing" : "Edit layout")}</button>}
    <button className="term-btn layout-desktop-action" onClick={()=>run(()=>{st.saveLayout();setNotice(ui("Layout saved."));})}>{ui("Save current layout")}</button>
    <button className="term-btn" aria-label={ui("Preview layout")} onClick={()=>{setSavedPreview(false);setConfirmRestore(false);setPreview(true);setIncludeAppearance(!!current.savedLayout?.presentation?.appearance);}}><span className="layout-desktop-label">{ui("Preview layout")}</span><span className="layout-mobile-label">{ui("Layouts")}</span></button>
    <button className="term-btn layout-desktop-action" onClick={openSaveAs}>{ui("Save layout as…")}</button>
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
    <span role="status" className={changed?"amber":"dim"}>{ui(!current.savedLayout?"No saved layout yet":changed?"Changes since saved layout":"Saved layout matches current view")}</span>
    {notice&&<span role="status" className="dim">{notice}</span>}
    {error && <span role="alert" className="down w-full">{error}</span>}
    {preview&&<Modal label={ui("Layout preview")} onClose={()=>setPreview(false)} className="layout-preview-dialog"><div className="p-4 space-y-3">
      <h2>{ui("Layout preview")} · {current.name}</h2>
      <div className="flex flex-wrap gap-2"><button className="term-btn" aria-pressed={!savedPreview} onClick={()=>setSavedPreview(false)}>{ui("Current view")}</button><button className="term-btn" aria-pressed={savedPreview} disabled={!current.savedLayout} onClick={()=>setSavedPreview(true)}>{ui("Saved version")}</button></div>
      <div className="layout-preview-map" role="img" aria-label={ui("Panel positions preview")}>{shown.layout.map(p=>{const widget=shown.widgets.find(w=>w.id===p.i)!;const hidden=shown.presentation?.hiddenPanelIds.includes(p.i);return <div key={p.i} className={`layout-preview-panel ${hidden?"layout-preview-hidden":""}`} style={{left:`${p.x/12*100}%`,top:`${p.y/bottom*100}%`,width:`${p.w/12*100}%`,height:`${p.h/bottom*100}%`}}><span>{widgetTitle(widget.type)}{hidden?` · ${ui("Hidden")}`:""}</span></div>;})}</div>
      <p className="dim">{ui("Working changes save automatically in this browser. Save a layout version to restore it later.")}</p>
      <label><input type="checkbox" checked={includeAppearance} onChange={e=>setIncludeAppearance(e.target.checked)}/> {ui("Include font, language and density")}</label>
      <div className="flex flex-wrap gap-2"><button className="term-btn" onClick={()=>run(()=>{st.saveLayout(includeAppearance);setNotice(ui("Layout saved."));setConfirmRestore(false);})}>{ui("Save current layout")}</button><button className="term-btn" onClick={()=>{setPreview(false);openSaveAs();}}>{ui("Save layout as…")}</button><button className="term-btn" disabled={!current.savedLayout||!changed} onClick={()=>setConfirmRestore(true)}>{ui("Restore saved layout")}</button><button className="term-btn" onClick={()=>setPreview(false)}>{ui("Done")}</button></div>
      {confirmRestore&&<div role="group" aria-label={ui("Confirm layout restore")} className="space-y-2"><p>{ui("Restore saved panels, home cards and appearance? Watchlist symbols and server records are kept.")}</p><button className="term-btn" onClick={()=>run(()=>{st.restoreSavedLayout();setConfirmRestore(false);setSavedPreview(false);setNotice(ui("Saved layout restored."));})}>{ui("Confirm restore")}</button><button className="term-btn" onClick={()=>setConfirmRestore(false)}>{ui("Cancel")}</button></div>}
    </div></Modal>}
  </div>;
}
