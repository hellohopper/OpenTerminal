"use client";
import { useI18n } from "../lib/use-i18n";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost, fmt } from "../lib/api";
import { expiryYears } from "../lib/option-greeks";
import {
  strategyRisk,
  riskScenarios,
  type RiskAssumptions,
} from "../lib/strategy-risk";
import type { StrategyLeg } from "../lib/option-strategy";
export default function StrategyRisk({
  legs,
  spot,
  expiry,
  symbol,
}: {
  legs: StrategyLeg[];
  spot: number | null;
  expiry: string;
  symbol: string;
}) {
  const { t: ui } = useI18n();

  const [manualSpot, setManualSpot] = useState(""),
    [date, setDate] = useState(""),
    [vol, setVol] = useState("30"),
    [rate, setRate] = useState("4"),
    [dividend, setDividend] = useState("0"),
    [days, setDays] = useState("7"),
    [shock, setShock] = useState("10"),
    [volShock, setVolShock] = useState("10"),
    [message, setMessage] = useState("");
  const qc = useQueryClient();
  let risk: ReturnType<typeof strategyRisk> | undefined,
    rows: ReturnType<typeof riskScenarios> | undefined,
    a: RiskAssumptions | undefined,
    reason = "";
  const selectedDate = date || expiry;
  try {
    if (!legs.length) throw new Error("Add strategy legs to calculate risk.");
    if (
      [vol, rate, dividend, days, shock, volShock].some((v) => v.trim() === "")
    )
      throw new Error("Enter all risk assumptions.");
    const years = legs.some((l) => l.kind !== "stock")
      ? expiryYears(selectedDate)
      : 1;
    if (years === null)
      throw new Error("Choose a future risk expiration date.");
    const price = manualSpot.trim() ? Number(manualSpot) : spot;
    if (price === null || !Number.isFinite(price) || price <= 0)
      throw new Error(
        "Enter a positive risk spot or load an underlying quote.",
      );
    a = {
      spot: price,
      years,
      volatility: Number(vol) / 100,
      rate: Number(rate) / 100,
      dividend: Number(dividend) / 100,
    };
    risk = strategyRisk(legs, a);
    rows = riskScenarios(
      legs,
      a,
      Number(days),
      Number(shock),
      Number(volShock),
    );
  } catch (e) {
    reason = (e as Error).message;
  }
  return (
    <section className="border border-[var(--border)] p-2 space-y-2">
      <p className="amber">{ui("Position Greeks and risk scenarios")}</p>
      <div className="flex flex-wrap gap-2">
        {[
          ["Risk spot", manualSpot, setManualSpot],
          ["Risk IV %", vol, setVol],
          ["Risk rate %", rate, setRate],
          ["Risk dividend yield %", dividend, setDividend],
          ["Risk days forward", days, setDays],
          ["Risk spot shock %", shock, setShock],
          ["Risk IV shock points", volShock, setVolShock],
        ].map(([label, value, setter]) => (
          <label key={label as string} className="flex flex-col">
            {label as string}
            <input
              className="w-28"
              aria-label={label as string}
              type="number"
              step="any"
              value={value as string}
              placeholder={
                label === "Risk spot" ? String(spot ?? "Required") : undefined
              }
              onChange={(e) => (setter as (v: string) => void)(e.target.value)}
            />
          </label>
        ))}
        <label>{ui("Risk expiration")} <input
            aria-label={ui("Risk expiration")}
            type="date"
            value={selectedDate}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      {reason && <p className="dim">{reason}</p>}
      {risk && rows && a && (
        <>
          <p>{ui("Current modeled P&L:")} {fmt(risk.pnl)} {ui("USD · Net modeled value:")}{" "}
            {fmt(risk.greeks.price)} USD
          </p>
          <table className="data-table">
            <thead>
              <tr>
                {[
                  "Delta",
                  "Gamma",
                  "Theta / day",
                  "Vega / IV point",
                  "Rho / rate point",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {(["delta", "gamma", "theta", "vega", "rho"] as const).map(
                  (key) => (
                    <td key={key} data-testid={`risk-${key}`}>
                      {fmt(risk!.greeks[key], 4)}
                    </td>
                  ),
                )}
              </tr>
            </tbody>
          </table>
          <p>{ui("Modeled P&L after")} {days} {ui("calendar days (USD, relative to entry premiums)")} </p>
          <table className="data-table" data-testid="risk-scenarios">
            <thead>
              <tr>
                <th>{ui("Spot move")}</th>
                {[-Number(volShock), 0, Number(volShock)].map((shift, i) => (
                  <th key={i}>IV {fmt(Number(vol) + shift)}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>
                    {row.move}% · {fmt(row.spot)}
                  </td>
                  {row.cells.map((cell, j) => (
                    <td
                      key={j}
                      className={
                        cell === null ? "dim" : cell >= 0 ? "up" : "down"
                      }
                    >
                      {cell === null ? ui("Unavailable") : fmt(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="term-btn"
            onClick={async () => {
              try {
                await apiPost("/api/journal", {
                  symbol,
                  title: `${symbol} strategy risk scenario`,
                  kind: "research",
                  image: null,
                  body: JSON.stringify(
                    {
                      model:
                        "European Black-Scholes; standard 100-share contracts",
                      capturedAt: new Date().toISOString(),
                      expiry: selectedDate,
                      assumptions: a,
                      daysForward: Number(days),
                      spotShockPercent: Number(shock),
                      ivShockPoints: Number(volShock),
                      legs,
                      position: risk,
                      scenarios: rows,
                    },
                    null,
                    2,
                  ),
                });
                await qc.invalidateQueries({ queryKey: ["journal"] });
                setMessage("Risk scenario saved to journal.");
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >{ui("Save risk scenario to journal")} </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      <p className="dim text-[10px]">{ui("European Black-Scholes estimates with user-supplied common IV and continuous rates/dividend yield. Signed position Greeks include 100 shares per option contract and actual stock shares. Future values use remaining time; after expiration they use intrinsic value (cash settlement assumed). Excludes fees, margin, early assignment, discrete dividends and volatility skew. Grid cells with invalid IV are unavailable.")} </p>
    </section>
  );
}
