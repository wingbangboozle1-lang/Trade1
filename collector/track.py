"""
Time series + jump detection.

Runs after each collector cycle:
  * appends one observation per tracked market to data/timeseries/{ticker}.json
    (bounded ring buffer, so a long-running repo does not grow without limit)
  * compares each market with its previous observation and records a jump whenever the YES price
    moved by at least $0.10 in either direction, which is the alert level requested for the
    dashboard

What is recorded about a jump: the exchange-derived prices, timestamps, liquidity and the official
links. What is NOT recorded: a claimed news cause. Attribution would require a news source, and
inventing one is exactly the hallucination failure mode this repo is guarding against. Each jump
therefore carries `attribution_status: "unverified"` plus links, and the page asks the reviewer to
confirm a cause. Anything a human does confirm is stored in data/attributions.json and rendered
only when it has a source URL.
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from collector.util import DATA, iso, now_ts, read_json, write_json

MAX_POINTS = 120           # per market, ring buffer (~30 hours at 15-minute cadence)
SERIES_LIMIT = 400         # markets that get a persisted series; the rest keep a sparkline only
JUMP_THRESHOLD = 0.10


def ts_path(ticker: str) -> str:
    safe = ticker.replace("/", "_")
    return os.path.join(DATA, "timeseries", f"{safe}.json")


def _rank_key(m):
    liq = (m.get("book") or {}).get("total_liquidity_usd") or 0
    return (-liq, -(m.get("dollar_volume") or 0))


def append_series(snapshot: dict) -> dict:
    """Append observations; return per-ticker previous points for jump detection.

    Server-side series files are written only for the highest-liquidity markets. Storing a file per
    market meant ~5,500 files and 22 MB per run, which is unshippable; jump detection only needs the
    previous observation, which the in-snapshot sparkline carries for every market.
    """
    ts = snapshot["generated_ts"]
    ranked = sorted(snapshot["markets"], key=_rank_key)
    keep = {m["ticker"] for m in ranked[:SERIES_LIMIT]}
    observations = {}
    for m in snapshot["markets"]:
        ticker = m["ticker"]
        spark = m.get("spark") or []
        if ticker not in keep:
            previous = spark[-1] if spark else None
            cur = {"t": ts, "bid": m.get("yes_bid"), "ask": m.get("yes_ask"), "mid": m.get("mid"),
                   "last": m.get("last_price"), "vol": m.get("volume"), "oi": m.get("open_interest")}
            observations[ticker] = {"previous": previous, "current": cur, "market": m}
            continue
        path = ts_path(ticker)
        doc = read_json(path) or {"ticker": ticker, "title": m["title"],
                                  "topics": m["topics"], "points": []}
        points = doc.get("points") or []
        if not points and spark:
            points = list(spark)
        if points and points[-1].get("t") == ts:
            points.pop()  # idempotent re-run within the same second
        previous = points[-1] if points else None
        point = {
            "t": ts,
            "bid": m.get("yes_bid"),
            "ask": m.get("yes_ask"),
            "mid": m.get("mid"),
            "last": m.get("last_price"),
            "vol": m.get("volume"),
            "oi": m.get("open_interest"),
        }
        book = m.get("book") or {}
        if book.get("total_liquidity_usd") is not None:
            point["liq"] = book["total_liquidity_usd"]
            point["yes_qty"] = book.get("yes_bid_qty_total")
            point["no_qty"] = book.get("no_bid_qty_total")
        points.append(point)
        doc["points"] = points[-MAX_POINTS:]
        doc.update({"title": m["title"], "topics": m["topics"], "event_ticker": m["event_ticker"],
                    "series_ticker": m["series_ticker"], "updated_at": iso()})
        write_json(path, doc, indent=0)
        observations[ticker] = {"previous": previous, "current": point, "market": m}
    return observations


def detect_jumps(observations: dict, snapshot: dict) -> list[dict]:
    jumps = []
    for ticker, obs in observations.items():
        prev, cur, m = obs["previous"], obs["current"], obs["market"]
        ref_prev = prev.get("mid") if prev else None
        ref_cur = cur.get("mid")
        if ref_prev is None or ref_cur is None:
            continue
        delta = round(ref_cur - ref_prev, 4)
        if abs(delta) < JUMP_THRESHOLD:
            continue
        jumps.append({
            "ticker": ticker,
            "title": m["title"],
            "event_ticker": m["event_ticker"],
            "topics": m["topics"],
            "kalshi_category": m.get("kalshi_category"),
            "from": ref_prev,
            "to": ref_cur,
            "delta": delta,
            "direction": "up" if delta > 0 else "down",
            "from_ts": prev.get("t"),
            "to_ts": cur.get("t"),
            "observed_at": iso(),
            "liquidity_usd": (m.get("book") or {}).get("total_liquidity_usd"),
            "volume_24h": m.get("volume_24h"),
            "close_time": m.get("close_time"),
            "sources": m.get("sources"),
            "attribution_status": "unverified",
        })
    return jumps


def merge_attributions(jumps: list[dict]) -> list[dict]:
    """Attach human-confirmed causes from data/attributions.json, source URL required."""
    att = read_json(os.path.join(DATA, "attributions.json"), {}) or {}
    for j in jumps:
        entry = att.get(f"{j['ticker']}@{j['to_ts']}")
        if entry and entry.get("source_url"):
            j["attribution_status"] = "confirmed"
            j["attribution"] = entry
    return jumps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", default=os.path.join(DATA, "markets", "latest.json"))
    args = ap.parse_args()

    snapshot = read_json(args.snapshot)
    if not snapshot:
        print("no snapshot; run collector.collect first", file=sys.stderr)
        return 1
    observations = append_series(snapshot)

    jumps_path = os.path.join(DATA, "jumps.json")
    existing = read_json(jumps_path, {"jumps": []}) or {"jumps": []}
    new_jumps = merge_attributions(detect_jumps(observations, snapshot))
    seen = {(j["ticker"], j["to_ts"]) for j in existing.get("jumps", [])}
    merged = [j for j in new_jumps if (j["ticker"], j["to_ts"]) not in seen] + existing.get("jumps", [])
    merged.sort(key=lambda j: j["to_ts"] or 0, reverse=True)
    write_json(jumps_path, {
        "generated_at": iso(),
        "threshold_dollars": JUMP_THRESHOLD,
        "attribution_note": "Causes are only shown when a reviewer has filed a source URL in "
                            "data/attributions.json. Unattributed jumps are listed as unverified.",
        "jumps": merged[:500],
    })
    print(f"observations={len(observations)} new_jumps={len(new_jumps)} total_jumps={len(merged[:500])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
