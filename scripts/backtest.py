"""Rule-based SIMULATED strategies replayed over OFFICIAL resolved-market candlesticks.

Method (see reports/METHODOLOGY.md):
- Candles: GET /series/{s}/markets/{t}/candlesticks, 60-minute period over each market's life
  (open_time -> settlement). Price used: price.close_dollars (last traded YES price), with
  yes_bid.close_dollars and yes_ask.close_dollars for execution.
- Entry buys at the quoted ask (YES) or at 1 - YES bid (NO), per Kalshi's documented reciprocal
  relationship. Exits at the next candle's YES bid, or held to settlement.
- Outcome = official 'result' field of the settled market ('yes' or 'no' only).
- NO FEES, NO SLIPPAGE beyond the candle quote, NO position sizing: each trade is 1 contract.
  Kalshi series carry a fee_type (e.g. 'quadratic'); exact fee formulas were NOT modelled.
"""
import statistics

MAX_MARKETS = 250
MAX_PERIODS = 5000
PRICE_BANDS = [(0.0, 0.10, "<$0.10"), (0.10, 0.50, "$0.10-$0.49"), (0.50, 0.90, "$0.50-$0.89"), (0.90, 1.0001, ">=$0.90")]
STRATEGIES = {
    "S0_BUY_YES_FIRST_QUOTE": "Baseline: buy YES at the first quoted candle, hold to settlement.",
    "S1_LONGSHOT_YES": "Buy YES when last price first closes <= $0.10; hold to settlement.",
    "S2_FAVOURITE_NO": "Buy NO when last price first closes >= $0.90; hold to settlement.",
    "S3_MOMENTUM_1H_YES": "After a candle-to-candle rise of >= $0.10, buy YES; exit at next candle's YES bid.",
    "S4_FADE_1H_YES": "After a candle-to-candle fall of >= $0.10, buy YES; exit at next candle's YES bid.",
}


def band_of(p):
    for lo, hi, name in PRICE_BANDS:
        if lo <= p < hi:
            return name
    return "n/a"


def trades_for_market(row, cs):
    outcome = row["resolved_outcome"]
    payoff_yes = 1.0 if outcome == "yes" else 0.0
    cs = [c for c in cs if c.get("close") is not None]
    out = []
    if not cs:
        return out

    def add(strategy, i, entry_cost, exit_value, exit_kind, exit_t, side):
        out.append({
            "strategy": strategy, "ticker": row["ticker"], "topic": row["topic"], "title": row["title"],
            "side": side, "entry_t": cs[i]["t"], "entry_price": round(entry_cost, 4),
            "exit_t": exit_t, "exit_kind": exit_kind, "exit_value": round(exit_value, 4),
            "pnl_per_contract": round(exit_value - entry_cost, 4),
            "outcome": outcome, "band": band_of(cs[i]["close"]),
            "source_api": row["source_api"], "source_terms": row["source_terms"],
        })

    # S0 baseline
    for i, c in enumerate(cs):
        if c.get("ask_close") is not None:
            add("S0_BUY_YES_FIRST_QUOTE", i, c["ask_close"], payoff_yes, "settlement", row["settlement_ts"] or None, "YES")
            break
    # S1 longshot YES
    for i, c in enumerate(cs):
        if c["close"] <= 0.10 and c.get("ask_close") is not None:
            add("S1_LONGSHOT_YES", i, c["ask_close"], payoff_yes, "settlement", row["settlement_ts"] or None, "YES")
            break
    # S2 favourite NO
    for i, c in enumerate(cs):
        if c["close"] >= 0.90 and c.get("bid_close") is not None:
            entry = round(1.0 - c["bid_close"], 4)
            add("S2_FAVOURITE_NO", i, entry, 1.0 - payoff_yes, "settlement", row["settlement_ts"] or None, "NO")
            break
    # S3 / S4 one-hour move rules
    for i in range(1, len(cs) - 1):
        d = cs[i]["close"] - cs[i - 1]["close"]
        if cs[i].get("ask_close") is None or cs[i + 1].get("bid_close") is None:
            continue
        if d >= 0.10 - 1e-9:
            add("S3_MOMENTUM_1H_YES", i, cs[i]["ask_close"], cs[i + 1]["bid_close"], "next_candle_bid", cs[i + 1]["t"], "YES")
        elif d <= -0.10 + 1e-9:
            add("S4_FADE_1H_YES", i, cs[i]["ask_close"], cs[i + 1]["bid_close"], "next_candle_bid", cs[i + 1]["t"], "YES")
    return out


def summarize(trades):
    groups = {}
    for t in trades:
        groups.setdefault((t["strategy"], t["topic"]), []).append(t["pnl_per_contract"])
    rows = []
    for (strat, topic), pnls in sorted(groups.items()):
        n = len(pnls)
        rows.append({
            "strategy": strat, "topic": topic, "trades": n,
            "win_rate": round(sum(1 for p in pnls if p > 0) / n, 4),
            "avg_pnl_per_contract": round(statistics.fmean(pnls), 4),
            "total_pnl_per_contract": round(sum(pnls), 4),
            "sample_flag": "insufficient sample (<30 trades)" if n < 30 else "",
        })
    return rows


def summarize_by_band(trades):
    groups = {}
    for t in trades:
        groups.setdefault((t["strategy"], t["band"]), []).append(t["pnl_per_contract"])
    rows = []
    for (strat, band), pnls in sorted(groups.items()):
        n = len(pnls)
        rows.append({
            "strategy": strat, "band": band, "trades": n,
            "win_rate": round(sum(1 for p in pnls if p > 0) / n, 4),
            "avg_pnl_per_contract": round(statistics.fmean(pnls), 4),
            "sample_flag": "insufficient sample (<30 trades)" if n < 30 else "",
        })
    return rows


def run(candidates, candles_fn, k, flag, now):
    candidates = sorted(candidates, key=lambda r: r.get("settlement_ts") or "", reverse=True)[:MAX_MARKETS]
    trades = []
    fetched = 0
    skipped = 0
    import datetime as dt
    for row in candidates:
        try:
            start = int(dt.datetime.fromisoformat(row["open_time"].replace("Z", "+00:00")).timestamp()) if row.get("open_time") else None
            end_s = row.get("settlement_ts") or row.get("close_time")
            end = int(dt.datetime.fromisoformat(end_s.replace("Z", "+00:00")).timestamp()) if end_s else now
        except (ValueError, AttributeError):
            skipped += 1
            continue
        if start is None or end <= start:
            skipped += 1
            continue
        period = 60 if (end - start) / 3600 <= MAX_PERIODS else 1440
        try:
            cs = candles_fn(row["series_ticker"], row["ticker"], start, end, period)
        except k.KalshiError as exc:
            flag("info", "backtest", row["ticker"], f"Candlestick request failed; market skipped: {str(exc)[:140]}", row["source_api"])
            skipped += 1
            continue
        fetched += 1
        if period == 1440:
            flag("info", "backtest", row["ticker"], "Market life > 5000 hours; daily candles used for backtest.", row["source_api"])
        trades.extend(trades_for_market(row, cs))
    summary = summarize(trades)
    return {
        "generated_epoch": now,
        "method": "Simulated only. No fees, no slippage beyond quoted candle ask/bid, 1 contract per trade, no position sizing.",
        "markets_considered": len(candidates),
        "markets_with_candles": fetched,
        "markets_skipped": skipped,
        "strategies": STRATEGIES,
        "summary": summary,
        "by_band": summarize_by_band(trades),
        "trade_count": len(trades),
        "trades": trades[:1500],
    }
