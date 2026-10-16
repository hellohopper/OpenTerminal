"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import AnalysisChart from "../AnalysisChart";
type Value = { value: number; filingUrl: string; filed: string; derived: boolean };
export type FinancialRow = { end: string; revenue: Value | null; netIncome: Value | null; operatingCashFlow: Value | null; capex: Value | null; assets: Value | null; liabilities: Value | null; freeCashFlow: number | null; netMargin: number | null; revenueYoY: number | null };
export type Financials = { name: string; currency: string; frequency: string; sourceUrl: string; retrievedAt: string; rows: FinancialRow[] };
export default function FundamentalsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [frequency, setFrequency] = useState("quarterly");
  const { data, error, isLoading } = useQuery({ queryKey: ["fundamentals", symbol, frequency], queryFn: () => apiGet<Financials>(`/api/fundamentals/${encodeURIComponent(symbol)}?frequency=${frequency}`), staleTime: 3600000 });
  const cell = (value: Value | null) => value ? <a href={value.filingUrl} target="_blank" rel="noopener noreferrer" title={`Filed ${value.filed}${value.derived ? "; quarter derived from cumulative disclosures" : ""}`} className="underline decoration-dotted">{fmtBig(value.value)}{value.derived ? "*" : ""}</a> : "—";
  return <div className="p-2 space-y-2"><div className="flex gap-2 items-center"><span className="amber">{data?.name ?? symbol}</span><select aria-label="Financial statement frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)}><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></div>
    {error ? <p className="down">Financial statements unavailable for {symbol}. US GAAP filings in USD are supported.</p> : isLoading ? <p className="dim">Loading SEC filings…</p> : !data?.rows.length ? <p className="dim">No supported financial facts reported for this company.</p> : <>
      <AnalysisChart rows={data.rows.map((r) => ({ date: r.end, ...(r.revenue ? { Revenue: r.revenue.value / 1e9 } : {}), ...(r.netIncome ? { "Net income": r.netIncome.value / 1e9 } : {}) }))} series={["Revenue", "Net income"]} />
      <p className="dim">Chart: USD billions · click a table value to open its SEC filing.</p>
      <table className="data-table"><thead><tr><th>Period end</th><th>Revenue</th><th>YoY</th><th>Net income</th><th>Margin</th><th>Op. cash</th><th>Capex</th><th>FCF</th><th>Assets</th><th>Liabilities</th></tr></thead><tbody>{[...data.rows].reverse().map((r) => <tr key={r.end}><td>{r.end}</td><td>{cell(r.revenue)}</td><td>{fmt(r.revenueYoY)}%</td><td>{cell(r.netIncome)}</td><td>{fmt(r.netMargin)}%</td><td>{cell(r.operatingCashFlow)}</td><td>{cell(r.capex)}</td><td>{fmtBig(r.freeCashFlow)}</td><td>{cell(r.assets)}</td><td>{cell(r.liabilities)}</td></tr>)}</tbody></table>
      <p className="dim text-[10px]">SEC US GAAP · USD · latest available amendments · *Quarter derived from comparable cumulative periods. Missing facts stay blank. FCF = operating cash flow − capex. <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="amber">Source</a></p>
    </>}
  </div>;
}
