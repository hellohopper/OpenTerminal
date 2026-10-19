"use client";

import { useEffect, useState } from "react";
import ResearchView from "./ResearchView";
import Modal from "./Modal";
import PortfolioWidget from "./widgets/PortfolioWidget";
import AlertsWidget from "./widgets/AlertsWidget";
import EventsWidget from "./widgets/EventsWidget";
import WidgetErrorBoundary from "./WidgetErrorBoundary";
import AlertNotifier from "./AlertNotifier";
import TopBar from "./TopBar";
import WorkspaceBar from "./WorkspaceBar";
import Sidebar from "./Sidebar";
import Workspace from "./Workspace";
import CommandPalette from "./CommandPalette";
import { useTerminal } from "../store/terminal";

export default function Terminal() {
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const addWidget = useTerminal((s) => s.addWidget);
  const [compact, setCompact] = useState<boolean | null>(null), [tools, setTools] = useState(false);
  const research = useTerminal(s => s.researchSymbol);
  const view = useTerminal(s => s.mobileView), setView = useTerminal(s => s.setMobileView);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => { setCompact(media.matches); if (!media.matches) setTools(false); };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(()=>{const symbol=new URLSearchParams(window.location.search).get("research");if(symbol)useTerminal.getState().openResearch(symbol);},[]);
  const workspaceId = useTerminal((s) => s.activeWorkspaceId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (e.altKey) {
        const map: Record<string, () => void> = {
          "1": () => addWidget("chart"),
          "2": () => addWidget("quote"),
          "3": () => addWidget("news"),
          "4": () => addWidget("screener"),
          "5": () => addWidget("heatmap"),
          "6": () => addWidget("crypto"),
          "7": () => addWidget("options"),
          "8": () => addWidget("portfolio"),
          "9": () => addWidget("ai"),
        };
        const fn = map[e.key];
        if (fn) {
          e.preventDefault();
          fn();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen, addWidget]);

  if (compact === null) return <div className="terminal-shell p-3 dim">Loading terminal…</div>;
  return (
    <div className="terminal-shell flex flex-col">
      <TopBar />
      {(!compact || view === "workspace") && <WorkspaceBar />}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {!compact && <Sidebar />}
        <main className="flex-1 overflow-auto min-w-0">
          {!compact || view === "workspace" ? <Workspace key={workspaceId} compact={compact} /> : <section className={`mobile-home mobile-${view} p-2`} aria-label={`Mobile ${view}`}>
            <h1 className="amber text-lg mb-2">{view === "holdings" ? "Holdings" : view === "alerts" ? "Alerts" : "Holdings events"}</h1>
            <WidgetErrorBoundary key={view} name={view}>{view === "holdings" ? <PortfolioWidget /> : view === "alerts" ? <AlertsWidget /> : <EventsWidget />}</WidgetErrorBoundary>
          </section>}
        </main>
      </div>
      {compact && <nav aria-label="Mobile navigation" className="mobile-nav">
        {(["holdings", "alerts", "events", "workspace"] as const).map(v => <button key={v} aria-current={view === v ? "page" : undefined} onClick={() => setView(v)}>{v === "holdings" ? "Holdings" : v === "alerts" ? "Alerts" : v === "events" ? "Events" : "Workspace"}</button>)}
        <button onClick={() => setTools(true)}>Tools</button>
      </nav>}
      {tools && compact && <Modal label="Add a panel" onClose={() => setTools(false)} className="tools-dialog"><div className="flex p-2"><h2 className="amber mr-auto">Widget library</h2><button className="term-btn" onClick={() => setTools(false)}>Close tools</button></div><Sidebar onSelect={() => { setView("workspace"); setTools(false); }} /></Modal>}
      {research && <ResearchView key={research} symbol={research} />}
      <CommandPalette />
      <AlertNotifier />
    </div>
  );
}
