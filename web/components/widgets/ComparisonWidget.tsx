"use client";
import { useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiGet, fmt, pctClass, type Candle } from "../../lib/api";
import { normalizeSymbol } from "../../lib/symbol";
import { compareSeries } from "../../lib/comparison";
import AnalysisChart from "../AnalysisChart";
export default function ComparisonWidget() {
  const [draft, setDraft] = useState("AAPL,MSFT,SPY");
  const [symbols, setSymbols] = useState(["AAPL", "MSFT", "SPY"]);
  const [range, setRange] = useState("6M");
  const [validation, setValidation] = useState("");
  const queries = useQueries({ queries: symbols.map((symbol) => ({ queryKey: ["history", symbol, range], queryFn: () => apiGet<Candle[]>(`/api/history-library/series/${encodeURIComponent(symbol)}?range=${range}`), staleTime: 60000 })) });
  const signature = queries.map((q) => q.dataUpdatedAt).join(",");
  const result = useMemo(() => compareSeries(symbols.map((symbol, i) => ({ symbol, candles: queries[i].data ?? [] }))), [symbols, signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const failed = queries.map((q, i) => q.error ? symbols[i] : null).filter(Boolean);
  return <div className="p-2 space-y-2">
    <form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); const raw = draft.split(","); const parsed = [...new Set(raw.map(normalizeSymbol))]; if (parsed.some((s) => !s) || parsed.length < 2 || parsed.length > 5) { setValidation("Enter 2–5 distinct, comma-separated symbols."); return; } setSymbols(parsed as string[]); setValidation(""); }}>
      <input aria-label="Comparison symbols" value={draft} onChange={(e) => setDraft(e.target.value)} className="flex-1 min-w-32" /><select aria-label="Comparison range" value={range} onChange={(e) => setRange(e.target.value)}>{["6M", "1Y", "5Y"].map((r) => <option key={r}>{r}</option>)}</select><button className="term-btn">Compare</button>
    </form>
    {validation && <p role="alert" className="down">{validation}</p>}
    {queries.some((q) => q.isLoading) ? <p className="dim">Loading price history…</p> : failed.length ? <p className="down">History unavailable: {failed.join(", ")}. Try another range or symbol.</p> : result.rows.length < 2 ? <p className="dim">Not enough common trading dates to compare these assets.</p> : <>
      <AnalysisChart rows={result.rows} series={symbols} />
      <table className="data-table"><thead><tr><th>Symbol</th><th>Return</th><th>Max drawdown</th><th>Volatility*</th></tr></thead><tbody>{result.metrics.map((m) => <tr key={m.symbol}><td>{m.symbol}</td><td className={pctClass(m.returnPercent)}>{fmt(m.returnPercent)}%</td><td className="down">{fmt(m.maxDrawdown)}%</td><td>{fmt(m.volatility)}%</td></tr>)}</tbody></table>
      <p className="dim">{String(result.rows[0].date)} → {String(result.rows.at(-1)!.date)} · {result.rows.length} common dates · start = 100.</p>
    </>}
    <p className="dim text-[10px]">Price comparison in each asset’s quote currency; no dividend or FX adjustment. Sources may use different split adjustments. *Volatility assumes 252 daily observations/year; weekly ranges are not annualized.</p>
  </div>;
}
