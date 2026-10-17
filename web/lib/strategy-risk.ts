import { blackScholes, type Greeks } from "./option-greeks";
import { analyzeStrategy, type StrategyLeg } from "./option-strategy";
export type RiskAssumptions = {
  spot: number;
  years: number;
  volatility: number;
  rate: number;
  dividend: number;
};
/** Dollar position sensitivities: delta per $1, gamma per $1², theta/day, vega/rho per percentage point. */
export function strategyRisk(legs: StrategyLeg[], a: RiskAssumptions) {
  analyzeStrategy(legs, a.spot);
  if (
    !Object.values(a).every(Number.isFinite) ||
    a.years < 0 ||
    a.years > 20 ||
    a.volatility <= 0 ||
    a.volatility > 5 ||
    a.rate < -0.2 ||
    a.rate > 1 ||
    a.dividend < 0 ||
    a.dividend > 1
  )
    throw new Error("Invalid risk assumptions.");
  const total: Greeks = {
    price: 0,
    delta: 0,
    gamma: 0,
    theta: 0,
    vega: 0,
    rho: 0,
  };
  let entry = 0;
  for (const leg of legs) {
    const scale =
      leg.quantity *
      (leg.side === "BUY" ? 1 : -1) *
      (leg.kind === "stock" ? 1 : 100);
    let g: Greeks;
    if (leg.kind === "stock")
      g = { price: a.spot, delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0 };
    else if (a.years === 0) {
      const call = leg.kind === "call";
      g = {
        price: Math.max(call ? a.spot - leg.strike : leg.strike - a.spot, 0),
        delta: call
          ? a.spot > leg.strike
            ? 1
            : a.spot === leg.strike
              ? 0.5
              : 0
          : a.spot < leg.strike
            ? -1
            : a.spot === leg.strike
              ? -0.5
              : 0,
        gamma: 0,
        theta: 0,
        vega: 0,
        rho: 0,
      };
    } else {
      const modeled = blackScholes({
        ...a,
        kind: leg.kind,
        strike: leg.strike,
      });
      if (!modeled)
        throw new Error("Missing or invalid option strike/assumptions.");
      g = modeled;
    }
    for (const key of Object.keys(total) as (keyof Greeks)[])
      total[key] += g[key] * scale;
    entry += leg.premium * scale;
  }
  if (![...Object.values(total), entry].every(Number.isFinite))
    throw new Error("Risk values exceed supported limits.");
  return { greeks: total, entry, pnl: total.price - entry };
}
export function riskScenarios(
  legs: StrategyLeg[],
  a: RiskAssumptions,
  days: number,
  spotShock: number,
  volShock: number,
) {
  strategyRisk(legs, a);
  if (
    ![days, spotShock, volShock].every(Number.isFinite) ||
    days < 0 ||
    days > 7300 ||
    spotShock < 0 ||
    spotShock >= 100 ||
    volShock < 0 ||
    volShock > 500
  )
    throw new Error("Invalid scenario range.");
  return [-spotShock, 0, spotShock].map((move) => ({
    move,
    spot: a.spot * (1 + move / 100),
    cells: [-volShock, 0, volShock].map((shift) => {
      try {
        return strategyRisk(legs, {
          ...a,
          spot: a.spot * (1 + move / 100),
          years: Math.max(0, a.years - days / 365),
          volatility: a.volatility + shift / 100,
        }).pnl;
      } catch {
        return null;
      }
    }),
  }));
}
