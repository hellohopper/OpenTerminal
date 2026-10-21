"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE, useDisplay } from "../store/display";
import { useTerminal } from "../store/terminal";
import { WIDGET_CATALOG, WIDGET_GROUPS } from "../lib/widget-catalog";
import { WIDGET_TYPES } from "../lib/workspaces";
import Modal from "./Modal";

const TABS = [
  { id: "appearance", label: "Appearance" },
  { id: "sidebar", label: "Sidebar" },
  { id: "panels", label: "Panels" },
] as const;
type SettingsTab = typeof TABS[number]["id"];

function VisibilityToggle({ label, detail, checked, onChange, name }: {
  label: ReactNode; detail?: string; checked: boolean; onChange: (visible: boolean) => void; name: string;
}) {
  return <label className="ui-visibility-row">
    <span className="min-w-0"><span className="block">{label}</span>{detail && <span className="block dim text-[10px] mt-1">{detail}</span>}</span>
    <input type="checkbox" role="switch" aria-label={name} checked={checked} onChange={(e) => onChange(e.target.checked)} />
  </label>;
}

export default function DisplaySettings() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const [filter, setFilter] = useState("");
  const display = useDisplay();
  const { fontSize, setFontSize } = display;
  const widgets = useTerminal((state) => state.widgets);
  const workspaceId = useTerminal((state) => state.activeWorkspaceId);
  const workspaces = useTerminal((state) => state.workspaces);
  const switchWorkspace = useTerminal((state) => state.switchWorkspace);
  const activeSymbol = useTerminal((state) => state.activeSymbol);
  const hiddenPanels = display.hiddenPanels[workspaceId] ?? [];
  const visibleCount = widgets.filter((widget) => !hiddenPanels.includes(widget.id)).length;
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const featureGroups = WIDGET_GROUPS.map((group) => ({ group, types: WIDGET_TYPES.filter((type) =>
    WIDGET_CATALOG[type].group === group && `${WIDGET_CATALOG[type].label} ${WIDGET_CATALOG[type].title}`.toLowerCase().includes(filter.toLowerCase().trim()),
  ) }));

  return <>
    <button className="term-btn display-settings-trigger" aria-label="UI settings" title="Font, sidebar and panel visibility" onClick={() => setOpen(true)}>
      UI settings <span className="dim">· {fontSize}px</span>
    </button>
    {open && <Modal label="UI settings" className="display-settings" onClose={() => setOpen(false)}>
      <div className="display-settings-heading">
        <div><h2 className="amber text-lg">UI settings</h2><p className="dim text-[10px] mt-1">Changes save automatically in this browser.</p></div>
        <button className="term-btn" onClick={() => setOpen(false)}>Done</button>
      </div>
      <div className="ui-settings-tabs" role="tablist" aria-label="UI settings categories">
        {TABS.map((item, index) => <button key={item.id} ref={(element) => { tabRefs.current[index] = element; }} role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-content`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
          if (next !== null) { event.preventDefault(); setTab(TABS[next].id); tabRefs.current[next]?.focus(); }
        }}>{item.label}</button>)}
      </div>
      <div key={tab} className="ui-settings-body space-y-4" role="tabpanel" id={`${id}-content`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>
      {tab === "appearance" && <>
        <h3 className="amber font-bold">Font & spacing</h3>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label htmlFor="terminal-font-size">Global font size</label>
          <output htmlFor="terminal-font-size" className="amber" aria-live="polite">{fontSize}px · {Math.round(fontSize / DEFAULT_FONT_SIZE * 100)}%</output>
        </div>
        <div className="display-size-controls">
          <button className="term-btn" aria-label="Decrease font size" disabled={fontSize <= MIN_FONT_SIZE} onClick={() => setFontSize(fontSize - 1)}>A−</button>
          <input id="terminal-font-size" type="range" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step={1} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} aria-valuetext={`${fontSize} pixels`} />
          <button className="term-btn" aria-label="Increase font size" disabled={fontSize >= MAX_FONT_SIZE} onClick={() => setFontSize(fontSize + 1)}>A+</button>
        </div>
        <div className="display-size-presets">
          {[12, 14, 16, 18, 20].map((size) => <button key={size} className={`term-btn ${fontSize === size ? "active" : ""}`} aria-pressed={fontSize === size} onClick={() => setFontSize(size)}>{size}px</button>)}
        </div>
        <div className="display-preview space-y-2" aria-label="Font size preview">
          <p className="amber font-bold">Your terminal, easier to read</p>
          <div className="flex justify-between gap-3 flex-wrap"><span>AAPL · Apple Inc.</span><span className="up">+1.37%</span></div>
          <p className="dim">Text, controls and chart labels resize together.</p>
        </div>
        <p className="dim">Panels gain space and stack when needed.</p>
        <button className="term-btn" disabled={fontSize === DEFAULT_FONT_SIZE} onClick={() => setFontSize(DEFAULT_FONT_SIZE)}>Reset to default (12px)</button>
      </>}
      {tab === "sidebar" && <>
        <VisibilityToggle label="Show left sidebar" detail="On smaller screens, the same features are available in Tools." name="Show left sidebar" checked={display.sidebarVisible} onChange={display.setSidebarVisible} />
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <div><h3 className="amber font-bold">Sidebar features</h3><p className="dim text-[10px] mt-1">Choose which shortcuts appear. Existing panels stay available.</p></div>
          <span className="dim">{WIDGET_TYPES.length - display.hiddenSidebarFeatures.length}/{WIDGET_TYPES.length} shown</span>
        </div>
        <label className="block">Find a feature<input className="block w-full mt-2" placeholder="Search features…" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
        <div className="flex gap-2 flex-wrap">
          <button className="term-btn" onClick={() => display.setSidebarFeaturesVisible(WIDGET_TYPES, true)}>Show all shortcuts</button>
          <button className="term-btn" onClick={() => display.setSidebarFeaturesVisible(WIDGET_TYPES, false)}>Hide all shortcuts</button>
        </div>
        {featureGroups.map(({ group, types }) => types.length > 0 && <section key={group} className="ui-settings-group">
          <div className="ui-settings-group-heading"><h4 className="amber">{group}</h4><button className="term-btn" aria-label={`Toggle ${group} shortcuts`} onClick={() => display.setSidebarFeaturesVisible(types, types.every((type) => display.hiddenSidebarFeatures.includes(type)))}>{types.every((type) => display.hiddenSidebarFeatures.includes(type)) ? "Show group" : "Hide group"}</button></div>
          <div className="ui-settings-options">{types.map((type) => <VisibilityToggle key={type} label={WIDGET_CATALOG[type].title} name={`Show sidebar feature ${WIDGET_CATALOG[type].title}`} checked={!display.hiddenSidebarFeatures.includes(type)} onChange={(visible) => display.setSidebarFeaturesVisible([type], visible)} />)}</div>
        </section>)}
        {!featureGroups.some(({ types }) => types.length > 0) && <p className="dim">No features match your search.</p>}
      </>}
      {tab === "panels" && <>
        <VisibilityToggle label="Show workspace bar" detail="Workspace selection and layout management below the header." name="Show workspace bar" checked={display.workspaceBarVisible} onChange={display.setWorkspaceBarVisible} />
        <div className="flex justify-between items-center gap-3 flex-wrap"><h3 className="amber font-bold">Workspace panels</h3><span className="dim">{visibleCount}/{widgets.length} shown</span></div>
        <label className="block">Workspace<select aria-label="Panel settings workspace" className="block w-full mt-2" value={workspaceId} onChange={(event) => switchWorkspace(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
        <p className="dim">Hide or restore each panel here. Its configuration and saved layout are kept. Panel choices apply to the selected workspace.</p>
        {widgets.length > 0 ? <>
          <div className="flex gap-2 flex-wrap">
            <button className="term-btn" disabled={visibleCount === widgets.length} onClick={() => display.setPanelsVisible(workspaceId, widgets.map((widget) => widget.id), true)}>Show all panels</button>
            <button className="term-btn" disabled={visibleCount === 0} onClick={() => display.setPanelsVisible(workspaceId, widgets.map((widget) => widget.id), false)}>Hide all panels</button>
          </div>
          <div className="ui-settings-options">{widgets.map((widget, index) => <VisibilityToggle key={widget.id} label={WIDGET_CATALOG[widget.type].title} detail={`Panel ${index + 1}${widget.linked ? ` · Linked to ${activeSymbol}` : widget.symbol ? ` · ${widget.symbol}` : ""}`} name={`Show ${WIDGET_CATALOG[widget.type].title} panel ${index + 1}`} checked={!hiddenPanels.includes(widget.id)} onChange={(visible) => display.setPanelsVisible(workspaceId, [widget.id], visible)} />)}</div>
        </> : <p className="dim">This workspace has no panels. Add one from the sidebar, Tools or command search.</p>}
      </>}
      </div>
      <div className="ui-settings-footer"><button className="term-btn" onClick={display.resetVisibility}>Restore all visibility</button><span className="dim text-[10px]">Font size stays as selected.</span></div>
    </Modal>}
  </>;
}
