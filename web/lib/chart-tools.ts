import type { Candle } from "./api";
export type Anchor = { time: number; price: number };
export type Drawing =
  | { id: string; kind: "horizontal"; price: number }
  | { id: string; kind: "trend"; start: Anchor; end: Anchor };
const validAnchor = (a: Anchor) =>
  !!a && Number.isSafeInteger(a.time) && a.time > 0 && Number.isFinite(a.price);
export function parseDrawings(raw: string | null): Drawing[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    return value
      .filter((d): d is Drawing => {
        if (
          !d ||
          typeof d.id !== "string" ||
          d.id.length > 100 ||
          ids.has(d.id)
        )
          return false;
        const valid =
          d.kind === "horizontal"
            ? Number.isFinite(d.price)
            : d.kind === "trend" &&
              validAnchor(d.start) &&
              validAnchor(d.end) &&
              d.start.time !== d.end.time;
        if (valid) ids.add(d.id);
        return valid;
      })
      .slice(-50);
  } catch {
    return [];
  }
}
export function trendPoints(drawing: Extract<Drawing, { kind: "trend" }>) {
  return [drawing.start, drawing.end]
    .sort((a, b) => a.time - b.time)
    .map((a) => ({ time: a.time, value: a.price }));
}
/** Exact shared timestamps: never interpolate or forward-fill unmatched trading sessions. */
export function normalizedOverlay(
  input: Array<{ symbol: string; candles: Candle[] }>,
) {
  const maps = input.map(
    (s) =>
      new Map(
        s.candles
          .filter(
            (c) =>
              Number.isSafeInteger(c.time) &&
              c.time > 0 &&
              Number.isFinite(c.close) &&
              c.close > 0,
          )
          .map((c) => [c.time, c.close]),
      ),
  );
  const times = maps.length
    ? [...maps[0].keys()]
        .filter((t) => maps.every((m) => m.has(t)))
        .sort((a, b) => a - b)
    : [];
  return {
    times,
    series: input.map((s, i) => ({
      symbol: s.symbol,
      points: times.map((time) => ({
        time,
        value: (maps[i].get(time)! / maps[i].get(times[0])!) * 100,
      })),
    })),
  };
}
