/* Trade1 — dashboard.js — index page: cross-topic "highest dollar value live events" ranking.
 * Topics stay separate (one ranked block per topic); the combined ranking table shows topic badges.
 */
"use strict";

(function () {
  let topMarkets = [];   // [{market, topic, group}] across topics, ranked by $OI
  let pollSet = [];

  document.addEventListener("DOMContentLoaded", () => {
    UI.initStatus("status-pill", "net-banner");
    (async () => {
      for (const id of T1.TOPIC_ORDER) {
        renderTopicSkeleton(id);
        try { await loadTopicTop(id); } catch (e) { console.error(id, e); renderTopicError(id, e); }
      }
      buildCombined();
      startBatchPolling();
      await Engine.checkResolutions();
    })();
  });

  function renderTopicSkeleton(id) {
    UI.html(`top-${id}`, `<div class="muted">Loading ${T1.TOPICS[id].label}…</div>`);
  }
  function renderTopicError(id, e) {
    UI.html(`top-${id}`, `<div class="muted">Could not load — ${UI.esc(e.message || e)} (will retry on next full refresh)</div>`);
  }

  function marketValue(m) {
    const yb = parseFloat(m.yes_bid_dollars), ya = parseFloat(m.yes_ask_dollars);
    const oi = parseFloat(m.open_interest_fp) || 0;
    let mid = null;
    if (!isNaN(yb) && !isNaN(ya) && yb > 0 && ya > 0) mid = (yb + ya) / 2;
    else { const lp = parseFloat(m.last_price_dollars); if (!isNaN(lp) && lp > 0) mid = lp; }
    return { oiDollars: mid !== null ? oi * mid : null };
  }

  async function loadTopicTop(topicId) {
    const topic = T1.TOPICS[topicId];
    const matched = new Set(topic.seeds);
    for (const cat of topic.categories.slice(0, 2)) {
      try {
        for (const s of (await KalshiAPI.getSeriesList(cat)) || []) {
          const hay = ((s.title || "") + " " + (s.ticker || "")).toLowerCase();
          if (topic.seeds.includes(s.ticker) || (s.tags || []).some((t) => topic.tags.includes(t))
            || topic.keywords.some((k) => hay.includes(k))) matched.add(s.ticker);
        }
      } catch (e) {}
      if (matched.size >= 6) break;
    }
    const groups = new Map();
    for (const st of [...matched].slice(0, 6)) {
      try {
        for (const m of await KalshiAPI.getMarketsBySeries(st, 1)) {
          if (m.status !== "active") continue;
          const arr = groups.get(m.event_ticker) || [];
          arr.push(m);
          groups.set(m.event_ticker, arr);
        }
      } catch (e) {}
    }
    // category-only topics (elections/culture) also scan events
    let events = [];
    try { events = (await KalshiAPI.getEvents(1)).filter((ev) =>
      topic.categories.includes(ev.category) || topic.keywords.some((k) => (ev.title || "").toLowerCase().includes(k))
      || topic.seeds.includes(ev.series_ticker)); } catch (e) {}
    for (const ev of events.slice(0, 6)) {
      if (!groups.has(ev.event_ticker)) {
        try { (await KalshiAPI.getMarketsByEvent(ev.event_ticker)).forEach((m) => { if (m.status === "active") (groups.get(ev.event_ticker) || groups.set(ev.event_ticker, []).get(ev.event_ticker)).push(m); }); } catch (e) {}
      }
    }
    const ranked = [...groups.entries()].map(([evt, ms]) => {
      const withVal = ms.map((m) => ({ m, v: marketValue(m).oiDollars || 0 })).sort((a, b) => b.v - a.v);
      return { event_ticker: evt, title: withVal[0]?.m.title || evt, series: withVal[0]?.m.ticker.split("-")[0] || "",
        oiDollars: withVal.reduce((a, x) => a + x.v, 0), markets: withVal.map((x) => x.m) };
    }).sort((a, b) => b.oiDollars - a.oiDollars).slice(0, 3);

    const rows = ranked.map((g) => {
      const m = g.markets[0];
      if (m) T1Track.latest[m.ticker] = m;
      const val = marketValue(m);
      const yb = parseFloat(m.yes_bid_dollars), ya = parseFloat(m.yes_ask_dollars);
      const lp = parseFloat(m.last_price_dollars), pp = parseFloat(m.previous_price_dollars);
      const w = Store.watchlist()[m.ticker];
      const res = w && w.resolved;
      return `<tr>
        <td>${UI.esc(trunc(g.title, 52))} <span class="event-ticker">${UI.esc(g.event_ticker)}</span></td>
        <td class="mono">${UI.esc(m.subtitle || "")}</td>
        <td class="mono">${UI.cents(yb)} / ${UI.cents(ya)}</td>
        <td class="mono">${UI.cents(lp)} ${UI.deltaHtml(isNaN(lp) || isNaN(pp) ? null : lp - pp)}</td>
        <td class="mono">${UI.money(g.oiDollars)}</td>
        <td>${res ? `<span class="res-${res.result === "yes" ? "yes" : "no"}">${res.result.toUpperCase()}</span>` : statusChip(m.status)}</td>
        <td>${UI.sourceCell(g.series, "/markets", { event_ticker: g.event_ticker, status: "open" })} · <a class="src" href="topics/${topicId}.html">${UI.esc(topic.label)} page →</a></td>
      </tr>`;
    }).join("") || `<tr><td colspan="7" class="muted">No open markets matched this topic right now.</td></tr>`;
    UI.html(`top-${topicId}`, rows);

    // add top market per group to combined ranking + poll set
    ranked.forEach((g) => {
      const m = g.markets[0];
      if (m) { topMarkets.push({ m, topic: topicId, g }); if (!pollSet.includes(m.ticker)) pollSet.push(m.ticker); }
    });
  }

  function statusChip(status) {
    const s = String(status || "");
    const cls = s === "active" ? "chip chip-open" : s === "finalized" ? "chip chip-settled" : "chip chip-other";
    return `<span class="${cls}">${UI.esc(s || "?")}</span>`;
  }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  function buildCombined() {
    topMarkets.sort((a, b) => (marketValue(b.m).oiDollars || 0) - (marketValue(a.m).oiDollars || 0));
    const rows = topMarkets.slice(0, 12).map(({ m, topic }) => {
      const yb = parseFloat(m.yes_bid_dollars), ya = parseFloat(m.yes_ask_dollars);
      const lp = parseFloat(m.last_price_dollars), pp = parseFloat(m.previous_price_dollars);
      const val = marketValue(m);
      return `<tr>
        <td>${topicBadge(topic)}</td>
        <td>${UI.esc(trunc(m.title, 40))} <span class="event-ticker">${UI.esc(m.ticker)}</span></td>
        <td class="mono">${UI.cents(yb)} / ${UI.cents(ya)}</td>
        <td class="mono">${UI.cents(lp)} ${UI.deltaHtml(isNaN(lp) || isNaN(pp) ? null : lp - pp)}</td>
        <td class="mono">${UI.money(val.oiDollars)}</td>
        <td>${UI.sourceCell(m.ticker.split("-")[0], "/markets", { event_ticker: m.event_ticker, status: "open" })}</td>
      </tr>`;
    }).join("");
    UI.html("combined-tbody", rows || `<tr><td colspan="6" class="muted">No live markets found yet.</td></tr>`);
    UI.stamp("combined-stamp", Date.now());
  }

  function topicBadge(id) {
    const t = T1.TOPICS[id];
    return `<span class="topic-badge" style="background:${t.accent}1a;color:${t.accent}">${t.icon} ${UI.esc(t.label)}</span>`;
  }

  // One batch call refreshes every tracked market (docs: tickers-only filter → one response)
  function startBatchPolling() {
    if (!pollSet.length) return;
    setInterval(async () => {
      if (document.hidden) return;
      try {
        const markets = await KalshiAPI.getMarketsByTickers(pollSet.slice(0, 40));
        for (const m of markets) {
          T1Track.latest[m.ticker] = m;
          const jm = T1Track.observe(m, topMarkets.find((x) => x.m.ticker === m.ticker)?.topic || "");
          if (jm) renderJumpRow(jm);
          if (Store.settings().enabled) Engine.tick(m, null);
        }
        for (const { m, topic } of topMarkets) {
          const fresh = markets.find((x) => x.ticker === m.ticker);
          if (fresh) Object.assign(m, fresh);
        }
        buildCombined();
      } catch (e) { console.debug(e); }
    }, T1.POLL_MS.index);
    setInterval(() => { if (!document.hidden) Engine.checkResolutions(); }, T1.POLL_MS.watchlist);
  }

  function renderJumpRow(j) {
    const tb = document.getElementById("global-jumps");
    if (!tb) return;
    tb.insertAdjacentHTML("afterbegin", `<tr class="jump-new">
      <td class="mono">${UI.esc(UI.clock(j.t))}</td>
      <td>${topicBadge(j.topic)} ${UI.esc(trunc(j.title || j.ticker, 46))}</td>
      <td class="mono">${UI.cents(j.from)} → <b>${UI.cents(j.to)}</b> ${j.dir === "up" ? '<span class="up">▲</span>' : '<span class="down">▼</span>'}</td>
      <td>${UI.sourceCell(j.series, "/markets", { event_ticker: j.event_ticker, status: "open" })} · ${UI.newsLink(j.title || j.ticker)}</td>
    </tr>`);
    while (tb.children.length > 12) tb.removeChild(tb.lastChild);
  }
})();
