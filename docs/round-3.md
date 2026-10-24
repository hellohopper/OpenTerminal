# Third feature round

Eight features are implemented sequentially, each through its own PR and merge before the next starts.

1. Technical signals
2. Investment thesis cards
3. Trade reviews
4. Rebalance simulation
5. SEC filing tracker
6. Background notifications
7. Screener changes
8. Backtest and daily replay

## Technical signals

Add SIGNALS. Save up to 20 rules spanning 30 distinct active symbols, with up to 20 symbols per rule (copy a watchlist group after loading it). Conditions support SMA crossings, RSI recovery, breakouts against prior highs, and volume ratios; an optional volume condition uses AND. Choose first matching bar or every matching daily bar. Pause/resume or delete rules; immutable history includes calculated values and opens research charts.

The API checks every five minutes, deduplicates by rule/symbol/bar, and retains the latest 500 events. Today's UTC date is excluded conservatively, so US closing signals become eligible after UTC midnight. New rules begin at the latest completed bar; existing rules resume from their saved checkpoint with up to thirty bars per symbol/pass. Historical events are labeled, and missing checkpoint coverage blocks catch-up. See [monitor recovery](workflow-reliability.md#monitor-recovery). Freshly retrieved history older than seven days is rejected. Missing/insufficient/malformed data is reported and never interpreted as a match. This is a snapshot of the selected list; later watchlist edits require a new rule. Provider history and split basis remain indicative.

## Investment thesis cards

Add THESES or open a stock's research → Thesis. Record rationale, key metrics, catalysts, invalidation criteria, status and a UTC review date. Edit cards to retain previous versions (latest 500 revisions globally). Version guards reject conflicting edits. Up to 100 cards are supported; archived and invalidated cards stop appearing in due reviews. Due active/watching cards appear in current and newly saved briefings, including text export. Review dates are manually maintained; the Events section provides earnings context. Cards and history participate in server backup/import. Restore invalidates in-flight record writes.

## Trade reviews

REVIEWS groups each symbol into flat-to-flat position cycles, retaining all partial entries/exits and adjusting quantities for recorded splits. Completed cycles show gross dollar P&L, return on total buy cost and calendar days held; open cycles are separate. Summary and strategy groups show win rate (breakeven is not a win), average win/loss and holding time. Add strategy tags, notes and a link to an existing journal entry. Ledger edits recalculate cycles; annotations whose cycle no longer exists are excluded. Up to 500 annotations and 50000 ledger entries are supported. This is USD long-only analysis; dividends, fees, FX and taxes are excluded.

## Rebalance simulation

REBALANCE accepts target stock weights (one SYMBOL:PERCENT per line, total at most 100%, remainder cash), new funds and fractional/whole-share or no-sale modes. Save/load target sets per portfolio; simulations show before/after cash, weights, concentration, sector exposure and signed share adjustments. Ledger cash must be funded and every holding/target needs a freshly retrieved, non-stale USD quote. No-sale deficits are proportionally scaled to available cash. Whole-share adjustments round toward zero and can leave residual drift. Simulations never write trades. Up to 30 symbols and 50000 ledger entries are supported; fees, slippage, tax and FX are excluded.

## SEC filing tracker

FILINGS (also in stock research) monitors a saved group of up to 12 SEC-mapped companies. The API checks every 15 minutes for 10-K, 10-Q, 8-K and amendments in SEC's recent-submissions data from the last 90 days, retaining up to 30 per company per retrieval. Refreshes are throttled and paced; missing mappings/provider errors are displayed. Each filing has a validated SEC original-document link, accession, filing/acceptance date, original metadata description, read state and bookmark. No document-content summary is inferred from metadata. The latest 500 filings are retained, protecting up to 100 bookmarks. Records and preferences participate in server backup/import. Set SEC_EDGAR_CONTACT to your contact email for the existing SEC client. API reference: https://www.sec.gov/search-filings/edgar-application-programming-interfaces.

## Background notifications

NOTIFICATIONS collects price-alert and technical-signal events into a persistent inbox, with read state and delivery history. A worker runs every 30 seconds while the API is active. Register a supported browser/device, then explicitly enable background delivery; a service worker receives encrypted Web Push messages while the page is closed. Clicking a notification opens the stock's research page. HTTPS (or localhost) is required; iOS/iPadOS may require installing the site on the Home Screen. Delivery remains subject to browser/OS push availability.

Generate VAPID keys once with `npx web-push generate-vapid-keys --json`. Set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` and `WEB_PUSH_SUBJECT=mailto:you@example.com` on the API; Docker Compose forwards these variables. Keep the private key stable and private. No email address receives messages. Without keys, the inbox works and device registration explains the missing configuration. The sender follows https://github.com/web-push-libs/web-push.

Settings support IANA timezone and overnight quiet hours (equal start/end disables them). Delivery waits until quiet hours end, for up to 24 hours. New subscriptions start with new events, not historical alerts. Each event/device pair has a durable job, a lease for crash recovery and at most three attempts, separated by increasing delays. HTTP 404/410 removes expired subscriptions. Up to 20 devices, 500 inbox entries and 500 delivery records are retained. Transient failures are retried; delivery is at least once after an ambiguous crash, with a stable notification tag for device deduplication. Only approved major-browser push service hosts are accepted. Subscriptions and history are private database records included in backup; VAPID secrets and browser permissions are excluded.

## Screener changes

SCREENER → Track daily results copies current filters into a server tracker. SCREEN CHANGES can also copy a saved local preset, pause/resume/delete trackers, inspect prior snapshots and copy captured results to the workspace watchlist. Filters are fixed per tracker; create a new tracker to change them. US and EU scans use fresh retrievals; EU market caps are converted to EUR and incomplete conversions block cap-filter snapshots.

The API checks every 15 minutes, saving at most one observation per UTC date while running (no backfill). Each tracker retains 30 observations, up to ten trackers. Entered/exited membership and consecutive saved-observation counts are compared with the previous retained snapshot; the first is a baseline. Provider failures do not generate empty snapshots or false exits. The source is a changing top-1500 listing universe; snapshots capture the first 200 sorted matches and report truncation. An exit can mean leaving that captured sample rather than failing the filter or leaving the market. Weekend/holiday observations may repeat prices and are not asserted to be distinct trading sessions. Retrieval time and sample sizes are displayed.

## Backtest and daily replay

BACKTEST runs cash-funded long-only SMA-crossover or prior-high-breakout/SMA-exit templates on up to one year of provider daily OHLCV. Configure dates, fast/slow/lookback periods, starting cash, fixed fee per order and slippage in basis points. A signal from a completed bar fills at the next observed open; buys use available cash after fees, sales include exit fees, and open positions remain marked at the final close. The benchmark buys the same asset at the first simulated open before costs. Results include equity, return, maximum drawdown, completed-trade win rate and execution dates. No live orders are submitted.

Replay hides future chart points and executions until you advance, with play/pause/reset/next controls and daily cash/position state. Final summary metrics remain visible above replay. Export the full equity CSV or save assumptions, provenance, metrics and executions to the research journal. The latest 30 complete runs are stored on the server for reload and backup.

Fresh retrievals and current USD currency verification are required. Today's UTC date is excluded. Missing warmup/coverage, malformed/duplicate bars or gaps over seven calendar days block a run; missing prices are never filled. Exchange-calendar completeness is not independently verified. Source, retrieval time, available dates and unspecified provider split/dividend price basis are displayed. This is price-only illustrative analysis: corporate actions, dividends, taxes, liquidity/market impact and exchange calendars are not modeled. Large price discontinuities are flagged. Provider adjustment basis and survivorship cannot be inferred from a price series.

## Round acceptance

All eight panels are implemented with authenticated server APIs and workspace/command-palette integration. Research records participate in SQLite/PostgreSQL migrations, JSON backup/restore and SQLite-to-PostgreSQL import. Restore invalidates optimistic write revisions. Signal-group resume checks are transactional so simultaneous resumes cannot exceed monitor limits.

Final local validation: 172 unit tests pass (10 optional PostgreSQL tests skipped locally), production API/web builds pass and all 20 authenticated browser workflows pass. Fixtures isolate provider requests and disposable databases; notification retry/quiet-hour/crash recovery and service-worker behavior are tested without sending an external push. Live provider availability, real-device push delivery and provider split/dividend price-basis reconciliation are not asserted.
