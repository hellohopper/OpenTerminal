"use client";
import { useI18n } from "../lib/use-i18n";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet } from "../lib/api";
import { useTerminal, type WidgetType } from "../store/terminal";
import { WIDGET_CATALOG } from "../lib/widget-catalog";
import { matchesWidget } from "../lib/i18n";
import Modal from "./Modal";
type SearchResult = { symbol: string; name: string; exchange: string; type: string };
type Command = { id: string; label: string; detail: string; run: (watch?: boolean) => void };
function Palette() {
  const { t: ui, widgetTitle } = useI18n();

  const st = useTerminal(), [query, setQuery] = useState(""), [debounced, setDebounced] = useState(""), [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(t); }, [query]);
  const mode = query.startsWith("#") ? "research" : query.startsWith(">") ? "actions" : query.startsWith("@") ? "workspaces" : "all";
  const needle = query.replace(/^[>@#]/, "").trim().toLowerCase();
  const symbols = useQuery({ queryKey: ["search", debounced], queryFn: () => apiGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(debounced)}`), enabled: mode === "all" && debounced.length > 0 && !/^[>@#]/.test(debounced), staleTime: 300000 });
  const privateSearch=useQuery({queryKey:['research-search-command',debounced],queryFn:()=>apiGet<{results:any[]}>(`/api/research-search?q=${encodeURIComponent(debounced.slice(1).trim())}`),enabled:mode==='research'&&debounced.slice(1).trim().length>0});
  const close = () => st.setCommandOpen(false);
  const commands: Command[] = [];
  if (mode !== "workspaces"&&mode!=="research") {
    const label = ui("Research {symbol}", { symbol: st.activeSymbol });
    if (!needle || `${label} Research ${st.activeSymbol}`.toLowerCase().includes(needle)) commands.push({ id: "research", label, detail: ui("Open stock research"), run: () => st.openResearch(st.activeSymbol) });
    for (const [type, item] of Object.entries(WIDGET_CATALOG)) {
      if (!needle || matchesWidget(type as WidgetType, needle)) commands.push({ id: type, label: ui("Add {name}", { name: widgetTitle(type as WidgetType) }), detail: ui("{group} · panel", { group: ui(item.group) }), run: () => { st.addWidget(type as WidgetType); close(); } });
    }
  }
  if (mode !== "actions"&&mode!=="research") for (const w of st.workspaces) if (!needle || w.name.toLowerCase().includes(needle)) commands.push({ id: `workspace-${w.id}`, label: ui("Switch to {name}", { name: w.name }), detail: ui("Workspace"), run: () => { st.switchWorkspace(w.id); close(); } });
  if (mode === "all" && debounced === query.trim()) for (const r of symbols.data ?? []) commands.unshift({ id: `symbol-${r.symbol}-${r.exchange}`, label: `${r.symbol} · ${r.name}`, detail: ui("{exchange} · research (Shift+Enter also watches)", { exchange: r.exchange }), run: (watch) => { if (watch) st.addToWatchlist(r.symbol); st.openResearch(r.symbol); } });
  if(mode==='research')for(const r of privateSearch.data?.results??[])commands.push({id:`saved-${r.kind}-${r.id}-${r.paragraph??''}`,label:`${r.symbol} · ${r.title} ${r.paragraph??''}`,detail:r.snippet,run:()=>{st.openResearch(r.symbol,{kind:r.kind,id:r.id,paragraph:r.paragraph});close();}});
  const index = Math.min(selected, Math.max(0, commands.length - 1));
  useEffect(() => { document.getElementById(`command-${index}`)?.scrollIntoView({ block: "nearest" }); }, [index]);
  return <Modal label={ui("Search symbols, features and workspaces")} onClose={close} className="command-dialog">
    <div className="flex gap-2 p-2"><input ref={input} aria-label={ui("Search symbols, features and workspaces")} role="combobox" aria-expanded={true} aria-controls="command-results" aria-activedescendant={commands.length ? `command-${index}` : undefined} autoComplete="off" className="w-full" placeholder={ui("Symbol, feature, workspace… (> panels, @ workspaces)")} value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }} onKeyDown={e => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected((index + 1) % Math.max(1, commands.length)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelected((index - 1 + commands.length) % Math.max(1, commands.length)); }
      if (e.key === "Enter" && commands[index]) { e.preventDefault(); commands[index].run(e.shiftKey); }
    }} /><button className="term-btn" aria-label={ui("Close search")} onClick={close}>{ui("Close")}</button></div>
    <p className="dim px-3 pb-2">{ui("↑↓ to navigate · Enter to open · Escape to close · # to search saved research")}</p>
    <div id="command-results" role="listbox" className="command-results">{commands.map((c,i) => <button key={c.id} id={`command-${i}`} role="option" aria-selected={index === i} className={`w-full text-left px-3 py-2 ${index === i ? "bg-[#1f1a10] amber" : ""}`} onMouseMove={() => setSelected(i)} onClick={e => c.run(e.shiftKey)}><span className="block">{c.label}</span><span className="dim text-[10px]">{c.detail}</span></button>)}
      {symbols.isFetching && mode === "all" && <p className="dim p-3">{ui("Searching symbols…")}</p>}
      {symbols.error && mode === "all" && <p className="amber p-3">{ui("Symbol search unavailable. Local commands still work.")}</p>}
      {privateSearch.error&&mode==="research"&&<p role="alert">{privateSearch.error.message}</p>}
      {!commands.length && !symbols.isFetching && <p className="dim p-3">{ui("No matching commands or symbols.")}</p>}
    </div>
  </Modal>;
}
export default function CommandPalette() {
  const open = useTerminal(s => s.commandOpen);
  return open ? <Palette /> : null;
}
