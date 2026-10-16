import { describe, it, expect } from "vitest";
import {
  parseDrawings,
  trendPoints,
  normalizedOverlay,
} from "../../web/lib/chart-tools";
import type { Candle } from "../../web/lib/api";
const candle = (time: number, close: number) => ({ time, close }) as Candle;
describe("chart tools", () => {
  it("validates persisted annotations without accepting corrupt or duplicate entries", () => {
    expect(parseDrawings("invalid")).toEqual([]);
    expect(parseDrawings("{}")).toEqual([]);
    expect(
      parseDrawings(
        JSON.stringify([
          { id: "a", kind: "horizontal", price: 42 },
          { id: "a", kind: "horizontal", price: 50 },
          {
            id: "b",
            kind: "trend",
            start: { time: 2, price: 1 },
            end: { time: 2, price: 3 },
          },
          {
            id: "c",
            kind: "trend",
            start: { time: 1, price: 2 },
            end: { time: 3, price: 4 },
          },
        ]),
      ).map((d) => d.id),
    ).toEqual(["a", "c"]);
  });
  it("bounds stored annotations and orders reverse-clicked trend endpoints", () => {
    expect(
      parseDrawings(
        JSON.stringify(
          Array.from({ length: 60 }, (_, i) => ({
            id: String(i),
            kind: "horizontal",
            price: i,
          })),
        ),
      ),
    ).toHaveLength(50);
    expect(
      trendPoints({
        id: "x",
        kind: "trend",
        start: { time: 20, price: 5 },
        end: { time: 10, price: 7 },
      }),
    ).toEqual([
      { time: 10, value: 7 },
      { time: 20, value: 5 },
    ]);
  });
  it("normalizes every asset on the same first timestamp and excludes invalid closes", () => {
    const r = normalizedOverlay([
      {
        symbol: "A",
        candles: [candle(3, 15), candle(1, 8), candle(2, 10), candle(4, 0)],
      },
      { symbol: "B", candles: [candle(2, 20), candle(3, 10), candle(4, 30)] },
    ]);
    expect(r.times).toEqual([2, 3]);
    expect(r.series.map((s) => s.points.map((p) => p.value))).toEqual([
      [100, 150],
      [100, 50],
    ]);
  });
  it("does not merge distinct intraday samples or invent missing prices", () => {
    expect(
      normalizedOverlay([
        { symbol: "A", candles: [candle(100, 1)] },
        { symbol: "B", candles: [candle(200, 2)] },
      ]).times,
    ).toEqual([]);
    expect(normalizedOverlay([])).toEqual({ times: [], series: [] });
  });
});
