"""
Exchange-traded history backfill.

Our own observations start when the collector first ran, which is honest but sparse on day one.
Kalshi publishes real candles, so this module backfills from them:

  GET /series/{series_ticker}/markets/{ticker}/candlesticks
      start_ts, end_ts (seconds), period_interval in {1, 60, 1440} minutes
      at most 5,000 periods per request, and the newest candles can lag live quotes by a few seconds
  Source: https://docs.kalshi.com/api-reference/market/get-market-candlesticks

Each returned candle carries yes_bid/yes_ask/price OHLC plus volume and open interest. We store the
close of each as an observation point flagged `src: "candle"`, and keep our own `src: "observe"`
points as the live series, so the chart can distinguish observed data from exchange history.
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from collector.kalshi_client import PROD, KalshiClient
from collector.util import DATA, fnum, iso, now_ts, read_json, write_json

MAX_PERIODS = 5000


def fetch_candles(client: KalshiClient, series_ticker: str, ticker: str, minutes: int,
                  hours_back: int = 48):
    end_ts = now_ts()
    start_ts = end_ts - hours_back * 3600
    # Respect the documented 5,000-period ceiling by clamping the window instead of erroring.
    max_span = MAX_PERIODS * minutes * 60
    if end_ts - start_ts > max_span:
        start_ts = end_ts - max_span
    return client.candlesticks(series_ticker, ticker, start_ts, end_ts, period_interval=minutes)


def candle_points(candles: list[dict]) -> list[dict]:
    pts = []
    for c in candles:
        ts = c.get("end_period_ts")
        if not ts:
            continue
        bid = (c.get("yes_bid") or {}).get("close_dollars")
        ask = (c.get("yes_ask") or {}).get("close_dollars")
        price = (c.get("price") or {}).get("close_dollars")
        bid, ask, price = fnum(bid), fnum(ask), fnum(price)
        mid = None
        if bid is not None and ask is not None and ask > 0:
            mid = round((bid + ask) / 2, 4)
        elif price is not None:
            mid = price
        pts.append({
            "t": int(ts), "bid": bid, "ask": ask, "mid": mid, "last": price,
            "vol": fnum(c.get("volume_fp")), "oi": fnum(c.get("open_interest_fp")),
            "src": "candle",
        })
    return pts


def merge_into_series(ticker: str, points: list[dict]) -> int:
    path = os.path.join(DATA, "timeseries", f"{ticker.replace('/', '_')}.json")
    doc = read_json(path) or {"ticker": ticker, "points": []}
    existing = {(p["t"], p.get("src", "observe")): p for p in doc.get("points") or []}
    added = 0
    for p in points:
        key = (p["t"], "candle")
        if key not in existing:
            existing[key] = p
            added += 1
    merged = sorted(existing.values(), key=lambda p: (p["t"], p.get("src", "observe")))
    doc["points"] = merged[-8000:]
    doc["history_backfilled_at"] = iso()
    doc["history_source"] = "https://docs.kalshi.com/api-reference/market/get-market-candlesticks"
    write_json(path, doc, indent=0)
    return added


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=PROD)
    ap.add_argument("--limit", type=int, default=20, help="markets to backfill per run")
    ap.add_argument("--minutes", type=int, default=60, choices=[1, 60, 1440])
    ap.add_argument("--hours", type=int, default=48)
    args = ap.parse_args()

    snap = read_json(os.path.join(DATA, "markets", "latest.json")) or {}
    markets = sorted(snap.get("markets") or [], key=lambda m: -(m.get("dollar_volume_24h") or 0))
    if not markets:
        print("history: no snapshot to backfill from")
        return 0

    client = KalshiClient(args.base)
    total = 0
    for m in markets[: args.limit]:
        try:
            candles = fetch_candles(client, m["series_ticker"], m["ticker"], args.minutes, args.hours)
        except Exception as e:  # noqa: BLE001 - a missing candle range must not fail the build
            print(f"  {m['ticker']}: {e}", file=sys.stderr)
            continue
        added = merge_into_series(m["ticker"], candle_points(candles))
        total += added
        print(f"  {m['ticker']}: {len(candles)} candles, {added} new")
    print(f"history: backfilled {total} points across {min(len(markets), args.limit)} markets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
