"""
Collector: one run = one observation cycle.

Pipeline (all public, unauthenticated reads):
  1. /series per category          -> official category/tags for topic membership
  2. /events?status=open           -> live events, carries `category`
  3. /markets?status=open          -> quotes, volume, open interest (multivariate excluded)
  4. /markets/{t}/orderbook?depth=10 -> liquidity: YES-bid liquidity (= NO ask) and NO-bid
     liquidity (= YES ask), plus the contract count available at each price

Outputs (all deterministic, sorted, no invented values):
  data/universe.json      series index + topic catalogue + run metadata
  data/markets/latest.json  snapshot used by the pages (per market + per event rollups)
  data/timeseries/{ticker}.json  append-only price/liquidity series for charting
  data/jumps.json         moves >= $0.10 between consecutive observations

Every market row records `sources` so the UI can link each value back to the exchange.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from collector import topics as topicmod
from collector.kalshi_client import DEMO, PROD, KalshiClient
from collector.util import (DATA, cents, fnum, iso, now_ts, parse_ts, read_json, utcnow,
                            write_json)

CATEGORIES = [
    "Crypto", "Elections", "Economics", "Commodities", "Culture", "Entertainment",
    "Social", "Sports", "Financials", "Politics",
]

JUMP_THRESHOLD = 0.10          # the user-specified alert level, in dollars
MAX_DEPTH_TICKERS = 45         # orderbook calls per run, liquidity-first (rate-limit friendly)


def build_universe(client: KalshiClient) -> dict:
    config = topicmod.load_config()
    series_all = []
    seen = set()
    for cat in CATEGORIES:
        try:
            for s in client.series_list(category=cat, max_pages=8):
                if s.get("ticker") and s["ticker"] not in seen:
                    seen.add(s["ticker"])
                    series_all.append(s)
        except Exception as e:  # noqa: BLE001 - one bad category must not kill the run
            print(f"  series[{cat}] failed: {e}", file=sys.stderr)
    index = topicmod.index_series(series_all, config)
    return {
        "generated_at": iso(),
        "series_count": len(index),
        "series": index,
        "topics": topicmod.topic_catalogue(config),
    }


def depth_summary(book: dict) -> dict:
    """Liquidity in dollars and contracts per side.

    From the orderbook doc: only bids are returned. A YES bid at X is a NO ask at 1-X with the
    same size. So:
      * cost to BUY YES (lifting NO bids) = sum over no-bids of qty * (1 - no_price)
      * cost to BUY NO  (lifting YES bids) = sum over yes-bids of qty * (1 - yes_price)
    and contracts available at the touch are the sizes of the best bid on each side.
    """
    yes = book.get("yes") or []
    no = book.get("no") or []
    yes_qty = sum(q for _, q in yes)
    no_qty = sum(q for _, q in no)
    # NOTE both sides use (1 - resting price) deliberately: the two are symmetric statements of
    # "dollars that must be paid to take the other side", which is what the UI labels them as.
    yes_liquidity = sum(q * (1 - p) for p, q in no)
    no_liquidity = sum(q * (1 - p) for p, q in yes)
    return {
        "yes_bid_qty": yes[-1][1] if yes else 0.0,
        "no_bid_qty": no[-1][1] if no else 0.0,
        "yes_bid_levels": len(yes),
        "no_bid_levels": len(no),
        "yes_bid_qty_total": round(yes_qty, 2),
        "no_bid_qty_total": round(no_qty, 2),
        "buy_yes_liquidity_usd": round(yes_liquidity, 2),
        "buy_no_liquidity_usd": round(no_liquidity, 2),
        "total_liquidity_usd": round(yes_liquidity + no_liquidity, 2),
        "best_yes_bid": yes[-1][0] if yes else None,
        "best_no_bid": no[-1][0] if no else None,
        "levels": {"yes": yes[-10:], "no": no[-10:]},
    }


def collect(base: str, with_depth: bool = True, depth_limit: int = MAX_DEPTH_TICKERS) -> dict:
    client = KalshiClient(base)
    print(f"collector: base={base}")
    status = client.exchange_status()
    print(f"  exchange trading_active={status.get('trading_active')}")

    universe = build_universe(client)
    write_json(os.path.join(DATA, "universe.json"), universe)
    print(f"  series indexed: {universe['series_count']}")

    events = client.events(status="open", max_pages=25)
    print(f"  open events: {len(events)}")
    markets = client.markets(status="open", max_pages=25)
    print(f"  open markets (mve excluded): {len(markets)}")

    series_index = universe["series"]
    event_by_ticker = {e["event_ticker"]: e for e in events}

    rows = []
    for m in markets:
        ticker = m.get("ticker")
        if not ticker or topicmod.is_excluded(ticker):
            continue
        ev = event_by_ticker.get(m.get("event_ticker")) or {}
        series_ticker = ev.get("series_ticker") or ticker.split("-")[0]
        s = series_index.get(series_ticker) or {}
        topics = s.get("topics") or []
        if not topics:
            continue
        yes_bid = fnum(m.get("yes_bid_dollars"))
        yes_ask = fnum(m.get("yes_ask_dollars"))
        last = fnum(m.get("last_price_dollars"))
        mid = None
        if yes_bid is not None and yes_ask is not None and yes_ask > 0:
            mid = round((yes_bid + yes_ask) / 2, 4)
        elif yes_bid is not None:
            mid = yes_bid
        volume = fnum(m.get("volume_fp"), 0.0) or 0.0
        vol24 = fnum(m.get("volume_24h_fp"), 0.0) or 0.0
        oi = fnum(m.get("open_interest_fp"), 0.0) or 0.0
        notional = fnum(m.get("notional_value_dollars"), 1.0) or 1.0
        rows.append({
            "ticker": ticker,
            "event_ticker": m.get("event_ticker"),
            "series_ticker": series_ticker,
            "title": m.get("title") or ev.get("title") or ticker,
            "event_title": ev.get("title") or "",
            "yes_sub_title": m.get("yes_sub_title") or "",
            "topics": topics,
            "kalshi_category": ev.get("category") or s.get("category") or "",
            "status": m.get("status"),
            "result": m.get("result") or "",
            "yes_bid": yes_bid,
            "yes_ask": yes_ask,
            "no_bid": round(1 - yes_ask, 4) if (yes_ask is not None and 0 < yes_ask <= 1) else None,
            "no_ask": round(1 - yes_bid, 4) if (yes_bid is not None and 0 <= yes_bid < 1) else None,
            "mid": mid,
            "price_label": ("mid" if (yes_bid is not None and yes_ask is not None and yes_ask > 0)
                            else ("bid only" if yes_bid is not None else "ask only")),
            "last_price": last,
            "volume": volume,
            "volume_24h": vol24,
            "open_interest": oi,
            "notional_value": notional,
            # Documented interpretation: a contract pays $1 if it settles YES.
            "dollar_volume": round(volume * notional, 2),
            "dollar_volume_24h": round(vol24 * notional, 2),
            "open_interest_dollars": round(oi * notional, 2),
            "close_time": m.get("close_time"),
            "close_ts": parse_ts(m.get("close_time")),
            "open_time": m.get("open_time"),
            "rules_primary": (m.get("rules_primary") or "")[:2000],
            "rules_secondary": (m.get("rules_secondary") or "")[:2000],
            "price_ranges": m.get("price_ranges") or [],
            "exchange_index": m.get("exchange_index"),
            "sources": {
                "market": f"{base}/markets/{ticker}",
                "event": f"{base}/events/{m.get('event_ticker')}",
                "series": f"{base}/series/{series_ticker}",
                # Verified pattern: kalshi.com/markets/<series ticker lowercase> resolves to the event page.
                "site": f"https://kalshi.com/markets/{series_ticker.lower()}",
            },
        })

    # Liquidity: orderbooks for the biggest markets per topic (rate-limit friendly).
    by_topic = defaultdict(list)
    for r in rows:
        for t in r["topics"]:
            by_topic[t].append(r)
    wanted, seen = [], set()
    per_topic_quota = max(1, depth_limit // max(1, len(by_topic)))
    for t, rs in by_topic.items():
        rs.sort(key=lambda r: (r["dollar_volume_24h"], r["dollar_volume"]), reverse=True)
        for r in rs[:per_topic_quota]:
            if r["ticker"] not in seen:
                seen.add(r["ticker"])
                wanted.append(r)
    # top up with the largest remaining markets
    rest = sorted(rows, key=lambda r: (r["dollar_volume_24h"], r["dollar_volume"]), reverse=True)
    for r in rest:
        if len(wanted) >= depth_limit:
            break
        if r["ticker"] not in seen:
            seen.add(r["ticker"])
            wanted.append(r)

    print(f"  orderbook calls: {len(wanted) if with_depth else 0}")
    for r in (wanted if with_depth else []):
        try:
            r["book"] = depth_summary(client.orderbook(r["ticker"], depth=10))
        except Exception as e:  # noqa: BLE001
            r["book"] = {"error": str(e)[:200]}

    # Event rollups: "highest dollar amount live events" is an event-level ranking.
    events_out = {}
    for r in rows:
        ev = r["event_ticker"]
        agg = events_out.setdefault(ev, {
            "event_ticker": ev,
            "series_ticker": r["series_ticker"],
            "title": r["event_title"] or r["title"],
            "topics": list(set(r["topics"])),
            "kalshi_category": r["kalshi_category"],
            "markets": 0,
            "dollar_volume": 0.0,
            "dollar_volume_24h": 0.0,
            "open_interest_dollars": 0.0,
            "liquidity_usd": 0.0,
            "close_ts": r["close_ts"],
            "close_time": r["close_time"],
            "top_yes_price": None,
            "top_yes_bid": None,
            "top_yes_ask": None,
            "site": f"https://kalshi.com/markets/{r['series_ticker'].lower()}",
            "rules_primary": r["rules_primary"],
            "settlement_sources": (series_index.get(r["series_ticker"]) or {}).get("settlement_sources", []),
        })
        agg["markets"] += 1
        for k in ("dollar_volume", "dollar_volume_24h", "open_interest_dollars"):
            agg[k] = round(agg[k] + (r.get(k) or 0), 2)
        if r.get("book"):
            agg["liquidity_usd"] = round(agg["liquidity_usd"] + (r["book"].get("total_liquidity_usd") or 0), 2)
        if r["close_ts"] and (agg["close_ts"] is None or r["close_ts"] < agg["close_ts"]):
            agg["close_ts"], agg["close_time"] = r["close_ts"], r["close_time"]
        # Event-level price summary: the most expensive YES (the leading outcome) and the range.
        if r["mid"] is not None:
            if agg["top_yes_price"] is None or r["mid"] > agg["top_yes_price"]:
                agg["top_yes_price"] = r["mid"]
        if r["yes_bid"] is not None:
            if agg["top_yes_bid"] is None or r["yes_bid"] > agg["top_yes_bid"]:
                agg["top_yes_bid"] = r["yes_bid"]
        if r["yes_ask"] is not None:
            if agg["top_yes_ask"] is None or r["yes_ask"] < agg["top_yes_ask"]:
                agg["top_yes_ask"] = r["yes_ask"]

    return {
        "generated_at": iso(),
        "generated_ts": now_ts(),
        "base_url": base,
        "exchange_status": status,
        "counts": {"events": len(events_out), "markets": len(rows), "series": universe["series_count"]},
        "markets": rows,
        "events": sorted(events_out.values(), key=lambda e: -e["dollar_volume"]),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=PROD)
    ap.add_argument("--out", default=os.path.join(DATA, "markets", "latest.json"))
    ap.add_argument("--no-depth", action="store_true")
    args = ap.parse_args()

    snapshot = collect(args.base, with_depth=not args.no_depth)
    write_json(args.out, snapshot)
    print(f"wrote {args.out}  markets={len(snapshot['markets'])} events={len(snapshot['events'])}")

    # Run log so the site can prove when data was last refreshed.
    runlog_path = os.path.join(DATA, "runlog.json")
    runlog = read_json(runlog_path, []) or []
    runlog.insert(0, {
        "at": snapshot["generated_at"],
        "base_url": snapshot["base_url"],
        "counts": snapshot["counts"],
        "trading_active": snapshot["exchange_status"].get("trading_active"),
    })
    write_json(runlog_path, runlog[:200])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
