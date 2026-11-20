/* Trade1 — engine.js — shared market tracker (history/jumps/watchlist) + paper strategy engine.
 *
 * Fees use Kalshi's OFFICIAL formula (verified against the general fee table in the fee schedule PDF):
 *   taker fee = roundup(M × 0.07 × C × P × (1−P))   — M=1 for simulated series unless API says otherwise
 *   https://kalshi.com/docs/kalshi-fee-schedule.pdf  (cross-check: 100 contracts @ $0.50 → $1.75 ✓)
 * Settlement: YES result pays $1/contract to YES holders, NO result pays $1/contract to NO holders,
 *   no settlement fee — https://docs.kalshi.com/getting_started/market_settlement.md
 */
"use strict";

(function () {
  // ============ Tracker: history + jumps + watchlist ============
  const Track = {
    // Call on every fresh market quote. Returns a jump object when |Δ| ≥ $0.10 vs previous observation.
    observe(market, topic) {
      const t = Date.now();
      const price = midOrLast(market);
      if (price === null) return null;
      Store.addWatch(market, topic);
      const hist = Store.history(market.ticker);
      const prev = hist.length ? hist[hist.length - 1][1] : null;
      Store.pushHistory(market.ticker, t, price);
      let jump = null;
      if (prev !== null && Math.abs(price - prev) >= T1.JUMP_THRESHOLD) {
        jump = {
          t, ticker: market.ticker, event_ticker: market.event_ticker,
          title: market.title || "", subtitle: market.subtitle || "",
          series: (market.ticker.split("-")[0] || ""),
          from: prev, to: price, dir: price > prev ? "up" : "down", topic: topic || guessTopic(market),
        };
        Store.addJump(jump);
      }
      return jump;
    },
    history(ticker) { return Store.history(ticker); },
    jumps(topic) {
      const js = Store.jumps();
      return topic ? js.filter((j) => j.topic === topic) : js;
    },
    // Latest quote cache (ticker -> market object) for cross-page use
    latest: {},
  };

  function midOrLast(m) {
    const yb = parseFloat(m.yes_bid_dollars), ya = parseFloat(m.yes_ask_dollars);
    if (!isNaN(yb) && !isNaN(ya) && yb > 0 && ya > 0 && ya >= yb) return round4((yb + ya) / 2);
    const lp = parseFloat(m.last_price_dollars);
    if (!isNaN(lp) && lp > 0) return round4(lp);
    const pp = parseFloat(m.previous_price_dollars);
    if (!isNaN(pp) && pp > 0) return round4(pp);
    return null;
  }
  function round4(v) { return Math.round(v * 10000) / 10000; }
  function guessTopic(m) {
    const hay = ((m.title || "") + " " + (m.subtitle || "") + " " + (m.ticker || "")).toLowerCase();
    for (const id of T1.TOPIC_ORDER) {
      const t = T1.TOPICS[id];
      if (t.seeds.some((s) => (m.ticker || "").startsWith(s))) return id;
      if (t.keywords.some((k) => hay.includes(k))) return id;
    }
    return "";
  }

  // ============ Paper engine ============
  const Engine = {
    feeTaker(contracts, priceDollars) {
      // Official taker formula, rounded up to the cent (verified vs fee table).
      const fee = Math.ceil(0.07 * contracts * priceDollars * (1 - priceDollars) * 100) / 100;
      return Math.max(fee, 0);
    },
    midOrLast,
    mark(m) {
      const yb = parseFloat(m.yes_bid_dollars), ya = parseFloat(m.yes_ask_dollars);
      if (!isNaN(yb) && !isNaN(ya) && yb > 0 && ya > 0) return round4((yb + ya) / 2);
      return midOrLast(m);
    },

    // Run strategies for one fresh market quote (book optional, used by imbalance only).
    tick(market, book) {
      const st = Store.settings();
      if (!st.enabled) return;
      const p = Store.paper();
      if (!p.positions[market.ticker]) {
        this._entries(market, book, p, st);
      } else {
        this._manage(market, p, st, book);
      }
      this.markAll(null);
    },

    _quote(m) {
      const yb = parseFloat(m.yes_bid_dollars), ya = parseFloat(m.yes_ask_dollars);
      const nb = parseFloat(m.no_bid_dollars), na = parseFloat(m.no_ask_dollars);
      return {
        yesBid: isNaN(yb) ? null : yb, yesAsk: isNaN(ya) ? null : ya,
        noBid: isNaN(nb) ? null : nb, noAsk: isNaN(na) ? null : na,
      };
    },

    _canOpen(p, st) {
      const openCount = Object.keys(p.positions).length;
      return p.cash > 1 && openCount < (st.maxPositions || 12);
    },

    _buy(market, side, strategy, reason, p, st) {
      const q = this._quote(market);
      const price = side === "yes" ? q.yesAsk : q.noAsk;
      if (price === null || price <= 0.02 || price >= 0.98) return;
      const stake = Math.min(st.stake || 15, p.cash);
      let contracts = Math.floor(stake / price);
      if (contracts < 1) return;
      const cost = round2(contracts * price);
      const fee = this.feeTaker(contracts, price);
      if (cost + fee > p.cash) { contracts -= 1; if (contracts < 1) return; }
      const cost2 = round2(contracts * price);
      const fee2 = this.feeTaker(contracts, price);
      p.cash = round2(p.cash - cost2 - fee2);
      p.feesPaid = round2(p.feesPaid + fee2);
      p.positions[market.ticker] = {
        side, contracts, entryPrice: price, cost: cost2, fees: fee2,
        entryTs: Date.now(), strategy, reason,
        market: { ticker: market.ticker, event_ticker: market.event_ticker, title: market.title, subtitle: market.subtitle, series: (market.ticker.split("-")[0] || "") },
        topic: guessTopic(market),
      };
      p.openLog.unshift({
        ts: Date.now(), kind: "buy", ticker: market.ticker, event: market.event_ticker,
        title: market.title, subtitle: market.subtitle, topic: guessTopic(market),
        strategy, side, contracts, price, fee: fee2, cashAfter: p.cash,
      });
      while (p.openLog.length > 800) p.openLog.pop();
      Store.setPaper(p);
    },

    _sell(market, pos, reason, p, extra) {
      const q = this._quote(market);
      const price = pos.side === "yes" ? q.yesBid : q.noBid;
      if (price === null || price <= 0) return;
      this._close(market, pos, price, reason, p, extra);
    },

    _close(market, pos, exitPrice, reason, p, extra) {
      const proceeds = round2(pos.contracts * exitPrice);
      const fee = this.feeTaker(pos.contracts, exitPrice);
      const pnl = round2(proceeds - pos.cost - fee);
      p.cash = round2(p.cash + proceeds - fee);
      p.feesPaid = round2(p.feesPaid + fee);
      p.realized = round2(p.realized + pnl);
      if (pnl > 0) p.wins += 1; else if (pnl < 0) p.losses += 1;
      p.trades.unshift({
        openedTs: pos.entryTs, closedTs: Date.now(), ticker: pos.market.ticker,
        event: pos.market.event_ticker, title: pos.market.title, subtitle: pos.market.subtitle,
        topic: pos.topic, strategy: pos.strategy, side: pos.side, contracts: pos.contracts,
        entryPrice: pos.entryPrice, exitPrice, fees: round2(pos.fees + fee), pnl,
        outcome: pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat",
        reason, holdSec: Math.round((Date.now() - pos.entryTs) / 1000),
        result: extra && extra.result, settlement: !!extra,
      });
      while (p.trades.length > 2000) p.trades.pop();
      p.openLog.unshift({
        ts: Date.now(), kind: extra && extra.settlement ? "settle" : "sell", ticker: pos.market.ticker,
        event: pos.market.event_ticker, title: pos.market.title, subtitle: pos.market.subtitle,
        topic: pos.topic, strategy: pos.strategy, side: pos.side, contracts: pos.contracts,
        price: exitPrice, fee, cashAfter: p.cash, pnl,
      });
      while (p.openLog.length > 800) p.openLog.pop();
      delete p.positions[pos.market.ticker];
      delete (Store.paper().strategyState || {})[pos.market.ticker];
      Store.setPaper(p);
    },

    _entries(market, book, p, st) {
      const q = this._quote(market);
      if (q.yesAsk === null || q.yesBid === null) return;
      if (market.status && !["active", "open"].includes(market.status)) return;
      const hist = Store.history(market.ticker);
      const now = Date.now();
      const sState = p.strategyState || (p.strategyState = {});
      const local = sState[market.ticker] || (sState[market.ticker] = { cooldowns: {} });

      const tryStrat = (id, fn) => {
        const cfg = st.strategies[id];
        if (!cfg || !cfg.on) return;
        const cd = local.cooldowns[id] || 0;
        if (now - cd < 15000) return; // avoid re-trigger churn
        if (fn(cfg) && this._canOpen(p, st)) {
          local.cooldowns[id] = now;
          this._buy(market, cfg._side || "yes", id, cfg._reason || "signal", p, st);
        }
      };

      // Momentum: price up ≥ trigger within windowSec
      tryStrat("momentum", (c) => {
        const cutoff = now - (c.windowSec || 8) * 1000;
        const win = hist.filter((pt) => pt[0] >= cutoff);
        if (win.length < 2) return false;
        const move = win[win.length - 1][1] - win[0][1];
        if (move >= (c.trigger || 0.04) && q.yesAsk < 0.97) { c._side = "yes"; c._reason = `+${move.toFixed(2)} in ${c.windowSec}s`; return true; }
        return false;
      });

      // Mean reversion: price ≤ baseline − trigger
      tryStrat("reversion", (c) => {
        const cutoff = now - (c.baselineSec || 300) * 1000;
        const win = hist.filter((pt) => pt[0] >= cutoff);
        if (win.length < 5) return false;
        const base = win.reduce((a, pt) => a + pt[1], 0) / win.length;
        const cur = win[win.length - 1][1];
        if (cur <= base - (c.trigger || 0.08) && q.yesAsk < 0.97) { c._side = "yes"; c._reason = `${(base - cur).toFixed(2)} under ${c.baselineSec}s baseline`; return true; }
        return false;
      });

      // Book imbalance: depth within depthCents of best bids
      tryStrat("imbalance", (c) => {
        if (!book) return false;
        const dC = (c.depthCents || 10) / 100;
        const yb = q.yesBid, nb = q.noBid;
        if (!yb || !nb) return false;
        const yDepth = (book.yes || []).reduce((a, [pr, qty]) => a + (Math.abs(parseFloat(pr) - yb) <= dC ? parseFloat(qty) : 0), 0);
        const nDepth = (book.no || []).reduce((a, [pr, qty]) => a + (Math.abs(parseFloat(pr) - nb) <= dC ? parseFloat(qty) : 0), 0);
        if (yDepth + nDepth < 5) return false; // too thin to trust
        const ratio = nDepth > 0 ? yDepth / nDepth : Infinity;
        if (ratio >= (c.ratio || 1.8) && q.yesAsk < 0.97) { c._side = "yes"; c._reason = `depth ratio ${ratio.toFixed(2)} (Y ${yDepth} vs N ${nDepth})`; return true; }
        if (ratio <= 1 / (c.ratio || 1.8) && q.noAsk && q.noAsk < 0.97) { c._side = "no"; c._reason = `depth ratio ${ratio.toFixed(2)} (N-side heavy)`; return true; }
        return false;
      });
    },

    _manage(market, p, st, book) {
      const pos = p.positions[market.ticker];
      if (!pos) return;
      const cfg = st.strategies[pos.strategy] || {};
      const q = this._quote(market);
      const cur = pos.side === "yes" ? q.yesBid : q.noBid;
      if (cur === null) return;
      const now = Date.now();
      const sState = p.strategyState || (p.strategyState = {});
      const local = sState[market.ticker] || (sState[market.ticker] = {});

      const held = (now - pos.entryTs) / 1000;
      const gain = cur - pos.entryPrice;
      if (gain >= (cfg.take || 0.05)) return this._sell(market, pos, "target", p);
      if (gain <= -(cfg.stop || 0.06)) return this._sell(market, pos, "stop", p);
      if (held >= (cfg.timeoutSec || 300)) return this._sell(market, pos, "timeout", p);
      // imbalance flip exit
      if (pos.strategy === "imbalance" && book) {
        const dC = (cfg.depthCents || 10) / 100;
        const yb = q.yesBid, nb = q.noBid;
        if (yb && nb) {
          const yDepth = (book.yes || []).reduce((a, [pr, qty]) => a + (Math.abs(parseFloat(pr) - yb) <= dC ? parseFloat(qty) : 0), 0);
          const nDepth = (book.no || []).reduce((a, [pr, qty]) => a + (Math.abs(parseFloat(pr) - nb) <= dC ? parseFloat(qty) : 0), 0);
          const ratio = nDepth > 0 ? yDepth / nDepth : Infinity;
          if ((pos.side === "yes" && ratio <= 1 / (cfg.ratio || 1.8)) || (pos.side === "no" && ratio >= (cfg.ratio || 1.8)))
            return this._sell(market, pos, "flip", p);
        }
      }
    },

    // Mark all open positions to market; push equity point. `quoteMap` optional (ticker->market).
    markAll(quoteMap) {
      const p = Store.paper();
      const tickers = Object.keys(p.positions);
      if (!tickers.length) return null;
      let total = 0;
      for (const t of tickers) {
        const m = (quoteMap && quoteMap[t]) || Track.latest[t];
        const pos = p.positions[t];
        if (!m) { total += pos.cost; continue; } // fall back to cost basis (conservative), never invented
        const q = this._quote(m);
        const mark = pos.side === "yes" ? q.yesBid : q.noBid;
        total += pos.contracts * (mark !== null && mark > 0 ? mark : pos.entryPrice);
      }
      const equity = round2(p.cash + total);
      Store.paperEquityPush(Date.now(), equity);
      return equity;
    },

    equityNow() {
      const p = Store.paper();
      let total = 0;
      for (const t of Object.keys(p.positions)) {
        const pos = p.positions[t];
        const m = Track.latest[t];
        const q = m ? this._quote(m) : {};
        const mark = pos.side === "yes" ? q.yesBid : q.noBid;
        total += pos.contracts * (mark !== null && mark > 0 ? mark : pos.entryPrice);
      }
      return round2(p.cash + total);
    },

    // ---- Resolution tracking: batch status check for watchlist (docs: tickers-only filter returns
    //      every matching market in ONE response — get-markets.md). Settles paper positions at $1/$0.
    async checkResolutions(tickers) {
      const list = (tickers || Object.keys(Store.watchlist())).filter(Boolean);
      const chunks = [];
      for (let i = 0; i < list.length; i += 40) chunks.push(list.slice(i, i + 40));
      const resolvedNow = [];
      for (const chunk of chunks) {
        let markets = [];
        try { markets = await KalshiAPI.getMarketsByTickers(chunk); } catch (e) { continue; }
        for (const m of markets) {
          Track.latest[m.ticker] = m;
          if ((m.status === "finalized" || m.status === "settled") && (m.result === "yes" || m.result === "no")) {
            const w = Store.watchlist();
            if (w[m.ticker] && (!w[m.ticker].resolved || w[m.ticker].resolved.result !== m.result)) {
              w[m.ticker].resolved = { result: m.result, settlement_ts: m.settlement_ts || "", seen: Date.now() };
              Store.set("watchlist", w);
              resolvedNow.push(m);
            }
          }
        }
      }
      // settle paper positions in resolved markets
      const p = Store.paper();
      for (const m of resolvedNow) {
        const pos = p.positions[m.ticker];
        if (!pos) continue;
        const payout = pos.side === m.result ? 1 : 0; // $1 to holders of the resolved side (official)
        this._close({ ...pos.market, yes_bid_dollars: String(payout), no_bid_dollars: String(payout) },
          pos, payout, "settlement", p, { settlement: true, result: m.result });
      }
      Store.setPaper({ ...p, lastResolutionCheck: Date.now() });
      return resolvedNow;
    },

    stats() {
      const p = Store.paper();
      const eq = p.equity.length ? p.equity : [];
      let peak = -Infinity, maxDD = 0;
      for (const [, v] of eq) { if (v > peak) peak = v; if (peak > 0) maxDD = Math.max(maxDD, (peak - v) / peak); }
      const byStrategy = {}, byTopic = {};
      for (const tr of p.trades) {
        const s = byStrategy[tr.strategy] = byStrategy[tr.strategy] || { pnl: 0, wins: 0, losses: 0, n: 0 };
        s.pnl = round2(s.pnl + tr.pnl); s.n++; if (tr.outcome === "win") s.wins++; if (tr.outcome === "loss") s.losses++;
        const t = byTopic[tr.topic || "other"] = byTopic[tr.topic || "other"] || { pnl: 0, wins: 0, losses: 0, n: 0 };
        t.pnl = round2(t.pnl + tr.pnl); t.n++; if (tr.outcome === "win") t.wins++; if (tr.outcome === "loss") t.losses++;
      }
      const closed = p.wins + p.losses;
      return {
        cash: round2(p.cash), equity: this.equityNow(), realized: p.realized,
        unrealized: round2(this.equityNow() - p.cash),
        fees: p.feesPaid, wins: p.wins, losses: p.losses,
        winRate: closed ? Math.round((p.wins / closed) * 100) : null,
        maxDrawdown: maxDD, equitySeries: eq,
        openPositions: Object.keys(p.positions).length,
        trades: p.trades, openLog: p.openLog,
        byStrategy, byTopic,
      };
    },
  };

  function round2(v) { return Math.round(v * 100) / 100; }

  window.T1Track = Track;
  window.Engine = Engine;
})();
