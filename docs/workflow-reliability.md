# Workflow recovery, coverage and account exposure

## Research drafts

THESES, VALUATION and EARNINGS REVIEW now save unsaved form values in this browser, isolated by workspace and panel; the research modal uses its symbol-specific thesis draft. Drafts survive refresh, hiding a panel, grid reflow and switching workspaces. Saving removes the corresponding local draft; Discard draft confirms before resetting the form. Saved server records remain authoritative. Restored thesis and earnings-note edits retain their original revision guards, so concurrent server edits require review instead of silent overwrite.

The status line distinguishes restored drafts from storage failures. When browser storage fails, a memory copy survives panel remounts for the current page; leaving/reloading warns while a dirty draft cannot be stored. This fallback cannot survive closing the browser. Drafts are private local data, bounded to 100 KB per research form. Existing journal drafts retain their separate attachment-aware storage.

## Optional UI preference sync

DEVICE SYNC includes an **Also sync UI preferences** checkbox, off by default. When enabled, it transfers language, font, spacing, polling preferences, favorites, recent tools, sidebar choices and panel visibility. When disabled, the destination keeps its UI preferences. Selective workspace sync updates hidden-panel choices only for the selected workspaces, while global UI choices follow the checkbox. Older snapshots without display preferences keep destination values.

Panel-specific settings travel with the workspace regardless of this checkbox; server validation now preserves those settings. Existing preview, local-change checks, server revision guards and ten-version recovery remain in place. Drafts are excluded from device sync and included in complete migration files instead.

## Scheduled backups and complete migration

BACKUP can enable one daily server backup at a chosen UTC hour and retain 1–30 copies (default seven). Scheduling is off until enabled. The API must be running: after a missed run it creates one current backup when the daily time is eligible, without fabricating historical snapshots. Failed attempts retry no more than hourly; **Back up now** can retry immediately. Latest attempt, success, errors and downloadable copies appear in BACKUP. Failures also enter the notification inbox and TODAY once per UTC date.

Backups are atomically written with owner-only file permissions under `DATA_DIR/backups`; pruning runs only after a new backup is written and affects generated backup filenames only. Policy and last-run metadata live beside the files and survive API restarts. These files share the server disk; download an external copy to protect against disk loss. The existing 32 MB / 50000-row server backup limits apply. Deployments running multiple API processes should enable this local-file scheduler on only one process/data directory.

**Download complete migration** packages a checked server snapshot, current browser workspaces, panel/UI preferences, drawings, and journal/research drafts. Browser snapshots are limited to 2 MB and drafts to 5 MB. API/session secrets, browser permissions, external backup files and the destination server's backup schedule are excluded. Workspaces still contain no secrets.

Both ordinary backups and complete migrations use the existing file picker and explicit RESTORE confirmation. Complete files have an outer SHA-256 checksum; server backups keep their schema and checksum validation. Browser writes are staged before the server restore to detect storage/quota failures without changing the database. Failed server requests roll browser changes back. A successful restore reloads the browser. A lost network acknowledgement can leave server completion uncertain; retain the migration file and verify server records before retrying. Database and browser storage are separate systems, not a distributed transaction.

## TODAY coverage

Expand **TODAY coverage** to select the current watchlist, saved watchlist groups, actual USD portfolios and imported currency accounts. The selection persists per workspace. Up to 200 unique symbols, ten portfolios and five currency accounts are supported; requests above the cap fail explicitly rather than truncating coverage. Earnings and quote checks run in batches of twelve with at most three batches in flight; failed feeds report their affected symbols.

Server-wide tasks now include open simulated option lots expiring within seven days (including overdue unsettled lots) and the latest unmatched reconciliation per currency account. Closed option lots disappear; a newer matched statement removes an older discrepancy from the task source. Open source selects the relevant option lot or reconciliation report. Completing a task manages the queue only; it does not settle contracts, change balances or resolve source records.

## Combined account exposure

PORTFOLIO RISK adds **Combined account exposure** for selected actual portfolios and currency accounts. It reuses consolidated-ledger replay, commission adjustments, same-currency valuations and dated ECB references. Quotes or dated manual marks must cover every position; missing prices or FX withhold the aggregate result. Up to ten portfolios, five currency accounts and thirty open account/asset positions are supported.

The report combines matching symbol/currency positions, preserves account provenance, and shows total NAV/cash, largest symbol weight, account/sector concentration and currency weights. Currency exposure describes cash/quote denomination, not company revenue sensitivity. Source marks, FX provenance and ledger checksums accompany the response. User edits invalidate displayed results and stale in-flight responses are ignored.

Paper-trading and option simulation accounts are excluded. Selecting the same account ID twice is deduplicated, but the application cannot identify when an imported account duplicates an independently recorded portfolio; select each real economic account once. This addition reports current exposure, not multicurrency historical correlations, volatility or performance. The original single-portfolio historical risk analysis remains available below it.

## Monitor recovery

Each technical signal retains a per-symbol completed-bar checkpoint. After downtime, the monitor evaluates at most thirty subsequent supplied bars per symbol/pass in chronological order using only each bar's historical prefix. Crossing mode preserves the prior match state. Events and checkpoint updates commit together with the existing revision guards and per-rule/symbol/date uniqueness. Remaining bars, failures and coverage gaps are visible for each rule.

New rules start at the latest completed bar. A checkpoint absent from provider history blocks catch-up until provider coverage is restored; the monitor does not skip to a new baseline. If that history cannot be recovered, explicitly create a new rule to begin from the latest bar; the old event history is retained. Gaps over seven calendar days are disclosed, but no independent exchange-session completeness is asserted. Historical events and push/inbox messages carry their signal date and catch-up label. The retained event limit remains 500.

Price alerts cannot reconstruct unobserved intraday moves. The app retains the latest 100 gaps between successful threshold evaluations when longer than five minutes (or configured cooldown plus one minute). Gaps can reflect server downtime, provider failures or intentional pauses; they are not proof of continuous monitoring. Gap history becomes available after the next successful evaluation and never fabricates triggers for the missing interval.
