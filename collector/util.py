"""Shared helpers: JSON IO, timestamps, money formatting, source register."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CONFIG = os.path.join(ROOT, "config")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or utcnow()).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def now_ts() -> int:
    return int(utcnow().timestamp())


def parse_ts(value) -> int | None:
    """Parse Kalshi ISO timestamps ('2026-11-20T12:59:52.250914Z') to unix seconds."""
    if not value:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    try:
        text = str(value).replace("Z", "+00:00")
        # Trim to microseconds; python handles up to 6 digits.
        if "." in text:
            head, rest = text.split(".", 1)
            frac = "".join(ch for ch in rest if ch.isdigit())
            tz = rest[len(frac):]
            text = f"{head}.{frac[:6]}{tz}"
        return int(datetime.fromisoformat(text).timestamp())
    except (ValueError, TypeError):
        return None


def read_json(path, default=None):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, obj, indent: int = 1):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=indent, sort_keys=False)
        f.write("\n")
    os.replace(tmp, path)


def fnum(value, default=None):
    """Fixed-point strings ("0.4500", "100.00") to float. None/"" -> default, never guessed."""
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def cents(dollars: float | None) -> int | None:
    if dollars is None:
        return None
    return int(round(dollars * 100))


# --------------------------------------------------------------------------- sources
# Single register of every external reference the site cites. `docs/` pages and the
# Flagged for Review page render from this so a link can never drift from its claim.
SOURCES = {
    "demo_env": {
        "url": "https://docs.kalshi.com/getting_started/demo_env",
        "title": "Kalshi docs — Test In The Demo Environment",
        "claim": "Demo environment exists with mock funds; recommended demo REST root is "
                 "https://external-api.demo.kalshi.co/trade-api/v2 and demo WebSocket is "
                 "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2.",
    },
    "api_env": {
        "url": "https://docs.kalshi.com/getting_started/api_environments",
        "title": "Kalshi docs — API Environments and Endpoints",
        "claim": "Full production and demo REST/WebSocket endpoint list.",
    },
    "terms": {
        "url": "https://docs.kalshi.com/getting_started/terms",
        "title": "Kalshi docs — Glossary (series / event / market, category, tags)",
        "claim": "A series has exactly one primary `category` and a `categories` list; `tags` are "
                 "subcategories; an event is the basic unit members interact with.",
    },
    "tags_by_categories": {
        "url": "https://docs.kalshi.com/api-reference/search/get-tags-for-series-categories",
        "title": "Kalshi API — Get Tags for Series Categories",
        "claim": "Authoritative category-to-tag map used to build topic membership.",
    },
    "get_markets": {
        "url": "https://docs.kalshi.com/api-reference/market/get-markets",
        "title": "Kalshi API — Get Markets",
        "claim": "Filtering, cursor paging, and the documented caveat that responses are cached and "
                 "can lag the exchange by several seconds.",
    },
    "get_events": {
        "url": "https://docs.kalshi.com/api-reference/events/get-events",
        "title": "Kalshi API — Get Events",
        "claim": "Events expose event_ticker, series_ticker, title, category and status; supports "
                 "status filter and min_close_ts.",
    },
    "get_series": {
        "url": "https://docs.kalshi.com/api-reference/market/get-series-list",
        "title": "Kalshi API — Get Series List",
        "claim": "Series list with category filter; returns category, categories, tags and settlement_sources.",
    },
    "orderbook": {
        "url": "https://docs.kalshi.com/api-reference/market/get-market-orderbook",
        "title": "Kalshi API — Get Market Orderbook",
        "claim": "Returns yes and no bids only (no asks); levels are [price, quantity] ascending so "
                 "the best bid is last; a YES bid at X equals a NO ask at 1-X.",
    },
    "trades": {
        "url": "https://docs.kalshi.com/api-reference/market/get-trades",
        "title": "Kalshi API — Get Trades",
        "claim": "Path is /markets/trades; each trade carries count_fp, yes_price_dollars, "
                 "no_price_dollars and created_time.",
    },
    "candlesticks": {
        "url": "https://docs.kalshi.com/api-reference/market/get-market-candlesticks",
        "title": "Kalshi API — Get Market Candlesticks",
        "claim": "period_interval accepts 1, 60 or 1440 minutes; at most 5,000 periods per request; "
                 "the newest candles can trail live quotes by a few seconds.",
    },
    "rate_limits": {
        "url": "https://docs.kalshi.com/getting_started/rate_limits",
        "title": "Kalshi docs — Rate Limits and Tiers",
        "claim": "Token-bucket limits; unauthenticated public requests have separate limits and "
                 "clients should back off on HTTP 429.",
    },
    "auth": {
        "url": "https://docs.kalshi.com/getting_started/quick_start_authenticated_requests",
        "title": "Kalshi docs — Quick Start: Authenticated Requests",
        "claim": "Signed requests use KALSHI-ACCESS-KEY / -TIMESTAMP / -SIGNATURE over "
                 "timestamp+METHOD+path, RSA-PSS SHA-256 for RSA keys or Ed25519.",
    },
    "websockets": {
        "url": "https://docs.kalshi.com/getting_started/quick_start_websockets",
        "title": "Kalshi docs — Quick Start: WebSockets",
        "claim": "WebSocket connections require authentication during the handshake, even for public "
                 "market-data channels such as `ticker`.",
    },
    "settlement": {
        "url": "https://docs.kalshi.com/getting_started/market_settlement",
        "title": "Kalshi docs — Market Settlement",
        "claim": "YES outcome pays YES holders $1 per contract, NO outcome pays NO holders $1; "
                 "settlement fees are zero for simple yes/no determinations.",
    },
    "fee_schedule": {
        "url": "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
        "title": "Kalshi — Fee Schedule (effective July 7, 2026)",
        "claim": "Taker fee = round_up(M x 0.07 x C x P x (1-P)); maker fee = round_up(M x 0.0175 x C x "
                 "P x (1-P)) with M defaulting to 0; no settlement fee; per-series multipliers table.",
    },
    "market_lifecycle": {
        "url": "https://docs.kalshi.com/getting_started/market_lifecycle",
        "title": "Kalshi docs — Market Lifecycle",
        "claim": "Markets move through unopened, open, closed and settled states.",
    },
}


def source(key: str) -> dict:
    return {"key": key, **SOURCES[key]}


def sources_for(keys) -> list:
    return [source(k) for k in keys if k in SOURCES]
