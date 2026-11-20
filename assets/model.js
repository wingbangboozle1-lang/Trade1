/* Trade1 — strategy model, ROI scoring, and the simulated (paper) broker.
 *
 * Everything in this file is local-only: no orders are sent to Kalshi, no
 * account is contacted, nothing leaves the browser. Paper fills are assumed
 * at the official bid/ask quotes with no slippage; see methods.html for the
 * documented assumptions and flagged.html for limitations (fees are OFF by
 * default because no fee schedule was verified from an official source
 * during this session).
 *
 * Topic classification mirrors scripts/topics.json (authoritative for the
 * data/ snapshots). The two MUST be kept in sync — flagged in flagged.html.
 */
window.KalshiModel = (function () {
  'use strict';

  /* ---------- persistence ---------- */
  var NS = 'kalshiDemo.v2.';
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(NS + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(NS + key, JSON.stringify(val)); }
    catch (e) { /* quota exceeded — drop silently, state stays in memory */ }
  }

  var DEFAULT_BOT = {
    enabled: true,
    bank: 1000,            // virtual starting bankroll, USD
    perTradeDollars: 25,   // target cost per paper trade
    maxPositions: 8,
    fees: false,           // UNVERIFIED fee schedule — off by default (flagged)
    strategies: {
      momentum:  { on: true, holdMin: 15, takeProfit: 0.15, stopLoss: 0.10, minScore: 0.45, maxSpread: 0.06 },
      fade:      { on: true, holdMin: 10, takeProfit: 0.08, stopLoss: 0.08, maxSpread: 0.04, minVol24h: 100 },
      harvest:   { on: true, minPrice: 0.90, maxSpread: 0.03, maxCloseHours: 72 },
      breakout:  { on: true, minVol24h: 500, maxSpread: 0.05, holdMin: 30, takeProfit: 0.12, stopLoss: 0.10 }
    }
  };

  var state = {
    trades: load('trades', []),
    alerts: load('alerts', []),
    resolved: load('resolved', {}),   // ticker -> {result, settlement_ts, event, title, topic}
    equity: load('equity', []),       // [{t, equity, cash}]
    bot: Object.assign({}, DEFAULT_BOT, load('bot', {})),
    crossed50: load('crossed50', {}), // breakout state per ticker: 'above'|'below'
    harvestCool: load('harvestCool', {}) // ticker -> last harvest entry ms
  };
  if (!state.bot.strategies) state.bot.strategies = JSON.parse(JSON.stringify(DEFAULT_BOT.strategies));

  /* ---------- topic classification (mirror of scripts/topics.json) ---------- */
  var TOPICS = [
    { id: 'gas-prices', label: 'Gas prices', categories: ['Economics', 'Energy'],
      titleRe: 'gasoline|gas price|gas prices|average gas|fuel price|petrol',
      exclRe: 'natural gas|natgas|propane|heating oil', seriesRe: '^(KX)?(GAS|FUEL)' },
    { id: 'elections', label: 'Elections', categories: ['Elections'],
      titleRe: '', exclRe: '', seriesRe: '^(KX)?(ELECT|SEN|HOUSE|GOV|PRES|MAYOR)' },
    { id: 'culture', label: 'Culture', categories: ['Culture', 'Entertainment', 'Mentions', 'Music', 'Movies', 'TV', 'Pop Culture'],
      titleRe: '', exclRe: '', seriesRe: '' },
    { id: 'crypto', label: 'Crypto', categories: ['Crypto'],
      titleRe: '', exclRe: '', seriesRe: '^(KX)?(BTC|ETH|SOL|XRP|DOGE|CRYPTO|BITCOIN|ETHEREUM|DEMOFUT)' },
    { id: 'golf', label: 'Golf', categories: ['Sports'],
      titleRe: 'golf', exclRe: '', seriesRe: '^(KX)?(GOLF|PGA|LPGA|RYDER|DPWORLD)' }
  ];

  function classify(category, title, series) {
    var hay = (title || '') + ' ' + (series || '');
    for (var i = 0; i < TOPICS.length; i++) {
      var t = TOPICS[i];
      if (t.exclRe && new RegExp(t.exclRe, 'i').test(hay)) continue;
      if (category && t.categories.indexOf(category) !== -1) {
        if (!t.titleRe || new RegExp(t.titleRe, 'i').test(title || '')) return t.id;
      }
      if (t.seriesRe && new RegExp(t.seriesRe, 'i').test(series || '')) return t.id;
    }
    return null;
  }

  /* ---------- ROI score for the "model picks" chat ----------
   * Documented heuristic (methods.html). Inputs are official market fields:
   *   vol24   = volume_24h_fp (contracts, exchange-reported)
   *   vol     = volume_fp (contracts, exchange-reported)
   *   spread  = yes_ask - yes_bid (exchange quotes)
   *   |delta| = sampled price move that triggered the alert (>= $0.10)
   * score = 0.30*min(vol24/2000,1) + 0.25*min(vol/10000,1)
   *       + 0.20*max(0,1-spread/0.15) + 0.25*min(|delta|/0.25,1)
   * Alerts with score >= minScore (default 0.45) go to the model chat.
   * This is a heuristic screen, NOT verified predictive alpha (flagged). */
  function score(delta, m) {
    var vol24 = Number(m.volume_24h_fp || m.volume_24h || 0);
    var vol = Number(m.volume_fp || m.volume || 0);
    var spread = (Number(m.yes_ask_dollars) - Number(m.yes_bid_dollars));
    if (!isFinite(spread)) spread = 0.99;
    var s = 0.30 * Math.min(vol24 / 2000, 1)
          + 0.25 * Math.min(vol / 10000, 1)
          + 0.20 * Math.max(0, 1 - spread / 0.15)
          + 0.25 * Math.min(Math.abs(delta) / 0.25, 1);
    return Math.round(s * 1000) / 1000;
  }

  /* ---------- fee (OFF by default; UNVERIFIED schedule — flagged) ---------- */
  function fee(costPerContract, qty) {
    if (!state.bot.fees) return 0;
    var p = costPerContract;
    return Math.ceil(0.07 * qty * p * (1 - p) * 100) / 100;
  }

  /* ---------- broker ---------- */
  var cash = load('cash', state.bot.bank);
  function persistAll() {
    save('trades', state.trades.slice(-400));
    save('alerts', state.alerts.slice(-300));
    save('resolved', state.resolved);
    save('equity', state.equity.slice(-1200));
    save('bot', state.bot);
    save('cash', cash);
    save('crossed50', state.crossed50);
    save('harvestCool', state.harvestCool);
  }

  function bidAsk(m, side) {
    var bid = side === 'yes' ? Number(m.yes_bid_dollars) : Number(m.no_bid_dollars);
    var ask = side === 'yes' ? Number(m.yes_ask_dollars) : Number(m.no_ask_dollars);
    return { bid: isFinite(bid) ? bid : null, ask: isFinite(ask) ? ask : null };
  }

  function openPositions() { return state.trades.filter(function (t) { return t.status === 'open'; }); }

  function tryEnter(m, side, strategy, qtyOverride, note) {
    var bot = state.bot;
    if (!bot.enabled) return false;
    if (openPositions().length >= bot.maxPositions) return false;
    var openSame = openPositions().some(function (t) { return t.ticker === m.ticker && t.strategy === strategy; });
    if (openSame) return false;
    var ba = bidAsk(m, side);
    if (ba.ask === null || ba.ask < 0.05 || ba.ask > 0.95) return false; // unfillable edges
    var qty = qtyOverride || Math.max(1, Math.floor(bot.perTradeDollars / ba.ask));
    var cost = qty * ba.ask;
    if (cost > cash) { qty = Math.floor(cash / ba.ask); cost = qty * ba.ask; }
    if (qty < 1) return false;
    cash = Math.round((cash - cost) * 10000) / 10000;
    state.trades.push({
      id: Date.now() + ':' + Math.random().toString(36).slice(2, 7),
      t: new Date().toISOString(), ticker: m.ticker, event_ticker: m.event_ticker,
      title: m.title, topic: m._topic || null, side: side, qty: qty,
      entry: ba.ask, strategy: strategy, status: 'open', mark: ba.bid,
      note: note || ''
    });
    persistAll();
    return true;
  }

  function closeTrade(t, price, reason, when) {
    var proceeds = t.qty * price;
    var f = fee(price, t.qty);
    cash = Math.round((cash + proceeds - f) * 10000) / 10000;
    t.status = 'closed';
    t.exit = { t: when || new Date().toISOString(), price: price, reason: reason, fee: f };
    t.pnl = Math.round((t.qty * (price - t.entry) - f) * 10000) / 10000;
    persistAll();
  }

  function settle(t, result, when) {
    var payout = (t.side === result) ? 1 : 0;
    cash = Math.round((cash + t.qty * payout) * 10000) / 10000;
    t.status = 'settled';
    t.exit = { t: when || new Date().toISOString(), price: payout, reason: 'settlement (' + result + ')' };
    t.pnl = Math.round(t.qty * (payout - t.entry) * 10000) / 10000;
    persistAll();
  }

  /* Manage exits for one market snapshot. Called every poll cycle. */
  function manage(ticker, m, now) {
    var bot = state.bot, st = bot.strategies;
    state.trades.forEach(function (t) {
      if (t.status !== 'open' || t.ticker !== ticker) return;
      var ba = bidAsk(m, t.side);
      if (ba.bid === null) return;
      t.mark = ba.bid;
      var cfg = st[t.strategy] || {};
      var heldMin = (now - new Date(t.t).getTime()) / 60000;
      var pl = ba.bid - t.entry;
      if (cfg.takeProfit !== undefined && pl >= cfg.takeProfit) return closeTrade(t, ba.bid, 'take-profit');
      if (cfg.stopLoss !== undefined && pl <= -cfg.stopLoss) return closeTrade(t, ba.bid, 'stop-loss');
      if (cfg.holdMin !== undefined && heldMin >= cfg.holdMin) return closeTrade(t, ba.bid, 'time-exit');
    });
  }

  /* Strategy entries, evaluated per poll cycle. `newAlerts` = alerts since last
   * cycle [{ticker, delta, dir}]; `markets` = live map ticker -> market. */
  var cycle = 0;
  function runStrategies(newAlerts, markets, now) {
    var bot = state.bot, st = bot.strategies;
    if (!bot.enabled) return [];
    var acted = [];
    (newAlerts || []).forEach(function (a) {
      var m = markets[a.ticker];
      if (!m || !m._topic) return;
      var spread = Number(m.yes_ask_dollars) - Number(m.yes_bid_dollars);
      var vol24 = Number(m.volume_24h_fp || 0);
      if (st.momentum.on && score(a.delta, m) >= st.momentum.minScore && spread <= st.momentum.maxSpread) {
        var side = a.dir === 'up' ? 'yes' : 'no';
        if (tryEnter(m, side, 'momentum')) acted.push({ ticker: a.ticker, strategy: 'momentum', side: side });
      } else if (st.fade.on && score(a.delta, m) < st.momentum.minScore
                 && spread <= st.fade.maxSpread && vol24 >= st.fade.minVol24h) {
        var sideF = a.dir === 'up' ? 'no' : 'yes';
        if (tryEnter(m, sideF, 'fade')) acted.push({ ticker: a.ticker, strategy: 'fade', side: sideF });
      }
    });
    // scan strategies (every cycle for breakout, every 5th for harvest to save CPU)
    var scan = markets.list || [];
    scan.forEach(function (m) {
      if (!m._topic) return;
      var spread = Number(m.yes_ask_dollars) - Number(m.yes_bid_dollars);
      var vol24 = Number(m.volume_24h_fp || 0);
      var last = Number(m.last_price_dollars);
      if (st.breakout.on) {
        var prev = state.crossed50[m.ticker];
        if (prev === undefined && isFinite(last)) {
          state.crossed50[m.ticker] = last >= 0.50 ? 'above' : 'below';
        } else if (isFinite(last) && prev && prev !== (last >= 0.50 ? 'above' : 'below')) {
          state.crossed50[m.ticker] = last >= 0.50 ? 'above' : 'below';
          if (vol24 >= st.breakout.minVol24h && spread <= st.breakout.maxSpread
              && last >= 0.05 && last <= 0.95) {
            if (tryEnter(m, last >= 0.50 ? 'yes' : 'no', 'breakout'))
              acted.push({ ticker: m.ticker, strategy: 'breakout', side: last >= 0.50 ? 'yes' : 'no' });
          }
        }
      }
      if (st.harvest.on && cycle % 5 === 0) {
        var cool = state.harvestCool[m.ticker] || 0;
        if (isFinite(last) && last >= st.harvest.minPrice && last <= 0.99
            && spread <= st.harvest.maxSpread && now - cool > 6 * 3600e3) {
          var closeMs = Date.parse(m.close_time || '');
          if (isFinite(closeMs) && closeMs - now < st.harvest.maxCloseHours * 3600e3 && closeMs > now) {
            if (tryEnter(m, 'yes', 'harvest')) {
              state.harvestCool[m.ticker] = now;
              acted.push({ ticker: m.ticker, strategy: 'harvest', side: 'yes' });
            }
          }
        }
      }
    });
    cycle++;
    return acted;
  }

  /* Apply resolution outcomes to open paper positions. */
  function applyResolutions(resolvedMap) {
    Object.keys(resolvedMap).forEach(function (ticker) {
      var r = resolvedMap[ticker];
      state.trades.forEach(function (t) {
        if (t.status === 'open' && t.ticker === ticker) settle(t, r.result, r.settlement_ts);
      });
    });
  }

  function equity() {
    var open = openPositions();
    var mark = open.reduce(function (s, t) { return s + t.qty * (t.mark || t.entry); }, 0);
    return Math.round((cash + mark) * 100) / 100;
  }

  function recordEquity(now) {
    state.equity.push({ t: now, equity: equity(), cash: Math.round(cash * 100) / 100 });
    if (state.equity.length > 1200) state.equity.splice(0, state.equity.length - 1200);
    persistAll();
  }

  /* ---------- analysis helpers (trades.html tables) ---------- */
  function byStrategy() {
    var rows = {};
    state.trades.forEach(function (t) {
      var r = rows[t.strategy] || (rows[t.strategy] = { strategy: t.strategy, n: 0, open: 0, wins: 0, losses: 0, pnl: 0, cost: 0 });
      r.n++;
      if (t.status === 'open') { r.open++; return; }
      r.pnl += t.pnl || 0;
      r.cost += t.qty * t.entry;
      if ((t.pnl || 0) > 0) r.wins++; else if ((t.pnl || 0) < 0) r.losses++;
    });
    return Object.keys(rows).map(function (k) { return rows[k]; });
  }
  function byTopic() {
    var rows = {};
    state.trades.forEach(function (t) {
      var k = t.topic || 'unclassified';
      var r = rows[k] || (rows[k] = { topic: k, n: 0, open: 0, pnl: 0, wins: 0, losses: 0 });
      r.n++;
      if (t.status === 'open') { r.open++; return; }
      r.pnl += t.pnl || 0;
      if ((t.pnl || 0) > 0) r.wins++; else if ((t.pnl || 0) < 0) r.losses++;
    });
    return Object.keys(rows).map(function (k) { return rows[k]; });
  }
  function summary() {
    var closed = state.trades.filter(function (t) { return t.status !== 'open'; });
    var wins = closed.filter(function (t) { return (t.pnl || 0) > 0; }).length;
    var pnl = closed.reduce(function (s, t) { return s + (t.pnl || 0); }, 0);
    var cost = closed.reduce(function (s, t) { return s + t.qty * t.entry; }, 0);
    return {
      n: state.trades.length, open: openPositions().length, closed: closed.length,
      wins: wins, winRate: closed.length ? wins / closed.length : null,
      pnl: Math.round(pnl * 100) / 100, roi: cost ? Math.round(pnl / cost * 10000) / 100 : null,
      equity: equity(), cash: Math.round(cash * 100) / 100
    };
  }

  function pushAlert(a) {
    state.alerts.push(a);
    if (state.alerts.length > 300) state.alerts.splice(0, state.alerts.length - 300);
    persistAll();
  }
  function reset(bank) {
    state.trades = []; state.alerts = []; state.resolved = {}; state.equity = [];
    state.crossed50 = {}; state.harvestCool = {};
    cash = bank || state.bot.bank;
    persistAll();
  }

  return {
    state: state, TOPICS: TOPICS, classify: classify, score: score,
    runStrategies: runStrategies, manage: manage, applyResolutions: applyResolutions,
    recordEquity: recordEquity, equity: equity, summary: summary,
    byStrategy: byStrategy, byTopic: byTopic, pushAlert: pushAlert,
    persistAll: persistAll, reset: reset,
    topicById: function (id) { return TOPICS.filter(function (t) { return t.id === id; })[0] || null; }
  };
})();
