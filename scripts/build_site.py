"""Build the static dashboard data from the OFFICIAL Kalshi Trade API (public GET endpoints only).

Outputs JSON under <out>/data/ and copies the static site from site/ into <out>/.
Every value written is either copied from an API field or derived by a formula documented
in reports/METHODOLOGY.md. Missing or inconsistent values are written as null and recorded in
data/flags.json so they appear on the Flagged for Review page.

Usage: python3 scripts/build_site.py [--out _site] [--quick]
  --quick  skips backtests (used for debugging)
"""
import argparse
import datetime as dt
import html
import json
import os
import pathlib
import re
import shutil
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import kalshi_api as k  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
NOW = int(time.time())
GENERATED_AT = dt.datetime.fromtimestamp(NOW, dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
TOP_N_DETAIL = 40          # markets that get orderbook + candlestick detail
RESOLVED_DAYS = 30
MAX_ROWS_PER_TOPIC = 5000
MOVE_THRESHOLD = 0.10      # brief: sharp jump >= $0.10 in either direction

FLAGS = []


def flag(severity, scope, entity, message, source_url=""):
    FLAGS.append({"severity": severity, "scope": scope, "entity": entity,
                  "message": message, "source_url": source_url})


def to_float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def iso_to_epoch(s):
    if not s:
        return None
    try:
        return int(dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def market_api_url(ticker):
    return f"{k.BASE}/markets/{ticker}"


def load_topics():
    cfg = json.loads((ROOT / "config/topics.json").read_text())
    return cfg["topics"]


def topic_for_series(s, topics):
    tk = s.get("ticker", "")
    tags = set(s.get("tags") or [])
    cat = s.get("category") or ""
    for t in topics:
        r = t["rules"]
        if "series_ticker_regex" in r and re.search(r["series_ticker_regex"], tk):
            return t["id"]
        if "series_tags_any" in r and tags.intersection(r["series_tags_any"]):
            return t["id"]
        if "series_categories" in r and cat in r["series_categories"]:
            return t["id"]
    return None


def series_for_event(event_ticker, series_map, cache):
    """Event tickers are '<SERIES>-<EVENT SUFFIX>'. Pick the longest hyphen prefix that is a known series."""
    if event_ticker in cache:
        return cache[event_ticker]
    parts = event_ticker.split("-")
    found = None
    for i in range(len(parts), 0, -1):
        cand = "-".join(parts[:i])
        if cand in series_map:
            found = cand
            break
    cache[event_ticker] = found
    return found


def sources_list(series):
    out = []
    for s in (series or {}).get("settlement_sources") or []:
        name = (s or {}).get("name", "")
        url = (s or {}).get("url", "")
        out.append({"name": name, "url": url})
        if name != name.strip() or "  " in name or name.endswith(" ") or name.endswith(" of"):
            flag("info", "settlement_sources", (series or {}).get("ticker", ""),
                 f"Settlement source name looks like unfilled template text: '{name}'",
                 (series or {}).get("contract_terms_url", ""))
    return out


def compact_market(m, series, topic_id):
    """Map one official Market object to the dashboard row. Derived fields are labelled in the methodology."""
    ticker = m.get("ticker", "")
    title = m.get("title") or ""
    if not title:
        flag("review", "markets", ticker, "Market has no 'title' field in API response; title left blank (not inferred).", market_api_url(ticker))
    yes_bid = to_float(m.get("yes_bid_dollars"))
    yes_ask = to_float(m.get("yes_ask_dollars"))
    last = to_float(m.get("last_price_dollars"))
    vol24 = to_float(m.get("volume_24h_fp"))
    vol_total = to_float(m.get("volume_fp"))
    oi = to_float(m.get("open_interest_fp"))
    notional = to_float(m.get("notional_value_dollars"))
    if yes_bid is not None and yes_ask is not None and yes_bid > yes_ask:
        flag("review", "markets", ticker, f"yes_bid {yes_bid} > yes_ask {yes_ask} (crossed quote as returned by API)", market_api_url(ticker))
    result = m.get("result", "")
    row = {
        "ticker": ticker,
        "event_ticker": m.get("event_ticker", ""),
        "series_ticker": series.get("ticker") if series else None,
        "topic": topic_id,
        "title": title,
        "outcome": m.get("yes_sub_title") or "",
        "status": m.get("status") or "",
        "result": result,
        "yes_bid": yes_bid,
        "yes_ask": yes_ask,
        "last": last,
        "prev_last": to_float(m.get("previous_price_dollars")),
        "volume_24h_contracts": vol24,
        "volume_total_contracts": vol_total,
        "open_interest_contracts": oi,
        "notional_value": notional,
        # DERIVED (see METHODOLOGY): estimated 24h dollar traded = 24h contracts x last traded YES price
        "est_24h_usd": round(vol24 * last, 4) if (vol24 is not None and last is not None) else None,
        # DERIVED: open interest at settlement value = open interest contracts x notional value per contract
        "oi_notional_usd": round(oi * notional, 4) if (oi is not None and notional is not None) else None,
        "open_time": m.get("open_time") or "",
        "close_time": m.get("close_time") or "",
        "expected_expiration_time": m.get("expected_expiration_time") or "",
        "settlement_ts": m.get("settlement_ts") or "",
        "rules_primary": m.get("rules_primary") or "",
        "price_level_structure": m.get("price_level_structure") or "",
        "source_api": market_api_url(ticker),
        "source_terms": (series or {}).get("contract_terms_url") or "",
        "settlement_sources": sources_list(series),
    }
    if result == "" and m.get("status") == "finalized":
        flag("review", "markets", ticker, "Market is finalized but result field is empty.", market_api_url(ticker))
    return row


def fetch_series_map():
    series = list(k.paginate("/series", "series", {}, limit=1000, max_pages=60))
    return {s["ticker"]: s for s in series if s.get("ticker")}, len(series)


def fetch_open_markets():
    return list(k.paginate("/markets", "markets", {"status": "open", "mve_filter": "exclude"},
                      limit=1000, max_pages=400, pause=0.1))


def fetch_settled_markets(min_settled_ts):
    out = []
    cursor_pages = k.paginate("/markets", "markets",
                              {"status": "settled", "mve_filter": "exclude", "min_settled_ts": min_settled_ts},
                              limit=1000, max_pages=200, pause=0.1)
    for m in cursor_pages:
        out.append(m)
    return out


def orderbook_summary(ob):
    book = ob.get("orderbook_fp") or ob.get("orderbook") or {}
    yes = book.get("yes_dollars") or book.get("yes") or []
    no = book.get("no_dollars") or book.get("no") or []
    yes_levels = [{"price": float(p), "contracts": float(q)} for p, q in yes]
    no_levels = [{"price": float(p), "contracts": float(q)} for p, q in no]
    best_yes_bid = yes_levels[-1]["price"] if yes_levels else None
    best_no_bid = no_levels[-1]["price"] if no_levels else None
    # Kalshi docs: YES ask = 1.00 - best NO bid ; NO ask = 1.00 - best YES bid
    best_yes_ask = round(1.0 - best_no_bid, 4) if best_no_bid is not None else None
    best_no_ask = round(1.0 - best_yes_bid, 4) if best_yes_bid is not None else None
    return {
        "best_yes_bid": best_yes_bid,
        "best_yes_ask_implied": best_yes_ask,
        "best_no_bid": best_no_bid,
        "best_no_ask_implied": best_no_ask,
        "yes_bid_contracts_total": round(sum(l["contracts"] for l in yes_levels), 2),
        "no_bid_contracts_total": round(sum(l["contracts"] for l in no_levels), 2),
        "yes_levels": yes_levels,
        "no_levels": no_levels,
    }


def candles(series_ticker, ticker, start, end, period):
    data = k.get(f"/series/{series_ticker}/markets/{ticker}/candlesticks",
                 {"start_ts": int(start), "end_ts": int(end), "period_interval": int(period)})
    out = []
    for c in data.get("candlesticks", []) or []:
        price = c.get("price") or {}
        yb = c.get("yes_bid") or {}
        ya = c.get("yes_ask") or {}
        out.append({
            "t": c.get("end_period_ts"),
            "close": to_float(price.get("close_dollars")),
            "high": to_float(price.get("high_dollars")),
            "low": to_float(price.get("low_dollars")),
            "bid_close": to_float(yb.get("close_dollars")),
            "ask_close": to_float(ya.get("close_dollars")),
            "volume": to_float(c.get("volume_fp")),
        })
    return out


def detect_moves(rows_by_ticker, candle_map, label):
    moves = []
    for ticker, series_points in candle_map.items():
        pts = [p for p in series_points if p["close"] is not None]
        for prev, cur in zip(pts, pts[1:]):
            d = round(cur["close"] - prev["close"], 4)
            if abs(d) + 1e-9 >= MOVE_THRESHOLD:
                r = rows_by_ticker.get(ticker, {})
                moves.append({
                    "ticker": ticker,
                    "title": r.get("title", ""),
                    "topic": r.get("topic", ""),
                    "granularity": label,
                    "from_t": prev["t"], "to_t": cur["t"],
                    "from_price": prev["close"], "to_price": cur["close"],
                    "change": d,
                    "direction": "up" if d > 0 else "down",
                    "source_api": market_api_url(ticker),
                    "source_terms": r.get("source_terms", ""),
                    "settlement_sources": r.get("settlement_sources", []),
                    "cause": "NOT VERIFIED - no official news attribution is available from the API",
                })
    moves.sort(key=lambda x: (x["to_t"] or 0), reverse=True)
    return moves


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, sort_keys=False))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="_site")
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    out = ROOT / args.out
    if out.exists():
        shutil.rmtree(out)
    (out / "data").mkdir(parents=True)

    topics = load_topics()
    topic_ids = [t["id"] for t in topics]
    print("API base:", k.BASE, flush=True)
    print("exchange status:", json.dumps(k.get("/exchange/status")), flush=True)

    series_map, n_series = fetch_series_map()
    series_topic = {tk: topic_for_series(s, topics) for tk, s in series_map.items()}
    topic_series_count = {t: sum(1 for v in series_topic.values() if v == t) for t in topic_ids}
    print("series:", n_series, "topic series:", topic_series_count, flush=True)

    open_raw = fetch_open_markets()
    print("open non-combo markets fetched:", len(open_raw), flush=True)

    event_cache = {}
    per_topic = {t: [] for t in topic_ids}
    unmatched_series = 0
    open_by_topic_total = {t: 0 for t in topic_ids}
    for m in open_raw:
        sk = series_for_event(m.get("event_ticker", ""), series_map, event_cache)
        if sk is None:
            unmatched_series += 1
            continue
        tp = series_topic.get(sk)
        if tp is None:
            continue
        open_by_topic_total[tp] += 1
        per_topic[tp].append(compact_market(m, series_map[sk], tp))
    if unmatched_series:
        flag("info", "markets", "series mapping", f"{unmatched_series} open markets could not be mapped to a series ticker and were excluded from topics.")

    # Sort by estimated 24h dollar volume (derived), keep caps
    for tp in topic_ids:
        per_topic[tp].sort(key=lambda r: (r["est_24h_usd"] or 0, r["volume_24h_contracts"] or 0), reverse=True)
        if len(per_topic[tp]) > MAX_ROWS_PER_TOPIC:
            flag("info", "markets", tp, f"Topic has {len(per_topic[tp])} open markets; first {MAX_ROWS_PER_TOPIC} written (sorted by est. 24h $).")
            per_topic[tp] = per_topic[tp][:MAX_ROWS_PER_TOPIC]

    # Resolved (settled) markets within the window
    settled_raw = fetch_settled_markets(NOW - RESOLVED_DAYS * 86400)
    print("settled non-combo markets in window:", len(settled_raw), flush=True)
    resolved = []
    settled_seen = set()
    for m in settled_raw:
        if m.get("ticker") in settled_seen:
            continue
        settled_seen.add(m.get("ticker"))
        sk = series_for_event(m.get("event_ticker", ""), series_map, event_cache)
        tp = series_topic.get(sk) if sk else None
        if tp is None:
            continue
        row = compact_market(m, series_map[sk], tp)
        res = row["result"]
        if res not in ("yes", "no"):
            flag("review", "resolved", row["ticker"], f"Settled market has result '{res or '(empty)'}' - not a yes/no outcome; shown as-is.", row["source_api"])
        row["resolved_outcome"] = res if res in ("yes", "no") else None
        row["settlement_value"] = to_float(m.get("settlement_value_dollars"))
        resolved.append(row)
    resolved.sort(key=lambda r: r.get("settlement_ts") or "", reverse=True)
    resolved = resolved[:MAX_ROWS_PER_TOPIC]

    rows_by_ticker = {}
    for tp in topic_ids:
        for r in per_topic[tp]:
            rows_by_ticker[r["ticker"]] = r
    for r in resolved:
        rows_by_ticker.setdefault(r["ticker"], r)

    # Orderbooks + candles for the top-N topic markets by estimated 24h dollars
    ranked = sorted([r for tp in topic_ids for r in per_topic[tp] if (r["est_24h_usd"] or 0) > 0],
                    key=lambda r: r["est_24h_usd"], reverse=True)[:TOP_N_DETAIL]
    orderbooks = {}
    candle_1m, candle_1h = {}, {}
    for r in ranked:
        t = r["ticker"]
        try:
            ob = orderbook_summary(k.get(f"/markets/{t}/orderbook"))
            orderbooks[t] = {**ob, "source_api": f"{k.BASE}/markets/{t}/orderbook", "fetched_at": NOW}
        except k.KalshiError as exc:
            flag("review", "orderbook", t, f"Orderbook request failed: {str(exc)[:160]}")
        sr = r["series_ticker"]
        try:
            candle_1m[t] = candles(sr, t, NOW - 6 * 3600, NOW, 1)
            candle_1h[t] = candles(sr, t, NOW - 7 * 86400, NOW, 60)
        except k.KalshiError as exc:
            flag("review", "candles", t, f"Candlestick request failed: {str(exc)[:160]}")
            candle_1m[t], candle_1h[t] = [], []
        if not candle_1h[t]:
            flag("info", "candles", t, "No 60-minute candlesticks returned for the last 7 days (thin or inactive market).", market_api_url(t))
        time.sleep(0.2)

    moves_1m = detect_moves(rows_by_ticker, candle_1m, "1m (last 6h)")
    moves_1h = detect_moves(rows_by_ticker, candle_1h, "1h (last 7d)")
    moves = (moves_1h + moves_1m)
    moves.sort(key=lambda x: x["to_t"] or 0, reverse=True)
    print("markets detailed:", len(ranked), "moves>=0.10:", len(moves), flush=True)

    # Backtests on resolved markets (candles over each market's life)
    backtest = None
    if not args.quick:
        import backtest as bt
        bt_candidates = [r for r in resolved if r.get("resolved_outcome") in ("yes", "no")]
        backtest = bt.run(bt_candidates, candles, k, flag, NOW)

    meta = {
        "generated_at": GENERATED_AT,
        "generated_epoch": NOW,
        "api_base": k.BASE,
        "api_docs": "https://docs.kalshi.com/getting_started/api_environments",
        "refresh_minutes": 30,
        "series_total": n_series,
        "topic_series_count": topic_series_count,
        "open_markets_fetched": len(open_raw),
        "open_by_topic_total": open_by_topic_total,
        "rows_written": {t: len(per_topic[t]) for t in topic_ids},
        "resolved_window_days": RESOLVED_DAYS,
        "resolved_rows": len(resolved),
        "resolved_yes": sum(1 for r in resolved if r.get("resolved_outcome") == "yes"),
        "resolved_no": sum(1 for r in resolved if r.get("resolved_outcome") == "no"),
        "detail_markets": len(ranked),
        "moves_threshold_usd": MOVE_THRESHOLD,
        "moves_count": len(moves),
        "flags_count": len(FLAGS),
        "topics": [{"id": t["id"], "label": t["label"], "description": t["description"]} for t in topics],
    }

    for tp in topic_ids:
        write_json(out / "data" / f"topic-{tp}.json", {
            "topic": tp,
            "label": next(t["label"] for t in topics if t["id"] == tp),
            "generated_at": GENERATED_AT,
            "open_total_in_topic": open_by_topic_total[tp],
            "rows": per_topic[tp],
        })
    write_json(out / "data" / "resolved.json", {"generated_at": GENERATED_AT, "window_days": RESOLVED_DAYS, "rows": resolved})
    write_json(out / "data" / "orderbook.json", {"generated_at": GENERATED_AT, "books": orderbooks})
    write_json(out / "data" / "candles.json", {"generated_at": GENERATED_AT,
                                              "period_1m_last_6h": candle_1m, "period_60m_last_7d": candle_1h})
    write_json(out / "data" / "moves.json", {"generated_at": GENERATED_AT, "threshold_usd": MOVE_THRESHOLD, "moves": moves[:2000]})
    if backtest is not None:
        write_json(out / "data" / "backtest.json", backtest)
    write_json(out / "data" / "flags.json", {"generated_at": GENERATED_AT, "flags": FLAGS})
    write_json(out / "data" / "meta.json", meta)
    print("flags:", len(FLAGS), flush=True)

    # Static site + rendered markdown reports
    import render_site
    render_site.render(ROOT, out, meta)
    print("built", out, flush=True)


if __name__ == "__main__":
    main()
