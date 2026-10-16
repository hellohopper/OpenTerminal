import { describe, expect, it } from "vitest";
import { compareSeries, maxDrawdown } from "../../web/lib/comparison";
const candle = (day: number, close: number) => ({ time: Date.UTC(2026, 0, day) / 1000, open: close, high: close, low: close, close, volume: 0 });
describe("asset comparison", () => {
  it("normalizes on common dates without forward-filling missing observations", () => {
    const result = compareSeries([{ symbol: "A", candles: [candle(1, 20), candle(2, 10), candle(3, 15)] }, { symbol: "B", candles: [candle(2, 100), candle(3, 110)] }]);
    expect(result.rows).toEqual([{ date: "2026-01-02", A: 100, B: 100 }, { date: "2026-01-03", A: 150, B: 110.00000000000001 }]);
    expect(result.metrics[0].returnPercent).toBe(50);
  });
  it("returns no comparison for disjoint dates or empty histories", () => {
    expect(compareSeries([{ symbol: "A", candles: [candle(1, 10)] }, { symbol: "B", candles: [candle(2, 10)] }]).rows).toEqual([]);
    expect(compareSeries([]).rows).toEqual([]);
  });
  it("computes drawdown from the running peak", () => { expect(maxDrawdown([100, 120, 90, 110])).toBe(-25); });
});
