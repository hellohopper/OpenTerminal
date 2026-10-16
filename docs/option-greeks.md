# Options-chain Greeks

Open **OPTIONS**, choose an expiration and enable **Show Greeks**. The chain adds a European model price plus Delta, Gamma, Theta, Vega and Rho for each call and put. Narrow panels can scroll horizontally. Toggle Greeks off to restore the compact quote table.

## Inputs and units

- **Rate %** is the annual continuously compounded risk-free-rate assumption, between −20% and 100%.
- **Dividend %** is an annual continuous dividend-yield assumption, between 0% and 100%.
- Both default to **0% as explicit assumptions**, not current market estimates. Empty or invalid inputs withhold analytics.
- **IV override %** is optional. A valid value greater than 0% and at most 500% overrides every displayed contract. Clear it to use automatic IV selection.
- **Reset model** restores the two 0% assumptions and automatic IV selection. Assumptions are temporary widget state and are not saved or fetched from a rate/dividend service.

Every metric is per underlying unit, in the instrument's quote units, rather than per contract. Standard contracts often cover 100 shares, but this feature does not infer multipliers or support adjusted-contract valuation.

| Column | Meaning |
|---|---|
| Model | Theoretical European option price |
| Δ | Option-price sensitivity to a 1-unit underlying-price increase |
| Γ | Delta sensitivity to a 1-unit underlying-price increase |
| Θ/day | Time decay per calendar day: annual theta divided by 365 |
| Vega | Price sensitivity per 1 percentage-point IV increase |
| Rho | Price sensitivity per 1 percentage-point interest-rate increase |

These are local model sensitivities, not guarantees for large moves. Model time uses actual elapsed time divided by 365 calendar days. Expiration is assumed to be **16:00 America/New_York**, with daylight-saving adjustment. AM-settled products, special trading hours and early closes are not modeled. The model clock refreshes every 30 seconds while Greeks are visible; the existing chain refresh remains every 20 seconds. The displayed model time is not a market-quote observation timestamp.

## IV selection and missing values

Each side of each strike independently selects volatility in this order:

1. A valid user override, labeled **User IV**.
2. A positive provider IV no greater than 500%, labeled **Provider IV**.
3. A fitted IV from `(bid + ask) / 2`, labeled **Midpoint IV**, if bid/ask are finite, nonnegative and noncrossed, and ask is positive.

The fit uses bisection between annual volatilities of 0.0001% and 500%. Premiums at or outside the resulting price bounds are rejected rather than clamped. No last-trade-price fallback is used. A spread midpoint is an estimate and can be stale or unrepresentative; this is especially relevant for illiquid contracts. Provider IV is used as supplied and may reflect different pricing assumptions.

Missing/invalid underlying prices or strikes, expired or missing dates, dates beyond the model's 20-year horizon, unusable IV and numerical failures produce **—**. Hover over cells for the reason. Existing raw quote columns remain available. Each IV source appears below OI/IV when Greeks are enabled.

## Model limits and validation

The implementation uses Black-Scholes with a continuous dividend yield. It excludes American early exercise, discrete dividend events, fees and transaction effects. American-style equity options may differ materially from these estimates; see the [OIC explanation of model assumptions](https://www.optionseducation.org/advancedconcepts/black-scholes-formula) and [Greek sensitivities](https://www.optionseducation.org/advancedconcepts/understanding-options-greeks).

Tests verify a standard ATM price/Greeks reference, dividend-adjusted put/call parity, independent finite-difference sensitivities, IV recovery for calls and puts, negative rates, near-expiry and extreme inputs, invalid quotes, source precedence and New York daylight-saving boundaries. Browser checks use fixture providers through the real API/web proxy, plus mocked option responses for provider-IV and missing-data states. No live-provider or broker-Greeks reconciliation was performed.
