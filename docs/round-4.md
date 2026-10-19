# Daily workbench, research models and earnings archives

Add panels from the widget sidebar or find them with Cmd/Ctrl+K: TODAY, HISTORY DATA, VALUATION, PORTFOLIO RISK, PAPER TRADE, MULTI LEDGER, FILING READER and EARNINGS REVIEW. Saved research records belong to the single deployment owner and participate in server database backup/import. They are independent of browser workspace layout sync.

## TODAY

TODAY combines unread notification/filing records, due active/watching thesis cards, upcoming seven-day earnings and quote-quality problems. Earnings and quality checks cover the first twelve workspace watchlist symbols. Expected earnings sessions remain unverified. Complete, reopen or snooze items for an hour; filters show pending, completed and snoozed tasks. State persists on the server and participates in backup/import, with optimistic conflict checks and retention of the latest 500 states. Completing a queue task does not mark its source read. A new thesis revision creates a new review task. Source and research buttons open existing panels.

## Historical data center

HISTORY DATA imports daily date/open/high/low/close/volume CSV (512 KB, 2–5000 rows), with symbol, currency, source and raw/split-adjusted/total-return/unknown basis declarations. Headers, dates, OHLCV and duplicate sessions are validated; gaps and large moves are flagged. Immutable versions have SHA-256 content checksums and server backup/import support. Up to twenty versions are retained; delete inactive versions to make room. Provider snapshots require a fresh USD currency check and preserve unknown adjustment basis.

Select one version per symbol to share its daily bars with charts, comparisons and backtests. Intraday chart ranges continue using providers. Personal CSV data is served only through authenticated library endpoints; public market history is unchanged. Backtests require USD and disclose user-declared adjustment basis without certifying it. Gap/coverage checks still apply. A version can be deactivated to return to providers; active versions cannot be deleted. Selections use conflict guards. This center stores supplied adjustments; it does not infer corporate actions or generate total returns from raw prices.

## Valuation lab

VALUATION provides enterprise DCF, reverse-DCF growth, discount/terminal-growth sensitivities and equity P/E scenarios. All rates are decimals; user revenue grows through the explicit forecast and is multiplied by a user-assumed unlevered FCF margin. Cost of capital must exceed terminal growth. Equity deducts net debt once (negative debt represents net cash); negative equity residual is floored at zero per share. P/E uses net income and does not deduct debt again. Reverse DCF solves only growth in −50% to +100% with other assumptions fixed, otherwise showing unavailable.

Optional current USD quote and annual SEC revenue/net-income references populate inputs; reported operating cash flow minus capex is displayed only as a reference and is not automatically treated as FCFF. Save up to fifty scenarios, link a matching-symbol thesis version and export assumptions/results to the journal. These are user assumption models, not forecasts or trading instructions.

## Portfolio stress and correlation

PORTFOLIO RISK analyzes 1–20 funded long-only USD holdings using fresh valuations, a selected daily history version or provider fallback and SPY. Correlations, current-weight volatility, beta and variance-risk contributions require at least ten common observations and no gaps over seven calendar days. Constant-series statistics remain unavailable. Mixed adjustment bases are rejected and actual common-date coverage is shown.

Symbol and sector percentage shocks compound; cash is unchanged. Historical scenarios revalue current positions using first-to-last price moves in the selected common window, rather than replaying the old portfolio. Costs, dividends, FX and future outcomes are not modeled. Sector lookup failures produce Unclassified exposure. Save the latest thirty snapshots with holdings, assumptions and source identities; snapshots are included in server backups.

## Paper trading and plans

PAPER TRADE maintains independent simulated accounts, cash, orders and fills without writing real portfolio transactions or contacting a broker. Configure initial capital, per-order fee, slippage and a starting completed UTC date. Market/limit/stop orders run after the account checkpoint; BUY plans can attach stop loss, take profit and a dollar loss budget (including two fees). Risk/cash/share violations reject orders rather than creating invalid balances. Pending orders can be cancelled with revision checks.

The API checks every fifteen minutes or on demand, processing up to 100 completed supplied daily dates per check. Existing protection exits run before discretionary orders; stop loss wins if both brackets touch the same bar, including conservative same-bar entry protection. Gaps use observed opens; limit fills stay within their limits after slippage. USD currency checks and aligned coverage are required. Account/ordered-fill changes commit atomically, with a revision guard against stale monitor work. Repeated checkpoints do not fill twice. These are illustrative daily-bar assumptions, not intraday liquidity/execution claims.

REVIEWS lists Paper accounts with fee-inclusive flat-to-flat statistics, tags, notes and journal links. Limits: five accounts, ten active symbols/account, twenty pending orders/account, 500 stored orders and 500 fills/account. Data and reviews participate in server backup/import. Start a new simulation when a fill cap is reached; histories are not silently truncated.

## Consolidated multicurrency ledger

MULTI LEDGER combines selected existing USD portfolios and up to five independent currency accounts into USD reports. Currency accounts accept deposits, withdrawals, buys/sells, net dividends, splits and executed FX conversions, retaining up to 500 entries/account. Conversions specify target units per source unit and a fee in source currency. Trades pay commission in their own currency. An optional entry USD-per-currency override records the user's historical rate; otherwise dated ECB references are used. Append/delete operations replay local balances atomically and reject cash deficits or oversells. Existing USD trade commissions can be annotated for consolidated reporting without modifying original portfolio performance.

Supported currencies: USD, EUR, GBP, JPY, CHF, CAD, AUD, CNY and HKD. Average-cost basis tracks local principal, historical USD principal and entry commissions. Prices must be fresh same-currency quotes or explicitly dated user-supplied marks (within seven days). ECB observations at or before each required date must be within seven days; unavailable historical coverage blocks reporting. Reference rates are not executable rates. Price effect + FX/cash-conversion effect + dividends − fees reconciles to net P&L; the FX/cash effect includes residual currency interactions and conversion spreads. Reports show per-position price/FX/entry-fee components and all source assumptions.

Reports support ten existing portfolios, five currency accounts and thirty open account/asset positions, retaining the latest twenty snapshots with ledger checksums and FX provenance. Values are simple cumulative gain/loss, not time-weighted or annualized returns. No tax-lot or tax-filing calculation is performed. Records, fee annotations and reports are included in server backups/imports.

## SEC reader

FILING READER retrieves stored filing metadata's canonical SEC HTML URLs only, with redirects disabled, a 15-second timeout and a streamed 2 MB limit. Inert extracted text retains up to 500 paragraphs / 200,000 characters, with explicit truncation, source URL, retrieval time and SHA-256 of downloaded HTML. Tables are flattened. Twenty immutable snapshots and 500 revision-guarded paragraph annotations participate in backups. Matching company/form documents support exact paragraph multiset addition/removal comparisons; reordering and semantic interpretation are outside this comparison.

Optional Anthropic summary/Q&A accepts 1–12 selected excerpts totaling at most 24,000 characters. It labels excerpt-only scope and returns source text plus clickable paragraph links. Missing or unknown paragraph citations reject the response; valid citation syntax does not establish factual correctness. Source text is untrusted reference data. Without a configured AI key, reading, annotations and comparisons remain available.

## Earnings review archives

EARNINGS REVIEW captures a matching company's immutable thesis revision, expectations, user event date and declared release session. Only captures before the event UTC date are prospective; same-day and past captures are explicitly retrospective and cannot establish prior predictions. Up to 100 archives hold post-event notes and refreshed analyses, with optimistic revision guards and the latest twenty prior revisions per archive. Search, JSON export, deletion and server backup/import are supported.

After the event UTC date completes, refresh matches Nasdaq's reported EPS/consensus/surprise to the exact event date; missing actuals remain unavailable and flag the window as user-dated. Fresh USD currency checks and matching history adjustment-basis labels are required. Shared selected history versions or provider fallback supply completed prices, with source checksums and measured closing values preserved. Unknown/before-open timing uses the previous common close; after-close timing requires an exact event-date close. Sessions are user declarations, not verified release timestamps.

The 1/5/20 horizons count common supplied completed dates with SPY, rather than calendar days or an independently verified exchange calendar. Missing horizons or gaps over seven calendar days remain unavailable. Excess return is asset price return minus SPY price return in percentage points. Dividend inclusion follows the declared or unspecified series adjustment basis; no separate dividends, fees, FX or causal attribution are modeled. Thesis edits never rewrite the captured thesis; result refreshes retain previous analyses in revision history.
