"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet } from "../lib/api";
import { useTerminal, type WidgetType } from "../store/terminal";
import { WIDGET_CATALOG } from "../lib/widget-catalog";
import Modal from "./Modal";
type SearchResult = { symbol: string; name: string; exchange: string; type: string };
type Command = { id: string; label: string; detail: string; run: (watch?: boolean) => void };
function Palette() {
  const st = useTerminal(), [query, setQuery] = useState(""), [debounced, setDebounced] = useState(""), [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(t); }, [query]);
  const mode = query.startsWith(">") ? "actions" : query.startsWith("@") ? "workspaces" : "all";
  const needle = query.replace(/^[>@]/, "").trim().toLowerCase();
  const symbols = useQuery({ queryKey: ["search", debounced], queryFn: () => apiGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(debounced)}`), enabled: mode === "all" && debounced.length > 0 && !/^[>@]/.test(debounced), staleTime: 300000 });
  const close = () => st.setCommandOpen(false);
  const commands: Command[] = [];
  if (mode !== "workspaces") {
    const label = `Research ${st.activeSymbol}`;
    if (!needle || label.toLowerCase().includes(needle)) commands.push({ id: "research", label, detail: "Open stock research", run: () => st.openResearch(st.activeSymbol) });
    for (const [type, item] of Object.entries(WIDGET_CATALOG)) {
      if (!needle || `${item.title} ${item.label} ${item.group}`.toLowerCase().includes(needle)) commands.push({ id: type, label: `Add ${item.title}`, detail: `${item.group} · panel`, run: () => { st.addWidget(type as WidgetType); close(); } });
    }
  }
  if (mode !== "actions") for (const w of st.workspaces) if (!needle || w.name.toLowerCase().includes(needle)) commands.push({ id: `workspace-${w.id}`, label: `Switch to ${w.name}`, detail: "Workspace", run: () => { st.switchWorkspace(w.id); close(); } });
  if (mode === "all" && debounced === query.trim()) for (const r of symbols.data ?? []) commands.unshift({ id: `symbol-${r.symbol}-${r.exchange}`, label: `${r.symbol} · ${r.name}`, detail: `${r.exchange} · research (Shift+Enter also watches)`, run: (watch) => { if (watch) st.addToWatchlist(r.symbol); st.openResearch(r.symbol); } });
  const index = Math.min(selected, Math.max(0, commands.length - 1));
  useEffect(() => { document.getElementById(`command-${index}`)?.scrollIntoView({ block: "nearest" }); }, [index]);
  return <Modal label="Search symbols, features and workspaces" onClose={close} className="command-dialog">
    <div className="flex gap-2 p-2"><input ref={input} aria-label="Search symbols, features and workspaces" role="combobox" aria-expanded={true} aria-controls="command-results" aria-activedescendant={commands.length ? `command-${index}` : undefined} autoComplete="off" className="w-full" placeholder="Symbol, feature, workspace… (> panels, @ workspaces)" value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }} onKeyDown={e => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected((index + 1) % Math.max(1, commands.length)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelected((index - 1 + commands.length) % Math.max(1, commands.length)); }
      if (e.key === "Enter" && commands[index]) { e.preventDefault(); commands[index].run(e.shiftKey); }
    }} /><button className="term-btn" aria-label="Close search" onClick={close}>Close</button></div>
    <p className="dim px-3 pb-2">↑↓ to navigate · Enter to open · Escape to close</p>
    <div id="command-results" role="listbox" className="command-results">{commands.map((c,i) => <button key={c.id} id={`command-${i}`} role="option" aria-selected={index === i} className={`w-full text-left px-3 py-2 ${index === i ? "bg-[#1f1a10] amber" : ""}`} onMouseMove={() => setSelected(i)} onClick={e => c.run(e.shiftKey)}><span className="block">{c.label}</span><span className="dim text-[10px]">{c.detail}</span></button>)}
      {symbols.isFetching && mode === "all" && <p className="dim p-3">Searching symbols…</p>}
      {symbols.error && mode === "all" && <p className="amber p-3">Symbol search unavailable. Local commands still work.</p>}
      {!commands.length && !symbols.isFetching && <p className="dim p-3">No matching commands or symbols.</p>}
    </div>
  </Modal>;
}
export default function CommandPalette() {
  const open = useTerminal(s => s.commandOpen);
  return open ? <Palette /> : null;
}
