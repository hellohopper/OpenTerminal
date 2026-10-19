"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, apiPost, fmt } from "../../lib/api";
import { analyzeStrategy, type StrategyLeg } from "../../lib/option-strategy";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import {useTerminal} from "../../store/terminal";
import StrategyRisk from "../StrategyRisk";
import AnalysisChart from "../AnalysisChart";
type Option = {
  strike: number | null;
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
};
type Chain = {
  selectedDate: string | null;
  underlyingPrice: number | null;
  expirationDates: string[];
  calls: Option[];
  puts: Option[];
};
export default function StrategyWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  return <Builder key={symbol} symbol={symbol} />;
}
function Builder({ symbol }: { symbol: string }) {
  const qc = useQueryClient();
  const [expiry, setExpiry] = useState(""),
    [legs, setLegs] = useState<StrategyLeg[]>([]),
    [message, setMessage] = useState("");
  const { data, error } = useQuery({
    queryKey: ["options", symbol, expiry || undefined],
    queryFn: () =>
      apiGet<Chain>(
        `/api/options/${encodeURIComponent(symbol)}${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ""}`,
      ),
    staleTime: 60000,
    retry: 0,
  });
  const spot = data?.underlyingPrice ?? 100;
  const strikes = [
    ...new Set(
      (data?.calls ?? [])
        .map((r) => r.strike)
        .filter((n): n is number => n !== null),
    ),
  ].sort((a, b) => a - b);
  const option = (
    kind: "call" | "put",
    side: "BUY" | "SELL",
    strike: number,
  ): StrategyLeg => {
    const row = (kind === "call" ? data?.calls : data?.puts)?.find(
      (r) => r.strike === strike,
    );
    return {
      kind,
      side,
      strike,
      premium: (side === "BUY" ? row?.ask : row?.bid) ?? row?.lastPrice ?? 0,
      quantity: 1,
    };
  };
  const template = (type: string) => {
    const firstAbove = strikes.findIndex((s) => s >= spot);
    const index = Math.max(
      0,
      Math.min(
        strikes.length - 2,
        firstAbove < 0 ? strikes.length - 2 : firstAbove,
      ),
    );
    const low = strikes[index],
      high = strikes[index + 1];
    setLegs(
      type === "call-spread"
        ? [option("call", "BUY", low), option("call", "SELL", high)]
        : type === "put-spread"
          ? [option("put", "BUY", high), option("put", "SELL", low)]
          : type === "straddle"
            ? [option("call", "BUY", low), option("put", "BUY", low)]
            : [
                {
                  kind: "stock",
                  side: "BUY",
                  strike: 0,
                  premium: spot,
                  quantity: 100,
                },
                option("call", "SELL", high),
              ],
    );
    setMessage("");
  };
  let analysis: ReturnType<typeof analyzeStrategy> | undefined,
    validation = "";
  if (legs.length) {
    try {
      analysis = analyzeStrategy(legs, spot);
    } catch (err) {
      validation = (err as Error).message;
    }
  }
  const money = (n: number) => (Number.isFinite(n) ? fmt(n) : "Unlimited");
  const patch = (i: number, change: Partial<StrategyLeg>) =>
    setLegs(legs.map((leg, j) => (j === i ? { ...leg, ...change } : leg)));
  return (
    <div className="p-2 space-y-2">
      <div className="flex gap-2 items-center flex-wrap">
        <span className="amber">
          {symbol} ·{" "}
          {data?.underlyingPrice == null ? "spot unavailable" : fmt(spot)}
        </span>
        <select
          aria-label="Strategy expiration"
          value={expiry || data?.selectedDate || ""}
          onChange={(e) => {
            setExpiry(e.target.value);
            setLegs([]);
          }}
        >
          <option value="">Select expiration</option>
          {data?.expirationDates.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </div>
      {error && (
        <p className="down">
          Option quotes unavailable. You can enter legs manually; confirm
          strikes, expiry and premiums.
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {[
          ["call-spread", "Bull call spread"],
          ["put-spread", "Bear put spread"],
          ["straddle", "Long straddle"],
          ["covered", "Covered call"],
        ].map(([type, label]) => (
          <button
            key={type}
            className="term-btn"
            disabled={strikes.length < 2}
            onClick={() => template(type)}
          >
            {label}
          </button>
        ))}
        <button
          className="term-btn"
          disabled={legs.length >= 8}
          onClick={() =>
            setLegs([
              ...legs,
              {
                kind: "call",
                side: "BUY",
                strike: spot,
                premium: 1,
                quantity: 1,
              },
            ])
          }
        >
          Add leg
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th>Side</th>
            <th>Strike</th>
            <th>Entry / premium</th>
            <th>Qty</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg, i) => (
            <tr key={i}>
              <td>
                <select
                  aria-label={`Leg ${i + 1} instrument`}
                  value={leg.kind}
                  onChange={(e) =>
                    patch(i, { kind: e.target.value as StrategyLeg["kind"] })
                  }
                >
                  {["call", "put", "stock"].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  aria-label={`Leg ${i + 1} side`}
                  value={leg.side}
                  onChange={(e) =>
                    patch(i, { side: e.target.value as StrategyLeg["side"] })
                  }
                >
                  <option>BUY</option>
                  <option>SELL</option>
                </select>
              </td>
              <td>
                <input
                  aria-label={`Leg ${i + 1} strike`}
                  className="w-20"
                  type="number"
                  min={0}
                  step="any"
                  disabled={leg.kind === "stock"}
                  value={leg.strike}
                  onChange={(e) => patch(i, { strike: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  aria-label={`Leg ${i + 1} premium`}
                  className="w-20"
                  type="number"
                  min={0}
                  step="any"
                  value={leg.premium}
                  onChange={(e) =>
                    patch(i, { premium: Number(e.target.value) })
                  }
                />
              </td>
              <td>
                <input
                  aria-label={`Leg ${i + 1} quantity`}
                  className="w-16"
                  type="number"
                  min={1}
                  step={1}
                  value={leg.quantity}
                  onChange={(e) =>
                    patch(i, { quantity: Number(e.target.value) })
                  }
                />
              </td>
              <td>
                <button
                  aria-label={`Remove leg ${i + 1}`}
                  onClick={() => setLegs(legs.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {validation && (
        <p role="alert" className="down">
          {validation}
        </p>
      )}
      {analysis && (
        <>
          <div className="flex gap-4 flex-wrap">
            <span>Net debit {fmt(analysis.netDebit)} USD</span>
            <span className="up">
              Max profit {money(analysis.maximumProfit)}
            </span>
            <span className="down">Max loss {money(analysis.maximumLoss)}</span>
            <span>
              Break-even{" "}
              {analysis.breakEvens.map((p) => fmt(p)).join(", ") || "None"}
              {analysis.breakEvenIntervals
                .map(([a, b]) => ` [${fmt(a)}–${money(b)}]`)
                .join("")}
            </span>
          </div>
          <AnalysisChart
            rows={analysis.rows}
            series={["P&L USD"]}
            xKey="Underlying"
            numericX
          />
          <button
            className="term-btn"
            onClick={async () => {
              try {
                await apiPost("/api/journal", {
                  symbol,
                  title: `${symbol} options strategy — ${expiry || data?.selectedDate || "manual expiry"}`,
                  kind: "research",
                  body: `Expiration payoff scenario; 100 shares/contract.\n${JSON.stringify(legs, null, 2)}\nMax profit: ${money(analysis!.maximumProfit)}; max loss: ${money(analysis!.maximumLoss)}.`,
                  image: null,
                });
                qc.invalidateQueries({ queryKey: ["journal"] });
                setMessage("Strategy saved to journal.");
              } catch (err) {
                setMessage((err as Error).message);
              }
            }}
          >
            Save strategy to journal
          </button>
          <button className="term-btn" onClick={()=>{const options=legs.filter(l=>l.kind!=='stock');if(options.length!==legs.length||!options.length||options.some(l=>l.quantity!==options[0].quantity)){setMessage('Copy requires option-only legs with equal contract quantities. Review the strategy structure first.');return;}sessionStorage.setItem('option-position-draft',JSON.stringify({symbol,expiry:expiry||data?.selectedDate||'',quantity:options[0]?.quantity??1,legs:options.map(({kind,side,strike,premium})=>({kind,side,strike,premium}))}));useTerminal.getState().addWidget('optionPositions');setMessage('Strategy copied to option holdings. Confirm standard contracts and supported debit structure before opening.');}}>Create simulated option holding</button>
        </>
      )}
      <StrategyRisk
        legs={legs}
        spot={data?.underlyingPrice ?? null}
        expiry={expiry || data?.selectedDate || ""}
        symbol={symbol}
      />
      {message && (
        <p role="status" className="amber">
          {message}
        </p>
      )}
      <p className="dim text-[10px]">
        Expiration-only P&amp;L, USD. All option legs share one underlying and
        expiry. Quantities mean contracts for options and shares for stock; 100
        shares per standard contract. Premiums are editable estimates. Excludes
        fees, early assignment, dividends, margin and adjusted contracts.
        Unlimited risk is never clipped to the chart range.
      </p>
    </div>
  );
}
