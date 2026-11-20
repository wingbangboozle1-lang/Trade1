# Coordination

| Task | Status | Owner session | Files in scope |
|---|---|---|---|
| Kalshi demo dashboard, source research, site, verification, and deployment setup | in progress | 81cacf69 | COORDINATION.md, README.md, index.html, landing/category/dashboard/flagged pages, assets/, .github/workflows/pages.yml |

## Session scope (this session, `81cacf69` on branch `arena/81cacf69-trade1`)

Claimed 2026-11-20. Branch policy prohibits switching/creating task branches; all work stays on `arena/81cacf69-trade1`. Previous session `ee533bdf` left the task at "needs review" with a single-page static prototype. This session rebuilds the site as a multi-page GitHub Pages dashboard (landing page + per-category subpages + live dashboard + flagged-for-review page), keeps topic separation (gas prices, elections, culture, crypto, golf), adds dual scrolling alert chats (all events + model-liked high-ROI filter), live contract-price chart with selectable time length, liquidity display, simulated paper trades with categorized strategy journal and portfolio tracking, and resolution yes/no tracking until events resolve.

## Task log

### Kalshi demo dashboard (session 81cacf69)
- Claimed 2026-11-20 by session `81cacf69` on `arena/81cacf69-trade1` (branched from `73ba25331dce88580aa6de552502fae31373d7bd` of `main`).
- Network check (2026-11-20): github.com reachable; `external-api.demo.kalshi.co` and `docs.kalshi.com` unreachable from sandbox (connection failed). No live Kalshi values can be fetched or verified in-session. All fetched/live values are therefore flagged unverified; no inferred or filled-in values anywhere.
- Plan: build multi-page static site; reference official Kalshi demo endpoint URLs and doc links from the user brief and prior COORDINATION.md; every table row links to the official market page; unverifiable items blank/flagged.

### Prior session `ee533bdf` (for context, not re-edited here)
- Implemented single-page static dashboard with topic filters, open-market REST polling, market rows linked to Kalshi, selected-market YES-bid sampling and chart, orderbook bid quantity summary, $0.10 sampled jump notice, local-only paper-trade log categorized by strategy, official-reference links, executive summary, explicit scope/safety flags.
- Flagged/not implemented there: authenticated demo account, actual order execution/automation, account performance/settlement history, resolved-market outcome archive, official dollar-notional ranking, persistent WebSocket feed, verified news-cause attribution, Pages deployment confirmation.

## Open items / flags for review
- Authenticated demo-account tracking and order execution (requires private-key signing per Kalshi auth docs; not implemented, no credentials stored).
- Actual automated trade execution; paper trades are browser localStorage only.
- Resolved-market yes/no archive and settlement outcome ingestion.
- True highest dollar-amount ranking (volume shown; dollar notional not an official field here).
- Persistent WebSocket live feed (REST polling only in prototype).
- External-news cause attribution for sharp moves (links to official market only; cause unverified).
- GitHub Pages deploy verification (workflow deploys on `main`; repository Pages setting and successful deployed workflow unverified from this branch).
