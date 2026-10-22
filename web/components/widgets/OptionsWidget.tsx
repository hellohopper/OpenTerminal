"use client";
import { useI18n } from "../../lib/use-i18n";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
const numberInput = (value: string) => (value.trim() ? Number(value) : NaN);
function Side({
  row,
  analytics,
  show,
  put = false,
}: {
  row?: OptionRow;
  analytics?: Analytics;
  show: boolean;
  put?: boolean;
}) {
  const { t: ui } = useI18n();

  const background = row?.inTheMoney
    ? put
      ? "bg-[#200d0d]"
      : "bg-[#0d2010]"
    : "";
  const iv = show ? analytics?.volatility : row?.impliedVolatility;
  return (
    <>
      <td className={background}>{fmt(row?.lastPrice)}</td>
      <td className={background}>{fmt(row?.bid)}</td>
      <td className={background}>{fmt(row?.ask)}</td>
      <td className={background}>{fmtBig(row?.volume)}</td>
      <td className={background}>
        {fmtBig(row?.openInterest)} ·{" "}
        {typeof iv === "number" && Number.isFinite(iv) && iv > 0
          ? `${fmt(iv * 100, 1)}%`
          : "—"}
        {show && row && (
          <div
            className="dim text-[9px]"
            title={analytics?.reason ?? undefined}
          >
            {analytics?.source ?? ui("IV unavailable")}
          </div>
        )}
      </td>
      {show &&
        COLUMNS.map((c) => (
          <td
            key={c.key}
            className={background}
            title={analytics?.reason ?? c.title}
            aria-label={`${c.label}: ${analytics?.greeks ? fmt(analytics.greeks[c.key], c.digits) : "unavailable"}`}
          >
            {analytics?.greeks ? fmt(analytics.greeks[c.key], c.digits) : "—"}
          </td>
        ))}
    </>
  );
}
export default function OptionsWidget({ widget }: { widget: WidgetInstance }) {
  const { t: ui } = useI18n();

  const symbol = useWidgetSymbol(widget);
  const [selection, setSelection] = useState<{
    symbol: string;
    date: string;
  } | null>(null);
  const expiry = selection?.symbol === symbol ? selection.date : undefined;
  const [show, setShow] = useState(false);
  const [rate, setRate] = useState("0");
  const [dividend, setDividend] = useState("0");
  const [override, setOverride] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!show) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [show]);
  const { data, error, isLoading } = useQuery({
    queryKey: ["options", symbol, expiry],
    queryFn: () =>
      apiGet<Chain>(
        `/api/options/${encodeURIComponent(symbol)}${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ""}`,
      ),
    refetchInterval: 20_000,
    retry: 0,
  });
  if (error)
    return (
      <div className="p-2">
        <div className="down">{ui("Option chain unavailable for")} {symbol}</div>
        <div className="dim">{(error as Error).message}</div>
      </div>
    );
  if (isLoading || !data)
    return <div className="p-2 dim">{ui("Loading option chain…")}</div>;
  const r = numberInput(rate) / 100,
    q = numberInput(dividend) / 100,
    v = override.trim() ? numberInput(override) / 100 : undefined;
  const validAssumptions =
    Number.isFinite(r) &&
    r >= -0.2 &&
    r <= 1 &&
    Number.isFinite(q) &&
    q >= 0 &&
    q <= 1 &&
    (v === undefined || (Number.isFinite(v) && v > 0 && v <= 5));
  const years = expiryYears(data.selectedDate, now);
  const byStrike = new Map<number, { call?: OptionRow; put?: OptionRow }>();
  for (const c of data.calls)
    if (c.strike !== null)
      byStrike.set(c.strike, { ...byStrike.get(c.strike), call: c });
  for (const p of data.puts)
    if (p.strike !== null)
      byStrike.set(p.strike, { ...byStrike.get(p.strike), put: p });
  const strikes = [...byStrike.keys()].sort((a, b) => a - b);
  function analyze(
    row: OptionRow | undefined,
    kind: "call" | "put",
  ): Analytics | undefined {
    if (!show || !row) return;
    if (!validAssumptions)
      return {
        greeks: null,
        volatility: null,
        source: null,
        reason: "Invalid model assumptions.",
      };
    return optionAnalytics(
      {
        kind,
        spot: data!.underlyingPrice ?? NaN,
        strike: row.strike ?? NaN,
        years: years ?? NaN,
        rate: r,
        dividend: q,
      },
      row,
      v,
    );
  }
  const headings = (
    <>
      <th>{ui("Last")}</th>
      <th>{ui("Bid")}</th>
      <th>{ui("Ask")}</th>
      <th>{ui("Vol")}</th>
      <th>{ui("OI · IV")}</th>
      {show &&
        COLUMNS.map((c) => (
          <th key={c.key} title={c.title}>
            {c.label}
          </th>
        ))}
    </>
  );
  return (
    <div>
      <div className="flex gap-2 items-center p-1 flex-wrap">
        <span className="dim">{ui("Underlying")}</span>
        <span className="amber font-bold">{fmt(data.underlyingPrice)}</span>
        <label className="dim ml-2">{ui("Expiry")}{" "}
          <select
            aria-label={ui("Option expiry")}
            value={data.selectedDate ?? ""}
            onChange={(e) => setSelection({ symbol, date: e.target.value })}
          >
            {data.expirationDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="ml-2">
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
          />{" "}{ui("Show Greeks")} </label>
      </div>
      {show && (
        <div className="p-1 space-y-1">
          <div className="flex gap-2 flex-wrap">
            <label>{ui("Rate %")}{" "}
              <input
                className="w-20"
                aria-label={ui("Risk-free rate percent")}
                type="number"
                step="any"
                min="-20"
                max="100"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </label>
            <label>{ui("Dividend %")}{" "}
              <input
                className="w-20"
                aria-label={ui("Dividend yield percent")}
                type="number"
                step="any"
                min="0"
                max="100"
                value={dividend}
                onChange={(e) => setDividend(e.target.value)}
              />
            </label>
            <label>{ui("IV override %")}{" "}
              <input
                className="w-24"
                aria-label={ui("IV override percent")}
                type="number"
                step="any"
                min="0.0001"
                max="500"
                placeholder={ui("Auto")}
                value={override}
                onChange={(e) => setOverride(e.target.value)}
              />
            </label>
            <button
              className="term-btn"
              onClick={() => {
                setRate("0");
                setDividend("0");
                setOverride("");
              }}
            >{ui("Reset model")} </button>
          </div>
          {!validAssumptions && (
            <p role="alert" className="down">{ui("Enter rate −20% to 100%, dividend 0% to 100%, and optional IV greater than 0% up to 500%. Blank rate/dividend is invalid.")} </p>
          )}
          {years === null && (
            <p role="status" className="amber">{ui("Greeks unavailable: expiration is missing, expired or outside the model’s 20-year horizon.")} </p>
          )}
          {(!Number.isFinite(data.underlyingPrice) ||
            !data.underlyingPrice ||
            data.underlyingPrice <= 0) && (
            <p role="status" className="amber">{ui("Greeks unavailable: valid underlying price is missing.")} </p>
          )}
          <p className="dim text-[10px]">{ui("European Black-Scholes estimate; American early exercise and discrete dividends are excluded. Rate and dividend are annual continuous assumptions (default 0%, not live rates). IV: user override → provider → valid bid/ask midpoint fit; no last-trade fallback.")} </p>
          <p className="dim text-[10px]">{ui("Per underlying unit, not contract: Δ/Γ per 1 price unit, Θ per calendar day, Vega/Rho per 1 percentage point. ACT/365; expiry assumed 16:00 New York (DST-aware), not AM settlement or early closes.")}{" "}
            {years !== null ? `${fmt(years * 365, 3)} days remaining · ` : ""}{ui("Model as of")} {new Date(now).toISOString()}{ui(". Missing inputs or unsolvable IV show —; hover for details. Quotes may be delayed.")} </p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th
                colSpan={5 + (show ? COLUMNS.length : 0)}
                className="!text-center up"
              >{ui("CALLS")} </th>
              <th className="!text-center">{ui("STRIKE")}</th>
              <th
                colSpan={5 + (show ? COLUMNS.length : 0)}
                className="!text-center down"
              >{ui("PUTS")} </th>
            </tr>
            <tr>
              {headings}
              <th></th>
              {headings}
            </tr>
          </thead>
          <tbody>
            {strikes.map((strike) => {
              const { call, put } = byStrike.get(strike)!;
              return (
                <tr key={strike}>
                  <Side
                    row={call}
                    analytics={analyze(call, "call")}
                    show={show}
                  />
                  <td className="!text-center font-bold amber">
                    {fmt(strike)}
                  </td>
                  <Side row={put} put analytics={analyze(put, "put")} show={show} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
