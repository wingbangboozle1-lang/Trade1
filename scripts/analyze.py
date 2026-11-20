"""Analysis helpers for the Kalshi demo dashboard (stdlib only).

Topic rules (documented on the site, Flagged page lists every assumption):
  crypto    : series.category == "Crypto"
  elections : series.category == "Elections"
  culture   : series.category == "Entertainment"   (culture = Kalshi "Entertainment")
  gas       : series.category == "Commodities" with tag "Oil & Gas", or a
              gas-price title match (r"gas price|gasoline") in any category
  golf      : series.category == "Sports" with tag "Golf"
A series is assigned to the first matching topic in the order above.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

TOPIC_LABELS = {
    "crypto": "Crypto",
    "elections": "Elections",
    "culture": "Culture (Entertainment)",
    "gas": "Gas prices",
    "golf": "Golf",
}

DOCS = {
    "api_envs": "https://docs.kalshi.com/getting_started/api_environments",
    "get_events": "https://docs.kalshi.com/api-reference/events/get-events",
    "get_series": "https://docs.kalshi.com/api-reference/market/get-series-list",
    "get_markets": "https://docs.kalshi.com/api-reference/market/get-markets",
    "candles": "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
    "orderbook": "https://docs.kalshi.com/api-reference/market/get-market-orderbook",
    "orderbook_concepts": "https://docs.kalshi.com/getting_started/orderbook_responses",
    "settlement": "https://docs.kalshi.com/getting_started/market_settlement",
    "lifecycle": "https://docs.kalshi.com/getting_started/market_lifecycle",
    "ws": "https://docs.kalshi.com/getting_started/quick_start_websockets",
    "tags": "https://external-api.demo.kalshi.co/trade-api/v2/search/tags_by_categories",
}

PUBLIC_FIELDS = [
    "ticker", "event_ticker", "series_ticker", "topic", "title", "yes_sub_title", "event_title",
    "status", "result", "resolved", "category", "close_time", "open_time", "yes_bid", "yes_ask",
    "no_bid", "no_ask", "last_price", "volume_fp", "volume_24h_fp", "open_interest_fp",
    "yes_bid_size_fp", "yes_ask_size_fp", "est_dollar_volume", "settlement_sources",
    "contract_terms_url", "series_title", "source_url", "captured_at", "first_seen",
    "series_tags", "rules_primary",
]

_GAS_TITLE = re.compile(r"gas price|gasoline", re.I)


def topic_for_series(s: dict) -> str | None:
    cat = s.get("category")
    cats = s.get("categories") or []
    tags = s.get("tags") or []
    title = s.get("title") or ""
    if cat == "Crypto" or "Crypto" in cats:
        return "crypto"
    if cat == "Elections":
        return "elections"
    if cat == "Entertainment":
        return "culture"
    if cat == "Commodities" and "Oil & Gas" in tags:
        return "gas"
    if _GAS_TITLE.search(title):
        return "gas"
    if cat == "Sports" and "Golf" in tags:
        return "golf"
    return None


def _dollars(v):
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def iso(ts) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def market_record(m: dict, ev: dict, s: dict, topic: str, base: str, now: int) -> dict:
    tk = m["ticker"]
    last = _dollars(m.get("last_price_dollars"))
    vol = _dollars(m.get("volume_fp"))
    src = ev.get("settlement_sources") or s.get("settlement_sources") or []
    return {
        "ticker": tk,
        "event_ticker": m.get("event_ticker") or ev.get("event_ticker"),
        "series_ticker": s.get("ticker"),
        "topic": topic,
        "title": m.get("title"),
        "yes_sub_title": m.get("yes_sub_title"),
        "event_title": ev.get("title"),
        "status": m.get("status"),
        "result": m.get("result") or None,
        "resolved": False,
        "category": ev.get("category") or s.get("category"),
        "close_time": m.get("close_time"),
        "open_time": m.get("open_time"),
        "yes_bid": _dollars(m.get("yes_bid_dollars")),
        "yes_ask": _dollars(m.get("yes_ask_dollars")),
        "no_bid": _dollars(m.get("no_bid_dollars")),
        "no_ask": _dollars(m.get("no_ask_dollars")),
        "last_price": last,
        "volume_fp": vol,
        "volume_24h_fp": _dollars(m.get("volume_24h_fp")),
        "open_interest_fp": _dollars(m.get("open_interest_fp")),
        "yes_bid_size_fp": _dollars(m.get("yes_bid_size_fp")),
        "yes_ask_size_fp": _dollars(m.get("yes_ask_size_fp")),
        # DERIVED (not an API field): contracts traded x last trade price. Formula shown on site.
        "est_dollar_volume": round(vol * last, 2) if (vol is not None and last is not None) else None,
        "settlement_sources": [{"name": x.get("name"), "url": x.get("url")} for x in src],
        "contract_terms_url": s.get("contract_terms_url"),
        "contract_url": s.get("contract_url"),
        "series_title": s.get("title"),
        "series_tags": s.get("tags"),
        "rules_primary": m.get("rules_primary") or None,
        "source_url": f"{base}/markets/{tk}",
        "captured_at": iso(now),
    }


def orderbook_levels(ob: dict) -> dict | None:
    book = (ob or {}).get("orderbook_fp")
    if not book:
        return None

    def conv(levels):
        out = []
        for p, q in levels or []:
            out.append({"price": _dollars(p), "contracts": _dollars(q)})
        return sorted(out, key=lambda x: -(x["price"] or 0))

    return {"yes_bids": conv(book.get("yes_dollars")), "no_bids": conv(book.get("no_dollars"))}


def candle_rows(cands: list) -> list:
    """[end_ts, open, high, low, close, volume, open_interest] per candle (null if absent)."""
    rows = []
    for c in cands:
        p = c.get("price") or {}
        rows.append([
            c.get("end_period_ts"),
            _dollars(p.get("open_dollars")),
            _dollars(p.get("high_dollars")),
            _dollars(p.get("low_dollars")),
            _dollars(p.get("close_dollars")),
            _dollars(c.get("volume_fp")),
            _dollars(c.get("open_interest_fp")),
        ])
    return rows


PERIOD_LABEL = {"1": "1 minute", "60": "1 hour", "1440": "1 day"}


def find_jumps(tracked: dict, threshold: float = 0.10, limit: int = 500) -> list:
    out = []
    for tk, rec in tracked.items():
        candles = rec.get("candles") or {}
        for period in ("1", "60", "1440"):
            rows = [r for r in candles.get(period, []) if r and r[4] is not None]
            for prev, cur in zip(rows, rows[1:]):
                delta = round(cur[4] - prev[4], 4)
                if abs(delta) + 1e-9 >= threshold:
                    out.append({
                        "ticker": tk, "title": rec.get("title"), "topic": rec.get("topic"),
                        "period": PERIOD_LABEL[period], "time": iso(cur[0]),
                        "from": prev[4], "to": cur[4], "delta": delta,
                        "direction": "up" if delta > 0 else "down",
                        "settlement_sources": rec.get("settlement_sources") or [],
                        "source_url": rec.get("source_url"),
                        "candles_source_url": candles.get(period + "_source_url"),
                        "cause": None, "cause_status": "unverified - no official cause link recorded",
                    })
    out.sort(key=lambda j: j["time"] or "", reverse=True)
    return out[:limit]


BANDS = [(0.0, 0.25, "0.00-0.25"), (0.25, 0.5, "0.25-0.50"), (0.5, 0.75, "0.50-0.75"), (0.75, 1.01, "0.75-1.00")]


def _band(p):
    for lo, hi, lab in BANDS:
        if lo <= p < hi:
            return lab
    return None


STRATEGIES = {
    "baseline_buy_yes": "Buy 1 YES at the first available hourly close (benchmark).",
    "momentum_buy_yes": "Buy 1 YES when the hourly close rose >= $0.10 over the prior 6 hourly candles.",
    "reversion_buy_yes": "Buy 1 YES when the hourly close fell >= $0.10 over the prior 6 hourly candles.",
    "fade_spike_buy_no": "Buy 1 NO when the hourly close rose >= $0.10 over the prior 6 hourly candles.",
}


def _signals(rows):
    """Yield (index, strategy, entry_price_for_side, side) for hourly candle rows."""
    closes = [r[4] for r in rows]
    first = next((i for i, c in enumerate(closes) if c is not None), None)
    if first is not None:
        yield first, "baseline_buy_yes", closes[first], "yes"
    for i in range(6, len(closes)):
        if closes[i] is None or closes[i - 6] is None:
            continue
        move = closes[i] - closes[i - 6]
        if move >= 0.10 - 1e-9:
            yield i, "momentum_buy_yes", closes[i], "yes"
            yield i, "fade_spike_buy_no", round(1 - closes[i], 4), "no"
        if move <= -0.10 + 1e-9:
            yield i, "reversion_buy_yes", closes[i], "yes"


def backtest(tracked: dict, resolved: dict) -> dict:
    trades = []
    seen = set()
    for tk, rec in tracked.items():
        if not rec.get("resolved") or rec.get("result") not in ("yes", "no"):
            continue
        rows = [r for r in (rec.get("candles") or {}).get("60", []) if r]
        for idx, strat, entry, side in _signals(rows):
            key = (tk, strat)
            if key in seen or entry is None or not (0 < entry < 1):
                continue
            seen.add(key)
            payout = 1.0 if (rec["result"] == side) else 0.0
            trades.append({
                "strategy": strat, "ticker": tk, "topic": rec.get("topic"),
                "side": side, "entry": entry, "band": _band(entry),
                "entry_time": iso(rows[idx][0]), "result": rec["result"],
                "pnl": round(payout - entry, 4), "source_url": rec.get("source_url"),
            })
    stats = []
    for name, desc in STRATEGIES.items():
        ts = [t for t in trades if t["strategy"] == name]
        n = len(ts)
        wins = sum(1 for t in ts if t["pnl"] > 0)
        stats.append({
            "strategy": name, "description": desc, "trades": n,
            "win_rate": round(wins / n, 4) if n else None,
            "avg_pnl_per_contract": round(sum(t["pnl"] for t in ts) / n, 4) if n else None,
            "total_pnl_per_contract": round(sum(t["pnl"] for t in ts), 4) if n else 0.0,
        })
    cats = {}
    for t in trades:
        k = (t["strategy"], t["topic"], t["band"])
        c = cats.setdefault(k, {"strategy": k[0], "topic": k[1], "band": k[2], "trades": 0, "pnl": 0.0, "wins": 0})
        c["trades"] += 1
        c["pnl"] += t["pnl"]
        c["wins"] += 1 if t["pnl"] > 0 else 0
    cat_rows = []
    for c in cats.values():
        cat_rows.append({**c, "pnl": round(c["pnl"], 4), "avg_pnl": round(c["pnl"] / c["trades"], 4),
                         "win_rate": round(c["wins"] / c["trades"], 4),
                         "small_sample": c["trades"] < 30})
    return {
        "resolved_markets_with_hourly_candles": sum(
            1 for r in tracked.values() if r.get("resolved") and (r.get("candles") or {}).get("60")),
        "resolved_markets_total": len(resolved),
        "fees_modelled": False,
        "note": "Simulation only, 1 contract per signal, fees not modelled, entry at candle close. "
                "Not financial advice; no real orders are placed.",
        "strategies": stats,
        "categories": sorted(cat_rows, key=lambda r: (r["strategy"], r["topic"] or "", r["band"] or "")),
        "trades": trades[:500],
    }


def update_paper(paper: dict, tracked: dict, now: int) -> dict:
    """Paper portfolio: opens momentum_buy_yes on live markets, marks to last price, settles at result."""
    positions = paper.get("positions", {})
    for tk, rec in tracked.items():
        key = f"momentum_buy_yes|{tk}"
        if rec.get("resolved") and rec.get("result") in ("yes", "no"):
            if key in positions and positions[key]["status"] == "open":
                p = positions[key]
                payout = 1.0 if rec["result"] == "yes" else 0.0
                p.update({"status": "closed", "exit": payout, "pnl": round(payout - p["entry"], 4),
                          "closed_at": iso(now)})
            continue
        rows = [r for r in (rec.get("candles") or {}).get("60", []) if r and r[4] is not None]
        if key in positions and positions[key]["status"] == "open" and rec.get("last_price") is not None:
            p = positions[key]
            p["mark"] = rec["last_price"]
            p["unrealized"] = round(rec["last_price"] - p["entry"], 4)
            continue
        if key not in positions and len(rows) >= 7 and rec.get("last_price") is not None and rec.get("status") not in ("closed", "settled", "finalized"):
            if rows[-1][4] - rows[-7][4] >= 0.10 - 1e-9:
                positions[key] = {"strategy": "momentum_buy_yes", "ticker": tk, "title": rec.get("title"),
                                  "topic": rec.get("topic"), "status": "open", "entry": rows[-1][4],
                                  "entry_time": iso(now), "mark": rec["last_price"],
                                  "unrealized": round(rec["last_price"] - rows[-1][4], 4),
                                  "source_url": rec.get("source_url")}
    paper["positions"] = positions
    return paper


def paper_summary(paper: dict) -> dict:
    pos = list(paper.get("positions", {}).values())
    op = [p for p in pos if p["status"] == "open"]
    cl = [p for p in pos if p["status"] == "closed"]
    return {
        "strategy": "momentum_buy_yes (paper, 1 contract each, fees not modelled)",
        "open_positions": len(op), "closed_positions": len(cl),
        "unrealized_pnl": round(sum(p.get("unrealized") or 0 for p in op), 4),
        "realized_pnl": round(sum(p.get("pnl") or 0 for p in cl), 4),
        "positions": sorted(pos, key=lambda p: p.get("entry_time") or "", reverse=True)[:200],
        "note": "Paper trades only. The Kalshi demo account is NOT connected (needs demo API keys; see Flagged page).",
    }


def verification_checks(tracked: dict, series: dict, series_raw: list) -> dict:
    checks = []
    flags = []

    # 1. Binary identity: yes_bid + no_ask should equal 1 (no ask = 1 - yes bid)
    ok, bad = 0, []
    for tk, r in tracked.items():
        if r.get("yes_bid") is None or r.get("no_ask") is None:
            continue
        if abs(r["yes_bid"] + r["no_ask"] - 1.0) <= 0.0001:
            ok += 1
        else:
            bad.append(tk)
            flags.append({"ticker": tk, "title": r.get("title"), "issue": "yes_bid + no_ask != 1.0000",
                          "source_url": r.get("source_url")})
    checks.append({"id": "binary_identity", "title": "yes_bid + no_ask = 1.0000 (binary market identity)",
                   "pass": ok, "fail": len(bad), "source": DOCS["orderbook_concepts"]})

    # 2. Orderbook top-of-book vs market quote
    ok, bad = 0, []
    for tk, r in tracked.items():
        ob = r.get("orderbook")
        if not ob or not ob.get("yes_bids") or r.get("yes_bid") is None:
            continue
        top = ob["yes_bids"][0]["price"]
        if top is not None and abs(top - r["yes_bid"]) <= 0.0001:
            ok += 1
        else:
            bad.append(tk)
            flags.append({"ticker": tk, "title": r.get("title"),
                          "issue": f"orderbook best YES bid {top} != market yes_bid {r['yes_bid']} (snapshot timing)",
                          "source_url": r.get("orderbook_source_url")})
    checks.append({"id": "book_vs_quote", "title": "Orderbook best YES bid equals market yes_bid",
                   "pass": ok, "fail": len(bad), "source": DOCS["orderbook"]})

    # 3. Settlement sources linking to the Kalshi homepage instead of a named source
    generic = 0
    for tk, r in tracked.items():
        for s in r.get("settlement_sources") or []:
            host = re.sub(r"^https?://", "", (s.get("url") or "")).split("/")[0].lower()
            if host in ("kalshi.com", "www.kalshi.com"):
                generic += 1
                flags.append({"ticker": tk, "title": r.get("title"),
                              "issue": f"settlement source '{s.get('name')}' links to kalshi.com (not the named source)",
                              "source_url": r.get("source_url")})
                break
    checks.append({"id": "source_links", "title": "Settlement sources link to the named publisher (not kalshi.com)",
                   "pass": None, "fail": generic, "source": DOCS["get_series"]})

    # 4. Contract PDFs hosted on a staging bucket
    staging = [s for s in series.values() if "staging" in (s.get("contract_url") or "")]
    for s in staging[:300]:
        flags.append({"ticker": s["ticker"], "title": s.get("title"),
                      "issue": "contract_url points to a 'staging' S3 bucket", "source_url": DOCS["get_series"]})
    checks.append({"id": "staging_contracts", "title": "Contract PDF URLs on production-looking hosts",
                   "pass": None, "fail": len(staging), "source": DOCS["get_series"]})

    # 5. Placeholder close dates (year >= 2099)
    far = [tk for tk, r in tracked.items() if (r.get("close_time") or "")[:4] >= "2099"]
    for tk in far[:300]:
        flags.append({"ticker": tk, "title": tracked[tk].get("title"),
                      "issue": "close_time in 2099 (placeholder-like; confirm against rules)",
                      "source_url": tracked[tk].get("source_url")})
    checks.append({"id": "far_future_close", "title": "Close dates in 2099 (placeholder-like)",
                   "pass": None, "fail": len(far), "source": DOCS["get_markets"]})

    # 6. Status values seen vs documented enum
    documented = {"unopened", "open", "closed", "settled"}
    seen = {r.get("status") for r in tracked.values() if r.get("status")}
    undoc = sorted(s for s in seen if s not in documented)
    checks.append({"id": "status_enum", "title": "Market status values match documented enum (unopened/open/closed/settled)",
                   "pass": None, "fail": len(undoc), "source": DOCS["get_markets"],
                   "detail": f"observed undocumented values: {undoc}" if undoc else "all observed values documented"})

    # 7. Series with null tags (taxonomy gap)
    nulltags = [s["ticker"] for s in series.values() if s.get("tags") is None and s.get("category") in
                ("Crypto", "Elections", "Entertainment", "Commodities", "Sports")]
    checks.append({"id": "null_tags", "title": "Series in topic categories with null tags",
                   "pass": None, "fail": len(nulltags), "source": DOCS["get_series"],
                   "examples": nulltags[:10]})

    return {"checks": checks, "flags": flags[:600], "flag_count": len(flags)}


def series_index(series: dict, base: str) -> list:
    out = []
    for tk, s in series.items():
        t = topic_for_series(s)
        if t is None:
            continue
        out.append({"ticker": tk, "topic": t, "title": s.get("title"), "category": s.get("category"),
                    "categories": s.get("categories"), "tags": s.get("tags"),
                    "frequency": s.get("frequency"), "contract_terms_url": s.get("contract_terms_url"),
                    "contract_url": s.get("contract_url"), "settlement_sources": s.get("settlement_sources"),
                    "source_url": f"{base}/series/{tk}"})
    return out
