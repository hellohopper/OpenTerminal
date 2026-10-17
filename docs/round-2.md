# Second development round

Requested workflow: separate reviewable PRs, followed by eight features in order. The earlier local roadmap is published as a baseline PR. Follow-up PRs are stacked against the preceding branch, with local merges after verification. Remote PRs stay open for review.

| Work | Branch | State |
|---|---|---|
| Fix valuation and quote metadata | codex/fix-valuation-quality | Complete: 123 tests pass (6 PostgreSQL tests skipped); full build passes |
| Web authentication and access control | codex/fix-web-auth | Complete: 125 tests pass, web build and 2 browser checks pass |
| Dependency maintenance | codex/fix-dependency-advisories | Complete: zero audit advisories; 125 tests, full build and 2 browser checks pass; Docker build added to CI |
| 1. Quote quality dashboard | codex/feature-13-quote-quality | Complete: full build and 3 browser workflows pass |
| 2. Trade CSV import/export | codex/feature-14-trade-csv | Complete: 129 tests, full build and 4 browser workflows pass |
| 3. Backup/restore and versioned schema migrations | codex/feature-15-backups | Complete: 139 tests including real PostgreSQL, production build and backup browser workflow pass |
| 4. Watchlist groups and saved screeners | codex/feature-16-watchlists | Complete: 141 tests, production build and persistent groups/presets browser workflow pass |
| 5. Cross-device workspace sync | codex/feature-17-sync | Complete: 143 tests including PostgreSQL concurrency, production build and two-device browser workflow pass |
| 6. Repeat/conditional alerts and scheduled briefings | codex/feature-18-delivery | Complete: 147 tests, production build and repeating alert/scheduled briefing browser workflow pass |
| 7. Option strategy risk scenarios | codex/feature-19-strategy-risk | Complete: 149 tests, production build and signed Greeks/scenario/journal browser workflow pass |
| 8. Holdings event center | codex/feature-20-events | Planned |

New frontend workflows will be exercised by repository-owned browser tests and included in CI as the round progresses. Production secrets and user databases are not used by test fixtures.
