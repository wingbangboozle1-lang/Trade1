# Verification report — session `0f2d9972` (2026-11-21 UTC)

**Branch:** `arena/0f2d9972-trade1` (base `main` @ `0dc6148`, PR #80 merge).
**Scope:** `COORDINATION.md` (claim + this record) and this file only. All other files review-only — open PRs #79 (`arena/0b68e1e4-trade1`) and #75 (`arena/725b09a7-trade1`) own `scripts/collect.py`, `scripts/portfolio_engine.py`, `assets/model.js`, workflows, and `flagged.html`; nothing in their scope was edited.
**Live site:** https://wingbangboozle1-lang.github.io/Trade1/ (GitHub Pages, legacy branch source `main /`).

## 1. Executive summary

A static, read-only live dashboard over the official Kalshi **demo** Trade API for five topics only — gas prices, elections, culture, crypto, golf. It ranks live markets by estimated traded dollars, posts a scrolling-chat alert on every sampled price move ≥ $0.10 in either direction (two chats: all events + model-picks ROI screen), draws interactive price charts (60 s → 24 h) with order-book depth (contracts at each price), tracks each watched market until the exchange settles it YES/NO, and runs automated paper strategies whose ledger persists in the repo (CI ledger, ~30 min cadence) plus a browser Strategy Lab. Every committed table row links the official API URL that produced it; values that cannot be confirmed are left blank and published on `flagged.html`. Demo-account trading is a separate opt-in console, inert without owner-supplied demo keys (see §5). Full summary: `EXECUTIVE_SUMMARY.md` + `executive-summary.html`.

## 2. Requirement coverage (brief → delivered → where)

| Brief requirement | Delivered | Where |
|---|---|---|
| Executive summary | Published | `EXECUTIVE_SUMMARY.md`, `executive-summary.html` |
| Dashboard: highest-dollar live events, 5 topics only | Ranked by estimated traded dollars (contracts × last price, labeled estimate); topics kept separate, events grouped within topic | `dashboard.html`, `topics/*.html`, `data/topics/*.json` |
| Live alerting ≥ $0.10 either direction, two scrolling chats | Exact 1/10000-dollar comparison (no float loss), 45 s cooldown; left chat = all moves, right chat = ROI screen score ≥ 0.45 | `dashboard.html` (engine `assets/app.js` + `assets/model.js`), Methods §3 |
| Track until resolved YES/NO | Watched markets re-checked each poll; official `result` + settlement time recorded; paper positions settle $1/winner | `dashboard.html`, `resolved.html`, `data/resolved.json` |
| Automated simulated trades / strategies | 4 paper strategies (momentum, fade, harvest, breakout) fill at official quotes with official taker fee; P&L by strategy × topic | `trades.html`, `portfolio.html`, `scripts/portfolio_engine.py`, `data/portfolio.json` |
| Portfolio performance (demo account) | Three disclosed layers, never mixed: (1) browser lab (localStorage), (2) CI ledger (repo-persistent), (3) opt-in demo-account console — **inert, `configured: false`** (no keys; see §5) | `trades.html`, `portfolio.html`, `demo-account/` |
| Interactive price graph: X=time (s/min/h), Y=price | Canvas chart, 60 s / 5 m / 15 m / 1 h / 6 h / 24 h windows; seconds/minutes from live samples, hours from official candlesticks | `dashboard.html`, Methods §6 |
| Liquidity: contracts at each price | Official order-book ladders (`depth=10`): YES/NO bid/ask with sizes, depth bars; asks derived by reciprocal rule, marked `*` | `dashboard.html` |
| Jump events + links that may have caused ≥ $0.10 moves | Alert markers on chart + link strip: official Kalshi page, event `settlement_sources`, news-search lead. Causality never asserted | `dashboard.html` |
| Suggestions for liveness/interactivity | Prioritized backlog, each item naming its official endpoint; continuous-organization rules; trader's playbook | `suggestions.html` |
| GitHub Pages site, category subpages, sourced tables | Landing + 5 topic pages + dashboard/lab/data/methods/ideas/flagged/sources; per-row official URLs enforced by `check_site.mjs` | root `*.html`, `topics/*.html` |
| No manual input; official sources only; blanks not inferred | CI collects + verifies on schedule; unconfirmed values blank + flagged | `scripts/collect.py`, `flagged.html`, `sources.html` |
| Coordination + PR → merge → Pages | Board claims, small commits, PR merged without waiting, Pages verified, record here | `COORDINATION.md`, this report |

## 3. Line-by-line verification performed (this session, all exit 0)

- `npm test` — engine 23/23, live_fixes 3/3, live_dash 6/6, lib ok, fees 21/21, model 30, root_engine 48/48, model.test 21/21, portfolio 60/60, demo-account 89/89, `test_collect.py` 4/4.
- `node tools/build.mjs` — BUILD OK: 18 HTML, 6 JS, 0 broken links.
- `node scripts/check_site.mjs` — 18 HTML, 432 links, 1249 snapshot rows, 825 resolved rows, **0 failures** (every row carries an official `source_url` on the demo base).
- `node scripts/check_links.mjs` — 16 published pages, 400 local + 236 external links, **0 failures**.
- `python3 tests/test_collect_failclosed.py` — 6/6 (429 fail-closed: verified artifacts byte-identical).
- `python3 scripts/portfolio_engine.py selftest` — 68/68 (fee math, $0.10 boundary, settlement, determinism).
- `node tools/render_test.mjs --offline` — all 16 pages render with 0 JS errors (jsdom, offline fixtures).
- Data audit (read, not edited): `data/meta.json` generated `2026-11-21T03:59:57Z`, base `https://external-api.demo.kalshi.co/trade-api/v2`; topic snapshots 131 events (gas 11, elections 30, culture 30, crypto 30, golf 30) each with file-level `source_urls` (events/markets/event-markets URLs) + verbatim tickers; `data/resolved.json` 200 rows (`settled_total` 6000, `in_scope_count` 1904); `data/portfolio.json` generated `2026-11-21T07:08:16Z` — 12 trades (8 open, 4 realised, 2 settled, 0 wins / 4 losses), realised P&L −$59.59, equity $933.48, cash $744.17, 30 alerts, 21 resolutions, 120 watchlist rows; every portfolio trade/alert/resolution/watchlist row carries a `source` (0 missing).
- Official docs re-read this session via the page fetcher and matched to site claims:
  - API Environments (demo REST `https://external-api.demo.kalshi.co/trade-api/v2` + `https://demo-api.kalshi.co/trade-api/v2`; demo WS `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2` + `wss://demo-api.kalshi.co/trade-api/ws/v2`) — https://docs.kalshi.com/getting_started/api_environments ✓ matches `data/meta.json` base/alt_base.
  - Test In The Demo Environment (mock funds; demo prices may not reflect real markets; recommended demo root) — https://docs.kalshi.com/getting_started/demo_env ✓ matches site demo-only warnings.
  - Get Markets (status filter `unopened|open|closed|settled`; market fields incl. `result`, `settlement_value_dollars`, `volume_fp`) — https://docs.kalshi.com/api-reference/market/get-markets ✓ matches collector + resolved handling.
  - Get Market Orderbook (`depth` 0–100, default 0 = all levels; `orderbook_fp` `[price, qty]` per side) — https://docs.kalshi.com/api-reference/market/get-market-orderbook ✓ matches depth ladder (`depth=10`).
  - Get Market Candlesticks (`period_interval` 1/60/1440 minutes; series-scoped path `/series/{s}/markets/{t}/candlesticks`) — https://docs.kalshi.com/api-reference/market/get-market-candlesticks ✓ matches chart windows (1 and 60 used; 1440 documented, not used for sub-day windows).
  - Fee Rounding (`trade_fee = ceil_6dp(model_fee)`; non-direct balances aligned to $0.01) — https://docs.kalshi.com/getting_started/fee_rounding ✓ matches ledger fee rule in `data/portfolio.json`.

## 4. Not verified (no inference made)

- **Live runtime responses from this sandbox:** `curl` to `external-api.demo.kalshi.co` returns `000` (no route from the sandbox). Runtime behaviour was checked against committed fixtures (`data/samples/`), the official docs above, and CI (GitHub runners can reach Kalshi). Published as an open item on `flagged.html`; does not block.
- **Demo-account balance/positions/orders:** `data/demo_account/status.json` reports `configured: false` ("KALSHI_DEMO_KEY_ID and/or KALSHI_DEMO_PRIVATE_KEY are not set. No request was sent."). No credential exists in this session and none was requested. The automatic paper layers (browser lab + CI ledger) are the credential-free portfolio trackers; real demo-account tracking stays opt-in.

## 5. Irregularities / flagged items (published, non-blocking)

All items below are already published on `flagged.html` (with source links) and were **not** edited here (owned by open PRs / integration):

1. Demo returns `status: "active"`/`"finalized"` vs documented `open`/`settled` — both spellings handled.
2. Estimated dollar volume (contracts × price) — no official per-market dollar-notional field; labeled estimate everywhere.
3. Maker fees unmodeled (paper fills cross the spread); fee-source conflict (demo API `fee_multiplier=1` vs schedule PDF `M=0` for `KXBTCY`/`KXETHY`) — environment-matched demo value modeled, conflict published.
4. ROI screen weights are documented heuristics, not verified alpha.
5. WebSocket unusable from a static page (signed handshake headers) → REST polling; sub-second swings invisible.
6. 06:58Z 429 incident degraded the snapshot (restored from 03:59:57Z by session `c96a21b7`); fail-closed collector + retry/backoff landed (PR #80; further backoff in open PR #79). Snapshot freshness depends on the 3-hourly CI job.
7. News leads are leads only — causality never asserted.

## 6. Coordination / overlap

- Open PRs at claim time: #79 (backoff for both Python collectors + ledger guards), #75 (final integration: D1/D3 repairs, per-row links), #74, #68, #67, #81. This session edited **only** `COORDINATION.md` + this new report, so no file-level overlap. If a change is later needed in a file owned by #79/#75, it will be logged here as a request, not edited.
- Merge conflicts: none encountered (prepend-only board edit + new file).

## 7. PR / merge / Pages record

- **PR:** pending (created from `arena/0f2d9972-trade1` → `main` after this report; link to be recorded here).
- **Merge:** pending (merge without waiting for approval, per brief).
- **Pages:** pending (verify `built` + live index after merge).
- **Task status:** done pending PR merge. Flagged items above remain published on `flagged.html` and do not block.
