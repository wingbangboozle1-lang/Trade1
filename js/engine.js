/* Kalshi demo dashboard engine.
   Reads PUBLIC market data from the Kalshi demo REST API (no credentials). Runs the
   alerting feeds, the heuristic ROI screen, orderbook depth sampling, price samples for
   charts, and a local paper-trade strategy engine. Live account execution is NOT performed
   (it requires a demo API key); see the Flagged for Review page. */
(function () {
  "use strict";

  var STORE = "kalshi.demo.v1";

  var DEFAULTS = {
    apiBases: [
      "https://external-api.demo.kalshi.co/trade-api/v2",
      "https://demo-api.kalshi.co/trade-api/v2"
    ],
    pollMs: 20000,          // full market poll interval
    settledPollMs: 60000,   // settled-market poll interval
    threshold: 0.10,        // swing size that triggers an alert (dollars)
    dedupeMs: 60000,        // min gap before re-alerting the same ticker/direction
    maxWindowMs: 6 * 3600e3,// keep at most 6h of price samples
    roiThreshold: 1.5,      // potential ROI needed to qualify as "high ROI"
    minLiquidity: 100,      // min contracts at best YES ask to qualify
    maxOpenPositions: 20,
    startCash: 10000,
    maxSettled: 300,
    maxAlerts: 300
  };

  var TOPICS = {
    "Gas prices": ["gas", "gasoline", "fuel", "oil price", "petrol", "diesel", "cng", "energy price"],
    "Elections": ["election", "president", "senate", "governor", "congress", "vote", "primary", "candidate", "inauguration"],
    "Culture": ["culture", "music", "movie", "film", "celebrity", "award", "oscar", "grammy", "tv", "television", "entertainment", "concert", "album", "show"],
    "Crypto": ["crypto", "bitcoin", "ethereum", "btc", "eth", "solana", "dogecoin", "ether", "blockchain", "coin"],
    "Golf": ["golf", "pga", "lpga", "masters", "ryder cup", "tournament", "fairway", "birdie"]
  };
  var TOPIC_KEYS = Object.keys(TOPICS);

  function num(v) {
    if (v === undefined || v === null || v === "") return null;
    var n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function str(v) { return v === undefined || v === null ? "" : String(v); }
  function pick(obj) { for (var i = 1; i < arguments.length; i++) { var k = arguments[i]; if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k]; } return null; }

  function loadStore() {
    try { var d = JSON.parse(localStorage.getItem(STORE) || "{}"); return d; }
    catch (e) { return {}; }
  }
  function saveStore(d) { try { localStorage.setItem(STORE, JSON.stringify(d)); } catch (e) {} }

  var Engine = {
    config: Object.assign({}, DEFAULTS),
    state: {
      base: null,
      connected: false,
      lastError: "",
      markets: [],        // all open markets from last poll
      byTicker: {},       // ticker -> market
      topicMatches: [],   // markets matching any of the 5 topics
      alerts: [],         // all >=$0.10 move messages
      roiAlerts: [],      // high-ROI subset messages
      roiWatch: {},       // ticker -> last roi score (for crossing detection)
      samples: {},        // ticker -> [{t,p}]
      lastPrice: {},      // ticker -> last yes_bid
      lastMove: {},       // ticker -> {dir, delta, t}
      lastAlertAt: {},    // ticker -> ts
      orderbooks: {},     // ticker -> {yes:[{p,c}], no:[{p,c}], ts}
      selected: null,
      positions: [],
      history: [],
      settled: [],
      cash: DEFAULTS.startCash,
      topic: "All"
    },
    timer: null,
    settledTimer: null,
    strategyFlags: { Momentum: true, MeanReversion: true, Value: true }
  };

  Engine.configure = function (cfg) { Object.assign(Engine.config, cfg || {}); };
  Engine.setTopic = function (t) { Engine.state.topic = t; };

  /* ---- classification (keyword heuristic, flagged) ---- */
  var RE_CACHE = {};
  function termRe(term) {
    if (!RE_CACHE[term]) {
      var escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      RE_CACHE[term] = new RegExp("\\b" + escaped + "\\b");
    }
    return RE_CACHE[term];
  }
  function cleanTicker(t) { return str(t).toLowerCase().replace(/^kx/, ""); }
  Engine.classify = function (m) {
    var hay = (str(m.title) + " " + str(m.subtitle) + " " + str(m.yes_sub_title) +
      " " + str(m.no_sub_title)).toLowerCase();
    var tickHay = (cleanTicker(m.event_ticker) + " " + cleanTicker(m.series_ticker)).toLowerCase();
    for (var i = 0; i < TOPIC_KEYS.length; i++) {
      var terms = TOPICS[TOPIC_KEYS[i]];
      for (var j = 0; j < terms.length; j++) {
        var term = terms[j];
        if (term.indexOf(" ") !== -1) { if (hay.indexOf(term) !== -1) return TOPIC_KEYS[i]; }
        else if (termRe(term).test(hay) || termRe(term).test(tickHay)) return TOPIC_KEYS[i];
      }
    }
    return null;
  };
  Engine.topicKeys = TOPIC_KEYS;

  /* ---- API fetch with host fallback ---- */
  Engine.fetchJson = async function (path) {
    var bases = Engine.config.apiBases.slice();
    var bases_ordered = (Engine.state.base ? [Engine.state.base].concat(bases.filter(function (b) { return b !== Engine.state.base; })) : bases);
    var lastErr = "";
    for (var i = 0; i < bases_ordered.length; i++) {
      try {
        var r = await fetch(bases_ordered[i] + path, { cache: "no-store" });
        if (!r.ok) { lastErr = "HTTP " + r.status; continue; }
        Engine.state.base = bases_ordered[i];
        return await r.json();
      } catch (e) { lastErr = e && e.message ? e.message : "network/CORS"; }
    }
    throw new Error(lastErr || "unreachable");
  };

  Engine.normalize = function (m) {
    return {
      ticker: str(m.ticker),
      event_ticker: str(m.event_ticker),
      market_type: str(m.market_type),
      title: str(m.title),
      subtitle: str(m.subtitle),
      yes_sub_title: str(m.yes_sub_title),
      no_sub_title: str(m.no_sub_title),
      status: str(m.status),
      yes_bid: num(pick(m, "yes_bid_dollars")),
      yes_ask: num(pick(m, "yes_ask_dollars")),
      no_bid: num(pick(m, "no_bid_dollars")),
      no_ask: num(pick(m, "no_ask_dollars")),
      yes_bid_size: num(pick(m, "yes_bid_size_fp")),
      yes_ask_size: num(pick(m, "yes_ask_size_fp")),
      last_price: num(pick(m, "last_price_dollars")),
      prev_yes_bid: num(pick(m, "previous_yes_bid_dollars")),
      volume: num(pick(m, "volume_fp")),
      volume_24h: num(pick(m, "volume_24h_fp")),
      open_interest: num(pick(m, "open_interest_fp")),
      notional: num(pick(m, "notional_value_dollars")),
      result: str(m.result) || "",
      settlement_value: num(pick(m, "settlement_value_dollars")),
      settlement_ts: str(pick(m, "settlement_ts")),
      close_time: str(pick(m, "close_time")),
      rules: str(pick(m, "rules_primary")),
      series_ticker: str(m.series_ticker)
    };
  };

  /* derived dollar-volume estimate (NOT an official field) */
  Engine.estDollarVolume = function (m) {
    var v = m.volume, n = m.notional;
    if (v === null || n === null) return null;
    return v * n;
  };

  /* ---- poll open markets ---- */
  Engine.poll = async function () {
    try {
      var d = await Engine.fetchJson("/markets?status=open&limit=1000");
      var list = (d.markets || []).map(Engine.normalize);
      var by = {};
      for (var i = 0; i < list.length; i++) by[list[i].ticker] = list[i];
      Engine.state.markets = list;
      Engine.state.byTicker = by;
      Engine.state.topicMatches = list.filter(function (m) { return Engine.classify(m); });
      Engine.state.connected = true;
      Engine.state.lastError = "";
      Engine.detectMoves();
      Engine.evaluateTrades();
      Engine.settlePositions();
      Engine.refreshROIWatch();
      Engine.notify();
    } catch (e) {
      Engine.state.connected = false;
      Engine.state.lastError = e && e.message ? e.message : "unreachable";
      Engine.notify();
    }
  };

  /* ---- poll settled markets (for resolution tracking) ---- */
  Engine.pollSettled = async function () {
    try {
      var d = await Engine.fetchJson("/markets?status=settled&limit=1000");
      var list = (d.markets || []).map(Engine.normalize).filter(function (m) { return Engine.classify(m); });
      var have = {};
      for (var i = 0; i < Engine.state.settled.length; i++) have[Engine.state.settled[i].ticker] = true;
      for (var j = 0; j < list.length; j++) {
        if (!have[list[j].ticker]) {
          Engine.state.settled.unshift({
            ticker: list[j].ticker,
            title: list[j].title,
            event_ticker: list[j].event_ticker,
            topic: Engine.classify(list[j]),
            result: list[j].result,
            settlement_value: list[j].settlement_value,
            settlement_ts: list[j].settlement_ts,
            close_time: list[j].close_time
          });
        }
      }
      if (Engine.state.settled.length > Engine.config.maxSettled) Engine.state.settled.length = Engine.config.maxSettled;
    } catch (e) { /* settled poll is best-effort */ }
  };

  /* ---- swing detection + alert feeds ---- */
  Engine.detectMoves = function () {
    var matches = Engine.state.topicMatches;
    var now = Date.now();
    var all = Engine.state.alerts, roi = Engine.state.roiAlerts;
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var bid = m.yes_bid;
      if (bid === null) continue;
      var prev = Engine.state.lastPrice[m.ticker];
      // seed last price without alerting
      if (prev === undefined) { Engine.state.lastPrice[m.ticker] = bid; continue; }
      var delta = bid - prev;
      Engine.state.lastPrice[m.ticker] = bid;
      if (Math.abs(delta) >= Engine.config.threshold) {
        var dir = delta > 0 ? "up" : "down";
        var at = Engine.state.lastAlertAt[m.ticker] || 0;
        if (now - at >= Engine.config.dedupeMs) {
          Engine.state.lastAlertAt[m.ticker] = now;
          Engine.state.lastMove[m.ticker] = { dir: dir, delta: delta, t: now };
          var msg = {
            t: now, dir: dir, delta: delta, ticker: m.ticker,
            title: m.title, event_ticker: m.event_ticker, topic: Engine.classify(m),
            from: prev, to: bid,
            url: Engine.marketUrl(m)
          };
          all.unshift(msg);
          if (all.length > Engine.config.maxAlerts) all.length = Engine.config.maxAlerts;
          var ro = Engine.roiScore(m);
          if (ro.high) {
            roi.unshift(Object.assign({}, msg, { roi: ro.score, roiSide: ro.side, liquidity: ro.liquidity }));
            if (roi.length > Engine.config.maxAlerts) roi.length = Engine.config.maxAlerts;
          }
        }
      }
    }
  };

  /* ---- ROI screen (heuristic, flagged) ---- */
  Engine.roiScore = function (m) {
    var ya = m.yes_ask, na = m.no_ask;
    var liq = (m.yes_ask_size !== null ? m.yes_ask_size : (m.yes_bid_size || 0));
    var roiYes = (ya !== null && ya > 0 && ya < 1) ? (1 - ya) / ya : 0;
    var roiNo = (na !== null && na > 0 && na < 1) ? (1 - na) / na : 0;
    var side, score;
    if (roiYes >= roiNo) { side = "YES"; score = roiYes; } else { side = "NO"; score = roiNo; }
    return { score: score, side: side, liquidity: liq, high: score >= Engine.config.roiThreshold && liq >= Engine.config.minLiquidity };
  };

  /* surface newly-qualifying high-ROI markets (watchlist crossing) */
  Engine.refreshROIWatch = function () {
    var matches = Engine.state.topicMatches;
    var now = Date.now();
    var roi = Engine.state.roiAlerts;
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var ro = Engine.roiScore(m);
      var prev = Engine.state.roiWatch[m.ticker];
      Engine.state.roiWatch[m.ticker] = ro.score;
      if (ro.high && (!prev || prev < Engine.config.roiThreshold)) {
        roi.unshift({
          t: now, dir: "watch", delta: 0, ticker: m.ticker, title: m.title,
          event_ticker: m.event_ticker, topic: Engine.classify(m),
          from: m.yes_bid, to: m.yes_bid, url: Engine.marketUrl(m),
          roi: ro.score, roiSide: ro.side, liquidity: ro.liquidity, watch: true
        });
        if (roi.length > Engine.config.maxAlerts) roi.length = Engine.config.maxAlerts;
      }
    }
  };

  Engine.marketUrl = function (m) {
    var et = m.event_ticker || m.ticker;
    return "https://kalshi.com/markets/" + encodeURIComponent(et);
  };

  /* ---- orderbook depth (bids only; YES ask derived) ---- */
  Engine.fetchOrderbook = async function (ticker) {
    try {
      var d = await Engine.fetchJson("/markets/" + encodeURIComponent(ticker) + "/orderbook?depth=10");
      var ob = d.orderbook_fp || d.orderbook || {};
      var yes = (ob.yes_dollars || ob.yes || []).map(function (p) { return { p: num(p[0]), c: num(p[1]) }; }).filter(function (x) { return x.p !== null; });
      var no = (ob.no_dollars || ob.no || []).map(function (p) { return { p: num(p[0]), c: num(p[1]) }; }).filter(function (x) { return x.p !== null; });
      yes.sort(function (a, b) { return b.p - a.p; });   // best bid first
      no.sort(function (a, b) { return b.p - a.p; });     // best (highest) NO bid first
      Engine.state.orderbooks[ticker] = {
        yes: yes, no: no, ts: Date.now(),
        best_yes_bid: yes.length ? yes[0].p : null,
        best_no_bid: no.length ? no[0].p : null,
        implied_yes_ask: no.length ? 1 - no[0].p : null
      };
    } catch (e) { Engine.state.orderbooks[ticker] = null; }
    Engine.notify();
  };

  /* ---- price samples (for charts) ---- */
  Engine.recordSample = function (ticker, price) {
    if (price === null) return;
    var arr = Engine.state.samples[ticker] || (Engine.state.samples[ticker] = []);
    var now = Date.now();
    arr.push({ t: now, p: price });
    var cutoff = now - Engine.config.maxWindowMs;
    while (arr.length && arr[0].t < cutoff) arr.shift();
    if (arr.length > 2000) arr.splice(0, arr.length - 2000);
  };

  /* ---- paper-trade strategy engine ---- */
  Engine.loadTrades = function () {
    var s = loadStore();
    Engine.state.positions = s.positions || [];
    Engine.state.history = s.history || [];
    Engine.state.settled = s.settled || [];
    Engine.state.cash = (s.cash !== undefined ? s.cash : Engine.config.startCash);
  };
  Engine.persistTrades = function () {
    saveStore({
      positions: Engine.state.positions,
      history: Engine.state.history,
      settled: Engine.state.settled,
      cash: Engine.state.cash
    });
  };

  Engine.openPosition = function (m, side, ask, strategy, qty) {
    var cost = ask * qty;
    if (Engine.state.cash < cost) return false;
    Engine.state.positions.push({
      id: "P" + Date.now() + Math.floor(Math.random() * 1000),
      ticker: m.ticker, title: m.title, event_ticker: m.event_ticker, topic: Engine.classify(m),
      side: side, qty: qty, cost: ask, costTotal: cost, strategy: strategy,
      openedAt: Date.now()
    });
    Engine.state.cash -= cost;
    Engine.persistTrades();
    return true;
  };

  Engine.evaluateTrades = function () {
    if (!Engine.strategyFlags) return;
    if (Engine.state.positions.length >= Engine.config.maxOpenPositions) return;
    var matches = Engine.state.topicMatches;
    var open = {};
    for (var i = 0; i < Engine.state.positions.length; i++) open[Engine.state.positions[i].ticker] = true;
    for (var j = 0; j < matches.length; j++) {
      var m = matches[j];
      if (open[m.ticker]) continue;
      if (m.yes_ask === null || m.yes_ask <= 0) continue;
      var ro = Engine.roiScore(m);
      var move = Engine.state.lastMove[m.ticker];
      var nearClose = m.close_time && (new Date(m.close_time).getTime() - Date.now()) < 30 * 60e3;
      var qty = 1;
      if (Engine.strategyFlags.Value && m.yes_bid !== null && m.yes_bid <= 0.40 && ro.liquidity >= Engine.config.minLiquidity && !nearClose) {
        if (Engine.openPosition(m, "YES", m.yes_ask, "Value", qty)) continue;
      }
      if (move && Math.abs(move.delta) >= Engine.config.threshold) {
        if (Engine.strategyFlags.Momentum && move.dir === "up" && ro.score >= 1.0) {
          if (Engine.openPosition(m, "YES", m.yes_ask, "Momentum", qty)) continue;
        }
        if (Engine.strategyFlags.MeanReversion && move.dir === "up" && m.no_ask !== null && m.no_ask < 0.9) {
          if (Engine.openPosition(m, "NO", m.no_ask, "MeanReversion", qty)) continue;
        }
      }
    }
  };

  Engine.settlePositions = function () {
    var by = Engine.state.byTicker;
    var still = [];
    for (var i = 0; i < Engine.state.positions.length; i++) {
      var p = Engine.state.positions[i];
      var m = by[p.ticker];
      var resolved = false, settleValue = null, result = "";
      if (m) {
        if (m.status === "settled" || m.result === "yes" || m.result === "no") {
          resolved = true; result = m.result;
          settleValue = (m.settlement_value !== null ? m.settlement_value : (result === "yes" ? 1 : 0));
        }
      } else {
        var ev = Engine.state.settled.find(function (s) { return s.ticker === p.ticker; });
        if (ev && (ev.result === "yes" || ev.result === "no")) {
          resolved = true; result = ev.result;
          settleValue = (ev.settlement_value !== null ? ev.settlement_value : (result === "yes" ? 1 : 0));
        }
      }
      if (resolved) {
        var payout = (p.side === "YES" ? settleValue : (1 - settleValue)) * p.qty;
        var pnl = payout - p.costTotal;
        Engine.state.cash += payout;
        Engine.state.history.unshift({
          ticker: p.ticker, title: p.title, event_ticker: p.event_ticker, topic: p.topic,
          side: p.side, qty: p.qty, cost: p.cost, strategy: p.strategy,
          payout: payout, pnl: pnl, win: pnl > 0, result: result,
          settledAt: Date.now()
        });
        if (Engine.state.history.length > 500) Engine.state.history.length = 500;
      } else {
        still.push(p);
      }
    }
    if (still.length !== Engine.state.positions.length) {
      Engine.state.positions = still;
      Engine.persistTrades();
    }
  };

  Engine.clearTrades = function () {
    Engine.state.positions = []; Engine.state.history = []; Engine.state.settled = [];
    Engine.state.cash = Engine.config.startCash; Engine.persistTrades(); Engine.notify();
  };

  /* ---- chart sample helper: record for selected + tracked top markets ---- */
  Engine.recordSamples = function () {
    var matches = Engine.state.topicMatches.slice().sort(function (a, b) {
      return (b.volume || 0) - (a.volume || 0);
    }).slice(0, 60);
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      if (m.yes_bid !== null) Engine.recordSample(m.ticker, m.yes_bid);
    }
  };

  Engine.notify = function () {
    if (window.KalshiUI && typeof window.KalshiUI.onCycle === "function") {
      window.KalshiUI.onCycle();
    }
  };

  Engine.start = function () {
    Engine.loadTrades();
    Engine.poll();
    Engine.recordSamplesInterval();
    Engine.timer = setInterval(function () {
      Engine.poll().then(function () { Engine.recordSamples(); });
    }, Engine.config.pollMs);
    Engine.settledTimer = setInterval(Engine.pollSettled, Engine.config.settledPollMs);
    Engine.pollSettled();
  };
  Engine.recordSamplesInterval = function () {
    setInterval(Engine.recordSamples, Math.min(Engine.config.pollMs, 10000));
  };
  Engine.stop = function () {
    if (Engine.timer) clearInterval(Engine.timer);
    if (Engine.settledTimer) clearInterval(Engine.settledTimer);
    Engine.timer = null; Engine.settledTimer = null;
  };

  window.KalshiEngine = Engine;
})();
