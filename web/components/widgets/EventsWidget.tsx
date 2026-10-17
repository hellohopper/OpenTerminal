"use client";
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
          aria-label="Event portfolio"
          value={portfolioId}
          onChange={(e) => setPortfolioId(e.target.value)}
        >
          <option value="">No portfolio selected</option>
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
          />
          Include workspace watchlist
        </label>
        <select
          aria-label="Event horizon"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        >
          <option value="7">Next 7 days</option>
          <option value="30">Next 30 days</option>
        </select>
        <select
          aria-label="Event type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">All upcoming events</option>
          <option value="earnings">Earnings</option>
          <option value="macro">Macro</option>
        </select>
        <button
          className="term-btn"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? "Refreshing…" : "Refresh events"}
        </button>
      </div>
      <p className="dim">
        Earnings dates are expected all-day dates with an unverified release
        session. Macro events show broad context for all selected holdings.
        Weights use fresh USD prices and exclude cash. Coverage:{" "}
        {data?.symbols.join(", ") || "No symbols"}.
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
        />{" "}
        Include a 24-hour calendar reminder
      </label>
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
      >
        Export visible events
      </button>
      {message && <p role="status">{message}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Event / source</th>
            <th>Related holdings</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>
                {e.allDay
                  ? e.date
                  : `${new Date(e.date).toLocaleString()} (local)`}
                {e.allDay && <div className="dim">Session unknown</div>}
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
                        {h.symbol}: {fmt(h.quantity, 4)} shares ·{" "}
                        {h.marketValue === null
                          ? "value unavailable"
                          : `${fmt(h.marketValue)} USD`}
                        {h.weight === null ? "" : ` · ${fmt(h.weight)}%`}
                      </div>
                    ))
                  : "Watchlist context"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!isFetching && !error && !events.length && (
        <p>No upcoming events available for this filter.</p>
      )}
      <details>
        <summary>Recorded dividends and splits (historical)</summary>
        <p className="dim">
          Most recent 20 ledger entries; these are not upcoming corporate-action
          forecasts.
        </p>
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
                  {e.kind === "SPLIT" ? "ratio" : "USD recorded cash"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
