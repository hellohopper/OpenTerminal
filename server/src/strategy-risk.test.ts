import { it, expect } from "vitest";
import { strategyRisk, riskScenarios } from "../../web/lib/strategy-risk.js";
import { payoff, type StrategyLeg } from "../../web/lib/option-strategy.js";
const leg: StrategyLeg = {
    kind: "call",
    side: "BUY",
    strike: 100,
    premium: 5,
    quantity: 1,
  },
  a = { spot: 100, years: 1, volatility: 0.2, rate: 0.05, dividend: 0 };
it("aggregates signed contract Greeks and stock shares", () => {
  const long = strategyRisk([leg], a),
    short = strategyRisk([{ ...leg, side: "SELL" }], a);
  expect(long.greeks.delta).toBeGreaterThan(50);
  expect(long.greeks.delta).toBeLessThan(100);
  for (const key of Object.keys(long.greeks) as (keyof typeof long.greeks)[])
    expect(short.greeks[key]).toBeCloseTo(-long.greeks[key], 9);
  expect(strategyRisk([leg, { ...leg, side: "SELL" }], a).pnl).toBe(0);
  expect(
    strategyRisk(
      [{ kind: "stock", side: "BUY", strike: 0, premium: 90, quantity: 50 }],
      a,
    ).greeks,
  ).toEqual({ price: 5000, delta: 50, gamma: 0, theta: 0, vega: 0, rho: 0 });
});
it("converges to expiration payoff and marks invalid IV cells unavailable", () => {
  const legs = [
    leg,
    { ...leg, kind: "put" as const, side: "SELL" as const, strike: 90 },
  ];
  for (const spot of [70, 90, 100, 120])
    expect(strategyRisk(legs, { ...a, spot, years: 0 }).pnl).toBeCloseTo(
      payoff(legs, spot),
      9,
    );
  const rows = riskScenarios([leg], a, 365, 10, 30);
  expect(rows[0].cells[0]).toBeNull();
  expect(rows[2].cells[1]).toBeCloseTo(500);
  expect(() => strategyRisk([leg], { ...a, spot: NaN })).toThrow();
  expect(() => riskScenarios([leg], a, -1, 10, 10)).toThrow();
});
