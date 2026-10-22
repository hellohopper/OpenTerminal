"use client";
import { useI18n } from "../../lib/use-i18n";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import {
  exportEventCalendar,
  type HoldingEvent,
} from "../../lib/event-calendar";
type Data = {
  events: HoldingEvent[];
  generatedAt: string;
  symbols: string[];
  warnings: string[];
  recorded: {
    kind: string;
    symbol: string | null;
    amount: number;
    executed_at: string;
  }[];
};
export default function EventsWidget() {
  const { t: ui } = useI18n();

  const watchlist = useTerminal((s) => s.watchlist),
    [portfolioId, setPortfolioId] = useState(""),
    [includeWatchlist, setIncludeWatchlist] = useState(true),
    [days, setDays] = useState("7"),
    [kind, setKind] = useState("all"),
    [reminder, setReminder] = useState(false),
    [message, setMessage] = useState("");
  const { data: portfolios = [] } = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => apiGet<{ id: number; name: string }[]>("/api/portfolios"),
  });
  const params = new URLSearchParams({
    symbols: includeWatchlist ? watchlist.join(",") : "",
    days,
  });
  if (portfolioId) params.set("portfolioId", portfolioId);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["holding-events", params.toString()],
    queryFn: () => apiGet<Data>(`/api/holding-events?${params}`),
    staleTime: 60000,
    retry: 0,
  });
  const events = (data?.events ?? []).filter(
    (e) => kind === "all" || e.kind === kind,
  );
  return (
    <div className="p-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <select
          aria-label={ui("Event portfolio")}
          value={portfolioId}
          onChange={(e) => setPortfolioId(e.target.value)}
        >
          <option value="">{ui("No portfolio selected")}</option>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={includeWatchlist}
            onChange={(e) => setIncludeWatchlist(e.target.checked)}
          />{ui("Include workspace watchlist")} </label>
        <select
          aria-label={ui("Event horizon")}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        >
          <option value="7">{ui("Next 7 days")}</option>
          <option value="30">{ui("Next 30 days")}</option>
        </select>
        <select
          aria-label={ui("Event type")}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">{ui("All upcoming events")}</option>
          <option value="earnings">{ui("Earnings")}</option>
          <option value="macro">{ui("Macro")}</option>
        </select>
        <button
          className="term-btn"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? ui("Refreshing…") : ui("Refresh events")}
        </button>
      </div>
      <p className="dim">{ui("Earnings dates are expected all-day dates with an unverified release session. Macro events show broad context for all selected holdings. Weights use fresh USD prices and exclude cash. Coverage:")}{" "}
        {data?.symbols.join(", ") || ui("No symbols")}.
      </p>
      {data?.warnings.map((w) => (
        <p key={w} className="amber">
          {w}
        </p>
      ))}
      {error && (
        <p role="alert" className="down">
          {error.message}
        </p>
      )}
      <label>
        <input
          type="checkbox"
          checked={reminder}
          onChange={(e) => setReminder(e.target.checked)}
        />{" "}{ui("Include a 24-hour calendar reminder")} </label>
      <button
        className="term-btn ml-2"
        disabled={!events.length}
        onClick={() => {
          try {
            const url = URL.createObjectURL(
                new Blob([exportEventCalendar(events, reminder)], {
                  type: "text/calendar;charset=utf-8",
                }),
              ),
              a = document.createElement("a");
            a.href = url;
            a.download = "holding-events.ics";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage(
              "Calendar downloaded. Import it into your calendar app to enable reminders.",
            );
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >{ui("Export visible events")} </button>
      {message && <p role="status">{message}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>{ui("Date")}</th>
            <th>{ui("Event / source")}</th>
            <th>{ui("Related holdings")}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>
                {e.allDay
                  ? e.date
                  : `${new Date(e.date).toLocaleString()} (local)`}
                {e.allDay && <div className="dim">{ui("Session unknown")}</div>}
              </td>
              <td>
                <span>{e.title}</span>
                <div className="dim">
                  {e.impact} · {e.source}
                </div>
              </td>
              <td>
                {e.exposure.length
                  ? e.exposure.map((h) => (
                      <div key={h.symbol}>
                        {h.symbol}: {fmt(h.quantity, 4)} {ui("shares ·")}{" "}
                        {h.marketValue === null
                          ? ui("value unavailable")
                          : `${fmt(h.marketValue)} USD`}
                        {h.weight === null ? "" : ` · ${fmt(h.weight)}%`}
                      </div>
                    ))
                  : ui("Watchlist context")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!isFetching && !error && !events.length && (
        <p>{ui("No upcoming events available for this filter.")}</p>
      )}
      <details>
        <summary>{ui("Recorded dividends and splits (historical)")}</summary>
        <p className="dim">{ui("Most recent 20 ledger entries; these are not upcoming corporate-action forecasts.")} </p>
        <table className="data-table">
          <tbody>
            {data?.recorded.map((e, i) => (
              <tr key={i}>
                <td>{e.executed_at.slice(0, 10)}</td>
                <td>
                  {e.symbol} · {e.kind}
                </td>
                <td>
                  {fmt(e.amount, 4)}{" "}
                  {e.kind === "SPLIT" ? ui("ratio") : ui("USD recorded cash")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
