/* Trade1 — store.js — localStorage persistence (watchlist, history, jumps, paper portfolio).
 * Browser-local by design; nothing leaves the browser except direct calls to the Kalshi demo API.
 */
"use strict";

(function () {
  const PREFIX = "trade1:v1:";

  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function remove(key) { try { localStorage.removeItem(PREFIX + key); } catch (e) {} }

  // ---- generic cached objects with TTL (e.g. series metadata) ----
  function getCache(key, ttlMs, fallback) {
    const box = get(key, null);
    if (box && box.ts && Date.now() - box.ts < ttlMs && box.data) return box.data;
    return fallback;
  }
  function setCache(key, data) { set(key, { ts: Date.now(), data }); }

  // ---- watchlist: every market ever shown, so resolution tracking survives reloads ----
  function watchlist() { return get("watchlist", {}); } // ticker -> {ticker, event_ticker, series_ticker, title, topic, first_seen}
  function addWatch(m, topic) {
    const w = watchlist();
    if (!w[m.ticker]) {
      w[m.ticker] = { ticker: m.ticker, event_ticker: m.event_ticker, series_ticker: (m.ticker.split("-")[0] || ""),
        title: m.title || "", subtitle: m.subtitle || "", topic: topic || "", first_seen: Date.now() };
      set("watchlist", w);
    }
  }
  function removeWatch(ticker) { const w = watchlist(); delete w[ticker]; set("watchlist", w); }

  // ---- per-market polled price history (seconds granularity) ----
  function history(ticker) { return get("hist:" + ticker, []); }
  function pushHistory(ticker, t, price) {
    const h = history(ticker);
    h.push([t, price]);
    while (h.length > T1.LIMITS.historyPoints) h.shift();
    set("hist:" + ticker, h);
  }

  // ---- jump log (≥ $0.10 moves) ----
  function jumps() { return get("jumps", []); }
  function addJump(j) {
    const js = jumps();
    js.unshift(j);
    while (js.length > T1.LIMITS.jumpLog) js.pop();
    set("jumps", js);
  }
  function clearJumps() { remove("jumps"); }

  // ---- paper portfolio ----
  function paper() {
    return get("paper", {
      created: Date.now(),
      cash: T1.PAPER_BANKROLL,
      positions: {},      // ticker -> {side:'yes'|'no', contracts, cost, fees, entryPrice, entryTs, market:{...}}
      trades: [],         // closed trade records
      openLog: [],        // open events (buys/sells as they happen)
      equity: [],         // [ts, equity]
      strategyState: {},  // per-market strategy scratch
      lastResolutionCheck: 0,
      realized: 0, feesPaid: 0, wins: 0, losses: 0,
    });
  }
  function setPaper(p) { return set("paper", p); }
  function resetPaper() {
    remove("paper");
    return paper();
  }
  function paperEquityPush(ts, eq) {
    const p = paper();
    p.equity.push([ts, eq]);
    while (p.equity.length > 2000) p.equity.shift();
    setPaper(p);
  }

  // ---- settings ----
  function settings() {
    return get("settings", { enabled: false, strategies: {}, tracking: {} });
  }
  function setSettings(s) { set("settings", s); }

  window.Store = {
    get, set, remove,
    getCache, setCache,
    watchlist, addWatch, removeWatch,
    history, pushHistory,
    jumps, addJump, clearJumps,
    paper, setPaper, resetPaper, paperEquityPush,
    settings, setSettings,
    exportAll() {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = get(k.slice(PREFIX.length), null);
      }
      return out;
    },
  };
})();
