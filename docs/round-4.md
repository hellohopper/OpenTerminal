# Fourth feature round

Each feature has its own PR, validated and merged before the next begins: TODAY workbench, historical data center, valuation lab, portfolio stress/correlation, paper trading, consolidated multicurrency ledger, filing reader/diff, and earnings review archives.

## TODAY

TODAY combines unread notification/filing records, due active/watching thesis cards, upcoming seven-day earnings and quote-quality problems. Earnings and quality checks cover the first twelve workspace watchlist symbols. Expected earnings sessions remain unverified. Complete, reopen or snooze items for an hour; filters show pending, completed and snoozed tasks. State persists on the server and participates in backup/import, with optimistic conflict checks and retention of the latest 500 states. Completing a queue task does not mark its source read. A new thesis revision creates a new review task. Source and research buttons open existing panels.

## Historical data center

HISTORY DATA imports daily date/open/high/low/close/volume CSV (512 KB, 2–5000 rows), with symbol, currency, source and raw/split-adjusted/total-return/unknown basis declarations. Headers, dates, OHLCV and duplicate sessions are validated; gaps and large moves are flagged. Immutable versions have SHA-256 content checksums and server backup/import support. Up to twenty versions are retained; delete inactive versions to make room. Provider snapshots require a fresh USD currency check and preserve unknown adjustment basis.

Select one version per symbol to share its daily bars with charts, comparisons and backtests. Intraday chart ranges continue using providers. Personal CSV data is served only through authenticated library endpoints; public market history is unchanged. Backtests require USD and disclose user-declared adjustment basis without certifying it. Gap/coverage checks still apply. A version can be deactivated to return to providers; active versions cannot be deleted. Selections use conflict guards. This center stores supplied adjustments; it does not infer corporate actions or generate total returns from raw prices.

## Valuation lab

VALUATION provides enterprise DCF, reverse-DCF growth, discount/terminal-growth sensitivities and equity P/E scenarios. All rates are decimals; user revenue grows through the explicit forecast and is multiplied by a user-assumed unlevered FCF margin. Cost of capital must exceed terminal growth. Equity deducts net debt once (negative debt represents net cash); negative equity residual is floored at zero per share. P/E uses net income and does not deduct debt again. Reverse DCF solves only growth in −50% to +100% with other assumptions fixed, otherwise showing unavailable.

Optional current USD quote and annual SEC revenue/net-income references populate inputs; reported operating cash flow minus capex is displayed only as a reference and is not automatically treated as FCFF. Save up to fifty scenarios, link a matching-symbol thesis version and export assumptions/results to the journal. These are user assumption models, not forecasts or trading instructions.
