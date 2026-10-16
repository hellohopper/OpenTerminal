export type OptionKind = "call" | "put";
export type ModelInputs = {
  kind: OptionKind;
  spot: number;
  strike: number;
  years: number;
  rate: number;
  dividend: number;
  volatility: number;
};
export type Greeks = {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
};
// Normal CDF approximation (absolute error < 7.5e-8); symmetry preserves put/call parity.
const density = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
function cdf(x: number): number {
  const a = Math.abs(x),
    t = 1 / (1 + 0.2316419 * a);
  const tail =
    density(a) *
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}
export function validModelBase(p: Omit<ModelInputs, "volatility">): boolean {
  return (
    (p.kind === "call" || p.kind === "put") &&
    Object.values(p)
      .filter((v) => typeof v === "number")
      .every(Number.isFinite) &&
    p.spot > 0 &&
    p.strike > 0 &&
    p.years > 0 &&
    p.years <= 20 &&
    p.rate >= -0.2 &&
    p.rate <= 1 &&
    p.dividend >= 0 &&
    p.dividend <= 1
  );
}
/** Continuous rates/dividends, ACT/365; sensitivities per underlying unit, not contract. */
export function blackScholes(p: ModelInputs): Greeks | null {
  if (
    !validModelBase(p) ||
    !Number.isFinite(p.volatility) ||
    p.volatility <= 0 ||
    p.volatility > 5
  )
    return null;
  const {
    spot: s,
    strike: k,
    years: t,
    rate: r,
    dividend: q,
    volatility: v,
    kind,
  } = p;
  const root = Math.sqrt(t),
    d1 = (Math.log(s / k) + (r - q + (v * v) / 2) * t) / (v * root),
    d2 = d1 - v * root;
  const dq = Math.exp(-q * t),
    dr = Math.exp(-r * t),
    pdf = density(d1),
    call = kind === "call";
  const price = call
    ? s * dq * cdf(d1) - k * dr * cdf(d2)
    : k * dr * cdf(-d2) - s * dq * cdf(-d1);
  const delta = call ? dq * cdf(d1) : -dq * cdf(-d1);
  const gamma = (dq * pdf) / (s * v * root);
  const decay = (-s * dq * pdf * v) / (2 * root);
  const theta =
    (call
      ? decay - r * k * dr * cdf(d2) + q * s * dq * cdf(d1)
      : decay + r * k * dr * cdf(-d2) - q * s * dq * cdf(-d1)) / 365;
  const vega = (s * dq * pdf * root) / 100;
  const rho = (call ? k * t * dr * cdf(d2) : -k * t * dr * cdf(-d2)) / 100;
  const result = { price: Math.max(0, price), delta, gamma, theta, vega, rho };
  return Object.values(result).every(Number.isFinite) ? result : null;
}
/** Reject boundary/invalid prices instead of inventing a zero or capped IV. */
export function impliedVolatility(
  p: Omit<ModelInputs, "volatility">,
  premium: number,
): number | null {
  if (!validModelBase(p) || !Number.isFinite(premium) || premium <= 0)
    return null;
  let low = 0.000001,
    high = 5;
  const lowResult = blackScholes({ ...p, volatility: low }),
    highResult = blackScholes({ ...p, volatility: high });
  if (!lowResult || !highResult) return null;
  const lower = lowResult.price,
    upper = highResult.price;
  const tolerance = 1e-8 * Math.max(1, p.spot, p.strike);
  if (premium <= lower + tolerance || premium >= upper - tolerance) return null;
  for (let i = 0; i < 70; i++) {
    const mid = (low + high) / 2,
      result = blackScholes({ ...p, volatility: mid });
    if (!result) return null;
    if (result.price > premium) high = mid;
    else low = mid;
  }
  const volatility = (low + high) / 2;
  const result = blackScholes({ ...p, volatility });
  return result && Math.abs(result.price - premium) <= tolerance
    ? volatility
    : null;
}
/** Assumed PM expiration at 16:00 New York, including daylight saving time. */
export function expiryYears(
  date: string | null,
  now = Date.now(),
): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(now))
    return null;
  const parsed = new Date(`${date}T20:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    return null;
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(parsed),
  );
  const end = parsed.getTime() + (16 - hour) * 3600000;
  const years = (end - now) / (365 * 86400000);
  return years > 0 && years <= 20 ? years : null;
}
export type Analytics = {
  greeks: Greeks | null;
  volatility: number | null;
  source: "Provider IV" | "Midpoint IV" | "User IV" | null;
  reason: string | null;
};
export function optionAnalytics(
  p: Omit<ModelInputs, "volatility">,
  quote: {
    bid: number | null;
    ask: number | null;
    impliedVolatility?: number | null;
  },
  override?: number,
): Analytics {
  const unavailable = (reason: string): Analytics => ({
    greeks: null,
    volatility: null,
    source: null,
    reason,
  });
  if (!validModelBase(p))
    return unavailable(
      "Missing or invalid price, strike, expiry or assumptions.",
    );
  let volatility: number | null = null,
    source: Analytics["source"] = null;
  if (override !== undefined) {
    if (!Number.isFinite(override) || override <= 0 || override > 5)
      return unavailable("User IV must be greater than 0% and at most 500%.");
    volatility = override;
    source = "User IV";
  } else if (
    typeof quote.impliedVolatility === "number" &&
    Number.isFinite(quote.impliedVolatility) &&
    quote.impliedVolatility > 0 &&
    quote.impliedVolatility <= 5
  ) {
    volatility = quote.impliedVolatility;
    source = "Provider IV";
  } else if (
    quote.bid !== null &&
    quote.ask !== null &&
    Number.isFinite(quote.bid) &&
    Number.isFinite(quote.ask) &&
    quote.bid >= 0 &&
    quote.ask >= quote.bid &&
    quote.ask > 0
  ) {
    volatility = impliedVolatility(p, (quote.bid + quote.ask) / 2);
    source = volatility === null ? null : "Midpoint IV";
  }
  if (volatility === null)
    return unavailable("No usable IV or bid/ask midpoint within model bounds.");
  const greeks = blackScholes({ ...p, volatility });
  return {
    greeks,
    volatility,
    source,
    reason: greeks ? null : "Model inputs did not produce finite values.",
  };
}
