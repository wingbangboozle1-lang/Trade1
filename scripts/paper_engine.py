#!/usr/bin/env python3
"""Kalshi demo paper-trade engine (standalone automation).

Mirrors the browser strategy engine in js/engine.js. Reads PUBLIC Kalshi demo market
data (no credentials) and runs simulated paper trades to test strategies:

  * Momentum        - buy YES after an >= $0.10 up-move when potential ROI >= 1.0x
  * MeanReversion   - buy NO after an >= $0.10 up-move
  * Value           - buy YES when YES bid <= $0.40 with liquidity

Positions are settled against the official `result` / `settlement_value_dollars` fields
when a market resolves. Nothing is sent to Kalshi; this is simulation only.

Usage:
    python3 scripts/paper_engine.py --once
    python3 scripts/paper_engine.py --loop --interval 20

Live order placement would require a demo API key + private key and signed requests
(POST /portfolio/events/orders); that is intentionally NOT implemented here.

Sources (official Kalshi docs):
  https://docs.kalshi.com/getting_started/demo_env
  https://docs.kalshi.com/getting_started/quick_start_market_data
  https://docs.kalshi.com/api-reference/market/get-markets
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

BASE_URLS = [
    "https://external-api.demo.kalshi.co/trade-api/v2",
    "https://demo-api.kalshi.co/trade-api/v2",
]

TOPICS = {
    "Gas prices": ["gas", "gasoline", "fuel", "oil price", "petrol", "diesel", "cng", "energy price"],
    "Elections": ["election", "president", "senate", "governor", "congress", "vote", "primary", "candidate", "inauguration"],
    "Culture": ["culture", "music", "movie", "film", "celebrity", "award", "oscar", "grammy", "tv", "television", "entertainment", "concert", "album", "show"],
    "Crypto": ["crypto", "bitcoin", "ethereum", "btc", "eth", "solana", "dogecoin", "ether", "blockchain", "coin"],
    "Golf": ["golf", "pga", "lpga", "masters", "ryder cup", "tournament", "fairway", "birdie"],
}

DEFAULTS = {
    "threshold": Decimal("0.10"),
    "roi_threshold": Decimal("1.5"),
    "min_liquidity": Decimal("100"),
    "max_open": 20,
    "cash": Decimal("10000"),
}


def d(value: Any) -> Decimal | None:
    """Parse a Kalshi fixed-point string to Decimal, preserving exactness."""
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


def num(value: Any) -> Decimal | None:
    n = d(value)
    return n if n is not None and n.is_finite() else None


_TERM_RES = {
    t: (re.compile(r"\b" + re.escape(t) + r"\b") if " " not in t else None)
    for terms in TOPICS.values() for t in terms
}


def _clean_ticker(t: str) -> str:
    return re.sub(r"^kx", "", str(t).lower())


def classify(market: dict) -> str | None:
    hay = " ".join(str(market.get(k, "")) for k in
                   ("title", "subtitle", "yes_sub_title", "no_sub_title")).lower()
    tick_hay = " ".join(_clean_ticker(market.get(k, "")) for k in
                        ("event_ticker", "series_ticker")).lower()
    for topic, terms in TOPICS.items():
        for t in terms:
            if _TERM_RES[t] is None:
                if t in hay:
                    return topic
            elif _TERM_RES[t].search(hay) or _TERM_RES[t].search(tick_hay):
                return topic
    return None


def series_of(market: dict) -> str:
    """Series ticker for a market.

    The Kalshi UI market page is https://kalshi.com/markets/{series_ticker}
    (lower-case) — see the official Quick Start
    (https://docs.kalshi.com/getting_started/quick_start_market_data, which links
    https://kalshi.com/markets/kxhighny). An *event* ticker in that position does
    not resolve to a market page, so links are never built from one. The
    official /markets object publishes `series_ticker`; the ticker prefix is
    used only as a fallback, which is the series for every ticker shape seen on
    the demo API.
    """
    st = market.get("series_ticker")
    if st:
        return str(st)
    return str(market.get("ticker") or market.get("event_ticker") or "").split("-")[0]


def market_url(market: dict) -> str:
    """Official Kalshi UI page for the market's series (verified pattern)."""
    s = series_of(market)
    return "https://kalshi.com/markets/" + urllib.parse.quote(s.lower()) if s else ""


def api_market_url(market: dict) -> str:
    """Exact official API record for the market (verification link)."""
    t = market.get("ticker")
    return BASE_URLS[0] + "/markets/" + urllib.parse.quote(str(t)) if t else ""


def get(base: str, path: str) -> dict:
    req = urllib.request.Request(base + path, headers={"User-Agent": "kalshi-demo-paper-engine/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def fetch_markets() -> list[dict]:
    last_err: Exception | None = None
    for base in BASE_URLS:
        try:
            data = get(base, "/markets?status=open&limit=1000")
            return [m for m in data.get("markets", []) if classify(m)]
        except (urllib.error.URLError, OSError) as exc:
            last_err = exc
            continue
    raise RuntimeError(f"unreachable: {last_err}")


def roi_score(m: dict) -> tuple[Decimal, str, Decimal, bool]:
    yes_ask = num(m.get("yes_ask_dollars"))
    no_ask = num(m.get("no_ask_dollars"))
    liq = num(m.get("yes_ask_size_fp"))
    if liq is None:
        liq = num(m.get("yes_bid_size_fp")) or Decimal("0")
    roi_yes = (Decimal(1) - yes_ask) / yes_ask if (yes_ask and 0 < yes_ask < 1) else Decimal(0)
    roi_no = (Decimal(1) - no_ask) / no_ask if (no_ask and 0 < no_ask < 1) else Decimal(0)
    if roi_yes >= roi_no:
        side, score = "YES", roi_yes
    else:
        side, score = "NO", roi_no
    high = score >= DEFAULTS["roi_threshold"] and liq >= DEFAULTS["min_liquidity"]
    return score, side, liq, high


class PaperEngine:
    def __init__(self, state_file: str):
        self.state_file = state_file
        self.state = self._load()

    def _load(self) -> dict:
        try:
            with open(self.state_file, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return {"positions": [], "history": [], "cash": str(DEFAULTS["cash"]),
                    "last_price": {}, "last_move": {}, "last_alert_at": {}}

    def _save(self) -> None:
        with open(self.state_file, "w", encoding="utf-8") as fh:
            json.dump(self.state, fh, indent=2)

    def detect_moves(self, markets: list[dict]) -> list[dict]:
        now = time.time()
        alerts: list[dict] = []
        for m in markets:
            bid = num(m.get("yes_bid_dollars"))
            t = m.get("ticker")
            if bid is None:
                continue
            prev = self.state["last_price"].get(t)
            self.state["last_price"][t] = str(bid)
            if prev is None:
                continue
            delta = bid - Decimal(prev)
            if abs(delta) >= DEFAULTS["threshold"]:
                last = self.state["last_alert_at"].get(t, 0)
                if now - last >= 60:
                    self.state["last_alert_at"][t] = now
                    self.state["last_move"][t] = {"dir": "up" if delta > 0 else "down", "delta": str(delta)}
                    alerts.append({"ticker": t, "title": m.get("title"), "topic": classify(m),
                                   "from": prev, "to": str(bid), "delta": str(delta),
                                   "url": market_url(m), "api_url": api_market_url(m)})
        return alerts

    def evaluate_trades(self, markets: list[dict]) -> list[dict]:
        opened: list[dict] = []
        if len(self.state["positions"]) >= DEFAULTS["max_open"]:
            return opened
        open_tickers = {p["ticker"] for p in self.state["positions"]}
        for m in markets:
            t = m.get("ticker")
            if t in open_tickers:
                continue
            yes_ask = num(m.get("yes_ask_dollars"))
            if yes_ask is None or yes_ask <= 0:
                continue
            score, _side, liq, _high = roi_score(m)
            bid = num(m.get("yes_bid_dollars"))
            move = self.state["last_move"].get(t)
            near_close = False
            if m.get("close_time"):
                near_close = (_parse_ts(m.get("close_time")) - time.time()) < 1800
            qty = 1
            if yes_ask * qty > Decimal(self.state["cash"]):
                continue
            strat = None
            if bid is not None and bid <= Decimal("0.40") and liq >= DEFAULTS["min_liquidity"] and not near_close:
                strat = "Value"
            elif move and abs(Decimal(move["delta"])) >= DEFAULTS["threshold"]:
                if move["dir"] == "up" and score >= Decimal("1.0"):
                    strat = "Momentum"
                elif move["dir"] == "up":
                    no_ask = num(m.get("no_ask_dollars"))
                    if no_ask is not None and no_ask < Decimal("0.9"):
                        strat = "MeanReversion"
            if strat:
                self.state["positions"].append({
                    "ticker": t, "title": m.get("title"), "topic": classify(m), "side": "YES",
                    "qty": qty, "cost": str(yes_ask), "strategy": strat,
                    "opened_at": datetime.now(timezone.utc).isoformat()})
                self.state["cash"] = str(Decimal(self.state["cash"]) - yes_ask * qty)
                open_tickers.add(t)
                opened.append({"ticker": t, "strategy": strat, "cost": str(yes_ask)})
        self._save()
        return opened

    def settle(self, markets: list[dict]) -> list[dict]:
        by = {m.get("ticker"): m for m in markets}
        settled: list[dict] = []
        keep = []
        for p in self.state["positions"]:
            m = by.get(p["ticker"])
            resolved, result, sval = False, "", None
            if m and (m.get("status") == "settled" or m.get("result") in ("yes", "no")):
                resolved, result = True, m.get("result")
                sval = num(m.get("settlement_value_dollars"))
                if sval is None:
                    sval = Decimal(1) if result == "yes" else Decimal(0)
            if resolved:
                payout = (sval if p["side"] == "YES" else Decimal(1) - sval) * Decimal(p["qty"])
                cost = Decimal(p["cost"]) * Decimal(p["qty"])
                pnl = payout - cost
                self.state["cash"] = str(Decimal(self.state["cash"]) + payout)
                settled.append({"ticker": p["ticker"], "strategy": p["strategy"], "result": result,
                                "payout": str(payout), "pnl": str(pnl), "win": pnl > 0})
            else:
                keep.append(p)
        if len(keep) != len(self.state["positions"]):
            self.state["positions"] = keep
            self.state["history"] = self.state["history"] + settled
            self._save()
        return settled

    def step(self) -> dict:
        markets = fetch_markets()
        alerts = self.detect_moves(markets)
        opened = self.evaluate_trades(markets)
        settled = self.settle(markets)
        return {"markets": len(markets), "alerts": alerts, "opened": opened, "settled": settled}


def _parse_ts(ts: str) -> float:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return 0.0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Kalshi demo paper-trade engine")
    ap.add_argument("--once", action="store_true", help="run a single pass and exit")
    ap.add_argument("--loop", action="store_true", help="run continuously")
    ap.add_argument("--interval", type=int, default=20, help="seconds between passes (loop mode)")
    ap.add_argument("--state", default="paper_engine_state.json", help="state file path")
    args = ap.parse_args(argv)

    engine = PaperEngine(args.state)
    try:
        while True:
            try:
                result = engine.step()
                print(json.dumps(result, indent=2))
            except Exception as exc:  # network/CORS errors are surfaced, not hidden
                print(f"[{datetime.now(timezone.utc).isoformat()}] poll failed: {exc}", file=sys.stderr)
            if args.once or not args.loop:
                return 0
            time.sleep(args.interval)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
