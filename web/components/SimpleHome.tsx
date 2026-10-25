"use client";
import { useState } from "react";
import { usePollingQuery as useQuery } from "../lib/use-polling-query";
import { useI18n } from "../lib/use-i18n";
import { useTerminal } from "../store/terminal";
import { useInterface, type SimplePage } from "../store/interface";
import { SIMPLE_CARDS, type SimpleCard } from "../lib/workspaces";
import { apiGet, fmt, pctClass, type Quote } from "../lib/api";
import { normalizeSymbol, symbolsParam } from "../lib/symbol";
import { valuePortfolio } from "../lib/valuation";
import { useAdaptiveRefresh } from "../lib/use-adaptive-refresh";
import type { AlertRule } from "../lib/alerts";
import type { Briefing } from "./widgets/BriefingWidget";
import AlertsWidget from "./widgets/AlertsWidget";
import WidgetErrorBoundary from "./WidgetErrorBoundary";
import SharedWatchlistControls from "./SharedWatchlistControls";
import { useSharedWatchlist } from "../lib/use-shared-watchlist";
import DataStatus from "./DataStatus";

const PAGE_LABELS: Record<SimplePage, string> = { today: "Today", watchlist: "Watchlist", holdings: "Holdings", research: "Research", alerts: "Alerts" };
const CARD_LABELS: Record<SimpleCard, string> = { briefing: "Market briefing", watchlist: "Watchlist", holdings: "Holdings", alerts: "Alerts" };
export function SimpleNavigation({ mobile = false }: { mobile?: boolean }) {
  const { t } = useI18n(), page = useInterface(s => s.page), setPage = useInterface(s => s.setPage);
  return <nav className={mobile ? "mobile-nav simple-mobile-nav" : "simple-nav"} aria-label={t(mobile ? "Mobile simple navigation" : "Simple navigation")}>{(["today", "watchlist", "holdings", "research", "alerts"] as const).map(p => <button className={mobile ? "" : `term-btn ${p === page ? "active" : ""}`} aria-current={p === page ? "page" : undefined} key={p} onClick={() => setPage(p)}>{t(PAGE_LABELS[p])}</button>)}</nav>;
}
function QueryFeedback({ loading, error, retry, hasData = false, updatedAt, fetching = false }: { loading: boolean; error: Error | null; retry: () => void; hasData?:boolean;updatedAt?:number;fetching?:boolean }) {
  return <DataStatus loading={loading} fetching={fetching} error={error} hasData={hasData} updatedAt={updatedAt} onRefresh={retry} />;
}
function MarketBriefing() {
  const { t } = useI18n(), watchlist = useTerminal(s => s.watchlist), symbols = watchlist.slice(0, 12);
  const q = useQuery({ queryKey: ["simple-briefing", symbols.join(",")], queryFn: () => apiGet<Briefing>(`/api/briefings/current?symbols=${symbolsParam(symbols)}&mode=pre-market`), enabled: !!symbols.length, staleTime: 60000 });
  return <><QueryFeedback loading={q.isLoading} fetching={q.isFetching} hasData={!!q.data} updatedAt={q.dataUpdatedAt} error={q.error} retry={() => void q.refetch()} />
    {!symbols.length && <p className="dim">{t("Add symbols to your watchlist to generate a personal briefing.")}</p>}
    {q.data && <><p>{q.data.summary}</p><div className="simple-indexes">{q.data.indexes.slice(0, 3).map(q => <p key={q.symbol}>{q.symbol} <strong className={pctClass(q.changePercent)}>{fmt(q.changePercent)}%</strong></p>)}</div>
    {q.data.headlines.slice(0, 3).map(n => <p className="simple-headline" key={n.link}><a href={n.link} target="_blank" rel="noopener noreferrer">{n.title}</a><span className="dim"> · {n.publisher}</span></p>)}
    {q.data.warnings.map(w => <p className="amber" key={w}>{w}</p>)}</>}
  </>;
}
function SimpleWatchlist({ preview = false }: { preview?: boolean }) {
  const { t } = useI18n(), watchlist = useTerminal(s => s.watchlist), [input, setInput] = useState(""), [invalid, setInvalid] = useState(false);
  const shared = useSharedWatchlist();
  const polling = useAdaptiveRefresh(15000);
  const q = useQuery({ queryKey: ["watchlist", watchlist.join(",")], queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(watchlist)}`), enabled: !!watchlist.length && polling.active, refetchInterval: polling.interval });
  const symbols = preview ? watchlist.slice(0, 5) : watchlist;
  return <div ref={polling.ref}>
    {!preview && <SharedWatchlistControls />}
    {shared.mutation.error && <p role="alert">{shared.mutation.error.message}</p>}
    {!preview && <form className="simple-add" onSubmit={e => { e.preventDefault(); const symbol = normalizeSymbol(input); if (!symbol) { setInvalid(true); return; } shared.add(symbol); setInput(""); setInvalid(false); }}>
      <label>{t("Add ticker")}<input aria-invalid={invalid} maxLength={20} value={input} placeholder="AAPL" onChange={e => setInput(e.target.value)} /></label><button className="term-btn">{t("Add")}</button>
      {invalid && <p role="alert">{t("Not a valid ticker symbol")}</p>}
    </form>}
    <QueryFeedback loading={q.isLoading} fetching={q.isFetching} hasData={!!q.data&&!!watchlist.length} updatedAt={q.dataUpdatedAt} error={q.error} retry={() => void q.refetch()} />
    {!watchlist.length && <p className="dim">{t("Your watchlist is empty. Add a symbol above.")}</p>}
    {symbols.map(symbol => { const quote = q.data?.find(q => q.symbol === symbol); return <div className="simple-asset" key={symbol}>
      <button className="simple-asset-link" aria-label={t("Research {symbol}", { symbol })} onClick={() => useTerminal.getState().openResearch(symbol)}><span><strong>{symbol}</strong><span className="dim">{quote?.name ?? ""}</span></span><span className="simple-price"><strong>{fmt(quote?.price)}</strong><span className={pctClass(quote?.changePercent)}>{fmt(quote?.changePercent)}%</span>{quote?.stale && <span className="amber">{t("Stale")}</span>}</span></button>
      {!preview && <button className="term-btn" aria-label={t("Remove {symbol} from watchlist", { symbol })} onClick={() => shared.remove(symbol)}>×</button>}
    </div>; })}
    {preview && <button className="term-btn" onClick={() => useInterface.getState().setPage("watchlist")}>{t("View watchlist")}</button>}
  </div>;
}
function SimpleHoldings({ preview = false }: { preview?: boolean }) {
  const { t } = useI18n(), workspace = useTerminal(s=>s.activeWorkspaceId), selected = useInterface(s=>s.accounts[workspace]);
  const accounts = useQuery({ queryKey: ["portfolios"], queryFn: () => apiGet<{ id: number; name: string }[]>("/api/portfolios") });
  const pid = accounts.data?.find(account=>account.id===selected)?.id ?? accounts.data?.[0]?.id;
  const positions = useQuery({ queryKey: ["positions", pid], queryFn: () => apiGet<{ symbol: string; quantity: number; avgCost: number; realizedPnl: number }[]>(`/api/portfolios/${pid}/positions`), enabled: !!pid });
  const symbols = positions.data?.map(p => p.symbol) ?? [];
  const quotes = useQuery({ queryKey: ["pf-quotes", symbols.join(",")], queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(symbols)}`), enabled: !!symbols.length, refetchInterval: 30000 });
  const total = valuePortfolio(positions.data ?? [], quotes.data ?? []);
  const ready = !!positions.data && !positions.error && (!symbols.length || !!quotes.data && !quotes.error);
  return <><QueryFeedback loading={accounts.isLoading || positions.isLoading || quotes.isLoading} fetching={accounts.isFetching||positions.isFetching||quotes.isFetching} hasData={!!positions.data} updatedAt={symbols.length?Math.min(positions.dataUpdatedAt,quotes.dataUpdatedAt):positions.dataUpdatedAt} error={accounts.error ?? positions.error ?? quotes.error} retry={() => { void accounts.refetch(); if (pid) void positions.refetch(); if (symbols.length) void quotes.refetch(); }} />
    {!!accounts.data?.length && <label>{t("Portfolio account")} <select aria-label={t("Portfolio account")} value={pid} onChange={e => useInterface.getState().setAccount(workspace,Number(e.target.value))}>{accounts.data.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
    <p className="simple-total">{t("Holdings value")} <strong>{fmt(ready ? total.marketValue : null)}</strong></p><p>{t("Unrealized P&L")} <span className={pctClass(ready ? total.unrealized : null)}>{fmt(ready ? total.unrealized : null)}</span></p>
    <p className="dim">{t("Positions only; excludes cash.")}</p>
    {!!total.missing.length && <p role="status" className="amber">{t("Valuation incomplete:")} {total.missing.join(", ")}</p>}
    {!preview && positions.data?.map(p => <div className="simple-asset" key={p.symbol}><button className="simple-asset-link" onClick={() => useTerminal.getState().openResearch(p.symbol)}><span><strong>{p.symbol}</strong><span className="dim">{p.quantity} {t("shares")}</span></span><span>{fmt(total.rows.find(r => r.symbol === p.symbol)?.marketValue)}</span></button></div>)}
    {ready && !symbols.length && <p>{t("No holdings yet.")}</p>}
    <button className="term-btn" onClick={() => preview ? useInterface.getState().setPage("holdings") : useTerminal.getState().addWidget("portfolio")}>{t(preview ? "View holdings" : "Open portfolio tools")}</button>
  </>;
}
function AlertsSummary() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ["price-alerts"], queryFn: () => apiGet<{ alerts: AlertRule[] }>("/api/alerts"), refetchInterval: 30000 });
  return <><QueryFeedback loading={q.isLoading} fetching={q.isFetching} hasData={!!q.data} updatedAt={q.dataUpdatedAt} error={q.error} retry={() => void q.refetch()} />{q.data && <p>{t("{count} active alerts", { count: q.data.alerts.filter(a => a.armed).length })}</p>}<button className="term-btn" onClick={() => useInterface.getState().setPage("alerts")}>{t("Manage alerts")}</button></>;
}
export default function SimpleHome() {
  const { t } = useI18n(), page = useInterface(s => s.page), setPage = useInterface(s => s.setPage), cards = useTerminal(s => s.simpleCards ?? SIMPLE_CARDS);
  const symbol = useTerminal(s => s.activeSymbol);
  return <div className="simple-home">
    <SimpleNavigation />
    <div className="simple-heading"><h1>{t(PAGE_LABELS[page])}</h1>{page === "today" && <details><summary>{t("Customize home")}</summary><div className="simple-customize">{SIMPLE_CARDS.map(card => <label key={card}><input type="checkbox" checked={cards.includes(card)} onChange={e => useTerminal.getState().setSimpleCards(e.target.checked ? [...cards, card] : cards.filter(c => c !== card))} /> {t(CARD_LABELS[card])}</label>)}</div></details>}</div>
    {page === "today" ? <div className="simple-grid">{cards.map(card => <section className={`simple-card simple-card-${card}`} key={card} aria-label={t(CARD_LABELS[card])}><h2>{t(CARD_LABELS[card])}</h2><WidgetErrorBoundary name={t(CARD_LABELS[card])}>{card === "briefing" ? <MarketBriefing /> : card === "watchlist" ? <SimpleWatchlist preview /> : card === "holdings" ? <SimpleHoldings preview /> : <AlertsSummary />}</WidgetErrorBoundary></section>)}{!cards.length && <p>{t("Choose cards in Customize home.")}</p>}</div>
      : <section className="simple-card" aria-label={t(PAGE_LABELS[page])}><WidgetErrorBoundary key={page} name={t(PAGE_LABELS[page])}>{page === "watchlist" ? <SimpleWatchlist /> : page === "holdings" ? <SimpleHoldings /> : page === "alerts" ? <AlertsWidget /> : <><p>{t("Search for a company or open your selected symbol.")}</p><div className="simple-add"><button className="term-btn" onClick={() => useTerminal.getState().setCommandOpen(true)}>{t("Search symbols")}</button><button className="term-btn" onClick={() => useTerminal.getState().openResearch(symbol)}>{t("Research {symbol}", { symbol })}</button></div></>}</WidgetErrorBoundary></section>}
  </div>;
}
