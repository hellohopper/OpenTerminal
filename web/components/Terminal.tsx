"use client";
import { useI18n } from "../lib/use-i18n";

import {readResearchLink} from "../lib/research-link";

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
import { useDisplay } from "../store/display";
import { PollingScope } from "../lib/use-adaptive-refresh";

export default function Terminal() {
  const { t: ui, widgetTitle } = useI18n();
  const lastAddedWidgetId = useTerminal(s => s.lastAddedWidgetId);
  const lastRemovedPanel = useTerminal(s => s.lastRemovedPanel);
  const addedPanel = useTerminal(s => s.widgets.find(w => w.id === s.lastAddedWidgetId));
  const undoAvailable = useTerminal(s => !!s.lastRemovedPanel && s.workspaces.some(w => w.id === s.lastRemovedPanel?.workspaceId && w.widgets.length < 50));

  const sidebarVisible = useDisplay((state) => state.sidebarVisible);
  const workspaceBarVisible = useDisplay((state) => state.workspaceBarVisible);
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
  useEffect(()=>{const read=()=>{const {symbol,target}=readResearchLink(window.location.search);if(symbol)useTerminal.getState().openResearch(symbol,target??undefined);else useTerminal.getState().closeResearch();};read();window.addEventListener("popstate",read);return()=>window.removeEventListener("popstate",read);},[]);
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

  if (compact === null) return <div className="terminal-shell p-3 dim">{ui("Loading terminal…")}</div>;
  return (
    <div className="terminal-shell flex flex-col">
      <TopBar />
      {workspaceBarVisible && (!compact || view === "workspace") && <WorkspaceBar />}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {!compact && sidebarVisible && <Sidebar />}
        <main className="flex-1 overflow-auto min-w-0">
          <PollingScope active={!research}>
          {!compact || view === "workspace" ? <Workspace key={workspaceId} compact={compact} /> : <section className={`mobile-home mobile-${view} p-2`} aria-label={ui("Mobile {value}", { value: ui(view === "holdings" ? "Holdings" : view === "alerts" ? "Alerts" : "Events") })}>
            <h1 className="amber text-lg mb-2">{view === "holdings" ? ui("Holdings") : view === "alerts" ? ui("Alerts") : ui("Holdings events")}</h1>
            <WidgetErrorBoundary key={view} name={view}>{view === "holdings" ? <PortfolioWidget /> : view === "alerts" ? <AlertsWidget /> : <EventsWidget />}</WidgetErrorBoundary>
          </section>}
          </PollingScope>
        </main>
      </div>
      {compact && <nav aria-label={ui("Mobile navigation")} className="mobile-nav">
        {(["holdings", "alerts", "events", "workspace"] as const).map(v => <button key={v} aria-current={view === v ? "page" : undefined} onClick={() => setView(v)}>{v === "holdings" ? ui("Holdings") : v === "alerts" ? ui("Alerts") : v === "events" ? ui("Events") : ui("Workspace")}</button>)}
        <button onClick={() => setTools(true)}>{ui("Tools")}</button>
      </nav>}
      {tools && compact && <Modal label={ui("Add a panel")} onClose={() => setTools(false)} className="tools-dialog"><div className="flex p-2"><h2 className="amber mr-auto">{ui("Widget library")}</h2><button className="term-btn" onClick={() => setTools(false)}>{ui("Close tools")}</button></div><Sidebar onSelect={() => { setView("workspace"); setTools(false); }} /></Modal>}
      {research && <ResearchView key={research} symbol={research} />}
      <CommandPalette />
      <AlertNotifier />
      {(lastAddedWidgetId && addedPanel || lastRemovedPanel) && <div className="panel-notice" role="status">
        <span>{lastRemovedPanel ? ui("Removed {name} panel", { name: widgetTitle(lastRemovedPanel.widget.type) }) : ui("Added {name} panel", { name: widgetTitle(addedPanel!.type) })}</span>
        {lastRemovedPanel && <button className="term-btn" disabled={!undoAvailable} onClick={() => useTerminal.getState().undoRemoveWidget()}>{ui("Undo removal")}</button>}
        <button aria-label={ui("Dismiss panel notice")} title={ui("Dismiss panel notice")} onClick={() => useTerminal.getState().dismissPanelNotice()}>✕</button>
      </div>}
    </div>
  );
}
