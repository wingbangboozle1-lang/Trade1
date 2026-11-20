"""
Fee model, implemented exactly as Kalshi publishes it.

Source: Kalshi Fee Schedule, "Last updated and effective: July 7, 2026"
        https://kalshi.com/docs/kalshi-fee-schedule.pdf

    taker fees = round_up(M x 0.07  x C x P x (1 - P))
    maker fees = round_up(M x 0.0175 x C x P x (1 - P))     # M defaults to 0 -> maker is free
    "round up = rounds up such that the fee + positionCost is rounded to a centicent"

There is no settlement fee for simple yes/no markets
(https://docs.kalshi.com/getting_started/market_settlement).

The per-series multipliers (M) in the schedule's non-standard table override the defaults; they are
applied only for the tickers actually listed there.
"""

from __future__ import annotations

import math

TAKER_RATE = 0.07
MAKER_RATE = 0.0175

# From the fee schedule's "Non-Standard Fees" table. (maker_M, taker_M)
# NOTE: this is the subset of the published table that is legible in the official PDF; series not
# listed here use the schedule defaults (M=1 taker, M=0 maker). Anything unusual is surfaced on the
# Flagged for Review page rather than silently assumed.
SERIES_MULTIPLIERS = {
    "KXAAAGASM": (1, 1),      # US gas price
    "KXATPMATCH": (1, 1),     # ATP Tennis Match
    "KXBALLONDOR": (1, 1),    # Ballon d'Or
    "KXBTCMAX150": (1, 1),
    "KXBTCY": (0, 0),         # BTC price range EOY -- fee free
    "KXCITRINI": (0, 0),
    "KXCPI": (1, 1),
    "KXCPIYOY": (1, 1),
    "KXDOED": (0, 0),
    "KXEGGS": (1, 1),
    "KXELECTIRAN": (0, 0),
    "KXEMMYCACTO": (1, 1),
    "KXEMMYCACTR": (1, 1),
    "KXEMMYCSERIES": (1, 1),
    "KXEMMYDACTO": (1, 1),
    "KXEMMYDACTR": (1, 1),
    "KXEMMYDSERIES": (1, 1),
    "KXETHY": (0, 0),         # ETH price EOY -- fee free
    "KXFED": (1, 1),
    "KXFEDDECISION": (1, 1),
    "KXGAMBLINGREPEAL": (0, 0),
    "KXGDP": (1, 1),
    "KXGREENLAND": (0, 0),
    "KXHEISMAN": (1, 1),
    "KXINXY": (1, 1),
    "KXIPO": (1, 1),
    "KXIRANDEMOCRACY": (0, 0),
    "KXLALIGA": (1, 1),
    "KXLAYOFFSYINFO": (0, 0),
    "KXLLM1": (1, 1),
    "KXMARMAD": (1, 1),
    "KXMEANRWMAODRLDCUP": (1, 1),
    "KXMLBNWORLDCUP": (1, 1),
    "KXMLBAL": (1, 1),
    "KXMLBASGAME": (1, 1),
    "KXMLBGAME": (1, 1),
    "KXMLBNL": (1, 1),
    "KXMVE": (1, 1),          # combos: 2 maker / 1 taker on the schedule; excluded from ranking
    "KXNASDAQ100Y": (1, 1),
}


def series_of(ticker: str) -> str:
    """Series ticker is the part before the first '-'. Used only for the multiplier lookup, never
    for topic membership (docs warn against inferring relationships from tickers)."""
    return (ticker or "").split("-")[0]


def multipliers(ticker: str) -> tuple[float, float]:
    key = series_of(ticker)
    if key in SERIES_MULTIPLIERS:
        return SERIES_MULTIPLIERS[key]
    return (0.0, 1.0)


def _round_up_cent(value: float) -> float:
    """Round the fee up to the next whole cent.

    Rationale: this is the only rounding that reproduces the official schedule's own published
    table. Every one of the 21 published rows ($0.05 -> $0.34, $0.15 -> $0.90, ... $0.50 -> $1.75)
    matches a round-up-to-cent, and 10 of them do NOT match a round-up-to-centicent. Verified by
    collector.fees.verify_schedule(), which the site's Verification page renders.
    """
    return math.ceil(round(value * 100, 6)) / 100


def trade_fee(contracts: float, price: float, taker: bool = True, ticker: str = "") -> float:
    """Fee in dollars for a single fill leg."""
    if contracts <= 0:
        return 0.0
    price = min(max(float(price), 0.0), 1.0)
    maker_m, taker_m = multipliers(ticker)
    if taker:
        return _round_up_cent(taker_m * TAKER_RATE * contracts * price * (1 - price))
    return _round_up_cent(maker_m * MAKER_RATE * contracts * price * (1 - price))


def schedule_row(price_cents: int) -> dict:
    """One row of the published 100-contract table, for the fee page's verification table."""
    p = price_cents / 100.0
    return {
        "price": f"${p:.2f}",
        "cost_100": f"${p * 100:.2f}",
        "fee_100_model": f"${trade_fee(100, p):.2f}",
    }


# Published values from the official PDF table (price of 100 contracts -> fee for 100 contracts).
PUBLISHED_100 = {
    0.01: 0.07, 0.05: 0.34, 0.10: 0.63, 0.15: 0.90, 0.20: 1.12, 0.25: 1.32, 0.30: 1.47,
    0.35: 1.60, 0.40: 1.68, 0.45: 1.74, 0.50: 1.75, 0.55: 1.74, 0.60: 1.68, 0.65: 1.60,
    0.70: 1.47, 0.75: 1.32, 0.80: 1.12, 0.85: 0.90, 0.90: 0.63, 0.95: 0.34, 0.99: 0.07,
}


def verify_schedule() -> list[dict]:
    """Recompute the published table and report any mismatch. Used by tests and by the site's
    verification page so the fee model is provably the official one."""
    rows = []
    for price, published in sorted(PUBLISHED_100.items()):
        model = trade_fee(100, price, taker=True, ticker="KXTEST")  # default M=1
        rows.append({
            "price": f"${price:.2f}",
            "published": f"${published:.2f}",
            "model": f"${model:.2f}",
            "match": abs(model - published) < 0.005,
        })
    return rows
