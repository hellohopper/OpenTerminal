"use client";
import DataStatus from "../DataStatus";
import { useAdaptiveRefresh } from "../../lib/use-adaptive-refresh";
import { useWidgetSetting } from "../../lib/use-widget-setting";
import { useDisplay } from "../../store/display";
import { useI18n } from "../../lib/use-i18n";

import { usePollingQuery as useQuery } from "../../lib/use-polling-query";
import { Fragment, useEffect, useRef, useState } from "react";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import {
  optionAnalytics,
  expiryYears,
  type Analytics,
  type Greeks,
} from "../../lib/option-greeks";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type OptionRow = {
  strike: number | null;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility?: number | null;
  inTheMoney: boolean;
};
type Chain = {
  symbol: string;
  underlyingPrice: number | null;
  expirationDates: string[];
  selectedDate: string | null;
  calls: OptionRow[];
  puts: OptionRow[];
};
const COLUMNS: Array<{
  key: keyof Greeks;
  label: string;
  title: string;
  digits: number;
}> = [
  {
    key: "price",
    label: "Model",
    title: "European model price per underlying unit",
    digits: 3,
  },
  {
    key: "delta",
    label: "Δ",
    title: "Delta: price sensitivity per 1 underlying price unit",
    digits: 4,
  },
  {
    key: "gamma",
    label: "Γ",
    title: "Gamma: delta sensitivity per 1 underlying price unit",
    digits: 5,
  },
  {
    key: "theta",
    label: "Θ/day",
    title: "Theta per calendar day (annual theta / 365)",
    digits: 4,
  },
  {
    key: "vega",
    label: "Vega",
    title: "Vega per 1 percentage-point volatility increase",
    digits: 4,
  },
  {
    key: "rho",
    label: "Rho",
    title: "Rho per 1 percentage-point rate increase",
    digits: 4,
  },
];
const numberInput = (value: string) => value.trim() ? Number(value) : NaN;
const QUOTE_COLUMNS = [
  { key: 'last', label: 'Last' }, { key: 'bid', label: 'Bid' }, { key: 'ask', label: 'Ask' },
  { key: 'volume', label: 'Vol' }, { key: 'oi', label: 'Open interest' }, { key: 'iv', label: 'IV' },
];
function Side({ row, analytics, show, columns }: { row?: OptionRow; analytics?: Analytics; show: boolean; columns: string[] }) {
  const { t: ui } = useI18n();
  const iv = show ? analytics?.volatility : row?.impliedVolatility;
  const values: Record<string, string> = {
    last: fmt(row?.lastPrice), bid: fmt(row?.bid), ask: fmt(row?.ask), volume: fmtBig(row?.volume), oi: fmtBig(row?.openInterest),
    iv: typeof iv === 'number' && Number.isFinite(iv) && iv > 0 ? `${fmt(iv * 100, 1)}%` : '—',
  };
  return <>
    {columns.map(key => <td key={key} className={row?.inTheMoney ? 'option-itm' : ''}>{values[key]}{key === 'iv' && show && row && <div className="dim text-[9px]" title={analytics?.reason ? ui(analytics.reason) : undefined}>{analytics?.source ? ui(analytics.source) : ui('IV unavailable')}</div>}</td>)}
    {show && COLUMNS.map(column => <td key={column.key} title={ui(analytics?.reason ?? column.title)} aria-label={`${ui(column.label)}: ${analytics?.greeks ? fmt(analytics.greeks[column.key], column.digits) : ui("unavailable")}`}>{analytics?.greeks ? fmt(analytics.greeks[column.key], column.digits) : '—'}</td>)}
  </>;
}
export default function OptionsWidget({ widget }: { widget: WidgetInstance }) {
  const { t: ui, locale } = useI18n();
  const symbol = useWidgetSymbol(widget);
  const [selection, setSelection] = useWidgetSetting(widget, 'optionExpiry', { symbol: '', date: '' });
  const expiry = selection.symbol === symbol ? selection.date || undefined : undefined;
  const [show, setShow] = useWidgetSetting(widget, 'optionGreeks', false);
  const [rate, setRate] = useWidgetSetting(widget, 'optionRate', '0');
  const [dividend, setDividend] = useWidgetSetting(widget, 'optionDividend', '0');
  const [override, setOverride] = useWidgetSetting(widget, 'optionIv', '');
  const [view, setView] = useWidgetSetting(widget, 'optionView', 'auto');
  const [columns, setColumns] = useWidgetSetting(widget, 'optionColumns', ['last', 'bid', 'ask', 'iv']);
  const [now, setNow] = useState(() => Date.now());
  const [width, setWidth] = useState(0);
  const fontSize = useDisplay(state => state.fontSize);
  const container = useRef<HTMLDivElement>(null);
  const polling = useAdaptiveRefresh(20_000);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!show || !polling.active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [show, polling.active]);
  const query = useQuery({
    queryKey: ['options', symbol, expiry],
    queryFn: () => apiGet<Chain>(`/api/options/${encodeURIComponent(symbol)}${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ''}`),
    enabled: polling.active, refetchInterval: polling.interval, retry: 0,
  });
  const { data, error, isLoading, isFetching, dataUpdatedAt, refetch } = query;
  const r = numberInput(rate) / 100, q = numberInput(dividend) / 100, v = override.trim() ? numberInput(override) / 100 : undefined;
  const validAssumptions = Number.isFinite(r) && r >= -0.2 && r <= 1 && Number.isFinite(q) && q >= 0 && q <= 1 && (v === undefined || (Number.isFinite(v) && v > 0 && v <= 5));
  const years = expiryYears(data?.selectedDate ?? null, now);
  const byStrike = new Map<number, { call?: OptionRow; put?: OptionRow }>();
  for (const call of data?.calls ?? []) if (call.strike !== null) byStrike.set(call.strike, { ...byStrike.get(call.strike), call });
  for (const put of data?.puts ?? []) if (put.strike !== null) byStrike.set(put.strike, { ...byStrike.get(put.strike), put });
  const strikes = [...byStrike.keys()].sort((a, b) => a - b);
  const resolvedView = view === 'auto' ? (width / fontSize < 75 ? 'calls' : 'both') : view;
  const sides = resolvedView === 'both' ? ['calls', 'puts'] as const : [resolvedView] as ('calls' | 'puts')[];
  const visibleColumns = QUOTE_COLUMNS.filter(c => columns.includes(c.key));
  const columnCount = visibleColumns.length + (show ? COLUMNS.length : 0);
  function analyze(row: OptionRow | undefined, kind: 'call' | 'put'): Analytics | undefined {
    if (!show || !row) return;
    if (!validAssumptions) return { greeks: null, volatility: null, source: null, reason: 'Invalid model assumptions.' };
    return optionAnalytics({ kind, spot: data?.underlyingPrice ?? NaN, strike: row.strike ?? NaN, years: years ?? NaN, rate: r, dividend: q }, row, v);
  }
  return <div ref={container} className="options-panel">
    <div ref={polling.ref}><DataStatus hasData={!!data} loading={isLoading} fetching={isFetching} error={error} updatedAt={dataUpdatedAt} onRefresh={refetch} /></div>
    {data && <>
      <div className="option-controls">
        <span>{ui('Underlying')} <strong className="amber">{fmt(data.underlyingPrice)}</strong></span>
        <label>{ui('Expiry')} <select aria-label={ui('Option expiry')} value={data.selectedDate ?? ''} onChange={e => setSelection({ symbol, date: e.target.value })}>{data.expirationDates.map(date => <option key={date} value={date}>{date}</option>)}</select></label>
        <label>{ui('Option view')} <select aria-label={ui('Option view')} value={view} onChange={e => setView(e.target.value as typeof view)}><option value="auto">{ui('Automatic')}</option><option value="both">{ui('Calls and puts')}</option><option value="calls">{ui('Calls only')}</option><option value="puts">{ui('Puts only')}</option></select></label>
        <label><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> {ui('Show Greeks')}</label>
        <details className="option-columns"><summary>{ui('Option columns')}</summary><div>{QUOTE_COLUMNS.map(column => <label key={column.key}><input type="checkbox" checked={columns.includes(column.key)} disabled={columns.length === 1 && columns.includes(column.key)} onChange={e => setColumns(previous => e.target.checked ? [...previous, column.key] : previous.filter(key => key !== column.key))} /> {ui(column.label)}</label>)}</div></details>
      </div>
      {resolvedView !== 'both' && <div className="option-side-switch" role="group" aria-label={ui('Option side')}>
        <button className={`term-btn ${resolvedView === 'calls' ? 'active' : ''}`} aria-pressed={resolvedView === 'calls'} onClick={() => setView('calls')}>{ui('CALLS')}</button>
        <button className={`term-btn ${resolvedView === 'puts' ? 'active' : ''}`} aria-pressed={resolvedView === 'puts'} onClick={() => setView('puts')}>{ui('PUTS')}</button>
        {view === 'auto' && <span className="dim">{ui('Single-side view fits this panel. Switch sides above.')}</span>}
      </div>}
      {show && <details className="option-model" open><summary>{ui('Model assumptions')}</summary><div className="option-controls">
        <label>{ui('Rate %')} <input aria-label={ui('Risk-free rate percent')} type="number" step="any" min="-20" max="100" value={rate} onChange={e => setRate(e.target.value)} /></label>
        <label>{ui('Dividend %')} <input aria-label={ui('Dividend yield percent')} type="number" step="any" min="0" max="100" value={dividend} onChange={e => setDividend(e.target.value)} /></label>
        <label>{ui('IV override %')} <input aria-label={ui('IV override percent')} type="number" step="any" min="0.0001" max="500" placeholder={ui('Auto')} value={override} onChange={e => setOverride(e.target.value)} /></label>
        <button className="term-btn" onClick={() => { setRate('0'); setDividend('0'); setOverride(''); }}>{ui('Reset model')}</button>
      </div>
      {!validAssumptions && <p role="alert" className="down">{ui('Enter rate −20% to 100%, dividend 0% to 100%, and optional IV greater than 0% up to 500%. Blank rate/dividend is invalid.')}</p>}
      {years === null && <p role="status" className="amber">{ui('Greeks unavailable: expiration is missing, expired or outside the model’s 20-year horizon.')}</p>}
      {(!data.underlyingPrice || !Number.isFinite(data.underlyingPrice) || data.underlyingPrice <= 0) && <p role="status" className="amber">{ui('Greeks unavailable: valid underlying price is missing.')}</p>}
      <p className="dim">{ui('Model as of')} {new Date(now).toLocaleString(locale)}</p>
      </details>}
      {show && <details className="option-notes"><summary>{ui('Model methodology and units')}</summary>
        <p>{ui('European Black-Scholes estimate; American early exercise and discrete dividends are excluded. Rate and dividend are annual continuous assumptions (default 0%, not live rates). IV: user override → provider → valid bid/ask midpoint fit; no last-trade fallback.')}</p>
        <p>{ui('Per underlying unit, not contract: Δ/Γ per 1 price unit, Θ per calendar day, Vega/Rho per 1 percentage point. ACT/365; expiry assumed 16:00 New York (DST-aware), not AM settlement or early closes.')}</p>
        <p>{ui('Missing inputs or unsolvable IV show —; hover for details. Quotes may be delayed.')}</p>
      </details>}
      <div className="option-table-scroll" tabIndex={0} role="region" aria-label={ui('Option chain table')}>
        <table className="data-table option-chain"><thead>
          <tr><th rowSpan={2} className="option-strike">{ui('STRIKE')}</th>{sides.map(side => <th key={side} colSpan={columnCount} className="option-side-heading">{ui(side === 'calls' ? 'CALLS' : 'PUTS')}</th>)}</tr>
          <tr>{sides.map(side => <Fragment key={side}>{visibleColumns.map(column => <th key={column.key}>{ui(column.label)}</th>)}{show && COLUMNS.map(column => <th key={column.key} title={ui(column.title)}>{ui(column.label)}</th>)}</Fragment>)}</tr>
        </thead><tbody>{strikes.map(strike => {
          const row = byStrike.get(strike)!;
          return <tr key={strike}><td className="option-strike amber">{fmt(strike)}</td>{sides.map(side => <Side key={side} row={side === 'calls' ? row.call : row.put} analytics={analyze(side === 'calls' ? row.call : row.put, side === 'calls' ? 'call' : 'put')} columns={visibleColumns.map(c => c.key)} show={show} />)}</tr>;
        })}</tbody></table>
        {strikes.length === 0 && <p className="p-2 dim">{ui('No contracts available for this expiry.')}</p>}
      </div>
    </>}
  </div>;
}
