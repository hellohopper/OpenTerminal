"use client";
import { useWidgetSetting } from "../../lib/use-widget-setting";
import { useI18n } from "../../lib/use-i18n";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import AnalysisChart from "../AnalysisChart";
type Value = { value: number; filingUrl: string; filed: string; derived: boolean };
export type FinancialRow = { end: string; revenue: Value | null; netIncome: Value | null; operatingCashFlow: Value | null; capex: Value | null; assets: Value | null; liabilities: Value | null; freeCashFlow: number | null; netMargin: number | null; revenueYoY: number | null };
export type Financials = { name: string; currency: string; frequency: string; sourceUrl: string; retrievedAt: string; rows: FinancialRow[] };
export default function FundamentalsWidget({ widget }: { widget: WidgetInstance }) {
  const { t: ui } = useI18n();

  const symbol = useWidgetSymbol(widget);
  const [frequency, setFrequency] = useWidgetSetting(widget, "fundamentalFrequency", "quarterly");
  const { data, error, isLoading } = useQuery({ queryKey: ["fundamentals", symbol, frequency], queryFn: () => apiGet<Financials>(`/api/fundamentals/${encodeURIComponent(symbol)}?frequency=${frequency}`), staleTime: 3600000 });
  const cell = (value: Value | null) => value ? <a href={value.filingUrl} target="_blank" rel="noopener noreferrer" title={ui("Filed {date}", { date: value.filed }) + (value.derived ? ui("; quarter derived from cumulative disclosures") : "")} className="underline decoration-dotted">{fmtBig(value.value)}{value.derived ? "*" : ""}</a> : "—";
  return <div className="p-2 space-y-2"><div className="flex gap-2 items-center"><span className="amber">{data?.name ?? symbol}</span><select aria-label={ui("Financial statement frequency")} value={frequency} onChange={(e) => setFrequency(e.target.value)}><option value="quarterly">{ui("Quarterly")}</option><option value="annual">{ui("Annual")}</option></select></div>
    {error ? <p className="down">{ui("Financial statements unavailable for")} {symbol}{ui(". US GAAP filings in USD are supported.")}</p> : isLoading ? <p className="dim">{ui("Loading SEC filings…")}</p> : !data?.rows.length ? <p className="dim">{ui("No supported financial facts reported for this company.")}</p> : <>
      <AnalysisChart rows={data.rows.map((r) => ({ date: r.end, ...(r.revenue ? { Revenue: r.revenue.value / 1e9 } : {}), ...(r.netIncome ? { "Net income": r.netIncome.value / 1e9 } : {}) }))} series={["Revenue", "Net income"]} />
      <p className="dim">{ui("Chart: USD billions · click a table value to open its SEC filing.")}</p>
      <table className="data-table"><thead><tr><th>{ui("Period end")}</th><th>{ui("Revenue")}</th><th>{ui("YoY")}</th><th>{ui("Net income")}</th><th>{ui("Margin")}</th><th>{ui("Op. cash")}</th><th>{ui("Capex")}</th><th>{ui("FCF")}</th><th>{ui("Assets")}</th><th>{ui("Liabilities")}</th></tr></thead><tbody>{[...data.rows].reverse().map((r) => <tr key={r.end}><td>{r.end}</td><td>{cell(r.revenue)}</td><td>{fmt(r.revenueYoY)}%</td><td>{cell(r.netIncome)}</td><td>{fmt(r.netMargin)}%</td><td>{cell(r.operatingCashFlow)}</td><td>{cell(r.capex)}</td><td>{fmtBig(r.freeCashFlow)}</td><td>{cell(r.assets)}</td><td>{cell(r.liabilities)}</td></tr>)}</tbody></table>
      <p className="dim text-[10px]">{ui("SEC US GAAP · USD · latest available amendments · *Quarter derived from comparable cumulative periods. Missing facts stay blank. FCF = operating cash flow − capex.")} <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="amber">{ui("Source")}</a></p>
    </>}
  </div>;
}
