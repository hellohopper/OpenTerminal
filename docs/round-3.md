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

The API checks every five minutes, deduplicates by rule/symbol/bar, and retains the latest 500 events. Today's UTC date is excluded conservatively, so US closing signals become eligible after UTC midnight. Only the latest completed bar is evaluated; missed days are not backfilled. Freshly retrieved history older than seven days is rejected. Missing/insufficient/malformed data is reported and never interpreted as a match. This is a snapshot of the selected list; later watchlist edits require a new rule. Provider history and split basis remain indicative.

## Investment thesis cards

Add THESES or open a stock's research → Thesis. Record rationale, key metrics, catalysts, invalidation criteria, status and a UTC review date. Edit cards to retain previous versions (latest 500 revisions globally). Version guards reject conflicting edits. Up to 100 cards are supported; archived and invalidated cards stop appearing in due reviews. Due active/watching cards appear in current and newly saved briefings, including text export. Review dates are manually maintained; the Events section provides earnings context. Cards and history participate in server backup/import. Restore invalidates in-flight record writes.
