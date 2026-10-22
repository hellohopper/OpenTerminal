"use client";
import { useI18n } from "../lib/use-i18n";

import { useState } from "react";
import { useTerminal, type WidgetType } from "../store/terminal";
import { WIDGET_CATALOG, WIDGET_GROUPS } from "../lib/widget-catalog";
import { useDisplay } from "../store/display";
import { matchesWidget } from "../lib/i18n";
export default function Sidebar({ onSelect }: { onSelect?: () => void }) {
  const { t: ui, widgetLabel } = useI18n();

  const hiddenFeatures = useDisplay((state) => state.hiddenSidebarFeatures);
  const addWidget = useTerminal(s => s.addWidget), reset = useTerminal(s => s.resetWorkspace);
  const [filter, setFilter] = useState("");
  return <nav aria-label={ui("Widget library")} className="widget-sidebar bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-y-auto">
    <label className="p-2 dim">{ui("Add widget")}<input aria-label={ui("Filter widgets")} placeholder={ui("Find a panel…")} className="w-full mt-1" value={filter} onChange={e => setFilter(e.target.value)} /></label>
    {WIDGET_GROUPS.map(group => {
      const entries = (Object.entries(WIDGET_CATALOG) as [WidgetType, typeof WIDGET_CATALOG[WidgetType]][]).filter(([type,v]) => !hiddenFeatures.includes(type) && v.group === group && matchesWidget(type, filter));
      return entries.length ? <section key={group}><h2 className="dim px-2 py-1 text-[10px] uppercase border-y border-[var(--border)]">{ui(group)}</h2>{entries.map(([type, item]) => <button key={type} className="w-full text-left px-2 py-1.5 text-[11px] hover:text-[var(--amber)] flex justify-between" onClick={() => { addWidget(type); onSelect?.(); }}><span>{widgetLabel(type)}</span><span className="dim text-[9px]">{item.key}</span></button>)}</section> : null;
    })}
    {Object.keys(WIDGET_CATALOG).length === hiddenFeatures.length && <p className="p-2 dim">{ui("All shortcuts are hidden. Open UI settings → Sidebar to show them.")}</p>}
    <button className="term-btn mt-auto" onClick={() => { if (confirm(ui("Reset this workspace layout?"))) reset(); }}>{ui("RESET LAYOUT")}</button>
  </nav>;
}
