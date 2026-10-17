"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, apiPost, apiDelete, fmt, pctClass, type Quote } from "../../lib/api";
import TradeCsvControls from "../TradeCsvControls";
import { valuePortfolio } from "../../lib/valuation";
import { symbolsParam } from "../../lib/symbol";

type Portfolio = { id: number; name: string };
type Position = { symbol: string; quantity: number; avgCost: number; realizedPnl: number };
type Tx = { id: number; symbol: string; side: string; quantity: number; price: number; executed_at: string };

export default function PortfolioWidget() {
  const qc = useQueryClient();
  const [portfolioId, setPortfolioId] = useState<number | null>(null);
  const [showTx, setShowTx] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [form, setForm] = useState({ symbol: "", side: "BUY", quantity: "", price: "", date: new Date().toISOString().slice(0, 10) });

  const { data: portfolios = [] } = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => apiGet<Portfolio[]>("/api/portfolios"),
  });
  const pid = portfolioId ?? portfolios[0]?.id;

  const { data: positions = [], error: positionsError, isLoading: positionsLoading } = useQuery({
    queryKey: ["positions", pid],
    queryFn: () => apiGet<Position[]>(`/api/portfolios/${pid}/positions`),
    enabled: !!pid,
  });

  const { data: txs = [] } = useQuery({
    queryKey: ["transactions", pid],
    queryFn: () => apiGet<Tx[]>(`/api/portfolios/${pid}/transactions`),
    enabled: !!pid && showTx,
  });

  const symbols = positions.map((p) => p.symbol);
  const { data: quotes = [] } = useQuery({
    queryKey: ["pf-quotes", symbols.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(symbols)}`),
    enabled: symbols.length > 0,
    refetchInterval: 30_000,
  });

  const addTx = useMutation({
    mutationFn: () =>
      apiPost(`/api/portfolios/${pid}/transactions`, {
        symbol: form.symbol,
        side: form.side,
        quantity: Number(form.quantity),
        price: Number(form.price),
        executed_at: `${form.date}T00:00:00Z`,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["performance", pid] });
      qc.invalidateQueries({ queryKey: ["positions", pid] });
      qc.invalidateQueries({ queryKey: ["transactions", pid] });
      setForm({ symbol: "", side: "BUY", quantity: "", price: "", date: new Date().toISOString().slice(0, 10) });
    },
  });

  const totals=valuePortfolio(positions,quotes);
  const unrealized=positionsLoading||positionsError?null:totals.unrealized;

  return (
    <div>
      {(deleteError || positionsError) && <p role="alert" className="down p-1">{deleteError || (positionsError as Error)?.message}</p>}
      <div className="flex gap-2 p-1 items-center flex-wrap">
        <select value={pid ?? ""} onChange={(e) => setPortfolioId(Number(e.target.value))}>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button className={`term-btn ${showTx ? "active" : ""}`} onClick={() => setShowTx(!showTx)}>
          TRANSACTIONS
        </button>
        <span className="ml-auto">
          MV <span className="amber">{fmt(positionsLoading||positionsError?null:totals.marketValue)}</span>{" "}
          <span className="dim">Unrl</span> <span className={pctClass(unrealized)}>{fmt(unrealized)}</span>{" "}
          <span className="dim">Rlzd</span> <span className={pctClass(totals.realized)}>{fmt(totals.realized)}</span>
        </span>
      </div>

      {totals.missing.length>0&&<p role="status" className="amber p-1">Valuation incomplete: {totals.missing.join(", ")}. Missing, expired or unverified-currency quotes are excluded; totals are withheld.</p>}
      <form
        className="flex gap-1 p-1 border-b border-[var(--border)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.symbol && form.quantity && form.price) addTx.mutate();
        }}
      >
        <input className="w-20" placeholder="Ticker" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} />
        <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>
          <option>BUY</option><option>SELL</option>
        </select>
        <input className="w-20" placeholder="Qty" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        <input className="w-24" placeholder="Price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <input type="date" aria-label="Trade date UTC" value={form.date} max={new Date().toISOString().slice(0,10)} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <button className="term-btn" type="submit">ADD</button>
        {addTx.error && <span className="down">{(addTx.error as Error).message}</span>}
      </form>

      {pid&&<TradeCsvControls key={pid} portfolioId={pid} onDone={()=>{qc.invalidateQueries({queryKey:["positions",pid]});qc.invalidateQueries({queryKey:["transactions",pid]});qc.invalidateQueries({queryKey:["performance",pid]});}}/>}
      {!showTx ? (
        <table className="data-table">
          <thead>
            <tr><th>Sym</th><th>Qty</th><th>Avg Cost</th><th>Last</th><th>Mkt Val</th><th>Unrl PnL</th><th>Rlzd PnL</th></tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const valued=totals.rows.find(r=>r.symbol===p.symbol)!;
              const last=valued.last,mv=valued.marketValue,upnl=valued.unrealized;
              return (
                <tr key={p.symbol}>
                  <td className="font-bold">{p.symbol}</td>
                  <td>{fmt(p.quantity, 4)}</td>
                  <td>{fmt(p.avgCost)}</td>
                  <td title={valued.reason??undefined}>{fmt(last)}{valued.reason&&<span className="amber"> ⚠</span>}</td>
                  <td>{fmt(mv)}</td>
                  <td className={pctClass(upnl)}>{fmt(upnl)}</td>
                  <td className={pctClass(p.realizedPnl)}>{fmt(p.realizedPnl)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Sym</th><th>Side</th><th>Qty</th><th>Price</th><th></th></tr>
          </thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td className="!text-left dim">{new Date(t.executed_at).toLocaleDateString()}</td>
                <td className="font-bold">{t.symbol}</td>
                <td className={t.side === "BUY" ? "up" : "down"}>{t.side}</td>
                <td>{fmt(t.quantity, 4)}</td>
                <td>{fmt(t.price)}</td>
                <td>
                  <button
                    className="dim hover:text-[var(--down)]"
                    onClick={async () => {
                      try {
                        await apiDelete(`/api/portfolios/${pid}/transactions/${t.id}`);
                        qc.invalidateQueries({ queryKey: ["performance", pid] });
                        qc.invalidateQueries({ queryKey: ["positions", pid] });
                        qc.invalidateQueries({ queryKey: ["transactions", pid] });
                        setDeleteError("");
                      } catch (err) { setDeleteError((err as Error).message); }
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
