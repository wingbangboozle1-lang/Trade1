"""
Resolution tracking: keep every tracked market until it resolves, then record HOW it resolved
(YES or NO) from the exchange's own `result` field.

Verified references:
  * Get Markets, status=settled: https://docs.kalshi.com/api-reference/market/get-markets
  * Market settlement (YES pays $1, NO pays $1 per the winning side):
        https://docs.kalshi.com/getting_started/market_settlement
  * Market lifecycle (unopened -> open -> closed -> settled):
        https://docs.kalshi.com/getting_started/market_lifecycle

`result` is copied verbatim from the API. If the exchange reports an empty result the row is
recorded as pending and shown as blank, never inferred from the last price.
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from collector.kalshi_client import PROD, KalshiClient
from collector.util import DATA, iso, now_ts, parse_ts, read_json, write_json

VALID_RESULTS = {"yes", "no"}
# A market can report a result while still finalizing; both states are terminal for trading and both
# carry the exchange's own result. Verified against GET /markets/KX10SONG-26-KAR, which returned
# status="finalized", result="yes", settlement_value_dollars="1.0000", settlement_ts set.
SETTLED_STATUSES = {"settled", "finalized"}


def tracked_tickers() -> list[str]:
    """Every market we have ever observed, plus open ones in the latest snapshot."""
    tickers = set()
    latest = read_json(os.path.join(DATA, "markets", "latest.json")) or {}
    for m in latest.get("markets") or []:
        tickers.add(m["ticker"])
    ts_dir = os.path.join(DATA, "timeseries")
    if os.path.isdir(ts_dir):
        for name in os.listdir(ts_dir):
            if name.endswith(".json"):
                doc = read_json(os.path.join(ts_dir, name)) or {}
                if doc.get("ticker"):
                    tickers.add(doc["ticker"])
    res = read_json(os.path.join(DATA, "resolutions.json"), {}) or {}
    tickers.update(res.keys())
    return sorted(tickers)


def update(base: str = PROD, limit_checks: int = 60) -> dict:
    client = KalshiClient(base)
    store_path = os.path.join(DATA, "resolutions.json")
    store = read_json(store_path, {}) or {}
    todo = [t for t in tracked_tickers()
            if (store.get(t) or {}).get("result") not in VALID_RESULTS
            or not (store.get(t) or {}).get("status_raw")]

    checked = 0
    for ticker in todo[:limit_checks]:
        try:
            m = client.market(ticker)
        except Exception as e:  # noqa: BLE001
            print(f"  {ticker}: {e}", file=sys.stderr)
            continue
        checked += 1
        result = (m.get("result") or "").lower()
        entry = {
            "ticker": ticker,
            "title": m.get("title"),
            "event_ticker": m.get("event_ticker"),
            "series_ticker": (m.get("event_ticker") or "").split("-")[0] or None,
            "status": m.get("status"),
            "result": result if result in VALID_RESULTS else "",
            "result_raw": m.get("result") or "",
            "settled": m.get("status") in SETTLED_STATUSES,
            "status_raw": m.get("status") or "",
            "settlement_ts": parse_ts(m.get("settlement_ts")),
            "settlement_value_dollars": m.get("settlement_value_dollars"),
            "close_time": m.get("close_time"),
            "close_ts": parse_ts(m.get("close_time")),
            "expiration_value": m.get("expiration_value"),
            "checked_at": iso(),
            "checked_ts": now_ts(),
            "source_url": f"{base}/markets/{ticker}",
        }
        # Keep the first time we saw a resolution so the site can show when it flipped.
        previous = store.get(ticker) or {}
        if not previous.get("resolved_at") and result in VALID_RESULTS:
            entry["resolved_at"] = iso()
            entry["resolved_ts"] = now_ts()
        else:
            entry["resolved_at"] = previous.get("resolved_at")
            entry["resolved_ts"] = previous.get("resolved_ts")
        store[ticker] = entry

    write_json(store_path, dict(sorted(store.items())))
    resolved = {k: v for k, v in store.items() if v.get("result") in VALID_RESULTS}
    print(f"resolutions: checked={checked} tracked={len(store)} resolved={len(resolved)}")
    return store


def summary(store: dict | None = None) -> dict:
    store = store or read_json(os.path.join(DATA, "resolutions.json"), {}) or {}
    resolved = [v for v in store.values() if v.get("result") in VALID_RESULTS]
    return {
        "generated_at": iso(),
        "tracked": len(store),
        "resolved": len(resolved),
        "resolved_yes": sum(1 for v in resolved if v["result"] == "yes"),
        "resolved_no": sum(1 for v in resolved if v["result"] == "no"),
        "pending": len(store) - len(resolved),
        "rows": sorted(resolved, key=lambda v: v.get("resolved_ts") or 0, reverse=True),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=PROD)
    ap.add_argument("--limit", type=int, default=60)
    args = ap.parse_args()
    store = update(args.base, args.limit)
    write_json(os.path.join(DATA, "resolution_summary.json"), summary(store))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
