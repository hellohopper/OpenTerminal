"use client";
import { useI18n } from "../../lib/use-i18n";

import { usePollingQuery as useQuery } from "../../lib/use-polling-query";
import { apiGet, fmt, fmtBig, pctClass, type Quote } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import Flash from "../Flash";
import DataStatus from "../DataStatus";
import { useAdaptiveRefresh } from "../../lib/use-adaptive-refresh";
import { useDisplay } from "../../store/display";

type ShortVolume = { date: string; shortVolume: number; shortExemptVolume: number; totalVolume: number; shortVolumePercent: number };

export default function QuoteWidget({ widget }: { widget: WidgetInstance }) {
  const { t: ui, locale } = useI18n();

  const symbol = useWidgetSymbol(widget);
  const polling = useAdaptiveRefresh();
  const hideEmpty = useDisplay(state => state.hideEmptyQuoteFields);
  const setHideEmpty = useDisplay(state => state.setHideEmptyQuoteFields);
  const { data, error, refetch, isFetching, isLoading } = useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => {
      const quote = (await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(symbol)}`))[0];
      if (!quote) throw new Error("No quote returned for this symbol.");
      return quote;
    },
    enabled: polling.active,
    refetchInterval: polling.interval,
  });
  // FINRA's Reg SHO file only updates once a day (next-morning), so no point polling it fast.
  const { data: shortVol } = useQuery({
    queryKey: ["short-volume", symbol],
    queryFn: () => apiGet<ShortVolume | null>(`/api/short-volume/${encodeURIComponent(symbol)}`),
    staleTime: 3_600_000,
    enabled: polling.active,
  });

  const status = <DataStatus hasData={!!data} loading={isLoading} fetching={isFetching} error={error} stale={data?.stale} updatedAt={Date.parse(data?.retrievedAt ?? "")} onRefresh={refetch} />;
  if (!data) return <div ref={polling.ref} className="p-2">{status}</div>;

  const rows: Array<[string, string, string?]> = [
    ["Open", fmt(data.open)],
    ["High", fmt(data.high)],
    ["Low", fmt(data.low)],
    ["Prev Close", fmt(data.previousClose)],
    ["Bid", fmt(data.bid)],
    ["Ask", fmt(data.ask)],
    ["Volume", fmtBig(data.volume)],
    ["Avg Vol 3M", fmtBig(data.avgVolume)],
    ...(shortVol ? ([["Short Vol %", fmt(shortVol.shortVolumePercent, 1) + "%"]] as Array<[string, string]>) : []),
    ["Mkt Cap", fmtBig(data.marketCap)],
    ["P/E (ttm)", fmt(data.pe)],
    ["EPS (ttm)", fmt(data.eps)],
    ["Div Yield", data.dividendYield !== null ? fmt(data.dividendYield * 100) + "%" : "—"],
    ["52W High", fmt(data.week52High)],
    ["52W Low", fmt(data.week52Low)],
    ["Beta", fmt(data.beta)],
    ["Shares Out", fmtBig(data.sharesOutstanding)],
  ];

  return (
    <div ref={polling.ref} className="p-2">
      {status}
      <div className="quote-head">
        <Flash value={data.price} className="text-xl font-bold">{fmt(data.price)}</Flash>
        <Flash value={data.changePercent} className={`${pctClass(data.changePercent)} text-sm`}>
          {data.change !== null && data.change >= 0 ? "+" : ""}
          {fmt(data.change)} ({fmt(data.changePercent)}%)
        </Flash>
      </div>
      <div className="quote-provenance dim mb-2">
        <span>{[data.exchange, data.currency, data.source].filter(Boolean).join(" · ")}</span>
        <span className={data.stale ? "amber" : ""}>{ui(data.stale ? "STALE FALLBACK" : "Indicative feed")}</span>
        <details><summary>{ui("Data details")}</summary><div>{ui("Retrieved:")} {data.retrievedAt ? new Date(data.retrievedAt).toLocaleString(locale) : ui("unknown")}<br />{ui("Observed:")} {data.time ? new Date(data.time * 1000).toLocaleString(locale) : ui("not supplied")}</div></details>
      </div>
      <div className="dim text-[11px] mb-2 truncate">{data.name}</div>
      <label className="quote-empty-toggle dim"><input type="checkbox" checked={hideEmpty} onChange={event => setHideEmpty(event.target.checked)} />{ui("Hide unavailable fields")}</label>
      <div className="quote-fields" aria-label={ui("Key quote metrics")}>
        {rows.slice(0, 8).filter(([, value]) => !hideEmpty || value !== "—").map(([label, value]) => (
          <div key={label} className="flex justify-between border-b border-[#161616] py-0.5">
            <span className="dim">{ui(label)}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
      {rows.slice(0, 8).every(([, value]) => value === "—") && hideEmpty && <p className="dim">{ui("Key metrics are unavailable from this source.")}</p>}
      <details className="quote-more"><summary>{ui("More indicators")} · {rows.slice(8).filter(([, value]) => !hideEmpty || value !== "—").length}</summary>
        <div className="quote-fields">{rows.slice(8).filter(([, value]) => !hideEmpty || value !== "—").map(([label, value]) => <div key={label}><span className="dim">{ui(label)}</span><span>{value}</span></div>)}</div>
      </details>
    </div>
  );
}
