"use client";
import { useI18n } from "../lib/use-i18n";
import RelativeTime from "./RelativeTime";

export default function DataStatus({ hasData, loading, fetching, error, stale = false, updatedAt, onRefresh }: {
  hasData: boolean; loading: boolean; fetching: boolean; error?: Error | null; stale?: boolean; updatedAt?: number; onRefresh: () => unknown;
}) {
  const { t: ui } = useI18n();
  const warning = !!error || stale;
  const message = error ? (hasData ? "Refresh failed. Showing last available data." : "Unable to load data.")
    : loading && !hasData ? "Loading data…" : stale ? "Cached data. Live refresh unavailable." : fetching ? "Refreshing…" : hasData ? "Data ready" : "No data available.";
  return <div className={`data-status ${warning ? "amber" : "dim"}`} role={error ? "alert" : "status"}>
    <span>{ui(message)}</span>
    {hasData && !!updatedAt && Number.isFinite(updatedAt) && <span className="dim">{ui("Last successful retrieval")} · <RelativeTime value={new Date(updatedAt).toISOString()} /></span>}
    <button className="term-btn" disabled={fetching} onClick={() => onRefresh()} aria-label={ui(error ? "Retry data refresh" : "Refresh data")}>{ui(error ? "Retry" : "Refresh")}</button>
    {error && <details className="w-full"><summary>{ui("Error details")}</summary><p className="break-words">{ui(error.message)}</p></details>}
  </div>;
}
