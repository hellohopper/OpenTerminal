# Research, reviewed sync and mobile navigation

## Stock research

Open **Research** in the top bar or a symbol-aware panel header. Symbol buttons in WATCHLIST and PORTFOLIO and the symbol-mode NEWS panel also open research. Symbol results in the command palette open the same view; Shift+Enter also adds the symbol to the current watchlist.

Research opens a keyboard-accessible modal pinned to the selected symbol, with Overview (quote and news), Chart, Financials, Events, Notes and Alerts sections. Create an alert, write a note or add to the current watchlist directly from its header. Notes and alert drafts remain available when switching research sections; save before closing research or refreshing. Research chart drawings use a stable symbol-specific ID and are included in entire-device sync.

All data uses the existing sources and limits: quotes are indicative and show retrieval/source information; SEC financial statements cover supported US GAAP/USD filings. Earnings dates are expected dates with unverified sessions; macro events cover the provider's current week and are market-wide context.

## Reviewed device sync

DEVICE SYNC can also transfer UI preferences through an optional checkbox; leaving it off keeps destination font, language and visibility choices. Panel settings always travel with their workspace. See [preference sync](workflow-reliability.md#optional-ui-preference-sync).

DEVICE SYNC has two scopes:

- **Entire snapshot** replaces all workspaces, watchlist groups, screener presets and drawings at the destination. Workspaces missing from the source are removed.
- **Selected workspaces** upserts selected workspace IDs, keeping other destination workspaces, their order and the active selection. Names are not identities: independently created workspaces with the same name remain separate. Drawings belonging only to selected panels are transferred; drawings shared with unselected destination panels are preserved. Shared watchlist groups and screener presets are replaced only if the separate checkbox is selected. Research-view drawings are included only in entire snapshots.

Select Upload or Download to fetch the current server revision and build a change preview. The preview lists added, removed and changed workspaces, changed fields/watchlists, shared preferences and drawing counts. Review the preview, check **I reviewed these changes**, then confirm. Nothing is written during preview. Local edits after preview invalidate it; server edits after preview reject uploads, restores and downloads. Preview again to review the latest revision. A reviewed upload can intentionally replace newer server contents; there is no automatic conflict merge or background sync.

The server retains the last **10 committed versions**, including the current version. Open **Server version history**, select a version and preview the restore. A confirmed restore creates a new server revision and leaves the current browser alone; preview and confirm a download to apply it locally. Devices holding old revisions cannot silently overwrite the restored revision. History is part of database backups and SQLite-to-PostgreSQL imports. Migration 5 seeds history from an existing current snapshot. Snapshot limits remain 2 MB and 20 workspaces; old versions are pruned as new ones are committed. Database restore changes the current sync version to invalidate old previews.

## Desktop and phone

The widget library is grouped into Markets, Research, Portfolio, Options and Settings, with a filter. The same typed catalog supplies panel titles and command search.

Use Cmd/Ctrl+K or the top-bar search button to find symbols, features and workspaces. Prefix with `>` for actions/panels or `@` for workspaces. Arrow keys select a result; Enter opens it; Escape dismisses the modal and restores focus. Local commands remain available if symbol search fails.

Below 768 CSS pixels the terminal has bottom navigation for **Holdings**, **Alerts**, **Events**, **Workspace** and **Tools**. Holdings is the default on a fresh mobile session. Tools opens the widget library and adds a panel to the workspace. Workspaces render as a single column with scrolling panel contents; desktop grid coordinates are not rewritten. Returning to a wider screen restores the saved draggable grid. Wide financial tables scroll inside their content area. No PWA installation or offline market-data mode is included.
