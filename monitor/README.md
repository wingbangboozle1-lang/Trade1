# monitor/ — Kalshi demo monitor (session f6094c46)

Self-contained, 100% client-side implementation of the Kalshi demo dashboard brief. Not part of the Pages deploy (the deployed site is the repository root); served verbatim from this folder. Start it with any static server, e.g. `python3 -m http.server 8081` from this directory.

- `index.html` — landing, executive summary, verified endpoint table
- `live.html` — full live dashboard: two scrolling alert chats (all events ≥$0.10 swings; heuristic high-ROI filter), price chart with 60s→24h windows, official orderbook ladder with contracts at each price, official trade tape, resolution mini-feed, paper-bot toggle
- `gas-prices.html`, `elections.html`, `culture.html`, `crypto.html`, `golf.html` — topic pages: verified snapshot table (per-row official request URL), live table, topic alert feed, resolution archive, official settlement sources
- `strategies.html`, `findings.html`, `resolved.html`, `flagged.html` — strategy/model docs + portfolio analytics, alert archive, resolution archive, flagged irregularities
- `assets/app.js` — the engine (API client with rate-limit guard, classifier, alerts, chats, chart, orderbook, tape, resolution tracker, 4-strategy paper bot, portfolio)
- `data/snapshot-2026-11-20.json` — verified snapshot; every value carries the official request URL that produced it

Tests (from the repo root): `node tests/engine.test.js` (36 assertions incl. official fee-table cross-checks), `node tests/smoke.test.js` (page boots, graceful degradation). Verification log: `../docs/VERIFICATION.md`.
