"use client";
import { useI18n } from "../lib/use-i18n";

import ResearchRecords from "./ResearchRecords";
import { useEffect, useState } from "react";
import { useTerminal, type WidgetInstance } from "../store/terminal";
import Modal from "./Modal";
import WidgetErrorBoundary from "./WidgetErrorBoundary";
import FilingsWidget from "./widgets/FilingsWidget";
import ThesisWidget from "./widgets/ThesisWidget";
import QuoteWidget from "./widgets/QuoteWidget";
import NewsWidget from "./widgets/NewsWidget";
import ChartWidget from "./widgets/ChartWidget";
import FundamentalsWidget from "./widgets/FundamentalsWidget";
import JournalWidget from "./widgets/JournalWidget";
import AlertsWidget from "./widgets/AlertsWidget";
import { EarningsTab, EconomicTab } from "./widgets/CalendarWidget";
import { PollingScope } from "../lib/use-adaptive-refresh";
const TABS = ["Overview", "Chart", "Financials", "Events", "Thesis", "Filings", "Notes", "Alerts", "Timeline", "Valuations", "Reader", "Earnings Reviews", "Plans"] as const;
type Tab = typeof TABS[number];
export default function ResearchView({ symbol }: { symbol: string }) {
  const { t: ui } = useI18n();

  const target=useTerminal(s=>s.researchTarget);
  const close = useTerminal(s => s.closeResearch), add = useTerminal(s => s.addToWatchlist);
  const watched = useTerminal(s => s.watchlist.includes(symbol));
  const [tab, setTab] = useState<Tab>("Overview"), [note, setNote] = useState(0);
  const [notesVisited, setNotesVisited] = useState(false), [alertsVisited, setAlertsVisited] = useState(false);
  const [chartVisited, setChartVisited] = useState(false);
  const choose = (next: Tab) => {
    if (next === "Notes") setNotesVisited(true);
    if (next === "Alerts") setAlertsVisited(true);
    if (next === "Chart") setChartVisited(true);
    setTab(next);
  };
  // Stable symbol-specific ID keeps research annotations across visits and device sync.
  useEffect(()=>{if(target)setTab("Timeline");},[target]);
  const recordKinds:Partial<Record<Tab,string[]>>={Valuations:['valuation-scenario'],Reader:['filing-document','filing-annotation'],"Earnings Reviews":['earnings-review'],Plans:['paper-order','option-lot']};
  const widget: WidgetInstance = { id: `research-${symbol}`, type: "quote", linked: false, symbol };
  return <Modal label={`${symbol} research`} onClose={close} className="research-dialog">
    <header className="p-3 border-b border-[var(--border)] flex flex-wrap gap-2 items-center">
      <h1 className="amber text-lg font-bold mr-auto">{symbol} {ui("research")}</h1>
      <button className="term-btn" disabled={watched} onClick={() => add(symbol)}>{watched ? ui("In watchlist") : ui("Add to watchlist")}</button>
      <button className="term-btn" onClick={() => choose("Alerts")}>{ui("Create alert")}</button>
      <button className="term-btn" onClick={() => { setNote(n => n + 1); choose("Notes"); }}>{ui("Write note")}</button>
      <button className="term-btn" aria-label={ui("Close research")} onClick={close}>{ui("Close")}</button>
    </header>
    <nav aria-label={ui("Research sections")} className="flex flex-wrap gap-1 p-2 border-b border-[var(--border)]">{TABS.map(t => <button className={`term-btn ${tab === t ? "active" : ""}`} aria-pressed={tab === t} key={t} onClick={() => choose(t)}>{ui(t)}</button>)}</nav>
    <div className="research-body">
      <WidgetErrorBoundary key={`${symbol}-${tab}-${note}`} name={`${symbol} ${tab}`}>
        {(tab==="Timeline"||recordKinds[tab])&&<ResearchRecords symbol={symbol} target={target} kinds={recordKinds[tab]}/>}
        {tab === "Overview" && <div className="research-overview"><section><h2 className="amber p-2">{ui("Quote / source")}</h2><QuoteWidget widget={widget} /></section><section><h2 className="amber p-2">{ui("Latest news")}</h2><NewsWidget widget={widget} /></section></div>}
        {tab === "Filings" && <FilingsWidget initialSymbol={symbol} />}
        {tab === "Thesis" && <ThesisWidget initialSymbol={symbol} />}
        {tab === "Financials" && <FundamentalsWidget widget={{ ...widget, type: "fundamentals" }} />}
        {tab === "Events" && <div className="space-y-4 p-2"><section><h2 className="amber">{symbol} {ui("earnings")}</h2><p className="dim">{ui("Expected provider dates; release sessions are unverified. Select a row for past results.")}</p><EarningsTab symbols={[symbol]} /></section><section><h2 className="amber">{ui("Market-wide economic calendar")}</h2><p className="dim">{ui("Current-week events provide context; they are not company-specific.")}</p><EconomicTab /></section></div>}

      </WidgetErrorBoundary>
      {chartVisited && <section hidden={tab !== "Chart"} aria-label={ui("Research chart")}><PollingScope active={tab === "Chart"}><WidgetErrorBoundary name={`${symbol} chart`}><div className="research-chart"><ChartWidget widget={{ ...widget, type: "chart" }} /></div></WidgetErrorBoundary></PollingScope></section>}
      {/* Keep editor state when reviewing another research section. */}
      {notesVisited && <section hidden={tab !== "Notes"}><WidgetErrorBoundary key={note} name={`${symbol} notes`}><JournalWidget widget={{ ...widget, type: "journal" }} startNew={note > 0} /></WidgetErrorBoundary></section>}
      {alertsVisited && <section hidden={tab !== "Alerts"}><WidgetErrorBoundary name={`${symbol} alerts`}><AlertsWidget initialSymbol={symbol} /></WidgetErrorBoundary></section>}
    </div>
  </Modal>;
}
