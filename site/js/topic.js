/* Trade1 — topic.js — controller for a topic page (data-topic="...").
 * Requirements covered here: live tracking, price chart (sec/min/hour), orderbook depth,
 * jump feed (≥ $0.10), resolution tracking (YES/NO), per-row source links.
 */
"use strict";

(function () {
  let TOPIC = null;
  let eventGroups = [];           // ranked event groups
  let tracked = [];               // top markets being polled
  let selected = null;            // selected market for deep panels
  let priceChart = null, depthChart = null;
  let granularity = "sec";
  let timerHandles = [];
  let candleCache = { key: "", ts: 0, data: [] };
  let selectedEvent = null;

  document.addEventListener("DOMContentLoaded", () => {
    TOPIC = T1.TOPICS[document.body.dataset.topic];
    if (!TOPIC) return;
    UI.initStatus("status-pill", "net-banner");
    priceChart = new T1Charts.PriceChart("price-chart");
    depthChart = new T1Charts.DepthChart("depth-chart");
    setupGranularityButtons();
    setupSelectedControls();
    renderStatic();
    loadTopic().catch((e) => console.error("loadTopic", e));
    startLoops();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) startLoops(); else stopLoops();
    });
  });

  function stopLoops() { timerHandles.forEach(clearInterval); timerHandles = []; }
  function loop(fn, ms) { const h = setInterval(() => { if (!document.hidden) fn().catch((e) => console.debug(e)); }, ms); timerHandles.push(h); }

  function renderStatic() {
    UI.html("topic-title", `${TOPIC.icon} ${UI.esc(TOPIC.label)}`);
    document.title = `${TOPIC.label} — Kalshi Demo Dashboard`;
    UI.html("topic-blurb", UI.esc(TOPIC.blurb));
    document.getElementById("topic-accent").style.background = TOPIC.accent;
  }

  // ---------------- Discovery ----------------
  async function discoverSeries() {
    const found = new Map(); // ticker -> series meta
    for (const cat of TOPIC.categories.slice(0, 2)) {
      try {
        const series = await KalshiAPI.getSeriesList(cat);
        for (const s of series || []) {
          const tags = s.tags || [];
          const hay = ((s.title || "") + " " + (s.ticker || "")).toLowerCase();
          const matches = TOPIC.seeds.includes(s.ticker)
            || TOPIC.tags.some((t) => tags.includes(t))
            || TOPIC.keywords.some((k) => hay.includes(k));
          if (matches) found.set(s.ticker, s);
        }
      } catch (e) { console.debug("series list", cat, e); }
      if (found.size >= T1.LIMITS.seriesPerTopic) break;
    }
    for (const seed of TOPIC.seeds) {
      if (!found.has(seed)) {
        try { const s = await KalshiAPI.getSeries(seed); if (s) found.set(s.ticker, s); } catch (e) {}
      }
    }
    return [...found.values()].slice(0, T1.LIMITS.seriesPerTopic);
  }

  function marketValue(m) {
    const yb = parseFloat(m.yes_bid_dollars), ya = parseFloat(m.yes_ask_dollars);
    const oi = parseFloat(m.open_interest_fp) || 0;
    let mid = null;
    if (!isNaN(yb) && !isNaN(ya) && yb > 0 && ya > 0) mid = (yb + ya) / 2;
    else { const lp = parseFloat(m.last_price_dollars); if (!isNaN(lp) && lp > 0) mid = lp; }
    const oiDollars = mid !== null ? oi * mid : null; // documented approximation (FLAGGED F8)
    const v24 = parseFloat(m.volume_24h_fp) || 0;
    const lp = parseFloat(m.last_price_dollars);
    const vol24Dollars = !isNaN(lp) && lp > 0 ? v24 * lp : null;
    return { oiDollars, vol24Dollars };
  }

  async function loadTopic() {
    UI.html("discovery-note", "Discovering series and events on the Kalshi demo API…");
    const seriesList = await discoverSeries();
    const seriesMeta = {};
    seriesList.forEach((s) => (seriesMeta[s.ticker] = s));

    // Markets for matched series (seeds first)
    const marketsByEvent = new Map();
    const addMarket = (m) => {
      if (!m || m.status !== "active") return;
      const arr = marketsByEvent.get(m.event_ticker) || [];
      arr.push(m);
      marketsByEvent.set(m.event_ticker, arr);
    };
    const ordered = [...seriesList].sort((a, b) => (TOPIC.seeds.includes(b.ticker) ? 1 : 0) - (TOPIC.seeds.includes(a.ticker) ? 1 : 0));
    for (const s of ordered.slice(0, T1.LIMITS.seriesPerTopic)) {
      try { (await KalshiAPI.getMarketsBySeries(s.ticker, 2)).forEach(addMarket); } catch (e) {}
    }

    // Event-scan for category topics (e.g. Elections) to catch series not matched above
    let scannedEvents = [];
    try { scannedEvents = (await KalshiAPI.getEvents(2)).filter((ev) => topicMatchesEvent(ev, seriesList)); } catch (e) {}
    for (const ev of scannedEvents.slice(0, T1.LIMITS.eventsPerTopic)) {
      if (!marketsByEvent.has(ev.event_ticker)) {
        try { (await KalshiAPI.getMarketsByEvent(ev.event_ticker)).forEach(addMarket); } catch (e) {}
      }
    }

    // Rank event groups by combined $OI (approximation documented in FLAGGED F8)
    eventGroups = [...marketsByEvent.entries()].map(([evt, ms]) => {
      const ranked = ms.map((m) => ({ m, val: marketValue(m) })).sort((a, b) => (b.val.oiDollars || 0) - (a.val.oiDollars || 0));
      const oiDollars = ranked.reduce((a, x) => a + (x.val.oiDollars || 0), 0);
      const vol24Dollars = ranked.reduce((a, x) => a + (x.val.vol24Dollars || 0), 0);
      const representative = ranked[0]?.m || {};
      const series = representative.ticker ? representative.ticker.split("-")[0] : "";
      const evMeta = scannedEvents.find((e) => e.event_ticker === evt);
      return {
        event_ticker: evt, series,
        title: evMeta ? evMeta.title : (representative.title || evt),
        category: evMeta ? evMeta.category : (seriesMeta[series]?.category || ""),
        settlement_sources: evMeta?.settlement_sources || seriesMeta[series]?.settlement_sources || [],
        markets: ranked.map((x) => x.m),
        oiDollars, vol24Dollars,
      };
    }).sort((a, b) => b.oiDollars - a.oiDollars).slice(0, T1.LIMITS.eventsPerTopic);

    // Tracked markets = top markets by $OI
    tracked = [];
    for (const g of eventGroups) for (const m of g.markets) {
      if (tracked.length >= T1.LIMITS.trackedPerTopic) break;
      tracked.push({ ticker: m.ticker, event_ticker: g.event_ticker, series: g.series });
      T1Track.latest[m.ticker] = m;
    }
    selected = tracked.length ? tracked[0] : null;
    selectedEvent = selected ? selected.event_ticker : null;

    UI.html("discovery-note", tracked.length
      ? `Tracking ${tracked.length} market${tracked.length > 1 ? "s" : ""} across ${eventGroups.length} live event group${eventGroups.length > 1 ? "s" : ""}.`
      : `No open markets matched this topic on the demo exchange right now — nothing is fabricated. Re-checks every 10 minutes. Try the <a href="${UI.apiUrl("/markets", { status: "open", limit: 5 })}" target="_blank" rel="noopener">raw API</a>.`);
    renderEventTable();
    renderJumpFeed();
    renderResolutionTable();
    if (selected) {
      await refreshSelected(true);
      await refreshCandles(true);
    }
  }

  function topicMatchesEvent(ev, seriesList) {
    if (TOPIC.seeds.includes(ev.series_ticker)) return true;
    if (TOPIC.categories.includes(ev.category)) {
      if (TOPIC.categories.length === 1 && ["Sports"].includes(ev.category)) {
        const s = seriesList.find((x) => x.ticker === ev.series_ticker);
        if (s && (s.tags || []).some((t) => TOPIC.tags.includes(t))) return true;
        if (TOPIC.keywords.some((k) => (ev.title || "").toLowerCase().includes(k))) return true;
        return false; // sports category alone is too broad for golf-only
      }
      return true;
    }
    const hay = ((ev.title || "") + " " + (ev.sub_title || "") + " " + (ev.series_ticker || "")).toLowerCase();
    return TOPIC.keywords.some((k) => hay.includes(k));
  }

  // ---------------- Rendering ----------------
  function renderEventTable() {
    const rows = [];
    eventGroups.forEach((g, gi) => {
      const shown = g.markets.slice(0, T1.LIMITS.marketsPerEventShown);
      rows.push(`<tr class="event-row"><td colspan="9">
        <span class="event-name">${UI.esc(g.title)}</span>
        <span class="event-ticker">${UI.esc(g.event_ticker)}</span>
        <span class="event-val">$OI <b>${UI.money(g.oiDollars)}</b></span>
        <span class="event-val">24h vol <b>${UI.money(g.vol24Dollars)}</b></span>
        <span class="event-sources">Settles by: ${UI.settlementLinks(g.settlement_sources, 3)}</span>
        ${UI.sourceCell(g.series, "/markets", { event_ticker: g.event_ticker, status: "open" })}
      </td></tr>`);
      shown.forEach((m) => {
        const yb = parseFloat(m.yes_bid_dollars), ya = parseFloat(m.yes_ask_dollars);
        const lp = parseFloat(m.last_price_dollars), pp = parseFloat(m.previous_price_dollars);
        const oi = parseFloat(m.open_interest_fp), v24 = parseFloat(m.volume_24h_fp);
        const val = marketValue(m);
        const w = Store.watchlist()[m.ticker];
        const res = w && w.resolved;
        rows.push(`<tr class="market-row ${selected && selected.ticker === m.ticker ? "sel" : ""}" data-ticker="${UI.esc(m.ticker)}">
          <td class="mono">${UI.esc(m.subtitle || m.yes_sub_title || "")}</td>
          <td class="mono">${UI.cents(yb)} / ${UI.cents(ya)}</td>
          <td class="mono">${UI.cents(lp)}</td>
          <td class="mono">${isNaN(lp) || isNaN(pp) ? "" : UI.deltaHtml(lp - pp)}</td>
          <td class="mono">${UI.num(oi)}</td>
          <td class="mono">${UI.money(val.oiDollars)}</td>
          <td class="mono">${UI.num(v24)}</td>
          <td class="mono">${UI.esc(closeTime(m))}</td>
          <td>${res ? `<span class="res-yes-${res.result === "yes" ? "y" : "n"}">${res.result === "yes" ? "YES ✅" : "NO ✅"}</span>` : statusChip(m.status)}</td>
        </tr>`);
      });
      if (g.markets.length > shown.length) {
        rows.push(`<tr class="market-row"><td colspan="9" class="muted">… +${g.markets.length - shown.length} more markets in this event group (see API link above)</td></tr>`);
      }
    });
    UI.html("events-tbody", rows.join("") || `<tr><td colspan="9" class="muted">No live markets yet — waiting for discovery…</td></tr>`);
    document.querySelectorAll("#events-tbody tr.market-row[data-ticker]").forEach((tr) => {
      tr.addEventListener("click", () => selectMarket(tr.dataset.ticker));
    });
    UI.stamp("events-stamp", Date.now());
  }

  function statusChip(status) {
    const s = String(status || "");
    const cls = s === "active" ? "chip-open" : s === "finalized" || s === "settled" ? "chip-settled" : "chip-other";
    return `<span class="chip ${cls}">${UI.esc(s || "?")}</span>`;
  }
  function closeTime(m) {
    if (!m.close_time) return "";
    const t = new Date(m.close_time).getTime();
    const mins = Math.round((t - Date.now()) / 60000);
    return `${UI.dateTime(t)} (${mins > 0 ? "in " + mins + "m" : "past"})`;
  }

  function selectMarket(ticker) {
    const t = tracked.find((x) => x.ticker === ticker) ||
      { ticker, event_ticker: T1Track.latest[ticker]?.event_ticker || (ticker.split("-").slice(0, 2).join("-")), series: ticker.split("-")[0] };
    selected = t;
    selectedEvent = t.event_ticker;
    candleCache = { key: "", ts: 0, data: [] };
    document.querySelectorAll("#events-tbody tr.market-row").forEach((tr) => tr.classList.toggle("sel", tr.dataset.ticker === ticker));
    refreshSelected(true).then(() => refreshCandles(true)).catch(() => {});
  }

  function setupSelectedControls() {
    const sel = document.getElementById("market-select");
    if (!sel) return;
    sel.addEventListener("change", () => selectMarket(sel.value));
  }
  function refreshSelectedOptions() {
    const sel = document.getElementById("market-select");
    if (!sel) return;
    sel.innerHTML = tracked.map((t) => {
      const m = T1Track.latest[t.ticker];
      return `<option value="${UI.esc(t.ticker)}" ${selected && selected.ticker === t.ticker ? "selected" : ""}>${UI.esc(t.ticker)}${m ? " — " + UI.esc(m.subtitle || "") : ""}</option>`;
    }).join("");
  }

  function setupGranularityButtons() {
    document.querySelectorAll("[data-gran]").forEach((btn) => {
      btn.addEventListener("click", () => {
        granularity = btn.dataset.gran;
        document.querySelectorAll("[data-gran]").forEach((b) => b.classList.toggle("active", b === btn));
        priceChart.setMode(granularity);
        if (granularity === "sec") { renderSec(); } else { refreshCandles(true); }
      });
    });
  }

  // ---------------- Polling ----------------
  async function refreshSelected(initial) {
    if (!selected) return;
    const markets = await KalshiAPI.getMarketsByEvent(selected.event_ticker);
    const m = markets.find((x) => x.ticker === selected.ticker);
    if (!m) return;
    T1Track.latest[selected.ticker] = m;
    selectedEvent = selected.event_ticker;
    const jump = T1Track.observe(m, document.body.dataset.topic);
    renderQuotePanel(m);
    if (granularity === "sec") renderSec();
    if (jump) { renderJumpFeed(); highlightJump(jump); }
    refreshSelectedOptions();
    if (Store.settings().enabled) Engine.tick(m, null);
    if (initial) renderTrades([], true);
  }

  function renderQuotePanel(m) {
    const yb = parseFloat(m.yes_bid_dollars), ya = parseFloat(m.yes_ask_dollars);
    const lp = parseFloat(m.last_price_dollars), pp = parseFloat(m.previous_price_dollars);
    const oi = parseFloat(m.open_interest_fp), v24 = parseFloat(m.volume_24h_fp);
    const ybs = parseFloat(m.yes_bid_size_fp), yas = parseFloat(m.yes_ask_size_fp);
    UI.html("sel-title", `${UI.esc(m.title || "")} <span class="event-ticker">${UI.esc(m.ticker)}</span>`);
    UI.html("sel-sub", UI.esc(m.subtitle || "") + (m.rules_primary ? ` — ${UI.esc(trunc(m.rules_primary, 220))}` : ""));
    UI.html("sel-quotes", `
      <div class="q"><span>Last</span><b>${UI.cents(lp)} ${UI.deltaHtml(isNaN(lp) || isNaN(pp) ? null : lp - pp)}</b></div>
      <div class="q"><span>YES bid/ask</span><b>${UI.cents(yb)} / ${UI.cents(ya)}</b></div>
      <div class="q"><span>NO bid/ask</span><b>${UI.cents(m.no_bid_dollars)} / ${UI.cents(m.no_ask_dollars)}</b></div>
      <div class="q"><span>Top-of-book size</span><b>${UI.num(ybs)} Y / ${UI.num(yas)} Y-ask</b></div>
      <div class="q"><span>Open interest</span><b>${UI.num(oi)} ct</b></div>
      <div class="q"><span>24h volume</span><b>${UI.num(v24)} ct</b></div>
      <div class="q"><span>Close</span><b>${UI.esc(closeTime(m))}</b></div>
      <div class="q"><span>Status</span><b>${statusChip(m.status)}</b></div>
      <div class="q"><span>Settlement</span><b>${m.result ? (m.result === "yes" ? "YES ✅" : "NO ✅") : "pending"}</b></div>
    `);
    UI.html("sel-links",
      `${UI.sourceCell(m.ticker.split("-")[0], "/markets", { event_ticker: m.event_ticker, status: "open" })} · ` +
      `<a class="src" href="${UI.apiUrl(`/markets/${encodeURIComponent(m.ticker)}/orderbook`, null)}" target="_blank" rel="noopener">orderbook API</a> · ` +
      `<a class="src" href="${UI.apiUrl("/markets/trades", { ticker: m.ticker, limit: 60 })}" target="_blank" rel="noopener">trades API</a>`);
    UI.stamp("sel-stamp", Date.now());
  }

  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  function renderSec() {
    if (!selected) return;
    priceChart.setHistory(T1Track.history(selected.ticker), T1Track.jumps(document.body.dataset.topic).filter((j) => j.ticker === selected.ticker));
    UI.stamp("chart-stamp", Date.now());
  }

  async function refreshCandles(force) {
    if (!selected || granularity === "sec") return;
    const period = granularity === "min" ? 1 : 60;
    const spanMin = granularity === "min" ? 360 : 60 * 24 * 14;
    const end = Math.floor(Date.now() / 1000);
    const start = end - spanMin * 60;
    const key = `${selected.ticker}:${period}`;
    if (!force && candleCache.key === key && Date.now() - candleCache.ts < 60000) return;
    try {
      const candles = await KalshiAPI.getCandles(selected.series || selected.ticker.split("-")[0], selected.ticker, start, end, period);
      candleCache = { key, ts: Date.now(), data: candles };
    } catch (e) { console.debug("candles", e); return; }
    const live = T1Track.latest[selected.ticker];
    const tail = live && granularity === "min" ? {
      end_period_ts: Math.floor(Date.now() / 1000),
      price: { close_dollars: String(Engine.midOrLast(live) ?? "") },
    } : null;
    priceChart.setCandles(candleCache.data, tail);
    UI.stamp("chart-stamp", Date.now());
  }

  async function refreshBook() {
    if (!selected) return;
    const book = await KalshiAPI.getOrderbook(selected.ticker);
    depthChart.setBook(book);
    renderBookTable(book);
    const m = T1Track.latest[selected.ticker];
    if (m && Store.settings().enabled) Engine.tick(m, book);
    UI.stamp("book-stamp", Date.now());
  }

  // Liquidity computed from orderbook (FLAGGED F3: no aggregate field in API responses)
  function renderBookTable(book) {
    const m = T1Track.latest[selected.ticker];
    const yb = m ? parseFloat(m.yes_bid_dollars) : NaN;
    const rows = [];
    const yes = (book.yes || []).slice(-12).reverse(); // best bid first
    const no = (book.no || []).slice(-12).reverse();
    const maxLen = Math.max(yes.length, no.length);
    let liqYes = 0, liqNo = 0;
    (book.yes || []).forEach(([p, q]) => { if (yb && Math.abs(parseFloat(p) - yb) <= 0.10) liqYes += parseFloat(q); });
    (book.no || []).forEach(([p, q]) => { if (yb && Math.abs(parseFloat(p) - (1 - yb)) <= 0.10) liqNo += parseFloat(q); });
    UI.html("book-liq", `
      <div class="q"><span>Liquidity within $0.10 of best YES bid</span><b>${UI.num(liqYes)} contracts</b></div>
      <div class="q"><span>Liquidity within $0.10 of best NO bid</span><b>${UI.num(liqNo)} contracts</b></div>
      <div class="q"><span>Method</span><b class="muted">computed from orderbook (see Flagged F3)</b></div>
    `);
    for (let i = 0; i < maxLen; i++) {
      const y = yes[i], n = no[i];
      rows.push(`<tr>
        <td class="mono">${y ? UI.cents(y[0]) : ""}</td>
        <td class="mono">${y ? UI.num(y[1]) : ""}</td>
        <td class="mono">${y ? UI.cents(1 - parseFloat(y[0])) : ""}</td>
        <td class="mono">${n ? UI.cents(n[0]) : ""}</td>
        <td class="mono">${n ? UI.num(n[1]) : ""}</td>
        <td class="mono">${n ? UI.cents(1 - parseFloat(n[0])) : ""}</td>
      </tr>`);
    }
    UI.html("book-tbody", rows.join("") || `<tr><td colspan="6" class="muted">Orderbook empty (or market has no resting bids right now)</td></tr>`);
  }

  async function refreshTrades() {
    if (!selected) return;
    const trades = await KalshiAPI.getTrades(selected.ticker, T1.LIMITS.tradesRows);
    renderTrades(trades);
    UI.stamp("trades-stamp", Date.now());
  }

  function renderTrades(trades, skeleton) {
    const rows = (trades || []).slice(0, T1.LIMITS.tradesRows).map((t) => {
      const price = parseFloat(t.yes_price_dollars);
      return `<tr>
        <td class="mono">${UI.esc(UI.dateTime(new Date(t.created_time).getTime()))}</td>
        <td class="mono">${UI.cents(price)}</td>
        <td class="mono">${UI.num(parseFloat(t.count_fp))}</td>
        <td>${UI.esc(t.taker_outcome_side || t.taker_side || "")}</td>
        <td>${t.is_block_trade ? "block" : ""}</td>
      </tr>`;
    });
    UI.html("trades-tbody", skeleton ? `<tr><td colspan="5" class="muted">Loading trade tape…</td></tr>`
      : rows.join("") || `<tr><td colspan="5" class="muted">No recent trades</td></tr>`);
  }

  // ---------------- Jump feed + resolution ----------------
  function jumpRow(j, highlight) {
    const m = T1Track.latest[j.ticker];
    const title = j.title || j.ticker;
    return `<tr class="${highlight ? "jump-new" : ""}">
      <td class="mono">${UI.esc(UI.clock(j.t))}</td>
      <td>${topicBadge(j.topic)} ${UI.esc(trunc(title, 60))} <span class="event-ticker">${UI.esc(j.ticker)}</span></td>
      <td class="mono">${UI.cents(j.from)} → <b>${UI.cents(j.to)}</b> ${j.dir === "up" ? '<span class="up">▲</span>' : '<span class="down">▼</span>'}</td>
      <td>${UI.sourceCell(j.series, "/markets", { event_ticker: j.event_ticker, status: "open" })} · ${UI.newsLink(title + " " + (m ? m.subtitle || "" : ""))}</td>
    </tr>`;
  }
  function renderJumpFeed() {
    const js = T1Track.jumps(document.body.dataset.topic).slice(0, 25);
    UI.html("jumps-tbody", js.map((j) => jumpRow(j)).join("") ||
      `<tr><td colspan="4" class="muted">No ≥ $0.10 jumps recorded yet on this topic. Detection runs on every poll.</td></tr>`);
  }
  function highlightJump(j) {
    const tb = document.getElementById("jumps-tbody");
    if (!tb) return;
    tb.insertAdjacentHTML("afterbegin", jumpRow(j, true));
  }

  function renderResolutionTable() {
    const w = Store.watchlist();
    const rows = Object.values(w).filter((x) => x.topic === document.body.dataset.topic || (x.title || "").toLowerCase());
    const sorted = rows.sort((a, b) => (b.resolved ? 1 : 0) - (a.resolved ? 1 : 0)).slice(0, 50);
    UI.html("res-tbody", sorted.map((x) => `<tr>
      <td>${UI.esc(trunc(x.title, 46))} <span class="event-ticker">${UI.esc(x.subtitle || "")}</span></td>
      <td class="mono">${UI.esc(x.ticker)}</td>
      <td>${x.resolved ? `<span class="res-${x.resolved.result === "yes" ? "yes" : "no"}">${x.resolved.result.toUpperCase()}</span>` : `<span class="chip chip-open">open</span>`}</td>
      <td class="mono">${x.resolved && x.resolved.settlement_ts ? UI.esc(UI.dateTime(new Date(x.resolved.settlement_ts).getTime())) : ""}</td>
      <td>${UI.sourceCell(x.ticker.split("-")[0], "/markets", { tickers: x.ticker })}</td>
    </tr>`).join("") || `<tr><td colspan="5" class="muted">Watchlist empty — markets you view here are tracked automatically until they resolve.</td></tr>`);
  }

  function startLoops() {
    stopLoops();
    loop(() => loadTopic(), T1.POLL_MS.rediscover);
    loop(async () => {
      for (const t of tracked) {
        if (!t.event_ticker) continue;
        try {
          const markets = await KalshiAPI.getMarketsByEvent(t.event_ticker);
          const m = markets.find((x) => x.ticker === t.ticker);
          if (m) {
            T1Track.latest[t.ticker] = m;
            const jump = T1Track.observe(m, document.body.dataset.topic);
            if (jump) { renderJumpFeed(); highlightJump(jump); }
            if (Store.settings().enabled) Engine.tick(m, null);
          }
        } catch (e) {}
      }
      renderEventTable();
      renderResolutionTable();
    }, T1.POLL_MS.table);
    loop(() => refreshSelected(), T1.POLL_MS.selectedQuote);
    loop(refreshBook, T1.POLL_MS.selectedBook);
    loop(refreshTrades, T1.POLL_MS.selectedTrades);
    loop(async () => { await Engine.checkResolutions(); renderResolutionTable(); }, T1.POLL_MS.watchlist);
  }
})();
