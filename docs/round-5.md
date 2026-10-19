# Research workflow extensions

## Research center

Individual stock research includes a chronological Timeline and saved Valuations, Reader, Earnings Reviews and Plans sections. These display authenticated server records and their original assumptions, source details and paragraph text; dedicated widgets continue editing those records. TODAY thesis and filing tasks open their exact record. Links preserve symbol, record kind/ID and optional paragraph across reloads. Deleted or mismatched records show unavailable. Timeline includes current retained thesis revisions, journal notes, filing metadata/text/annotations, valuation scenarios, earnings archives and paper orders. At most 5000 latest journal entries per symbol are scanned; coverage is explicit.

Unsaved research journal drafts stay in browser-tab memory per symbol when closing or switching research. The editor explains this scope; save before reloading. Drafts are cleared after save or explicit Close, and existing Notes/Alerts state stays mounted while changing research sections.

## Personal research search

RESEARCH SEARCH finds retained journals, theses, valuations, SEC text/annotations and earnings reviews with case-insensitive Unicode normalization and AND matching of up to eight keywords. Filter by company, record type and updated-date range; results paginate thirty at a time and link to exact records/paragraphs. Filing truncation and journal scan coverage are explicit. No separate index can become stale: each search reads current saved records, including deletions. Cmd/Ctrl+K with #keywords searches the same authenticated source set. Search covers retained data, not unsaved drafts or unretained source documents.

## Peer fundamentals

PEER FINANCIALS compares two to six USD US-GAAP companies. Annual values require a supported annual duration; TTM requires four consecutive, non-overlapping supported quarters. Each metric must cover the same actual periods; missing metrics remain unavailable. Derived quarters retain both filing URLs. Growth additionally requires a comparable prior year/window. Current P/E and P/S need fresh USD market capitalization and positive denominators; negative income has no P/E. Source details expose periods, filing dates, units and retrieval timestamps. Company fiscal periods and accounting definitions can differ.

Save twenty named peer groups and the latest twenty immutable comparison snapshots. Transfer revenue/net income references to a newly opened valuation panel; FCFF margin, shares, debt and discount assumptions stay manual. A failed company remains visibly unavailable rather than receiving invented values.

## Thesis evidence monitoring

THESIS MONITOR binds up to fifty saved rules to exact thesis revisions with 1–6 price, annual revenue-growth, latest-quarter net-margin or TTM P/E conditions. ALL/ANY uses three-valued logic; unusable/missing metrics are unknown. Price references require fresh USD retrieval; quarterly metrics expire after 200 days and annual metrics after 550 days, with filing dates checked. Retrieval time is not necessarily provider observation time. Rules re-evaluate every fifteen minutes or manually (one-minute throttle), retaining twenty observations per rule. Changed or deleted thesis revisions require explicit rebinding.

Initial met conditions and subsequent state changes enter notifications/TODAY with cooldown and duplicate protection. Evidence includes values, source/period times, thresholds and rule/thesis revisions. A guarded user confirmation can invalidate the linked thesis and preserve its prior version; evaluation alone never changes its status. Rule edits and monitor commits use revision guards. Financial values reuse current/latest amendments, not historical point-in-time assertions.

## Account import and reconciliation

ACCOUNT RECONCILE imports into independent MULTI LEDGER currency accounts, including USD. Existing portfolio trade CSV remains available in PORTFOLIO. Canonical columns or twenty saved mapping profiles cover funding, buys/sells, fees, net dividends, splits and executed FX; standalone FEE reduces cash and increases reported fees. Files up to 512 KB are fully validated and replayed before atomic commit, within the 500-entry account cap. Source IDs are scoped to account/source and content conflicts reject import; normalized fingerprints catch identical entries. Preview tokens invalidate if the ledger or reviewed input changes.

Keep up to one hundred auditable batches with file checksums, source IDs and entry identities. Undo requires the account to match that batch's post-import ledger; added, removed or changed entries are listed as dependencies. Undoing later batches restores the ability to undo earlier batches. Imported balances and history are never silently overwritten.

Complete statement snapshots use kind,currency,symbol,value CSV, with CASH or POSITION rows and a UTC as-of date. Omitted currencies/positions mean zero; comparisons use native amounts and share quantities without prices or FX translation. Saved reconciliation results (latest thirty) retain statement/ledger checksums. Mapping profiles, batches, standalone fee entries and reconciliations participate in server backup/import.
