"use client";
import { useI18n } from "../lib/use-i18n";
import { useId, useState } from "react";
import { useTerminal, type WidgetType } from "../store/terminal";
import { WIDGET_CATALOG, WIDGET_GROUPS } from "../lib/widget-catalog";
import { useDisplay } from "../store/display";
import { matchesWidget } from "../lib/i18n";

export default function Sidebar({ onSelect }: { onSelect?: () => void }) {
  const { t: ui, widgetLabel } = useI18n();
  const display = useDisplay();
  const addWidget = useTerminal(s => s.addWidget), reset = useTerminal(s => s.resetWorkspace);
  const widgetCount = useTerminal(s => s.widgets.length);
  const [filter, setFilter] = useState("");
  const id = useId();
  const available = (type: WidgetType) => !display.hiddenSidebarFeatures.includes(type) && matchesWidget(type, filter);
  const entries = (Object.keys(WIDGET_CATALOG) as WidgetType[]).filter(available);
  const pinned = filter.trim() ? [] : [...new Set([...display.favoriteFeatures, ...display.recentFeatures])];
  const renderFeature = (type: WidgetType) => <div key={type} className="sidebar-feature">
    <button disabled={widgetCount >= 50} className="sidebar-add" title={ui("Add {name} panel", { name: widgetLabel(type) })} onClick={() => { addWidget(type); onSelect?.(); }}><span>{widgetLabel(type)}</span><span className="dim text-[9px]">{WIDGET_CATALOG[type].key}</span></button>
    <button className="sidebar-favorite" aria-label={ui(display.favoriteFeatures.includes(type) ? "Unfavorite {name}" : "Favorite {name}", { name: widgetLabel(type) })} aria-pressed={display.favoriteFeatures.includes(type)} title={ui(display.favoriteFeatures.includes(type) ? "Unfavorite {name}" : "Favorite {name}", { name: widgetLabel(type) })} onClick={() => display.toggleFavorite(type)}>{display.favoriteFeatures.includes(type) ? "★" : "☆"}</button>
  </div>;
  return <nav aria-label={ui("Widget library")} className="widget-sidebar bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-y-auto">
    <label className="p-2 dim">{ui("Add widget")}<input aria-label={ui("Filter widgets")} placeholder={ui("Find a panel…")} className="w-full mt-1" value={filter} onChange={e => setFilter(e.target.value)} /></label>
    {widgetCount >= 50 && <p role="status" className="p-2 amber">{ui("Panel limit reached (50). Remove a panel to add another.")}</p>}
    {!filter.trim() && [["Favorites", display.favoriteFeatures], ["Recently used", display.recentFeatures]].map(([label, types]) => {
      const shown = (types as WidgetType[]).filter(type => available(type) && (label !== "Recently used" || !display.favoriteFeatures.includes(type)));
      return shown.length > 0 && <section key={label as string}><h2 className="sidebar-group-label">{ui(label as string)}</h2>{shown.map(renderFeature)}</section>;
    })}
    {WIDGET_GROUPS.map((group, index) => {
      const types = entries.filter(type => WIDGET_CATALOG[type].group === group && !pinned.includes(type));
      const expanded = !!filter.trim() || !display.collapsedGroups.includes(group);
      return types.length > 0 && <section key={group}>
        <h2><button className="sidebar-group-label w-full text-left" aria-expanded={expanded} aria-controls={`${id}-${index}`} onClick={() => display.toggleGroup(group)}><span aria-hidden="true">{expanded ? "▾" : "▸"}</span> {ui(group)} <span className="dim">{types.length}</span></button></h2>
        <div id={`${id}-${index}`} hidden={!expanded}>{types.map(renderFeature)}</div>
      </section>;
    })}
    {entries.length === 0 && <p className="p-2 dim">{ui(display.hiddenSidebarFeatures.length === Object.keys(WIDGET_CATALOG).length ? "All shortcuts are hidden. Open UI settings → Sidebar to show them." : "No features match your search.")}</p>}
    <button className="term-btn mt-auto" onClick={() => { if (confirm(ui("Reset this workspace layout?"))) reset(); }}>{ui("RESET LAYOUT")}</button>
  </nav>;
}
