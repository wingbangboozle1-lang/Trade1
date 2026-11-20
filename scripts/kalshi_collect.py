#!/usr/bin/env python3
"""Collect Kalshi DEMO market data for the dashboard (official REST API only).

Standard library only. Writes a static site into ./_site (copied from ./docs)
plus JSON files under _site/data/. Prior state is loaded from the previously
deployed site (STATE_URL) so resolutions, paper positions and candle history
accumulate across scheduled runs without committing data to git.

Every record keeps `source_url` = the exact official API URL it was read from.
Values the API did not return are written as null (never inferred).
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyze  # noqa: E402

BASE = os.environ.get("KALSHI_BASE", "https://external-api.demo.kalshi.co/trade-api/v2")
ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
OUT = ROOT / "_site"
REPO = os.environ.get("GITHUB_REPOSITORY", "wingbangboozle1-lang/Trade1")
OWNER, _, NAME = REPO.partition("/")
STATE_URL = os.environ.get("STATE_URL", f"https://{OWNER}.github.io/{NAME}/data/state.json")
UA = "Trade1-dashboard/1.0 (+https://github.com/wingbangboozle1-lang/Trade1)"

TOP_PER_TOPIC = 8          # markets per topic that get orderbook + candlestick pulls
MAX_RESOLUTION_CHECKS = 150
ERRORS: list[str] = []
CALLS = {"n": 0}


def now_ts() -> int:
    return int(time.time())


def api_get(path: str, params: dict | None = None, retries: int = 4):
    qs = ("?" + urllib.parse.urlencode(params, doseq=True)) if params else ""
    url = BASE + path + qs
    delay = 1.0
    for attempt in range(retries):
        try:
            CALLS["n"] += 1
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            ERRORS.append(f"HTTP {e.code} {url}")
            return None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            ERRORS.append(f"{type(e).__name__} {url}: {e}")
            return None
    return None


def paginate(path: str, key: str, params: dict):
    out, cursor = [], None
    for _ in range(200):  # hard stop
        p = dict(params)
        if cursor:
            p["cursor"] = cursor
        data = api_get(path, p)
        if not data:
            break
        out.extend(data.get(key, []) or [])
        cursor = data.get("cursor")
        if not cursor:
            break
    return out


def load_state() -> dict:
    try:
        with urllib.request.urlopen(urllib.request.Request(STATE_URL, headers={"User-Agent": UA}), timeout=20) as r:
            st = json.loads(r.read().decode("utf-8"))
            print(f"[state] loaded previous state from {STATE_URL}")
            return st
    except Exception as e:  # first run or offline
        print(f"[state] no previous state ({type(e).__name__}); starting fresh")
        return {"tracked": {}, "paper": {}, "resolved": {}}


def f(v):
    """Dollar/fp string -> float or None (never invents a value)."""
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main() -> int:
    t0 = time.time()
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    state = load_state()
    tracked: dict = state.get("tracked", {})
    paper: dict = state.get("paper", {})
    resolved: dict = state.get("resolved", {})

    # 1. Series metadata (category, tags, settlement sources, contract terms)
    series_raw = (api_get("/series") or {}).get("series", []) or []
    series = {s["ticker"]: s for s in series_raw if s.get("ticker")}
    print(f"[series] {len(series)} series returned")

    series_topic = {t: analyze.topic_for_series(s) for t, s in series.items()}

    # 2. Open events with nested markets (multivariate/combo events are excluded by this endpoint)
    events = paginate("/events", "events", {"status": "open", "with_nested_markets": "true", "limit": 200})
    print(f"[events] {len(events)} open events")

    open_markets: dict[str, dict] = {}
    statuses_seen: dict[str, int] = {}
    unmapped_series = set()
    for ev in events:
        st = ev.get("series_ticker")
        topic = series_topic.get(st)
        if st not in series:
            unmapped_series.add(st)
        for m in ev.get("markets", []) or []:
            statuses_seen[m.get("status") or "null"] = statuses_seen.get(m.get("status") or "null", 0) + 1
            if topic is None:
                continue
            open_markets[m["ticker"]] = analyze.market_record(m, ev, series[st], topic, BASE, now_ts())

    print(f"[markets] {len(open_markets)} markets in tracked topics; statuses seen: {statuses_seen}")

    # 3. Upsert tracked markets; keep candle history for ones we pull
    for tk, rec in open_markets.items():
        prev = tracked.get(tk, {})
        rec["first_seen"] = prev.get("first_seen", gen)
        rec["candles"] = prev.get("candles", {})
        rec["resolved"] = False
        tracked[tk] = {**prev, **rec}

    # 4. Resolution check for tracked markets no longer open
    checks = 0
    pending = [tk for tk, rec in tracked.items() if tk not in open_markets and not rec.get("resolved")]
    pending.sort(key=lambda tk: tracked[tk].get("checked_at") or "")  # oldest check first
    for tk in pending[:MAX_RESOLUTION_CHECKS]:
        rec = tracked[tk]
        checks += 1
        rec["checked_at"] = gen
        data = api_get(f"/markets/{urllib.parse.quote(tk)}")
        m = (data or {}).get("market", data) if data else None
        if not m:
            continue
        rec.update({
            "status": m.get("status"),
            "result": m.get("result") or None,
            "last_price": f(m.get("last_price_dollars")),
            "settlement_value": f(m.get("settlement_value_dollars")),
            "settlement_ts": m.get("settlement_ts"),
            "source_url": f"{BASE}/markets/{tk}",
        })
        if rec.get("result") in ("yes", "no"):
            rec["resolved"] = True
            resolved[tk] = {k: rec.get(k) for k in (
                "ticker", "title", "topic", "series_ticker", "event_ticker", "result", "status",
                "settlement_value", "settlement_ts", "close_time", "source_url", "settlement_sources")}
    print(f"[resolution] checked {checks}; resolved total {len(resolved)}")

    # 5. Liquidity and candles for the top markets per topic (by official volume_fp)
    by_topic: dict[str, list] = {}
    for tk, rec in open_markets.items():
        by_topic.setdefault(rec["topic"], []).append(rec)
    focus = []
    for topic, recs in by_topic.items():
        recs.sort(key=lambda r: (r.get("volume_fp") or 0), reverse=True)
        focus.extend(recs[:TOP_PER_TOPIC])

    now = now_ts()
    windows = {
        1: (now - 6 * 3600, 1),          # 1-minute candles, last 6 hours
        60: (now - 7 * 86400, 60),       # 1-hour candles, last 7 days
        1440: (now - 90 * 86400, 1440),  # 1-day candles, last 90 days
    }
    for rec in focus:
        tk = rec["ticker"]
        ob = api_get(f"/markets/{urllib.parse.quote(tk)}/orderbook", {"depth": 20})
        rec["orderbook"] = analyze.orderbook_levels(ob) if ob else None
        rec["orderbook_source_url"] = f"{BASE}/markets/{tk}/orderbook?depth=20"
        candles = tracked[tk].setdefault("candles", {})
        for period, (start, _) in windows.items():
            cd = api_get(
                f"/series/{urllib.parse.quote(rec['series_ticker'])}/markets/{urllib.parse.quote(tk)}/candlesticks",
                {"start_ts": start, "end_ts": now, "period_interval": period},
            )
            if cd is not None:
                candles[str(period)] = analyze.candle_rows(cd.get("candlesticks", []) or [])
                candles[str(period) + "_source_url"] = (
                    f"{BASE}/series/{rec['series_ticker']}/markets/{tk}/candlesticks"
                    f"?period_interval={period}")
    print(f"[liquidity+candles] {len(focus)} focus markets, api calls so far: {CALLS['n']}")

    # Copy focus data back into the tracked record for the site
    for rec in focus:
        tracked[rec["ticker"]]["orderbook"] = rec.get("orderbook")
        tracked[rec["ticker"]]["orderbook_source_url"] = rec.get("orderbook_source_url")

    # 6. Analysis: jumps, categories, strategies, paper portfolio
    jumps = analyze.find_jumps(tracked, threshold=0.10)
    strategies = analyze.backtest(tracked, resolved)
    paper = analyze.update_paper(paper, tracked, now)
    checks_out = analyze.verification_checks(tracked, series, series_raw)

    # Keep state small: full candles only for markets open this run; resolved and closed-awaiting keep 1-hour only
    for tk, rec in tracked.items():
        if tk in open_markets:
            continue
        c = rec.get("candles") or {}
        rec["candles"] = {k: v for k, v in c.items() if k in ("60", "60_source_url")}
    state_out = {"generated_at": gen, "tracked": tracked, "paper": paper, "resolved": resolved}

    # 7. Write site + data
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(DOCS, OUT)
    data_dir = OUT / "data"
    (data_dir / "candles").mkdir(parents=True, exist_ok=True)

    # Candles to separate files (loaded on demand by the chart)
    for tk, rec in tracked.items():
        if rec.get("candles") and any(k in rec["candles"] for k in ("1", "60", "1440")):
            (data_dir / "candles" / f"{tk}.json").write_text(json.dumps(rec["candles"], separators=(",", ":")))

    markets_out = []
    for tk, rec in sorted(tracked.items(), key=lambda kv: -(kv[1].get("volume_fp") or 0)):
        row = {k: rec.get(k) for k in analyze.PUBLIC_FIELDS}
        row["has_candles"] = bool(rec.get("candles"))
        row["orderbook"] = rec.get("orderbook")
        row["orderbook_source_url"] = rec.get("orderbook_source_url")
        markets_out.append(row)

    data = {
        "generated_at": gen,
        "api_base": BASE,
        "environment": "demo",
        "topics": analyze.TOPIC_LABELS,
        "series_count": len(series),
        "open_event_count": len(events),
        "markets": markets_out,
        "resolved": sorted(resolved.values(), key=lambda r: r.get("settlement_ts") or "", reverse=True),
        "jumps": jumps,
        "strategies": strategies,
        "paper": analyze.paper_summary(paper),
        "verification": checks_out,
        "statuses_seen": statuses_seen,
        "unmapped_series": sorted(s for s in unmapped_series if s),
        "errors": ERRORS[:200],
        "api_calls": CALLS["n"],
        "runtime_seconds": round(time.time() - t0, 1),
        "series_sources": analyze.series_index(series, BASE),
    }
    (data_dir / "data.json").write_text(json.dumps(data, separators=(",", ":"), default=str))
    (data_dir / "state.json").write_text(json.dumps(state_out, separators=(",", ":"), default=str))
    print(f"[done] wrote {OUT} in {data['runtime_seconds']}s; markets={len(markets_out)} "
          f"jumps={len(jumps)} resolved={len(resolved)} errors={len(ERRORS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
