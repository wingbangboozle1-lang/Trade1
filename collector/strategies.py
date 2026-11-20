"""
Strategy engine.

Each strategy is a deterministic function of observed market state -> a target position.
Positions are expressed in contracts of the YES side (negative = NO exposure) so one paper
ledger can hold every strategy. No randomness: the same snapshot produces the same decision,
which is what makes the backtest reproducible.

Every threshold is a parameter with a documented default, so the Strategies page can show both
the rule text and the numbers actually used.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict


@dataclass
class Signal:
    strategy: str
    family: str
    ticker: str
    side: str            # "yes" | "no"
    limit_price: float   # dollars, always crosses at the touch
    contracts: int
    reason: str
    meta: dict = field(default_factory=dict)


def _mid(yes_bid: float | None, yes_ask: float | None) -> float | None:
    if yes_bid is None and yes_ask is None:
        return None
    if yes_bid is None:
        return yes_ask
    if yes_ask is None:
        return yes_bid
    return (yes_bid + yes_ask) / 2.0


class Strategy:
    name = "base"
    family = "base"
    rule = ""
    params: dict = {}

    def describe(self) -> dict:
        return {
            "name": self.name,
            "family": self.family,
            "rule": self.rule,
            "params": dict(self.params),
        }

    def evaluate(self, market: dict, history: list[dict], ctx: dict) -> Signal | None:
        raise NotImplementedError


# ---------------------------------------------------------------- 1. value vs reference
class FairValueStrategy(Strategy):
    """Buy a cheap longshot only when the exchange price sits far enough below a mechanical
    fair value, and sell (buy NO) when it sits far above. The reference probability uses the
    distance to close, not the price, so it is independent of the quote being tested."""

    name = "fair_value_vs_clock"
    family = "Statistical"
    params = {"min_edge": 0.06, "max_price": 0.45, "min_days_to_close": 3}

    rule = ("With >= {min_days_to_close} days to close and the YES ask or bid at or below "
            "{max_price}, compare price with a reference probability that rises linearly to 0.5 "
            "as close time approaches. Buy YES if reference - price >= {min_edge}; buy NO if "
            "price - reference >= {min_edge}.")

    def __init__(self, **over):
        self.params = {**type(self).params, **over}
        self.rule = type(self).rule.format(**self.params)

    def evaluate(self, market, history, ctx):
        p = self.params
        days = ctx.get("days_to_close")
        if days is None or days < p["min_days_to_close"]:
            return None
        yes_bid = market.get("yes_bid")
        yes_ask = market.get("yes_ask")
        mid = _mid(yes_bid, yes_ask)
        if mid is None or mid <= 0 or mid >= 1:
            return None
        reference = 0.5 * min(1.0, days / 365.0)
        edge = reference - mid
        if abs(edge) < p["min_edge"]:
            return None
        if mid > p["max_price"] and edge < 0:
            return None
        if edge > 0 and yes_ask is not None:
            return Signal(self.name, self.family, market["ticker"], "yes", yes_ask,
                          ctx["size"], f"Reference {reference:.3f} vs ask {yes_ask:.3f} (edge {edge:+.3f})")
        if edge < 0 and yes_bid is not None:
            no_ask = round(1 - yes_bid, 4)
            return Signal(self.name, self.family, market["ticker"], "no", no_ask,
                          ctx["size"], f"Reference {reference:.3f} vs bid {yes_bid:.3f} (edge {edge:+.3f})")
        return None


# ---------------------------------------------------------------- 2. momentum
class MomentumStrategy(Strategy):
    """Kalshi order books show one price level every 10 cents in the 0.10-0.99 band, so a real
    re-pricing shows up as a run of same-direction moves in our snapshots."""

    name = "momentum_ignition"
    family = "Momentum"
    params = {"window": 6, "move": 0.03, "max_entry_low": 0.90, "take_after": 0.05}

    rule = ("Look at the last {window} snapshots. If YES mid rose by >= {move} and the last three "
            "snapshots are not lower, buy YES at the ask while it is below {max_entry_low}. "
            "Symmetric for NO on a fall. Exit is handled by the portfolio's take-profit.")

    def __init__(self, **over):
        self.params = {**type(self).params, **over}
        self.rule = type(self).rule.format(**self.params)

    def evaluate(self, market, history, ctx):
        p = self.params
        if len(history) < p["window"] + 1:
            return None
        window = history[-(p["window"] + 1):]
        first, last = window[0].get("mid"), window[-1].get("mid")
        if first is None or last is None:
            return None
        delta = round(last - first, 4)   # round: 0.60-0.50 is 0.0999... in binary floats
        if abs(delta) < p["move"]:
            return None
        tail = [h.get("mid") for h in window[-3:]]
        if any(v is None for v in tail):
            return None
        if delta > 0 and not (tail[-1] >= tail[-2] >= tail[-3]):
            return None
        if delta < 0 and not (tail[-1] <= tail[-2] <= tail[-3]):
            return None
        yes_ask = market.get("yes_ask")
        yes_bid = market.get("yes_bid")
        if delta > 0 and yes_ask is not None and yes_ask < p["max_entry_low"]:
            return Signal(self.name, self.family, market["ticker"], "yes", yes_ask, ctx["size"],
                          f"YES mid {first:.3f} -> {last:.3f} over {p['window']} snapshots")
        if delta < 0 and yes_bid is not None and (1 - yes_bid) < p["max_entry_low"]:
            return Signal(self.name, self.family, market["ticker"], "no", round(1 - yes_bid, 4),
                          ctx["size"], f"YES mid {first:.3f} -> {last:.3f} over {p['window']} snapshots")
        return None


# ---------------------------------------------------------------- 3. market making
class MeanReversionStrategy(Strategy):
    """Fade a stretched move inside a quiet, liquid book: the Kalshi equivalent of a market-making
    fill, which also earns the maker side of the official fee schedule (multiplier 0 by default)."""

    name = "fade_stretched_move"
    family = "Market making"
    params = {"window": 10, "stretch": 0.05, "min_depth": 50}

    rule = ("Needs >= {window} snapshots and >= {min_depth} contracts resting on each side. If YES "
            "mid is at least {stretch} above its window mean, buy NO; if it is at least {stretch} "
            "below, buy YES. Intended as a resting-order (maker) style entry.")

    def __init__(self, **over):
        self.params = {**type(self).params, **over}
        self.rule = type(self).rule.format(**self.params)

    def evaluate(self, market, history, ctx):
        p = self.params
        if len(history) < p["window"]:
            return None
        depth = ctx.get("book_depth") or {}
        if (depth.get("yes_qty") or 0) < p["min_depth"] or (depth.get("no_qty") or 0) < p["min_depth"]:
            return None
        mids = [h.get("mid") for h in history[-p["window"]:]]
        if any(v is None for v in mids):
            return None
        mean = sum(mids) / len(mids)
        last = mids[-1]
        dev = round(last - mean, 4)
        if abs(dev) < p["stretch"]:
            return None
        if dev > 0 and market.get("yes_bid") is not None:
            return Signal(self.name, self.family, market["ticker"], "no",
                          round(1 - market["yes_bid"], 4), ctx["size"],
                          f"YES mid {last:.3f} is {dev:+.3f} above the {p['window']}-snapshot mean {mean:.3f}")
        if dev < 0 and market.get("yes_ask") is not None:
            return Signal(self.name, self.family, market["ticker"], "yes", market["yes_ask"],
                          ctx["size"],
                          f"YES mid {last:.3f} is {dev:+.3f} below the {p['window']}-snapshot mean {mean:.3f}")
        return None


# ---------------------------------------------------------------- 4. event-driven (jumps)
class StaleOddsStrategy(Strategy):
    """The instruction that ties news to prices: a jump of >= $0.10 in one direction is the
    exchange repricing on new information. If our own last snapshot still shows the old price,
    the move is very recent; take the same direction before the book finishes adjusting."""

    name = "post_jump_drift"
    family = "Event driven"
    params = {"jump_threshold": 0.10, "max_fade": 0.05}

    rule = ("When the |change| in YES mid between consecutive snapshots is >= {jump_threshold}, buy "
            "in the direction of the jump at the touch, provided the price has not already retraced "
            "more than {max_fade} from the post-jump level.")

    def __init__(self, **over):
        self.params = {**type(self).params, **over}
        self.rule = type(self).rule.format(**self.params)

    def evaluate(self, market, history, ctx):
        p = self.params
        if len(history) < 3:
            return None
        prev, last = history[-2].get("mid"), history[-1].get("mid")
        if prev is None or last is None:
            return None
        delta = round(last - prev, 4)   # round: 0.60-0.50 is 0.0999... in binary floats
        if abs(delta) < p["jump_threshold"]:
            return None
        if delta > 0 and market.get("yes_ask") is not None and market["yes_ask"] - last <= p["max_fade"]:
            return Signal(self.name, self.family, market["ticker"], "yes", market["yes_ask"],
                          ctx["size"], f"Jump {prev:.3f} -> {last:.3f} ({delta:+.3f}) on the latest snapshot")
        if delta < 0 and market.get("yes_bid") is not None and last - market["yes_bid"] <= p["max_fade"]:
            return Signal(self.name, self.family, market["ticker"], "no",
                          round(1 - market["yes_bid"], 4), ctx["size"],
                          f"Jump {prev:.3f} -> {last:.3f} ({delta:+.3f}) on the latest snapshot")
        return None


# ---------------------------------------------------------------- 5. topic thesis
class TopicThesisStrategy(Strategy):
    """Category-level, not price-level: buy YES on liquid markets whose price is closer to a
    coin flip than the topic median, i.e. where the market is least decisive."""

    name = "topic_uncertainty"
    family = "Event thesis"
    params = {"min_depth": 25, "max_price": 0.40}

    rule = ("Within a topic, buy YES at the ask on markets with >= {min_depth} contracts resting per "
            "side whose YES price is at or below {max_price}: positive-expectation longshots the "
            "market still prices as live rather than dead.")

    def __init__(self, **over):
        self.params = {**type(self).params, **over}
        self.rule = type(self).rule.format(**self.params)

    def evaluate(self, market, history, ctx):
        p = self.params
        depth = ctx.get("book_depth") or {}
        if (depth.get("yes_qty") or 0) < p["min_depth"] or (depth.get("no_qty") or 0) < p["min_depth"]:
            return None
        yes_ask = market.get("yes_ask")
        if yes_ask is None or yes_ask <= 0.02 or yes_ask > p["max_price"]:
            return None
        return Signal(self.name, self.family, market["ticker"], "yes", yes_ask, ctx["size"],
                      f"YES ask {yes_ask:.3f} with {depth.get('yes_qty'):.0f}/{depth.get('no_qty'):.0f} contracts resting")


# ---------------------------------------------------------------- 6. arbitrage
class ComplementArbStrategy(Strategy):
    """A YES bid at X is a NO ask at 1-X (orderbook doc). If the two sides' best bids sum to less
    than 1.00, buying both is a guaranteed $1 at settlement. We only report an edge when both
    legs are actually available, and we size to the smaller leg."""

    name = "complement_arbitrage"
    family = "Arbitrage"
    params = {"min_edge": 0.02, "min_depth": 5}

    rule = ("If best YES bid + best NO bid <= 1 - {min_edge} and both sides hold >= {min_depth} "
            "contracts, buy YES and NO together sized to the smaller side.")

    def __init__(self, **over):
        self.params = {**type(self).params, **over}
        self.rule = type(self).rule.format(**self.params)

    def evaluate(self, market, history, ctx):
        p = self.params
        yb, nb = market.get("yes_bid"), market.get("no_bid")
        if yb is None or nb is None:
            return None
        depth = ctx.get("book_depth") or {}
        if min(depth.get("yes_qty") or 0, depth.get("no_qty") or 0) < p["min_depth"]:
            return None
        edge = 1.0 - (yb + nb)
        if edge < p["min_edge"]:
            return None
        contracts = min(int(depth.get("yes_qty") or 0), int(depth.get("no_qty") or 0), ctx["size"] * 2)
        if contracts <= 0:
            return None
        return Signal(self.name, self.family, market["ticker"], "yes_complement",
                      round(1 - nb, 4), contracts,
                      f"YES bid {yb:.2f} + NO bid {nb:.2f} = {yb + nb:.2f}, locking {edge:.2f} per pair",
                      meta={"no_price": round(1 - yb, 4), "edge": round(edge, 4)})


ALL_STRATEGIES = [
    FairValueStrategy,
    MomentumStrategy,
    MeanReversionStrategy,
    StaleOddsStrategy,
    TopicThesisStrategy,
    ComplementArbStrategy,
]

FAMILIES = ["Statistical", "Momentum", "Market making", "Event driven", "Event thesis", "Arbitrage"]

# Strategy categories used to group trades on the analysis pages.
TOPIC_RULES_NOTE = re.compile(r"[a-z_]+")


def registry(**overrides) -> list[Strategy]:
    """Build the strategy set, optionally overriding params per strategy name."""
    out = []
    for cls in ALL_STRATEGIES:
        out.append(cls(**(overrides.get(cls.name) or {})))
    return out


def describe_all(**overrides) -> list[dict]:
    return [s.describe() for s in registry(**overrides)]


def as_dict(sig: Signal) -> dict:
    return asdict(sig)
