"use client";

import { useEffect, useRef, useState } from "react";
import { WIDGET_CATALOG } from "../lib/widget-catalog";
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
    <span
      className="ml-2 text-[var(--text)] cursor-pointer hover:text-[var(--amber)]"
      title="Click to set this widget's ticker"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => setEditing(true)}
    >
      {shown}
    </span>
  );
}

export default function Workspace({ compact = false }: { compact?: boolean }) {
  const widgets = useTerminal((s) => s.widgets);
  const layout = useTerminal((s) => s.layout);
  const setLayout = useTerminal((s) => s.setLayout);
  const removeWidget = useTerminal((s) => s.removeWidget);
  const toggleLinked = useTerminal((s) => s.toggleLinked);
  const activeSymbol = useTerminal((s) => s.activeSymbol);

  const symbolAware = new Set(["quote", "chart", "news", "options", "insider", "fundamentals", "journal", "strategy"]);

  const panels = widgets.map((w) => (
        <div key={w.id} className={compact ? "mobile-workspace-panel" : undefined}>
          <div className="terminal-panel">
            <div className="panel-title">
              <span>{WIDGET_CATALOG[w.type].title}{symbolAware.has(w.type) && <SymbolTag widget={w} activeSymbol={activeSymbol} />}</span>
              <span className="flex gap-2 items-center">
                {symbolAware.has(w.type) && <>
                  <button aria-label={`Research ${w.linked ? activeSymbol : w.symbol ?? activeSymbol}`} onMouseDown={e => e.stopPropagation()} onClick={() => useTerminal.getState().openResearch(w.linked ? activeSymbol : w.symbol ?? activeSymbol)}>Research</button>
                  <button title={w.linked ? "Linked to active symbol (click to unlink)" : "Unlinked (click to link)"} onMouseDown={e => e.stopPropagation()} onClick={() => toggleLinked(w.id)} className={w.linked ? "amber" : "dim"}>⛓</button>
                </>}
                <button aria-label={`Remove ${WIDGET_CATALOG[w.type].title}`} onMouseDown={e => e.stopPropagation()} onClick={() => removeWidget(w.id)} className="dim">✕</button>
              </span>
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              <WidgetErrorBoundary name={WIDGET_CATALOG[w.type].title}><WidgetBody widget={w} /></WidgetErrorBoundary>
            </div>
          </div>
        </div>
  ));
  if (compact) return <div className="space-y-3 p-2">{panels.length ? panels : <p className="dim">This workspace is empty. Open Tools to add a panel.</p>}</div>;
  return (
    <Grid
      className="layout"
      layout={layout}
      cols={12}
      rowHeight={30}
      margin={[4, 4]}
      draggableHandle=".panel-title"
      onLayoutChange={(l) => setLayout(l.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })))}
    >
      {panels}
    </Grid>
  );
}
