"use client";
import { useI18n } from "../lib/use-i18n";

import { useId, useRef, useState, type ReactNode } from "react";
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE, useDisplay } from "../store/display";
import { useTerminal } from "../store/terminal";
import { WIDGET_CATALOG, WIDGET_GROUPS } from "../lib/widget-catalog";
import { WIDGET_TYPES } from "../lib/workspaces";
import { matchesWidget } from "../lib/i18n";
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
  const { t: ui, widgetTitle } = useI18n();

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
    WIDGET_CATALOG[type].group === group && matchesWidget(type, filter),
  ) }));

  return <>
    <button className="term-btn display-settings-trigger" aria-label={ui("UI settings")} title={ui("Font, sidebar and panel visibility")} onClick={() => setOpen(true)}>{ui("UI settings")} <span className="dim">· {fontSize}px</span>
    </button>
    {open && <Modal label={ui("UI settings")} className="display-settings" onClose={() => setOpen(false)}>
      <div className="display-settings-heading">
        <div><h2 className="amber text-lg">{ui("UI settings")}</h2><p className="dim text-[10px] mt-1">{ui("Changes save automatically in this browser.")}</p></div>
        <button className="term-btn" onClick={() => setOpen(false)}>{ui("Done")}</button>
      </div>
      <div className="ui-settings-tabs" role="tablist" aria-label={ui("UI settings categories")}>
        {TABS.map((item, index) => <button key={item.id} ref={(element) => { tabRefs.current[index] = element; }} role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-content`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
          if (next !== null) { event.preventDefault(); setTab(TABS[next].id); tabRefs.current[next]?.focus(); }
        }}>{ui(item.label)}</button>)}
      </div>
      <div key={tab} className="ui-settings-body space-y-4" role="tabpanel" id={`${id}-content`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>
      {tab === "appearance" && <>
        <label className="block">Language / 语言<select aria-label="Language / 语言" className="block w-full mt-2" value={display.language} onChange={(event) => display.setLanguage(event.target.value === "zh" ? "zh" : "en")}><option value="en" lang="en">English</option><option value="zh" lang="zh-CN">中文</option></select></label>
        <h3 className="amber font-bold">{ui("Font & spacing")}</h3>
        <label className="block">{ui("Interface density")}<select aria-label={ui("Interface density")} className="block w-full mt-2" value={display.density} onChange={event => display.setDensity(event.target.value as typeof display.density)}>
          <option value="compact">{ui("Compact")}</option><option value="standard">{ui("Standard")}</option><option value="comfortable">{ui("Comfortable")}</option>
        </select><span className="dim block mt-1">{ui("Adjust spacing independently of font size.")}</span></label>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label htmlFor="terminal-font-size">{ui("Global font size")}</label>
          <output htmlFor="terminal-font-size" className="amber" aria-live="polite">{fontSize}px · {Math.round(fontSize / DEFAULT_FONT_SIZE * 100)}%</output>
        </div>
        <div className="display-size-controls">
          <button className="term-btn" aria-label={ui("Decrease font size")} disabled={fontSize <= MIN_FONT_SIZE} onClick={() => setFontSize(fontSize - 1)}>A−</button>
          <input id="terminal-font-size" type="range" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step={1} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} aria-valuetext={ui("Pixels {size}", { size: fontSize })} />
          <button className="term-btn" aria-label={ui("Increase font size")} disabled={fontSize >= MAX_FONT_SIZE} onClick={() => setFontSize(fontSize + 1)}>A+</button>
        </div>
        <div className="display-size-presets">
          {[12, 14, 16, 18, 20].map((size) => <button key={size} className={`term-btn ${fontSize === size ? "active" : ""}`} aria-pressed={fontSize === size} onClick={() => setFontSize(size)}>{size}px</button>)}
        </div>
        <div className="display-preview space-y-2" aria-label={ui("Font size preview")}>
          <p className="amber font-bold">{ui("Your terminal, easier to read")}</p>
          <div className="flex justify-between gap-3 flex-wrap"><span>AAPL · Apple Inc.</span><span className="up">+1.37%</span></div>
          <p className="dim">{ui("Text, controls and chart labels resize together.")}</p>
        </div>
        <p className="dim">{ui("Panels gain space and stack when needed.")}</p>
        <button className="term-btn" disabled={fontSize === DEFAULT_FONT_SIZE} onClick={() => setFontSize(DEFAULT_FONT_SIZE)}>{ui("Reset to default (12px)")}</button>
      </>}
      {tab === "sidebar" && <>
        <VisibilityToggle label={ui("Show left sidebar")} detail={ui("On smaller screens, the same features are available in Tools.")} name={ui("Show left sidebar")} checked={display.sidebarVisible} onChange={display.setSidebarVisible} />
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <div><h3 className="amber font-bold">{ui("Sidebar features")}</h3><p className="dim text-[10px] mt-1">{ui("Choose which shortcuts appear. Existing panels stay available.")}</p></div>
          <span className="dim">{ui("{count}/{total} shown", { count: WIDGET_TYPES.length - display.hiddenSidebarFeatures.length, total: WIDGET_TYPES.length })}</span>
        </div>
        <label className="block">{ui("Find a feature")}<input className="block w-full mt-2" placeholder={ui("Search features…")} value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
        <div className="flex gap-2 flex-wrap">
          <button className="term-btn" onClick={() => display.setSidebarFeaturesVisible(WIDGET_TYPES, true)}>{ui("Show all shortcuts")}</button>
          <button className="term-btn" onClick={() => display.setSidebarFeaturesVisible(WIDGET_TYPES, false)}>{ui("Hide all shortcuts")}</button>
        </div>
        {featureGroups.map(({ group, types }) => types.length > 0 && <section key={group} className="ui-settings-group">
          <div className="ui-settings-group-heading"><h4 className="amber">{ui(group)}</h4><button className="term-btn" aria-label={ui("Toggle {group} shortcuts", { group: ui(group) })} onClick={() => display.setSidebarFeaturesVisible(types, types.every((type) => display.hiddenSidebarFeatures.includes(type)))}>{types.every((type) => display.hiddenSidebarFeatures.includes(type)) ? ui("Show group") : ui("Hide group")}</button></div>
          <div className="ui-settings-options">{types.map((type) => <VisibilityToggle key={type} label={widgetTitle(type)} name={ui("Show sidebar feature {name}", { name: widgetTitle(type) })} checked={!display.hiddenSidebarFeatures.includes(type)} onChange={(visible) => display.setSidebarFeaturesVisible([type], visible)} />)}</div>
        </section>)}
        {!featureGroups.some(({ types }) => types.length > 0) && <p className="dim">{ui("No features match your search.")}</p>}
      </>}
      {tab === "panels" && <>
        <VisibilityToggle label={ui("Show workspace bar")} detail={ui("Workspace selection and layout management below the header.")} name={ui("Show workspace bar")} checked={display.workspaceBarVisible} onChange={display.setWorkspaceBarVisible} />
        <div className="flex justify-between items-center gap-3 flex-wrap"><h3 className="amber font-bold">{ui("Workspace panels")}</h3><span className="dim">{ui("{count}/{total} shown", { count: visibleCount, total: widgets.length })}</span></div>
        <label className="block">{ui("Workspace")}<select aria-label={ui("Panel settings workspace")} className="block w-full mt-2" value={workspaceId} onChange={(event) => switchWorkspace(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
        <p className="dim">{ui("Hide or restore each panel here. Its configuration and saved layout are kept. Panel choices apply to the selected workspace.")}</p>
        {widgets.length > 0 ? <>
          <div className="flex gap-2 flex-wrap">
            <button className="term-btn" disabled={visibleCount === widgets.length} onClick={() => display.setPanelsVisible(workspaceId, widgets.map((widget) => widget.id), true)}>{ui("Show all panels")}</button>
            <button className="term-btn" disabled={visibleCount === 0} onClick={() => display.setPanelsVisible(workspaceId, widgets.map((widget) => widget.id), false)}>{ui("Hide all panels")}</button>
          </div>
          <div className="ui-settings-options">{widgets.map((widget, index) => <VisibilityToggle key={widget.id} label={widgetTitle(widget.type)} detail={ui("Panel {index}", { index: index + 1 }) + (widget.linked ? " · " + ui("Linked to {symbol}", { symbol: activeSymbol }) : widget.symbol ? " · " + widget.symbol : "")} name={ui("Show {name} panel {index}", { name: widgetTitle(widget.type), index: index + 1 })} checked={!hiddenPanels.includes(widget.id)} onChange={(visible) => display.setPanelsVisible(workspaceId, [widget.id], visible)} />)}</div>
        </> : <p className="dim">{ui("This workspace has no panels. Add one from the sidebar, Tools or command search.")}</p>}
      </>}
      </div>
      <div className="ui-settings-footer"><button className="term-btn" onClick={display.resetVisibility}>{ui("Restore all visibility")}</button><span className="dim text-[10px]">{ui("Font size and language stay as selected.")}</span></div>
    </Modal>}
  </>;
}
