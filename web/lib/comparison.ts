import type { Candle } from "./api";
export function maxDrawdown(values: number[]): number {
  let peak = values[0] ?? 0;
  let worst = 0;
  for (const value of values) { peak = Math.max(peak, value); if (peak > 0) worst = Math.min(worst, (value / peak - 1) * 100); }
  return worst;
}
export function compareSeries(series: Array<{ symbol: string; candles: Candle[] }>) {
  const maps = series.map(({ candles }) => {
    const daily = new Map<string, number>();
    for (const c of [...candles].sort((a, b) => a.time - b.time)) {
      if (Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0) daily.set(new Date(c.time * 1000).toISOString().slice(0, 10), c.close);
    }
    return daily;
  });
  const dates = maps.length ? [...maps[0].keys()].filter((date) => maps.every((m) => m.has(date))).sort() : [];
  const rows = dates.map((date) => Object.fromEntries([["date", date], ...series.map((s, i) => [s.symbol, maps[i].get(date)! / maps[i].get(dates[0])! * 100])]) as Record<string, number | string>);
  const metrics = series.map((s, i) => {
    const prices = dates.map((d) => maps[i].get(d)!);
    const returns = prices.slice(1).map((p, j) => p / prices[j] - 1);
    const mean = returns.reduce((sum, v) => sum + v, 0) / returns.length;
    const daily = dates.length > 1 && (Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / (dates.length - 1) <= 3 * 86400000;
    const volatility = daily && returns.length > 1 ? Math.sqrt(returns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252) * 100 : null;
    return { symbol: s.symbol, returnPercent: prices.length > 1 ? (prices.at(-1)! / prices[0] - 1) * 100 : null, maxDrawdown: prices.length > 1 ? maxDrawdown(prices) : null, volatility };
  });
  return { rows, metrics };
}
