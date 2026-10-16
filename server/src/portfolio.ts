export type Trade = { id?: number; symbol: string; side: "BUY" | "SELL"; quantity: number; price: number; executed_at: string };
export type CashEvent = { id?: number; kind: "DEPOSIT" | "WITHDRAWAL" | "DIVIDEND" | "SPLIT"; amount: number; symbol: string | null; executed_at: string };
export type Position = { quantity: number; avgCost: number; realizedPnl: number; dividends: number };
export function replayLedger(trades: Trade[], events: CashEvent[]) {
  const positions = new Map<string, Position>();
  let cash = 0, netDeposits = 0;
  const ledger = [...trades.map((t) => ({ ...t, type: "trade" as const })), ...events.map((e) => ({ ...e, type: "event" as const }))].sort((a, b) => Date.parse(a.executed_at) - Date.parse(b.executed_at) || (a.type === b.type ? (a.id ?? 0) - (b.id ?? 0) : a.type === "event" ? -1 : 1));
  for (const item of ledger) {
    if (item.type === "event" && (item.kind === "DEPOSIT" || item.kind === "WITHDRAWAL")) {
      const flow = item.kind === "DEPOSIT" ? item.amount : -item.amount; cash += flow; netDeposits += flow; continue;
    }
    const symbol = item.symbol!;
    const p = positions.get(symbol) ?? { quantity: 0, avgCost: 0, realizedPnl: 0, dividends: 0 };
    positions.set(symbol, p);
    if (item.type === "event") {
      if (item.kind === "DIVIDEND") { cash += item.amount; p.dividends += item.amount; }
      if (item.kind === "SPLIT") { p.quantity *= item.amount; p.avgCost /= item.amount; }
    } else if (item.side === "BUY") {
      p.avgCost = (p.avgCost * p.quantity + item.price * item.quantity) / (p.quantity + item.quantity);
      p.quantity += item.quantity; cash -= item.price * item.quantity;
    } else {
      const tolerance = 1e-9 * Math.max(1, p.quantity, item.quantity);
      if (p.quantity === 0 || item.quantity > p.quantity + tolerance) throw new Error(`Sell exceeds available ${symbol} shares on ${item.executed_at}.`);
      p.realizedPnl += (item.price - p.avgCost) * item.quantity; p.quantity = Math.max(0, p.quantity - item.quantity);
      if (p.quantity < tolerance) { p.quantity = 0; p.avgCost = 0; }
      cash += item.price * item.quantity;
    }
  }
  if (![cash, netDeposits, ...[...positions.values()].flatMap((p) => [p.quantity, p.avgCost, p.realizedPnl, p.dividends])].every(Number.isFinite)) throw new Error("Ledger values exceed the supported numeric range.");
  return { positions, cash, netDeposits };
}
export function portfolioPerformance(trades: Trade[], events: CashEvent[], histories: Record<string, Array<{ time: number; close: number }>>, priceBasis: "raw" | "split-adjusted" | "unverified" = "unverified") {
  const state = replayLedger(trades, events);
  const warnings: string[] = [];
  if (!events.some((e) => e.kind === "DEPOSIT")) warnings.push("Record deposits and withdrawals to calculate cash-inclusive returns.");
  if (events.some((e) => e.kind === "SPLIT") && priceBasis === "unverified") warnings.push("Confirm the provider price basis before calculating returns across stock splits.");
  const firstDate = [...trades, ...events].map((e) => e.executed_at.slice(0, 10)).sort()[0];
  const prices = Object.fromEntries(Object.entries(histories).map(([symbol, rows]) => [symbol, rows.filter((r) => Number.isFinite(r.close) && r.close > 0).sort((a, b) => a.time - b.time).map((r) => {
    const date = new Date(r.time * 1000).toISOString().slice(0, 10);
    const factor = priceBasis === "split-adjusted" ? events.filter((e) => e.kind === "SPLIT" && e.symbol === symbol && e.executed_at.slice(0, 10) > date).reduce((f, e) => f * e.amount, 1) : 1;
    return { date, close: r.close * factor };
  })]));
  const dates = [...new Set([...Object.values(prices).flatMap((rows) => rows.map((r) => r.date)), ...trades.map((t) => t.executed_at.slice(0, 10)), ...events.map((e) => e.executed_at.slice(0, 10))])].filter((d) => firstDate && d >= firstDate && d <= new Date().toISOString().slice(0, 10)).sort();
  const priceAt = (symbol: string, date: string) => {
    const points = prices[symbol] ?? [];
    for (let i = points.length - 1; i >= 0; i--) if (points[i].date <= date) {
      return Date.parse(date) - Date.parse(points[i].date) <= 7 * 86400000 ? points[i].close : undefined;
    }
    return undefined;
  };
  let index = 100, peak = 100, worst = 0, previousNav: number | null = null, previousDate = "";
  const rows: Array<{ date: string; nav: number; index: number; benchmark?: number; drawdown: number }> = [];
  let missing = false;
  const benchmarkStart = dates.length ? priceAt("SPY", dates[0]) : undefined;
  for (const date of dates) {
    const daily = replayLedger(trades.filter((t) => t.executed_at.slice(0, 10) <= date), events.filter((e) => e.executed_at.slice(0, 10) <= date));
    let nav = daily.cash;
    let complete = true;
    for (const [symbol, p] of daily.positions) if (p.quantity > 0) {
      const price = priceAt(symbol, date); if (price === undefined) { complete = false; break; } nav += price * p.quantity;
    }
    if (!complete || nav <= 0 || daily.cash < -0.000001) { missing = true; previousNav = null; continue; }
    const flows = events.filter((e) => ["DEPOSIT", "WITHDRAWAL"].includes(e.kind) && e.executed_at.slice(0, 10) > previousDate && e.executed_at.slice(0, 10) <= date).reduce((sum, e) => sum + (e.kind === "DEPOSIT" ? e.amount : -e.amount), 0);
    if (previousNav !== null) index *= (nav - flows) / previousNav;
    if (index <= 0) { missing = true; previousNav = null; continue; }
    peak = Math.max(peak, index); const drawdown = (index / peak - 1) * 100; worst = Math.min(worst, drawdown);
    rows.push({ date, nav, index, ...(benchmarkStart && priceAt("SPY", date) ? { benchmark: priceAt("SPY", date)! / benchmarkStart * 100 } : {}), drawdown });
    previousNav = nav; previousDate = date;
  }
  if (missing) warnings.push("Incomplete history, non-positive equity, or missing funding: returns are withheld until the ledger and prices cover the period.");
  const end = rows.at(-1);
  const positions = [...state.positions].map(([symbol, p]) => { const price = end ? priceAt(symbol, end.date) : undefined; const marketValue = price !== undefined ? price * p.quantity : null; return { symbol, ...p, price: price ?? null, marketValue, unrealizedPnl: price !== undefined ? (price - p.avgCost) * p.quantity : null, weight: marketValue !== null && end ? marketValue / end.nav * 100 : null }; });
  return { rows: warnings.length ? [] : rows, positions, cash: state.cash, netDeposits: state.netDeposits, warnings, returnPercent: !warnings.length && end ? end.index - 100 : null, maxDrawdown: !warnings.length && end ? worst : null, asOf: end?.date ?? null };
}
