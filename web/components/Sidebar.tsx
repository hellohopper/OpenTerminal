"use client";
import { useState } from "react";
import { useTerminal, type WidgetType } from "../store/terminal";
import { WIDGET_CATALOG, WIDGET_GROUPS } from "../lib/widget-catalog";
export default function Sidebar({ onSelect }: { onSelect?: () => void }) {
  const addWidget = useTerminal(s => s.addWidget), reset = useTerminal(s => s.resetWorkspace);
  const [filter, setFilter] = useState("");
  return <nav aria-label="Widget library" className="widget-sidebar bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-y-auto">
    <label className="p-2 dim">Add widget<input aria-label="Filter widgets" placeholder="Find a panel…" className="w-full mt-1" value={filter} onChange={e => setFilter(e.target.value)} /></label>
    {WIDGET_GROUPS.map(group => {
      const entries = (Object.entries(WIDGET_CATALOG) as [WidgetType, typeof WIDGET_CATALOG[WidgetType]][]).filter(([,v]) => v.group === group && `${v.label} ${v.title}`.toLowerCase().includes(filter.toLowerCase()));
      return entries.length ? <section key={group}><h2 className="dim px-2 py-1 text-[10px] uppercase border-y border-[var(--border)]">{group}</h2>{entries.map(([type, item]) => <button key={type} className="w-full text-left px-2 py-1.5 text-[11px] hover:text-[var(--amber)] flex justify-between" onClick={() => { addWidget(type); onSelect?.(); }}><span>{item.label}</span><span className="dim text-[9px]">{item.key}</span></button>)}</section> : null;
    })}
    <button className="term-btn mt-auto" onClick={() => { if (confirm("Reset this workspace layout?")) reset(); }}>RESET LAYOUT</button>
  </nav>;
}
