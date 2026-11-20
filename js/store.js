/*
 * Dashboard store: holds live state, polls the Kalshi demo API, maintains price
 * series, detects sharp moves, and persists portfolio + simulated trades in
 * localStorage (so strategy results survive page reloads).
 */

(function (global) {
  "use strict";

  const CFG = global.KD_CONFIG;
  const CENTS_PER_DOLLAR = CFG.CENTS_PER_DOLLAR;

  const LS_KEY = "kd_state_v1";

  function defaultState() {
    return {
      connected: false,
      base: null,
      error: null,
      // market -> { ticker, title, event_ticker, category, series, yes_bid, yes_ask,
      //             last_price, volume, open_interest, close_ts, status, resolved, resolution }
      markets: {},
      // ticker -> [{t, y}] price series (dollars)
      series: {},
      // ticker -> orderbook {yes:[[price,count]], no:[[price,count]]}
      books: {},
      // ticker -> { sharp:[{t, delta, from, to}], link }
      sharpMoves: {},
      topics: { gas: [], elections: [], culture: [], crypto: [], golf: [] },
      // user portfolio snapshot from Kalshi (private)
      portfolio: { balance: null, positions: [], fetchedAt: null },
      // locally persisted simulated/paper trades + strategy results
      trades: [],
      strategies: [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      return Object.assign(defaultState(), s);
    } catch (_e) {
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (_e) { /* quota */ }
  }

  class Store {
    constructor() {
      this.state = load();
      this.client = null;
      this.pollTimer = null;
      this.listeners = [];
      this._sharpThreshold = CFG.SHARP_MOVE_THRESHOLD_DOLLARS;
      this.onChange = () => { this.listeners.forEach((fn) => fn(this.state)); };
    }

    subscribe(fn) {
      this.listeners.push(fn);
      fn(this.state);
      return () => { this.listeners = this.listeners.filter((f) => f !== fn); };
    }

    notify() { save(this.state); this.onChange(); }

    async init(client) {
      this.client = client;
      try {
        await client._probe();
        this.state.connected = client.connected;
        this.state.base = client.base;
        if (!client.connected) this.state.error = client.lastError ? client.lastError.message : "unreachable";
      } catch (e) {
        this.state.error = e.message;
      }
      this.notify();
      await this.refreshTopics();
      this.refreshMarkets();
    }

    /* Discover live series for each topic and pull their open markets. */
    async refreshTopics() {
      const topics = CFG.TOPIC_ORDER;
      for (const topic of topics) {
        try {
          const series = await this.client.discoverTopicSeries(topic);
          const tickers = series.map((s) => s.series_ticker).filter(Boolean);
          let markets = [];
          // Fetch open markets for this topic's series, newest/largest first.
          if (tickers.length) {
            try {
              markets = await this.client.getMarkets({
                series_ticker: tickers.join(","),
                status: "open",
                limit: 100,
              });
            } catch (_e) {
              markets = [];
            }
          }
          // Sort by dollar volume (highest first) — the task asks for the highest
          // dollar amount live events.
          markets.sort((a, b) => (b.volume_fp || 0) - (a.volume_fp || 0));
          this.state.topics[topic] = markets.slice(0, 40);
        } catch (e) {
          this.state.topics[topic] = [];
        }
      }
      this.notify();
    }

    /* Refresh a set of markets' tickers (public fields + orderbook). */
    async refreshMarkets(tickers) {
      const list = tickers || this.allTrackedTickers();
      const tasks = list.map((ticker) => this.refreshMarket(ticker));
      await Promise.all(tasks);
    }

    allTrackedTickers() {
      const set = new Set();
      CFG.TOPIC_ORDER.forEach((topic) =>
        (this.state.topics[topic] || []).forEach((m) => set.add(m.ticker))
      );
      Object.keys(this.state.markets).forEach((t) => set.add(t));
      return Array.from(set);
    }

    async refreshMarket(ticker) {
      if (!this.client || !this.client.connected) return;
      try {
        const [market, book] = await Promise.all([
          this.client.getMarket(ticker),
          this.client.getOrderbook(ticker, 0).catch(() => null),
        ]);
        if (!market) return;
        const prev = this.state.markets[ticker];
        const last = market.last_price !== undefined && market.last_price !== null
          ? market.last_price / CENTS_PER_DOLLAR
          : (prev ? prev.last_price : null);

        this.state.markets[ticker] = {
          ticker,
          title: market.title || ticker,
          event_ticker: market.event_ticker || "",
          category: market.category || "",
          series: market.series_ticker || "",
          yes_bid: market.yes_bid !== undefined ? market.yes_bid / CENTS_PER_DOLLAR : null,
          yes_ask: market.yes_ask !== undefined ? market.yes_ask / CENTS_PER_DOLLAR : null,
          no_bid: market.no_bid !== undefined ? market.no_bid / CENTS_PER_DOLLAR : null,
          no_ask: market.no_ask !== undefined ? market.no_ask / CENTS_PER_DOLLAR : null,
          last_price: last,
          volume: market.volume_fp !== undefined ? market.volume_fp : market.volume,
          open_interest: market.open_interest_fp !== undefined ? market.open_interest_fp : (market.open_interest || 0),
          close_ts: market.close_ts || null,
          status: market.status || "open",
          resolved: market.status === "settled",
          settlement: market.settlement || (prev ? prev.settlement : null),
          result: market.result || (prev ? prev.result : null),
        };

        // orderbook
        if (book) {
          const yes = book.yes || book.yes_dollars || [];
          const no = book.no || book.no_dollars || [];
          const norm = (arr) => (arr || []).map(([p, c]) => [
            typeof p === "number" && p < 1 ? p : p / CENTS_PER_DOLLAR,
            c,
          ]);
          this.state.books[ticker] = { yes: norm(yes), no: norm(no) };
        }

        // resolution tracking: mark resolved yes/no
        if (market.status === "settled" && !prev.resolved) {
          this.markResolved(ticker, market);
        }

        // price series + sharp move detection
        if (last !== null && last !== undefined) {
          const arr = this.state.series[ticker] || [];
          arr.push({ t: Date.now(), y: last });
          if (arr.length > 2000) arr.splice(0, arr.length - 2000);
          this.state.series[ticker] = arr;

          if (prev && prev.last_price !== null && prev.last_price !== undefined) {
            const delta = last - prev.last_price;
            if (Math.abs(delta) >= this._sharpThreshold) {
              this.state.sharpMoves[ticker] = this.state.sharpMoves[ticker] || [];
              this.state.sharpMoves[ticker].push({
                t: Date.now(),
                delta,
                from: prev.last_price,
                to: last,
              });
              if (this.state.sharpMoves[ticker].length > 50) this.state.sharpMoves[ticker].shift();
            }
          }
        }
      } catch (e) {
        // leave market untouched; network errors are surfaced by connected flag
      }
    }

    markResolved(ticker, market) {
      const m = this.state.markets[ticker];
      if (!m) return;
      m.resolved = true;
      // Kalshi settled markets carry a result/outcome; derive yes/no where possible.
      const res = market.result || market.settlement || null;
      m.result = res;
      m.settlement = res;
      m.resolution = this.normalizeResolution(res, market);
    }

    /* Normalize a Kalshi settlement into a clear yes/no for the resolution column. */
    normalizeResolution(res, market) {
      if (res === true) return "yes";
      if (res === false) return "no";
      // Some markets return an outcome string or a cents value.
      if (res === undefined || res === null) {
        const lp = market.last_price;
        if (lp === undefined || lp === null) return "";
        return lp >= 50 ? "yes" : "no"; // last price >= 50c => YES settled
      }
      if (typeof res === "number") return res >= 50 ? "yes" : "no";
      const s = String(res).toLowerCase();
      if (s.includes("yes")) return "yes";
      if (s.includes("no")) return "no";
      return s || "";
    }

    /* Poll loop. */
    startPolling(intervalMs = 15000) {
      this.stopPolling();
      this.pollTimer = setInterval(() => {
        if (this.client && this.client.connected) this.refreshMarkets();
      }, intervalMs);
    }
    stopPolling() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    /* ---------- portfolio / trades ---------- */

    async refreshPortfolio() {
      if (!this.client || !this.client.connected || !this.client.keyId) {
        this.state.error = "Set Kalshi demo API key + private key to load the live portfolio.";
        this.notify();
        return;
      }
      try {
        const [balance, positions] = await Promise.all([
          this.client.getBalance(),
          this.client.getPositions({ status: "open" }),
        ]);
        this.state.portfolio = {
          balance: balance,
          positions: positions || [],
          fetchedAt: Date.now(),
        };
      } catch (e) {
        this.state.error = "Portfolio load failed: " + e.message;
      }
      this.notify();
    }

    addTrade(trade) {
      this.state.trades.unshift(trade);
      this.notify();
    }
    updateTrade(id, patch) {
      const t = this.state.trades.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
      this.notify();
    }
    allTrades() { return this.state.trades; }
  }

  global.KD_store = new Store();
})(window);
