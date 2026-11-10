# Research changes, capture and review

This release connects six workflows to the existing private terminal. All new server endpoints use owner authentication. New records live in `research_records` and participate in SQLite/PostgreSQL backup and restore. No additional market-data subscription or AI key is required.

## Changes since last review

Open **CHANGES** or a company's **Changes** research tab. It compares saved notes, theses, valuation scenarios, SEC filing metadata, earnings reviews and thesis monitor evidence with the last explicitly reviewed snapshot. Opening the tab does not change the baseline. **Mark reviewed** verifies both the content shown and the previous baseline before saving; a concurrent edit returns a conflict for refresh. The first visit shows current records as a baseline. Changed records expose the saved before/after text and an exact record link; removed records are labeled no longer retained.

Up to ten snapshots per symbol and 100 symbols are retained. Coverage follows the research center: the latest 5000 notes for the company and retained records of each type. Text previews are bounded to 4000 characters; hashes compare the complete retained values. Old saved snapshots can be reviewed from the selector. Monitoring check timestamps alone do not count as research changes. This compares retained research, not all news on the internet or reconstructed historical financial statements. Financial changes can be inspected through saved thesis evidence and valuations.

## Research events on charts

Enable **Research events on chart** in CHART or the research chart. Filter trades, notes, thesis revisions, filings and saved earnings reviews. Clicking a marker or an entry in **Event filters and records** opens details; research entries link to the original record. Trades include the account name and recorded execution information.

A note uses its original creation time, a thesis revision its recorded revision time, and a filing its disclosure date—not its fiscal period end. Earnings markers identify saved review dates, not inferred release times. Events map to their date or the next available supplied bar; date-only events are hidden on intraday charts. Daily placement does not imply the evidence existed before the opening bell. Note details show the current saved text, which can include edits made after the creation marker; they are not a historical version of the note. Events outside the chart's supplied range remain accessible in the list. Comparison mode hides markers. Coverage is the latest 1000 company notes and 1000 trades, plus retained revisions/filings/reviews. Filter choices travel with workspace settings.

## Research inbox and iPhone capture

**INBOX** collects a title, thought, HTTP(S) link and optional PNG/JPEG/WebP screenshot up to 1 MB. Assign a symbol and edit the text before **Create research note**. Conversion appends the source URL, preserves the image and commits the note and inbox status atomically. Archive/reopen and version-checked removal are available. Removing an inbox item does not delete an already created journal note.

The server accepts up to 200 inbox items, 17,000 characters of text, 120 title characters and a 2000-character URL. Capture IDs make retries idempotent; reuse with different content is rejected. The latest 400 lightweight receipts also prevent a lost acknowledgement from recreating a removed item. No URL is fetched by the capture endpoint.

On iPhone, open **Research inbox** using the tray button in the navigation bar. Captures are written locally before upload; pending captures retry every 30 seconds while the app is active. A failed or canceled request keeps its capture ID. A late reply cannot change a new session. New research-note drafts persist by server and symbol across app restarts. **Keep offline in inbox** moves a draft into the capture queue for later organization on the web.

The **OpenTerminal Share** extension accepts a link, text or one image from the system share sheet and lets you add a thought. Images are resized to at most 1600 pixels and JPEG-compressed; an image still larger than 1 MB is rejected. Shared captures are initially unassigned and require **Upload** in the signed-in app before being sent anywhere. The extension has no server credentials or network upload code.

Local captures are bounded to 100 per store. One atomic file per item avoids overwriting another process's additions. iOS files use complete file protection, owner-only permissions and exclusion from device backup. Sign-out clears drafts and queued captures bound to that server; unassigned share-extension captures remain for manual review. Storage failures are visible and do not claim successful persistence.

### Signing the extension

Set the same `RESEARCH_APP_GROUP` build setting for the app and extension to an App Group registered to your Apple Developer team. The project default is `group.com.openterminal.companion`. Enable that group in both provisioning profiles and use an extension bundle identifier prefixed by the app's identifier. The app target embeds and builds `OpenTerminalShare.appex`; CI's existing simulator build covers both targets.

Apple documents [App Groups entitlements](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.application-groups) and [shared container lookup](https://developer.apple.com/documentation/foundation/filemanager/containerurl(forsecurityapplicationgroupidentifier:)). Missing group configuration is shown as an error in the extension. Device signing, iOS file protection and the share sheet require an actual iOS build/device check.

## Compound alerts

**COMPOUND ALERTS** supports up to 30 rules with 1–6 ALL/ANY conditions: price, close above the preceding 20 supplied daily highs, completed-day volume divided by the preceding 20-bar mean, shares in a selected USD ledger portfolio, and days until expected earnings. A holding condition requires an account; closed-bar triggers require a daily market condition.

Trigger modes are first satisfied observation, continuously satisfied observations for 1–120 minutes, or a new completed daily bar. The cooldown is 1 minute to 7 days. A fired crossing rearms only after a known unmet result; unavailable data never rearms it. Unknown results or a monitoring gap over five minutes reset a sustained interval. A closed-bar trigger fires at most once for the same supplied close. Pause/resume preserves prior notification deduplication.

Checks run every minute while the API is active, with a one-minute manual throttle and one in-flight monitor run. Quote checks require a fresh non-stale retrieval. Daily decisions exclude the current UTC date and reject a latest bar more than seven days old; there is no independent exchange holiday/completeness certification. Earnings dates are expected dates with unverified release sessions. Each rule retains twenty observations, including values, source/time, unknown conditions and rule revision. Notifications reuse the existing inbox, TODAY and opted-in push delivery. Edits/deletion while a check is running invalidate that result.

## Forecast scorecard

**SCORECARD** records a symbol, measurable question, named metric/unit, comparison threshold, probability, rationale and future deadline. Forecasts are immutable. After the deadline, the user records an observed value with source evidence, or an explicit reason the result cannot be verified. Outcomes are immutable and version guarded. This first version uses manually reviewed evidence; it does not claim automatic verification of arbitrary metrics.

The dashboard shows resolved, pending, overdue and unresolvable counts, mean Brier score and five probability calibration bands. Brier score is `(probability − binary outcome)²`; lower is better. Only verified numerical outcomes enter scores. All other counts stay visible, and resolved forecasts cannot be deleted to improve the score. Up to 500 forecasts are retained. Overdue unresolved forecasts appear in TODAY and open the scorecard.

## Weekly portfolio reports

**WEEKLY REVIEW** saves a report for a selected completed UTC Monday–Sunday week and funded long-only USD portfolio. It includes opening/closing NAV, external deposits/withdrawals, dollar P&L excluding those flows, per-symbol contribution, buys/sells/dividends, activity, retained policy violations during the week and theses due at generation time. Export text or JSON and reopen saved reports.

Contribution is ending value minus starting value minus buys plus sells plus dividends. These contributions reconcile to NAV change excluding external flows; they are not a time-weighted return or a causal explanation of market moves. Boundary valuations use the latest supplied close within seven calendar days. Missing prices, incomplete funding or unverified currency withhold totals. A ledger with splits requires a declared raw or split-adjusted price basis; adjustment is not independently certified. Cash movements in this USD ledger have no fees/FX model; multicurrency accounts and simulated option accounts are outside weekly-report scope.

Reports support up to 30 symbols and 5000 ledger entries, retaining the latest 100 immutable reports. A ledger checksum prevents a report being committed after concurrent ledger edits. Historical feed availability limits which weeks can be valued. Only retained observations for current risk policies are included, so an empty risk section does not certify that no violation ever occurred.

Enable the optional per-account weekly schedule to generate the most recently completed UTC week while the API is running. It checks at startup and hourly, retries failures no more than hourly, and does not fabricate missing past weeks. Up to ten schedules are supported. The UI shows the most recently completed week and errors. Scheduling and generation do not submit trades or change the ledger.
