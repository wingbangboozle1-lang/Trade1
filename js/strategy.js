/*
 * Simulated (paper) trading strategies + trade categorization + performance
 * analysis. Strategies run entirely client-side against live Kalshi prices so they
 * can be tested without committing demo funds. Real demo execution is available
 * separately via the portfolio page (opt-in, credentials required).
 */

(function (global) {
  "use strict";

  const CFG = global.KD_CONFIG;

  /* Each strategy declares its trade type/category so trades can be grouped. */
  const STRATEGIES = [
    {
      id: "momentum",
      name: "Momentum",
      category: "momentum",
      description: "Buys YES when price is rising; exits on a reversal.",
      enabled: true,
    },
    {
      id: "meanrev",
      name: "Mean Reversion",
      category: "mean-reversion",
      description: "Buys YES when price drops below its recent average, expects bounce.",
      enabled: true,
    },
    {
      id: "value",
      name: "Value",
      category: "value",
      description: "Buys YES when price is below the topic's average fair value.",
      enabled: true,
    },
    {
      id: "liquidity",
      name: "Liquidity-First",
      category: "liquidity",
      description: "Only trades markets with deep orderbooks; fades thin books.",
      enabled: true,
    },
  ];

  function uid() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function mean(arr) {
    if (!arr || !arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function std(arr) {
    if (!arr || arr.length < 2) return 0;
    const m = mean(arr);
    const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
    return Math.sqrt(v);
  }

  /* Compute a signal for a market given a strategy. Returns {side, reason} or null. */
  function evaluate(strategy, market, series, book) {
    const pts = (series || []).filter((p) => p.y > 0);
    if (pts.length < 8) return null;
    const last = pts[pts.length - 1].y;

    if (strategy.id === "momentum") {
      const m = mean(pts.slice(-20).map((p) => p.y));
      if (last > m + 0.02 && last < 0.9) return { side: "buy_yes", reason: "price above recent mean" };
      return null;
    }
    if (strategy.id === "meanrev") {
      const m = mean(pts.slice(-20).map((p) => p.y));
      const s = std(pts.slice(-20).map((p) => p.y));
      if (last < m - s && last < 0.9) return { side: "buy_yes", reason: "price below mean by >1sd" };
      return null;
    }
    if (strategy.id === "value") {
      const m = mean(pts.map((p) => p.y));
      if (last < m * 0.9 && last < 0.9) return { side: "buy_yes", reason: "price below topic avg value" };
      return null;
    }
    if (strategy.id === "liquidity") {
      const bestBid = book && book.yes && book.yes.length ? book.yes[book.yes.length - 1][1] : 0;
      if (bestBid >= 25 && last < 0.9) return { side: "buy_yes", reason: "deep YES book (>=25)" };
      return null;
    }
    return null;
  }

  class StrategyEngine {
    constructor() {
      this.running = false;
      this.timer = null;
      this.configs = STRATEGIES.map((s) => ({ ...s }));
    }

    setStrategyEnabled(id, enabled) {
      const s = this.configs.find((x) => x.id === id);
      if (s) s.enabled = enabled;
    }

    strategies() { return this.configs.slice(); }

    /* One evaluation pass over all tracked markets. */
    step() {
      const store = global.KD_store;
      const markets = store.state.markets;
      const series = store.state.series;
      const books = store.state.books;
      const trades = store.state.trades;
      const openByMarket = {};
      trades.filter((t) => t.status === "open").forEach((t) => {
        (openByMarket[t.ticker] = openByMarket[t.ticker] || []).push(t);
      });

      this.configs.forEach((strat) => {
        if (!strat.enabled) return;
        Object.keys(markets).forEach((ticker) => {
          const m = markets[ticker];
          if (m.resolved || m.status !== "open") return;
          if (openByMarket[ticker] && openByMarket[ticker].length >= 3) return; // cap

          const sig = evaluate(strat, m, series[ticker], books[ticker]);
          if (!sig) return;

          const entry = m.last_price;
          if (!entry || entry <= 0 || entry >= 1) return;

          const trade = {
            id: uid(),
            strategy: strat.id,
            category: strat.category,
            topic: this.topicOf(m),
            ticker,
            title: m.title,
            side: sig.side,
            action: "buy",
            count: 10,
            entry_price: entry,
            cost_cents: Math.round(entry * 100) * 10,
            status: "open",
            reason: sig.reason,
            opened_at: Date.now(),
            closed_at: null,
            pnl: null,
            resolution: null,
          };
          store.addTrade(trade);
          openByMarket[ticker] = openByMarket[ticker] || [];
          openByMarket[ticker].push(trade);
        });
      });

      this._updateOpenPositions();
    }

    topicOf(market) {
      const found = CFG.TOPIC_ORDER.find((topic) =>
        (global.KD_store.state.topics[topic] || []).some((x) => x.ticker === market.ticker)
      );
      return found || "other";
    }

    /* Settle/close open paper trades: mark resolved events, and close trades on
       a take-profit / stop-loss using the live price. */
    _updateOpenPositions() {
      const store = global.KD_store;
      store.state.trades
        .filter((t) => t.status === "open")
        .forEach((t) => {
          const m = store.state.markets[t.ticker];
          if (!m) return;

          // Event resolved on Kalshi -> settle the paper trade at the outcome.
          if (m.resolved) {
            const res = m.resolution || m.result;
            const win = String(res).toLowerCase().includes("yes");
            t.status = "closed";
            t.closed_at = Date.now();
            t.resolution = res === "" ? "" : res;
            t.pnl = win ? (1 - t.entry_price) * t.count : -t.entry_price * t.count;
            store.updateTrade(t.id, { status: t.status, closed_at: t.closed_at, resolution: t.resolution, pnl: t.pnl });
            return;
          }

          // Take profit at 0.85 / stop loss at 0.15 relative to entry.
          const lp = m.last_price;
          if (lp === null || lp === undefined) return;
          if (lp >= 0.85 || lp <= 0.15) {
            t.status = "closed";
            t.closed_at = Date.now();
            t.pnl = (lp - t.entry_price) * t.count;
            t.exit_price = lp;
            store.updateTrade(t.id, { status: t.status, closed_at: t.closed_at, pnl: t.pnl, exit_price: lp });
          }
        });
    }

    start(intervalMs = 20000) {
      if (this.running) return;
      this.running = true;
      this.timer = setInterval(() => this.step(), intervalMs);
    }
    stop() {
      this.running = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }

    /* Performance summary grouped by strategy category and topic. */
    performance() {
      const trades = global.KD_store.allTrades().filter((t) => t.status === "closed" && t.pnl !== null);
      const byCategory = {};
      const byTopic = {};
      const byStrategy = {};
      let total = 0, wins = 0, realized = 0;
      trades.forEach((t) => {
        total += t.count;
        realized += t.pnl;
        if (t.pnl > 0) wins += 1;
        const c = byCategory[t.category] || (byCategory[t.category] = { trades: 0, wins: 0, pnl: 0 });
        c.trades += 1; c.pnl += t.pnl; if (t.pnl > 0) c.wins += 1;
        const tp = byTopic[t.topic] || (byTopic[t.topic] = { trades: 0, wins: 0, pnl: 0 });
        tp.trades += 1; tp.pnl += t.pnl; if (t.pnl > 0) tp.wins += 1;
        const st = byStrategy[t.strategy] || (byStrategy[t.strategy] = { trades: 0, wins: 0, pnl: 0 });
        st.trades += 1; st.pnl += t.pnl; if (t.pnl > 0) st.wins += 1;
      });
      return {
        totalTrades: trades.length,
        totalContracts: total,
        wins,
        winRate: trades.length ? wins / trades.length : 0,
        realizedPnl: realized,
        byCategory,
        byTopic,
        byStrategy,
      };
    }

    reset() {
      const store = global.KD_store;
      store.state.trades = [];
      store.notify();
    }
  }

  global.KD_strategy = { engine: new StrategyEngine(), STRATEGIES };
})(window);
