"use client";
import { useI18n } from "../../lib/use-i18n";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig, pctClass, type Quote } from "../../lib/api";
import { normalizeSymbol, symbolsParam } from "../../lib/symbol";
import { useTerminal } from "../../store/terminal";
import {quoteQuality} from "../../lib/valuation";
import SavedControls from "../SavedControls";
import Flash from "../Flash";

export default function WatchlistWidget() {
  const { t: ui, locale } = useI18n();

  const watchlist = useTerminal((s) => s.watchlist);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const removeFromWatchlist = useTerminal((s) => s.removeFromWatchlist);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const activeSymbol = useTerminal(s => s.activeSymbol);
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);

  const { data = [] } = useQuery({
    queryKey: ["watchlist", watchlist.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(watchlist)}`),
    enabled: watchlist.length > 0,
    refetchInterval: 1_000,
  });

  return (
    <div>
      <SavedControls kind="groups" value={watchlist} onLoad={value=>useTerminal.getState().setWatchlist(value as string[])} />
      <form
        className="flex gap-1 p-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          const sym = normalizeSymbol(input);
          if (!sym) {
            setInvalid(true);
            return;
          }
          addToWatchlist(sym);
          setInput("");
        }}
      >
        <input
          aria-label={ui("Add ticker")}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setInvalid(false);
          }}
          placeholder={ui("Add ticker…")}
          title={invalid ? ui("Not a valid ticker symbol") : undefined}
          aria-invalid={invalid}
          className={`flex-1 ${invalid ? "!border-[var(--down)]" : ""}`}
        />
        <button className="term-btn" type="submit" aria-label={ui("Add ticker")} title={ui("Add ticker")}>+</button>
      </form>
      <table className="data-table">
        <thead>
          <tr><th>{ui("Sym")}</th><th>{ui("Last")}</th><th>{ui("Chg%")}</th><th>{ui("Vol")}</th><th>{ui("Actions")}</th></tr>
        </thead>
        <tbody>
          {watchlist.map((sym) => {
            const q = data.find((d) => d.symbol === sym);
            return (
              <tr key={sym} className={activeSymbol === sym ? "watchlist-active" : ""} onClick={() => setActiveSymbol(sym)}>
                <td className="font-bold"><button aria-label={ui("Select {symbol}", { symbol: sym })} aria-pressed={activeSymbol === sym} className="amber watchlist-symbol" onClick={e => { e.stopPropagation(); setActiveSymbol(sym); }}>{sym}</button></td>
                <td title={quoteQuality(q) ? ui(quoteQuality(q)!) : ui("Retrieved {time}; indicative feed", { time: q?.retrievedAt ? new Date(q.retrievedAt).toLocaleString(locale) : ui("unknown") })}><Flash value={q?.price}>{fmt(q?.price)}</Flash>{quoteQuality(q)&&<span className="amber"> ⚠</span>}</td>
                <td className={pctClass(q?.changePercent)}>
                  <Flash value={q?.changePercent}>{fmt(q?.changePercent)}%</Flash>
                </td>
                <td>{fmtBig(q?.volume)}</td>
                <td>
                  <button className="term-btn" aria-label={ui("Research {symbol}", { symbol: sym })} onClick={e => { e.stopPropagation(); useTerminal.getState().openResearch(sym); }}>{ui("Research")}</button>{" "}
                  <button
                    aria-label={ui("Remove {symbol} from watchlist", { symbol: sym })}
                    title={ui("Remove {symbol} from watchlist", { symbol: sym })}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromWatchlist(sym);
                    }}
                    className="dim hover:text-[var(--down)]"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
