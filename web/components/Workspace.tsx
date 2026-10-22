"use client";
import { useI18n } from "../lib/use-i18n";

import { useEffect, useRef, useState } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { normalizeSymbol } from "../lib/symbol";
import { useTerminal, type WidgetInstance } from "../store/terminal";
import ThesisWidget from "./widgets/ThesisWidget";
import TradeReviewsWidget from "./widgets/TradeReviewsWidget";
import RebalanceWidget from "./widgets/RebalanceWidget";
import FilingsWidget from "./widgets/FilingsWidget";
import NotificationsWidget from "./widgets/NotificationsWidget";
import ScreenerTrackingWidget from "./widgets/ScreenerTrackingWidget";
import BacktestWidget from "./widgets/BacktestWidget";
import TodayWidget from "./widgets/TodayWidget";
import HistoryLibraryWidget from "./widgets/HistoryLibraryWidget";
import ValuationLabWidget from "./widgets/ValuationLabWidget";
import PortfolioRiskWidget from "./widgets/PortfolioRiskWidget";
import PaperTradingWidget from "./widgets/PaperTradingWidget";
import ConsolidatedLedgerWidget from "./widgets/ConsolidatedLedgerWidget";
import FilingReaderWidget from "./widgets/FilingReaderWidget";
import EarningsReviewWidget from "./widgets/EarningsReviewWidget";
import ResearchSearchWidget from "./widgets/ResearchSearchWidget";
import PeersWidget from "./widgets/PeersWidget";
import ThesisMonitorWidget from "./widgets/ThesisMonitorWidget";
import AccountImportWidget from "./widgets/AccountImportWidget";
import PortfolioGuardsWidget from "./widgets/PortfolioGuardsWidget";
import OptionPositionsWidget from "./widgets/OptionPositionsWidget";
import WalkforwardWidget from "./widgets/WalkforwardWidget";
import SignalsWidget from "./widgets/SignalsWidget";
import QualityWidget from "./widgets/QualityWidget";
import BackupWidget from "./widgets/BackupWidget";
import SyncWidget from "./widgets/SyncWidget";
import DeliveryWidget from "./widgets/DeliveryWidget";
import EventsWidget from "./widgets/EventsWidget";
import AlertsWidget from "./widgets/AlertsWidget";
import BriefingWidget from "./widgets/BriefingWidget";
import StrategyWidget from "./widgets/StrategyWidget";
import PerformanceWidget from "./widgets/PerformanceWidget";
import JournalWidget from "./widgets/JournalWidget";
import FundamentalsWidget from "./widgets/FundamentalsWidget";
import ComparisonWidget from "./widgets/ComparisonWidget";
import QuoteWidget from "./widgets/QuoteWidget";
import ChartWidget from "./widgets/ChartWidget";
import WatchlistWidget from "./widgets/WatchlistWidget";
import NewsWidget from "./widgets/NewsWidget";
import HeatmapWidget from "./widgets/HeatmapWidget";
import ScreenerWidget from "./widgets/ScreenerWidget";
import CryptoWidget from "./widgets/CryptoWidget";
import MacroWidget from "./widgets/MacroWidget";
import OptionsWidget from "./widgets/OptionsWidget";
import PortfolioWidget from "./widgets/PortfolioWidget";
import AiWidget from "./widgets/AiWidget";
import CalendarWidget from "./widgets/CalendarWidget";
import InsiderWidget from "./widgets/InsiderWidget";
import TvWidget from "./widgets/TvWidget";
import RecapWidget from "./widgets/RecapWidget";
import WidgetErrorBoundary from "./WidgetErrorBoundary";
import { DEFAULT_FONT_SIZE, useDisplay } from "../store/display";
import { mergeVisibleLayout } from "../lib/display";
import PanelFrame from "./PanelFrame";

const Grid = WidthProvider(GridLayout);

function WidgetBody({ widget }: { widget: WidgetInstance }) {
  switch (widget.type) {
    case "thesis": return <ThesisWidget />;
    case "reviews": return <TradeReviewsWidget />;
    case "rebalance": return <RebalanceWidget />;
    case "filings": return <FilingsWidget />;
    case "notifications": return <NotificationsWidget />;
    case "tracking": return <ScreenerTrackingWidget />;
    case "backtest": return <BacktestWidget />;
    case "today": return <TodayWidget />;
    case "historyLibrary": return <HistoryLibraryWidget />;
    case "valuationLab": return <ValuationLabWidget />;
    case "portfolioRisk": return <PortfolioRiskWidget />;
    case "paper": return <PaperTradingWidget />;
    case "consolidated": return <ConsolidatedLedgerWidget />;
    case "filingReader": return <FilingReaderWidget />;
    case "earningsReview": return <EarningsReviewWidget />;
    case "researchSearch": return <ResearchSearchWidget />;
    case "peers": return <PeersWidget />;
    case "thesisMonitor": return <ThesisMonitorWidget />;
    case "accountImport": return <AccountImportWidget />;
    case "portfolioGuards": return <PortfolioGuardsWidget />;
    case "optionPositions": return <OptionPositionsWidget />;
    case "walkforward": return <WalkforwardWidget />;
    case "signals": return <SignalsWidget />;
    case "quality": return <QualityWidget />;
    case "backup": return <BackupWidget />;
    case "sync": return <SyncWidget />;
    case "delivery": return <DeliveryWidget />;
    case "events": return <EventsWidget />;
    case "alerts": return <AlertsWidget />;
    case "briefing": return <BriefingWidget />;
    case "strategy": return <StrategyWidget widget={widget} />;
    case "performance": return <PerformanceWidget />;
    case "journal": return <JournalWidget widget={widget} />;
    case "fundamentals": return <FundamentalsWidget widget={widget} />;
    case "comparison": return <ComparisonWidget />;
    case "quote": return <QuoteWidget widget={widget} />;
    case "chart": return <ChartWidget widget={widget} />;
    case "watchlist": return <WatchlistWidget />;
    case "news": return <NewsWidget widget={widget} />;
    case "heatmap": return <HeatmapWidget />;
    case "screener": return <ScreenerWidget />;
    case "crypto": return <CryptoWidget />;
    case "macro": return <MacroWidget />;
    case "options": return <OptionsWidget widget={widget} />;
    case "portfolio": return <PortfolioWidget />;
    case "ai": return <AiWidget />;
    case "calendar": return <CalendarWidget />;
    case "insider": return <InsiderWidget widget={widget} />;
    case "tv": return <TvWidget />;
    case "recap": return <RecapWidget />;
  }
}

function SymbolTag({ widget, activeSymbol }: { widget: WidgetInstance; activeSymbol: string }) {
  const { t: ui } = useI18n();

  const setWidgetSymbol = useTerminal((s) => s.setWidgetSymbol);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = widget.linked ? activeSymbol : widget.symbol ?? activeSymbol;

  useEffect(() => {
    if (!editing) return;
    setDraft(shown);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = normalizeSymbol(draft);
            if (v) setWidgetSymbol(widget.id, v);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        className="ml-2 w-16 !border-0 !border-b !border-[var(--amber-dim)] bg-transparent text-[var(--text)] px-0 py-0 text-[13px] leading-none"
      />
    );
  }

  return (
    <button type="button"
      className="ml-2 text-[var(--text)] cursor-pointer hover:text-[var(--amber)]"
      title={ui("Click to set this widget's ticker")}
      aria-label={ui("Change panel symbol {symbol}", { symbol: shown })}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => setEditing(true)}
    >
      {shown}
    </button>
  );
}

export default function Workspace({ compact = false }: { compact?: boolean }) {
  const { t: ui, widgetTitle } = useI18n();

  const fontSize = useDisplay((state) => state.fontSize);
  const scale = fontSize / DEFAULT_FONT_SIZE;
  const density = useDisplay(state => state.density);
  const [maximized, setMaximized] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const widgets = useTerminal((s) => s.widgets);
  const layout = useTerminal((s) => s.layout);
  const setLayout = useTerminal((s) => s.setLayout);
  const removeWidget = useTerminal((s) => s.removeWidget);
  const toggleLinked = useTerminal((s) => s.toggleLinked);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const workspaceId = useTerminal((s) => s.activeWorkspaceId);
  const lastAddedWidgetId = useTerminal(s => s.lastAddedWidgetId);
  useEffect(() => {
    if (!lastAddedWidgetId) return;
    const frame = requestAnimationFrame(() => {
      const panel = containerRef.current?.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(lastAddedWidgetId)}"]`);
      panel?.scrollIntoView({ block: "center", behavior: "instant" });
      panel?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [lastAddedWidgetId]);
  const hiddenPanels = useDisplay((state) => state.hiddenPanels);
  const hiddenIds = hiddenPanels[workspaceId] ?? [];
  const visibleWidgets = widgets.filter((widget) => !hiddenIds.includes(widget.id));
  const visibleLayout = layout.filter((item) => !hiddenIds.includes(item.i));

  // Reflow only the rendered layout; preserve the user's draggable layout.
  const reflow = compact || (width > 0 && visibleLayout.some((item) => width * item.w / 12 < 300 * scale));
  const rowHeight = 30 * scale * (density === "comfortable" ? 1.2 : density === "compact" ? .9 : 1);
  const symbolAware = new Set(["quote", "chart", "news", "options", "insider", "fundamentals", "journal", "strategy"]);

  const panels = visibleWidgets.map((w) => (
        <div key={w.id} data-panel-id={w.id} tabIndex={-1} className={reflow ? "reflow-workspace-panel" : undefined} style={reflow ? {
          height: Math.max(360 * scale, (layout.find((item) => item.i === w.id)?.h ?? 12) * (rowHeight + 4 * scale)),
          gridColumn: (layout.find((item) => item.i === w.id)?.w ?? 0) >= 10 ? "1 / -1" : undefined,
        } : undefined}>
          <PanelFrame label={widgetTitle(w.type)} maximized={maximized === w.id} onRestore={() => setMaximized(null)}>
            <div className="panel-title">
              <span>{widgetTitle(w.type)}{symbolAware.has(w.type) && <SymbolTag widget={w} activeSymbol={activeSymbol} />}</span>
              <span className="flex gap-2 items-center">
                {symbolAware.has(w.type) && <>
                  <button aria-label={ui("Research {symbol}", { symbol: w.linked ? activeSymbol : w.symbol ?? activeSymbol })} onMouseDown={e => e.stopPropagation()} onClick={() => useTerminal.getState().openResearch(w.linked ? activeSymbol : w.symbol ?? activeSymbol)}>{ui("Research")}</button>
                  <button aria-label={w.linked ? ui("Unlink panel from current symbol") : ui("Link panel to current symbol")} aria-pressed={w.linked} title={w.linked ? ui("Linked to active symbol (click to unlink)") : ui("Unlinked (click to link)")} onMouseDown={e => e.stopPropagation()} onClick={() => toggleLinked(w.id)} className={w.linked ? "amber" : "dim"}>⛓</button>
                </>}
                <button title={ui(maximized === w.id ? "Restore panel size" : "Maximize panel")} aria-label={ui(maximized === w.id ? "Restore {name} panel" : "Maximize {name} panel", { name: widgetTitle(w.type) })} onMouseDown={e => e.stopPropagation()} onClick={() => setMaximized(maximized === w.id ? null : w.id)}>{maximized === w.id ? "⊡" : "⛶"}</button>
                <details className="panel-actions" onMouseDown={e => e.stopPropagation()}>
                  <summary title={ui("Panel actions")} aria-label={ui("Actions for {name}", { name: widgetTitle(w.type) })}>⋯</summary>
                  <div className="panel-action-list">
                    <button onClick={() => { setMaximized(null); useDisplay.getState().setPanelsVisible(workspaceId, [w.id], false); }}>{ui("Hide panel")}</button>
                    <button onClick={() => { setMaximized(null); removeWidget(w.id); }}>{ui("Remove panel")}</button>
                  </div>
                </details>
              </span>
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              <WidgetErrorBoundary name={widgetTitle(w.type)}><WidgetBody widget={w} /></WidgetErrorBoundary>
            </div>
          </PanelFrame>
        </div>
  ));
  return <div ref={containerRef} className="workspace-container">{panels.length === 0 ? (
    <div className="p-4 space-y-2"><h2 className="amber">{widgets.length ? ui("All panels are hidden") : ui("This workspace is empty")}</h2><p className="dim">{widgets.length ? ui("Open UI settings → Panels in the header to show your panels again.") : ui("Add a panel from the sidebar, Tools or command search (⌘/Ctrl+K).")}</p></div>
  ) : reflow ? (
    <div className="reflow-workspace">{panels}</div>
  ) : (
    <Grid
      className="layout"
      layout={visibleLayout}
      cols={12}
      rowHeight={rowHeight}
      margin={[4 * scale, 4 * scale]}
      draggableHandle=".panel-title"
      // Only persist deliberate edits, not compaction caused by hiding panels.
      onDragStop={(next) => setLayout(mergeVisibleLayout(layout, next))}
      onResizeStop={(next) => setLayout(mergeVisibleLayout(layout, next))}
    >
      {panels}
    </Grid>
  )}</div>;
}
