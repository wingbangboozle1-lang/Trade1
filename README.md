# Trade1 — Kalshi demo dashboard

Live site (GitHub Pages): https://wingbangboozle1-lang.github.io/Trade1/

What it does
- Collects **Kalshi demo** market data (official REST API: `https://external-api.demo.kalshi.co/trade-api/v2`) for five topics: Crypto, Elections, Culture (Kalshi "Entertainment"), Gas prices, Golf.
- Publishes a static dashboard: open markets, resolved YES/NO results, price moves of $0.10 or more, orderbook liquidity, 1-minute / 1-hour / 1-day price charts, simulated strategies, paper portfolio, sources and a Flagged for Review page.
- Every table row links to the official API record it came from. Values the API does not return are shown as blank ("—"), never inferred.

Layout
- `scripts/kalshi_collect.py` — collector (stdlib only). Writes `_site/`.
- `scripts/analyze.py` — topic rules, jump detection, backtest, paper portfolio, verification checks.
- `tests/test_analyze.py` — unit tests on synthetic fixtures (logic only).
- `docs/` — static site source (HTML/CSS/JS). Copied into `_site/` on each run.
- `.github/workflows/pages.yml` — runs tests and collector every 30 minutes; deploys to Pages from `main`.
- `COORDINATION.md` — shared task board, claims, sources and irregularities log.

Run locally
```
python -m unittest discover -s tests -v
python scripts/kalshi_collect.py      # needs internet access to the Kalshi demo host
python -m http.server -d _site 8000   # then open http://localhost:8000
```

Not included
- Trading on the Kalshi demo account and demo portfolio tracking (needs demo API keys; add them as repository secrets to enable).
- Seconds-level charts (the API offers 1-minute, 1-hour and 1-day candles).
- Verified causes for price moves (no official news feed is wired in).

See the Flagged for Review page on the live site for irregularities and sources.
