import { describe, it, expect } from "vitest";
import {
  blackScholes,
  expiryYears,
  impliedVolatility,
  optionAnalytics,
  type ModelInputs,
} from "../../web/lib/option-greeks";
const base: ModelInputs = {
  kind: "call",
  spot: 100,
  strike: 100,
  years: 1,
  rate: 0.05,
  dividend: 0,
  volatility: 0.2,
};
const price = (p: ModelInputs) => blackScholes(p)!.price;
describe("Black-Scholes Greeks", () => {
  it("matches a standard ATM call/put reference and quoted Greek units", () => {
    const c = blackScholes(base)!,
      p = blackScholes({ ...base, kind: "put" })!;
    expect(c.price).toBeCloseTo(10.45058357, 4);
    expect(p.price).toBeCloseTo(5.57352602, 4);
    expect(c.delta).toBeCloseTo(0.63683065, 5);
    expect(p.delta).toBeCloseTo(-0.36316935, 5);
    expect(c.gamma).toBeCloseTo(0.01876202, 6);
    expect(c.theta).toBeCloseTo(-0.01757268, 6);
    expect(c.vega).toBeCloseTo(0.37524035, 6);
    expect(c.rho).toBeCloseTo(0.53232482, 5);
  });
  it("satisfies dividend-adjusted parity and Greek identities", () => {
    const b = { ...base, dividend: 0.03 },
      c = blackScholes(b)!,
      p = blackScholes({ ...b, kind: "put" })!;
    expect(c.price - p.price).toBeCloseTo(
      100 * Math.exp(-0.03) - 100 * Math.exp(-0.05),
      9,
    );
    expect(c.delta - p.delta).toBeCloseTo(Math.exp(-0.03), 10);
    expect(c.gamma).toBe(p.gamma);
    expect(c.vega).toBe(p.vega);
  });
  it("agrees with independent finite differences for both kinds and nonzero dividends", () => {
    for (const kind of ["call", "put"] as const) {
      const b = { ...base, kind, dividend: 0.025, strike: 105, years: 0.6 },
        g = blackScholes(b)!,
        h = 0.01;
      expect(g.delta).toBeCloseTo(
        (price({ ...b, spot: b.spot + h }) -
          price({ ...b, spot: b.spot - h })) /
          (2 * h),
        4,
      );
      expect(g.gamma).toBeCloseTo(
        (price({ ...b, spot: b.spot + h }) -
          2 * price(b) +
          price({ ...b, spot: b.spot - h })) /
          (h * h),
        4,
      );
      const e = 0.0001;
      expect(g.vega).toBeCloseTo(
        (price({ ...b, volatility: b.volatility + e }) -
          price({ ...b, volatility: b.volatility - e })) /
          (2 * e) /
          100,
        4,
      );
      expect(g.rho).toBeCloseTo(
        (price({ ...b, rate: b.rate + e }) -
          price({ ...b, rate: b.rate - e })) /
          (2 * e) /
          100,
        4,
      );
      expect(g.theta).toBeCloseTo(
        -(
          price({ ...b, years: b.years + e }) -
          price({ ...b, years: b.years - e })
        ) /
          (2 * e) /
          365,
        5,
      );
    }
  });
  it("handles deep ITM/OTM and short maturities without non-finite values", () => {
    for (const spot of [1, 100, 10000])
      for (const kind of ["call", "put"] as const) {
        const g = blackScholes({ ...base, spot, kind, years: 1e-8 })!;
        expect(Object.values(g).every(Number.isFinite)).toBe(true);
        expect(g.gamma).toBeGreaterThanOrEqual(0);
        expect(g.vega).toBeGreaterThanOrEqual(0);
      }
  });
  it("rejects expired, zero-volatility, non-finite or unsupported inputs", () => {
    for (const patch of [
      { spot: 0 },
      { strike: -1 },
      { years: 0 },
      { years: 21 },
      { volatility: 0 },
      { volatility: NaN },
      { rate: Infinity },
      { dividend: -1 },
    ])
      expect(blackScholes({ ...base, ...patch })).toBeNull();
  });
  it("recovers IV from prices for calls and puts with dividends and negative rates", () => {
    for (const kind of ["call", "put"] as const)
      for (const volatility of [0.1, 0.25, 0.8, 2]) {
        const p = { ...base, kind, dividend: 0.02, rate: -0.01, volatility };
        expect(impliedVolatility(p, price(p))).toBeCloseTo(volatility, 6);
      }
    for (const premium of [0, -1, 101, NaN])
      expect(impliedVolatility(base, premium)).toBeNull();
    expect(impliedVolatility({ ...base, spot: 150 }, 10)).toBeNull();
    expect(() =>
      impliedVolatility({ ...base, spot: Number.MIN_VALUE }, 1),
    ).not.toThrow();
  });
  it("distinguishes provider, midpoint and explicit IV without using last trade fallback", () => {
    const q = { bid: 9, ask: 11, impliedVolatility: 0.3 };
    expect(optionAnalytics(base, q).source).toBe("Provider IV");
    expect(optionAnalytics(base, q, 0.4).source).toBe("User IV");
    expect(optionAnalytics(base, { bid: 9, ask: 11 }).source).toBe(
      "Midpoint IV",
    );
    for (const q of [
      { bid: 11, ask: 9 },
      { bid: null, ask: 11 },
      { bid: 0, ask: 0 },
      { bid: Infinity, ask: Infinity },
    ])
      expect(optionAnalytics(base, q).greeks).toBeNull();
    expect(optionAnalytics(base, q, NaN).greeks).toBeNull();
    expect(
      optionAnalytics(base, { bid: 0, ask: 20, impliedVolatility: 0 }).greeks,
    ).not.toBeNull();
  });
  it("uses 16:00 New York with DST and withholds expired/invalid dates", () => {
    expect(
      expiryYears("2026-07-17", Date.parse("2026-07-17T19:00:00Z")),
    ).toBeCloseTo(1 / (365 * 24), 12);
    expect(
      expiryYears("2026-12-18", Date.parse("2026-12-18T20:00:00Z")),
    ).toBeCloseTo(1 / (365 * 24), 12);
    for (const date of ["2026-02-30", "bad", "2026-07-17"])
      expect(expiryYears(date, Date.parse("2026-07-17T20:00:00Z"))).toBeNull();
  });
});
