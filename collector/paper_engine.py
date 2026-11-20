"""
Simulated trading engine ("paper" portfolio).

Fully self-contained: it never touches a Kalshi account, it reads the observations the collector
wrote and keeps a ledger in data/paper/. That is what makes "automate simulated trades to test
different strategies" possible without credentials, and it means every number on the Portfolio page
can be reproduced by re-running this file.

Accounting rules (stated once, applied everywhere):
  * a contract costs its price and pays exactly $1.00 if it settles on your side
    (https://docs.kalshi.com/getting_started/market_settlement)
  * fees use the official published schedule (collector/fees.py)
  * fills are simulated at the quoted touch: buying YES pays the YES ask, buying NO pays the NO ask
    derived from the YES bid (a YES bid at X is a NO ask at 1-X, per the orderbook doc)
  * exits are simulated at the touch too: selling YES receives the YES bid
  * no slippage model is invented; if the book at the touch is thinner than the order, the order is
    reduced to the size the quote actually showed

Every fill records the strategy that produced it, so trades can be grouped by strategy type on the
analysis pages.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from collector import strategies as stratmod
from collector.fees import trade_fee
from collector.util import DATA, iso, now_ts, read_json, write_json

STARTING_BALANCE = 10_000.00
ORDER_SIZE = 25                # contracts per signal
TAKE_PROFIT = 0.05             # exit when the mark is +5c in favor
STOP_LOSS = 0.08               # exit when the mark is -8c against


def ledger_path() -> str:
    return os.path.join(DATA, "paper", "ledger.json")


def load_ledger() -> dict:
    doc = read_json(ledger_path())
    if not doc:
        doc = {
            "created_at": iso(),
            "starting_balance": STARTING_BALANCE,
            "cash": STARTING_BALANCE,
            "positions": [],
            "fills": [],
            "equity_curve": [],
            "closed": [],
            "note": "Simulated portfolio only. No Kalshi account is connected; no order was placed.",
        }
    return doc


def history_for(ticker: str, limit: int = 60) -> list[dict]:
    path = os.path.join(DATA, "timeseries", f"{ticker.replace('/', '_')}.json")
    doc = read_json(path) or {}
    return (doc.get("points") or [])[-limit:]


def book_depth(market: dict) -> dict:
    book = market.get("book") or {}
    return {
        "yes_qty": book.get("yes_bid_qty_total") or 0,
        "no_qty": book.get("no_bid_qty_total") or 0,
    }


def days_to_close(market: dict) -> float | None:
    ts = market.get("close_ts")
    if not ts:
        return None
    return max(0.0, (ts - now_ts()) / 86400.0)


def execute(doc: dict, sig: stratmod.Signal, market: dict, ts: int, taker: bool = True) -> dict | None:
    """Simulate one fill (one or two legs) and update cash/positions."""
    legs = []
    if sig.side == "yes_complement":
        legs = [("yes", sig.limit_price), ("no", sig.meta.get("no_price"))]
    elif sig.side in ("yes", "no"):
        legs = [(sig.side, sig.limit_price)]

    fills = []
    for side, price in legs:
        if price is None or not (0 < price < 1):
            continue
        contracts = int(sig.contracts)
        if contracts <= 0:
            continue
        cost = contracts * price
        fee = trade_fee(contracts, price, taker=taker, ticker=sig.ticker)
        if cost + fee > doc["cash"]:
            affordable = int((doc["cash"] * 0.95) // (price + 0.02))
            contracts = min(contracts, affordable)
            if contracts <= 0:
                continue
            cost = contracts * price
            fee = trade_fee(contracts, price, taker=taker, ticker=sig.ticker)
        doc["cash"] = round(doc["cash"] - cost - fee, 6)

        pos = None
        for p in doc["positions"]:
            if p["ticker"] == sig.ticker and p["side"] == side:
                pos = p
                break
        if pos is None:
            pos = {
                "ticker": sig.ticker, "side": side, "contracts": 0, "avg_price": 0.0,
                "cost": 0.0, "fees": 0.0, "opened_ts": ts, "strategy": sig.name,
                "family": sig.family, "title": market.get("title"),
                "topics": market.get("topics") or [], "event_ticker": market.get("event_ticker"),
                "reason": sig.reason, "mark": price, "unrealized": 0.0,
            }
            doc["positions"].append(pos)
        total_cost = pos["cost"] + cost
        pos["contracts"] += contracts
        pos["avg_price"] = round(total_cost / pos["contracts"], 6)
        pos["cost"] = round(total_cost, 6)
        pos["fees"] = round(pos["fees"] + fee, 6)
        pos["mark"] = price

        fill = {
            "ts": ts, "at": iso(), "ticker": sig.ticker, "side": side, "action": "buy",
            "contracts": contracts, "price": round(price, 4), "fee": round(fee, 6),
            "cost": round(cost, 6), "strategy": sig.name, "family": sig.family,
            "reason": sig.reason, "topics": market.get("topics") or [],
        }
        doc["fills"].append(fill)
        fills.append(fill)
    return fills[0] if fills else None


def close_position(doc: dict, pos: dict, market: dict, ts: int, why: str) -> dict | None:
    """Sell the position back at the touch. Returns the closing fill."""
    if pos["side"] == "yes":
        bid = market.get("yes_bid")
    else:
        bid = market.get("no_bid")
    if bid is None or not (0 < bid < 1):
        return None
    contracts = pos["contracts"]
    proceeds = contracts * bid
    fee = trade_fee(contracts, bid, taker=True, ticker=pos["ticker"])
    doc["cash"] = round(doc["cash"] + proceeds - fee, 6)
    realized = round(proceeds - fee - pos["cost"], 6)
    closed = {
        "ts": ts, "at": iso(), "ticker": pos["ticker"], "side": pos["side"],
        "contracts": contracts, "entry": pos["avg_price"], "exit": bid,
        "fees": round(pos["fees"] + fee, 6), "realized": realized,
        "strategy": pos["strategy"], "family": pos["family"], "topics": pos["topics"],
        "title": pos["title"], "reason_close": why, "holding_ts": ts - pos["opened_ts"],
    }
    doc["closed"].append(closed)
    doc["fills"].append({
        "ts": ts, "at": iso(), "ticker": pos["ticker"], "side": pos["side"], "action": "sell",
        "contracts": contracts, "price": round(bid, 4), "fee": round(fee, 6),
        "cost": round(-proceeds, 6), "strategy": pos["strategy"], "family": pos["family"],
        "reason": why, "topics": pos["topics"],
    })
    doc["positions"].remove(pos)
    return closed


def settle_positions(doc: dict, resolutions: dict, ts: int) -> list[dict]:
    settled = []
    for pos in list(doc["positions"]):
        res = (resolutions or {}).get(pos["ticker"])
        if not res or res.get("result") not in ("yes", "no"):
            continue
        result = res["result"]
        payout = pos["contracts"] * 1.0 if pos["side"] == result else 0.0
        doc["cash"] = round(doc["cash"] + payout, 6)
        realized = round(payout - pos["cost"], 6)
        closed = {
            "ts": ts, "at": iso(), "ticker": pos["ticker"], "side": pos["side"],
            "contracts": pos["contracts"], "entry": pos["avg_price"], "exit": 1.0 if payout else 0.0,
            "fees": pos["fees"], "realized": realized, "strategy": pos["strategy"],
            "family": pos["family"], "topics": pos["topics"], "title": pos["title"],
            "reason_close": f"settled {result.upper()}", "holding_ts": ts - pos["opened_ts"],
            "resolved": result, "resolution_source": res.get("source_url"),
        }
        doc["closed"].append(closed)
        doc["positions"].remove(pos)
        settled.append(closed)
    return settled


def mark_to_market(doc: dict, snapshot: dict) -> float:
    by_ticker = {m["ticker"]: m for m in snapshot["markets"]}
    total = 0.0
    for pos in doc["positions"]:
        m = by_ticker.get(pos["ticker"])
        if not m:
            total += pos["cost"]
            continue
        mark = m.get("yes_bid") if pos["side"] == "yes" else m.get("no_bid")
        if mark is None:
            mark = pos["avg_price"]
        pos["mark"] = round(mark, 4)
        pos["unrealized"] = round(pos["contracts"] * mark - pos["cost"], 6)
        pos["strategy"] = pos.get("strategy") or "unknown"
        total += pos["contracts"] * mark
    return round(total, 2)


def run(snapshot_path: str | None = None, strategies_csv: str | None = None) -> dict:
    snapshot_path = snapshot_path or os.path.join(DATA, "markets", "latest.json")
    snapshot = read_json(snapshot_path)
    if not snapshot:
        raise SystemExit("no snapshot; run the collector first")
    ts = snapshot["generated_ts"]
    doc = load_ledger()
    resolutions = read_json(os.path.join(DATA, "resolutions.json"), {}) or {}

    # 1. settle anything resolved
    settled = settle_positions(doc, resolutions, ts)

    # 2. manage open positions: take profit / stop loss / market closed
    by_ticker = {m["ticker"]: m for m in snapshot["markets"]}
    for pos in list(doc["positions"]):
        m = by_ticker.get(pos["ticker"])
        if not m:
            continue
        mark = m.get("yes_bid") if pos["side"] == "yes" else m.get("no_bid")
        if mark is None:
            continue
        pnl = mark - pos["avg_price"]
        if pnl >= TAKE_PROFIT:
            close_position(doc, pos, m, ts, f"take profit at {mark:.2f} (entry {pos['avg_price']:.2f})")
        elif pnl <= -STOP_LOSS:
            close_position(doc, pos, m, ts, f"stop loss at {mark:.2f} (entry {pos['avg_price']:.2f})")

    # 3. ask every strategy for signals
    chosen = None
    if strategies_csv:
        chosen = {s.strip() for s in strategies_csv.split(",") if s.strip()}
    strategies = [s for s in stratmod.registry() if not chosen or s.name in chosen]

    open_tickers = {(p["ticker"], p["side"]) for p in doc["positions"]}
    signals = []
    for m in snapshot["markets"]:
        hist = history_for(m["ticker"])
        ctx = {"size": ORDER_SIZE, "days_to_close": days_to_close(m), "book_depth": book_depth(m)}
        for s in strategies:
            try:
                sig = s.evaluate(m, hist, ctx)
            except Exception:  # noqa: BLE001 - a bad market must not stop the cycle
                continue
            if not sig:
                continue
            if (sig.ticker, sig.side) in open_tickers and sig.side != "yes_complement":
                continue
            signals.append((sig, m))

    # Largest-edge first so a limited cash balance goes to the best ideas.
    signals.sort(key=lambda sm: (-(sm[0].meta.get("edge") or 0), sm[0].ticker))
    new_fills = []
    for sig, m in signals:
        fill = execute(doc, sig, m, ts)
        if fill:
            new_fills.append(fill)

    # 4. mark to market + equity curve
    positions_value = mark_to_market(doc, snapshot)
    equity = round(doc["cash"] + positions_value, 2)
    curve = doc.get("equity_curve") or []
    if curve and curve[-1].get("t") == ts:
        curve.pop()
    curve.append({"t": ts, "at": iso(), "cash": round(doc["cash"], 2),
                  "positions": positions_value, "equity": equity})
    doc["equity_curve"] = curve[-5000:]
    doc["updated_at"] = iso()
    doc["last_snapshot_ts"] = ts
    write_json(ledger_path(), doc, indent=1)

    summary = analyse(doc)
    write_json(os.path.join(DATA, "paper", "summary.json"), summary)
    print(f"paper: fills+={len(new_fills)} settled={len(settled)} equity={equity:.2f} "
          f"trades={len(doc['fills'])} open={len(doc['positions'])}")
    return {"ledger": doc, "summary": summary}


def analyse(doc: dict) -> dict:
    """Per-strategy and per-topic performance, straight from the ledger."""
    closed = doc.get("closed") or []
    fills = doc.get("fills") or []

    by_strategy = {}
    for c in closed:
        s = by_strategy.setdefault(c["strategy"], {
            "strategy": c["strategy"], "family": c["family"], "trades": 0, "wins": 0,
            "realized": 0.0, "fees": 0.0, "notional": 0.0, "hold_ts": 0,
        })
        s["trades"] += 1
        s["wins"] += 1 if c["realized"] > 0 else 0
        s["realized"] = round(s["realized"] + c["realized"], 6)
        s["fees"] = round(s["fees"] + (c.get("fees") or 0), 6)
        s["notional"] = round(s["notional"] + c["contracts"] * c["entry"], 6)
        s["hold_ts"] += c.get("holding_ts") or 0

    open_by_strategy = defaultdict(lambda: {"open": 0, "unrealized": 0.0, "open_cost": 0.0})
    for p in doc.get("positions") or []:
        o = open_by_strategy[p["strategy"]]
        o["open"] += 1
        o["unrealized"] = round(o["unrealized"] + (p.get("unrealized") or 0), 6)
        o["open_cost"] = round(o["open_cost"] + p["cost"], 6)

    rows = []
    for name, desc in ((d["name"], d) for d in stratmod.describe_all()):
        s = by_strategy.get(name) or {"trades": 0, "wins": 0, "realized": 0.0, "fees": 0.0,
                                     "notional": 0.0, "hold_ts": 0, "family": desc["family"]}
        o = open_by_strategy.get(name) or {"open": 0, "unrealized": 0.0, "open_cost": 0.0}
        trades = s["trades"]
        rows.append({
            "strategy": name, "family": desc["family"], "rule": desc["rule"],
            "params": desc["params"],
            "closed_trades": trades,
            "win_rate": round(s["wins"] / trades, 4) if trades else None,
            "realized": round(s["realized"], 2),
            "fees": round(s["fees"], 2),
            "roi": round(s["realized"] / s["notional"], 4) if s["notional"] else None,
            "avg_hold_hours": round(s["hold_ts"] / trades / 3600, 2) if trades else None,
            "open_positions": o["open"],
            "unrealized": round(o["unrealized"], 2),
            "open_cost": round(o["open_cost"], 2),
        })

    by_topic = defaultdict(lambda: {"trades": 0, "realized": 0.0, "wins": 0})
    for c in closed:
        key = (c.get("topics") or ["untagged"])[0]
        t = by_topic[key]
        t["trades"] += 1
        t["realized"] = round(t["realized"] + c["realized"], 6)
        t["wins"] += 1 if c["realized"] > 0 else 0

    positions_value = sum((p.get("contracts") or 0) * (p.get("mark") or p.get("avg_price") or 0)
                          for p in doc.get("positions") or [])
    equity = round(doc["cash"] + positions_value, 2)
    return {
        "generated_at": iso(),
        "starting_balance": doc["starting_balance"],
        "cash": round(doc["cash"], 2),
        "positions_value": round(positions_value, 2),
        "equity": equity,
        "total_return": round(equity / doc["starting_balance"] - 1, 4),
        "realized_total": round(sum(c["realized"] for c in closed), 2),
        "fees_total": round(sum((c.get("fees") or 0) for c in closed), 2),
        "open_positions": len(doc.get("positions") or []),
        "closed_trades": len(closed),
        "fills": len(fills),
        "strategies": rows,
        "by_topic": [{"topic": k, "trades": v["trades"],
                      "realized": round(v["realized"], 2),
                      "win_rate": round(v["wins"] / v["trades"], 4) if v["trades"] else None}
                     for k, v in sorted(by_topic.items())],
        "equity_curve": doc.get("equity_curve") or [],
        "disclaimer": "Simulated fills on observed quotes. Not exchange trades, no Kalshi account "
                      "involved, and no slippage beyond the quoted touch is modelled.",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", default=None)
    ap.add_argument("--strategies", default=None, help="comma-separated strategy names to run")
    args = ap.parse_args()
    run(args.snapshot, args.strategies)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
