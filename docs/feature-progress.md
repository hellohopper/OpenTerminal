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
| 8 | AI research with sources | codex/feature-08-research-assistant | Planned |

Portfolio performance currently supports long-only USD assets and up to one year of provider history. Funding gaps, missing prices, unverified currencies or unverified split price basis withhold return metrics. Record cash events in PERFORMANCE and trades in PORTFOLIO.
