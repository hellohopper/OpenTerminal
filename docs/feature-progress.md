# Sequential feature implementation

Each feature is developed on its own branch, validated, then merged into local main before the next feature starts.

| # | Feature | Branch | Status |
|---|---|---|---|
| 1 | Workspaces and layout presets | codex/feature-01-workspaces | Complete; 52 tests, web build, browser create/reload/duplicate/import/export passed |
| 2 | Multi-symbol comparison | codex/feature-02-comparison | Complete; 55 tests and web build passed |
| 3 | Company fundamentals | codex/feature-03-fundamentals | Complete; 58 tests and full build passed |
| 4 | Research notes and trading journal | codex/feature-04-journal | Complete; 61 tests and full build passed |
| 5 | Portfolio performance and risk | codex/feature-05-performance | Complete; 68 tests, full build and final type check passed |
| 6 | Options strategy builder | codex/feature-06-option-strategies | Complete; 72 tests and web build passed |
| 7 | Personal daily briefing | codex/feature-07-briefing | Complete; 74 tests, full build and final provider-error checks passed |
| 8 | AI research with sources | codex/feature-08-research-assistant | Complete; 82 tests across 22 suites, full build and browser integration passed |

Portfolio performance currently supports long-only USD assets and up to one year of provider history. Funding gaps, missing prices, unverified currencies or unverified split price basis withhold return metrics. Record cash events in PERFORMANCE and trades in PORTFOLIO.


## Eight-feature checkpoint verification

- All eight feature branches were implemented sequentially and merged into local main after validation.
- Automated suite at the eight-feature checkpoint: 82 passing tests across 22 files. Server and production web builds pass.
- Browser integration used an isolated SQLite database and fixture providers through the real web proxy and Express API. Verified workspace management/persistence/import/export, comparison metrics, financial filing links, journal persistence and chart snapshots, funded portfolio returns, strategy payoffs and journal save, briefing generation/history, and AI source previews/private-data controls/missing-key handling. No browser runtime errors.
- Model calls are mocked in tests. No live paid AI request or live provider-availability acceptance test was performed.

## Using the features

1. Use **WORKSPACE → Manage** to create a named daily, research, options or blank layout; duplicate, rename or import/export it. Workspaces save independently in this browser.
2. Add **COMPARE** from the sidebar and enter 2–5 symbols. Comparisons use common dates and price returns, without FX or dividend adjustments.
3. Add **FINANCIALS** for quarterly/annual USD US GAAP statements. Click reported values for the original filing. Derived quarters are marked with an asterisk.
4. Use **JOURNAL** for research/trade notes, or **JOURNAL SNAPSHOT** inside a chart to capture it. Images and notes persist in the configured server database.
5. Record trades (with UTC dates) in **PORTFOLIO**, then funding/dividend/split events in **PERFORMANCE**. Confirm historical price basis when using splits. Missing funding, prices or currencies withhold return metrics.
6. Use **STRATEGY** to build up to eight option/stock legs, choose a template and inspect expiration P&L. Standard options assume 100 shares/contract. Early assignment, fees and margin are excluded.
7. **MY BRIEFING** collects the first twelve watchlist symbols. Select a session label, save snapshots or export text. Reports are on demand; delivery is not scheduled.
8. **AI ASSIST → Preview sources** works without a model key. With ANTHROPIC_API_KEY configured, responses cite server-collected sources. Notes/holdings are opt-in; changing personal-data selections clears the chat so old private text is not resent. Headlines are not full-article evidence; retrieval time is distinct from market observation time.

## Additional feature: price alerts

| # | Feature | Branch | Status |
|---|---|---|---|
| 9 | Persistent price and daily-change alerts | codex/feature-09-price-alerts | Complete; 103 tests across 26 files and full production build passed |

Add **ALERTS** to create, edit, pause and rearm rules. The API checks enabled symbols every 15 seconds; each trigger is recorded atomically and disarms its rule. Global in-app notifications and opt-in desktop notifications share a browser delivery cursor. See [price-alert usage and limits](price-alerts.md).

Browser integration uses an isolated database, fixture quotes and a simulated Notification API. It verifies threshold and percentage triggers, one-shot/rearm behavior, reload persistence, cross-tab deduplication, stale-cache rejection, provider recovery, browser-closed catch-up and denied-permission fallback. No operating-system desktop notification or live-provider acceptance test was performed.

## Additional feature: chart tools and overlays

| # | Feature | Branch | Status |
|---|---|---|---|
| 10 | Chart drawing tools and multi-asset overlay | codex/feature-10-chart-tools | Complete; 107 tests across 27 files, full build and browser integration passed |

Horizontal levels and two-point trend segments are saved per chart widget, symbol and range in browser storage. Undo, individual deletion, clear and Escape cancellation are available. Normalized overlays compare up to four assets at exact shared timestamps and can be captured in the journal. See [chart tools usage and limits](chart-tools.md).

Browser checks use fixture providers through the real API/web proxy. They verify rapid two-point drawing in reverse time order, reload persistence, range isolation, Escape, undo/delete/clear, normalized comparison and price-mode restoration, journal snapshots, invalid symbols and missing history. No browser runtime errors were observed; live provider availability was not tested.

## Additional feature: options Greeks

| # | Feature | Branch | Status |
|---|---|---|---|
| 11 | Black-Scholes Greeks on the options chain | codex/feature-11-option-greeks | Complete; 115 tests across 28 files, full build and browser integration passed |

Enable **OPTIONS → Show Greeks** for model price, Delta, Gamma, Theta, Vega and Rho. Rate/dividend assumptions are editable, IV provenance is shown per contract, and missing inputs withhold results. See [Greeks units, assumptions and limits](option-greeks.md).

Browser validation uses fixture-backed API responses for midpoint IV and mocked option responses for provider IV, expired contracts and missing inputs. It verifies quote/Greek table switching, edits, reset, expiry selection, invalid-input withholding and no last-trade fallback. No browser runtime errors were observed. Live-provider/broker reconciliation was not performed.

## Additional feature: PostgreSQL storage

| # | Feature | Branch | Status |
|---|---|---|---|
| 12 | Optional PostgreSQL storage and SQLite import | codex/feature-12-postgresql | Complete; 126 tests across 31 files with real PostgreSQL enabled, full build and browser integration passed |

SQLite remains the default; set DATABASE_URL for PostgreSQL. All server data uses the shared asynchronous interface. Transactions preserve ledger validation, alert caps and one-shot events across concurrent requests. The import command retains IDs/history/attachments, repairs destination sequences and refuses nonempty targets. See [setup, migration and verification](postgresql.md).

Local verification used a disposable PostgreSQL 17 instance. Browser checks through the real API/web proxy covered journal CRUD/screenshots, funded portfolio analytics, strategy journal saves, briefings and private AI source previews. Restart retained data; the migration CLI preserved the source and refused a second import. Live market/model calls were fixtures. Docker Compose was unavailable locally; CI now provisions PostgreSQL for the automated suite.

All items currently listed in the README roadmap are implemented and merged into local main after validation.
