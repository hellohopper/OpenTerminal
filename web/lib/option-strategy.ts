export type StrategyLeg = { kind: "call" | "put" | "stock"; side: "BUY" | "SELL"; strike: number; premium: number; quantity: number };
export function payoff(legs: StrategyLeg[], price: number): number {
  return legs.reduce((sum, leg) => {
    const intrinsic = leg.kind === "call" ? Math.max(price - leg.strike, 0) : leg.kind === "put" ? Math.max(leg.strike - price, 0) : price;
    return sum + (intrinsic - leg.premium) * leg.quantity * (leg.kind === "stock" ? 1 : 100) * (leg.side === "BUY" ? 1 : -1);
  }, 0);
}
export function analyzeStrategy(legs: StrategyLeg[], spot: number) {
  if (!legs.length || legs.length > 8 || !Number.isFinite(spot) || spot <= 0 || legs.some((l) => !["call", "put", "stock"].includes(l.kind) || !["BUY", "SELL"].includes(l.side) || ![l.strike, l.premium, l.quantity].every(Number.isFinite) || l.strike < 0 || l.premium < 0 || l.quantity <= 0 || !Number.isInteger(l.quantity) || l.quantity > 1000000)) throw new Error("Use 1–8 valid legs, whole positive quantities, and nonnegative strikes and premiums.");
  const critical = [...new Set([0, ...legs.filter((l) => l.kind !== "stock").map((l) => l.strike)])].sort((a, b) => a - b);
  const values = critical.map((p) => payoff(legs, p));
  const slope = legs.reduce((sum, l) => sum + (l.kind === "put" ? 0 : l.quantity * (l.kind === "call" ? 100 : 1) * (l.side === "BUY" ? 1 : -1)), 0);
  const breakEvens: number[] = [], breakEvenIntervals: Array<[number, number]> = [];
  critical.forEach((price, i) => {
    if (Math.abs(values[i]) < 1e-8) breakEvens.push(price);
    if (i + 1 < critical.length) {
      if (values[i] * values[i + 1] < 0) breakEvens.push(price - values[i] * (critical[i + 1] - price) / (values[i + 1] - values[i]));
      if (Math.abs(values[i]) < 1e-8 && Math.abs(values[i + 1]) < 1e-8) breakEvenIntervals.push([price, critical[i + 1]]);
    }
  });
  const last = critical.at(-1)!;
  if (slope !== 0) { const root = last - values.at(-1)! / slope; if (root > last) breakEvens.push(root); }
  else if (Math.abs(values.at(-1)!) < 1e-8) breakEvenIntervals.push([last, Infinity]);
  const netDebit = legs.reduce((sum, l) => sum + l.premium * l.quantity * (l.kind === "stock" ? 1 : 100) * (l.side === "BUY" ? 1 : -1), 0);
  const maximumProfit = slope > 0 ? Infinity : Math.max(...values);
  const maximumLoss = slope < 0 ? Infinity : Math.max(0, -Math.min(...values));
  const upper = Math.max(spot * 1.6, last * 1.25, ...breakEvens.map((p) => p * 1.15));
  const points = [...new Set([...Array.from({ length: 81 }, (_, i) => upper * i / 80), ...critical, ...breakEvens])].sort((a, b) => a - b);
  return { maximumProfit, maximumLoss, netDebit, breakEvens: [...new Set(breakEvens)].sort((a, b) => a - b), breakEvenIntervals, rows: points.map((price) => ({ Underlying: price, "P&L USD": payoff(legs, price) })) };
}
