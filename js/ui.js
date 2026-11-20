/* Shared UI for the Kalshi demo dashboard. Injects the chrome, renders live tables
   (each data row carries a link to the official Kalshi market), charts, orderbook depth,
   alert chats, and the paper-trade portfolio/analysis views. */
(function () {
  "use strict";
  var E = window.KalshiEngine;
  var REF = window.KalshiRef;

  var NAV = [
    { href: "index.html", label: "Dashboard" },
    { href: "pages/gas.html", label: "Gas prices" },
    { href: "pages/elections.html", label: "Elections" },
    { href: "pages/culture.html", label: "Culture" },
    { href: "pages/crypto.html", label: "Crypto" },
    { href: "pages/golf.html", label: "Golf" },
    { href: "alerts.html", label: "Live alerts" },
    { href: "trading.html", label: "Trading lab" },
    { href: "flagged.html", label: "Flagged" },
    { href: "sources.html", label: "Sources" }
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function money(v) { return (v === null || v === undefined) ? "" : "$" + Number(v).toFixed(2); }
  function fmt(v) {
    if (v === null || v === undefined) return "";
    var n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString() : String(v);
  }
  function topicPill(t) { return t ? '<span class="pill">' + esc(t) + "</span>" : '<span class="pill flag">unclassified</span>'; }

  function buildChrome() {
    if ($("app-header")) return;
    var page = document.body.getAttribute("data-page") || "";
    var nav = NAV.map(function (n) {
      var active = n.href.split("/").pop() === page || (n.href === "index.html" && page === "index") ? " active" : "";
      return '<a class="' + active.trim() + '" href="' + n.href + '">' + esc(n.label) + "</a>";
    }).join("");
    var header =
      '<header class="top"><div class="brand"><div class="mark">K</div>' +
      '<div><h1>Kalshi Demo Dashboard</h1><small>Live market monitor · paper strategy lab</small></div></div>' +
      '<span class="state off" id="liveState">Connecting…</span></header>' +
      '<nav class="site">' + nav + "</nav>";
    var holder = document.createElement("div");
    holder.id = "app-header";
    holder.innerHTML = header;
    document.body.insertBefore(holder, document.body.firstChild);
  }

  function setLive(connected, err) {
    var el = $("liveState");
    if (!el) return;
    if (connected) { el.textContent = "Live · " + (E.state.base ? host(E.state.base) : "demo API"); el.className = "state on"; }
    else { el.textContent = "Disconnected"; el.className = "state " + (err ? "err" : "off"); }
  }
  function host(u) { try { return new URL(u).host; } catch (e) { return u; } }

  /* ---------- market table ---------- */
  function renderMarketTable(containerId, markets, opts) {
    opts = opts || {};
    var el = $(containerId);
    if (!el) return;
    if (!markets.length) { el.innerHTML = '<tr><td colspan="11" class="empty">No matching open markets returned from the live endpoint.</td></tr>'; return; }
    var rows = markets.slice().sort(function (a, b) { return (b.volume || 0) - (a.volume || 0); }).slice(0, opts.limit || 100).map(function (m) {
      var derived = E.estDollarVolume(m);
      return "<tr>" +
        '<td><a href="' + esc(E.marketUrl(m)) + '" target="_blank" rel="noopener">' + esc(m.title || m.ticker) + "</a>" +
        '<br><small class="muted">' + esc(m.event_ticker || m.ticker) + "</small></td>" +
        "<td>" + topicPill(E.classify(m)) + "</td>" +
        '<td class="num">' + money(m.yes_bid) + "</td>" +
        '<td class="num">' + money(m.yes_ask) + "</td>" +
        '<td class="num">' + money(m.no_bid) + "</td>" +
        '<td class="num">' + fmt(m.volume) + "</td>" +
        '<td class="num">' + fmt(m.open_interest) + "</td>" +
        '<td class="num" title="Derived estimate: volume × notional_value_dollars (not an official field)">' +
        (derived === null ? "" : fmt(Math.round(derived))) + ' <span class="pill flag">*</span></td>' +
        '<td class="num">' + fmt(m.yes_ask_size) + "</td>" +
        '<td><span class="pill">' + esc(m.status) + "</span></td>" +
        '<td class="source"><a href="' + esc(E.marketUrl(m)) + '" target="_blank" rel="noopener">official market ↗</a></td>' +
        "</tr>";
    }).join("");
    el.innerHTML = rows;
  }

  /* ---------- alert chats ---------- */
  function renderChat(containerId, list, roi) {
    var el = $(containerId);
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="msg muted">No qualifying events yet. Alerts appear here when a tracked market moves ≥ $0.10.</div>'; return; }
    el.innerHTML = list.slice(0, 120).map(function (a) {
      var cls = a.dir === "up" ? "up" : (a.dir === "down" ? "down" : "roi");
      var arrow = a.dir === "up" ? "▲" : (a.dir === "down" ? "▼" : "★");
      var extra = roi && a.roi ? ' <span class="pill">ROI ' + a.roi.toFixed(1) + "× " + esc(a.roiSide) + "</span>" : "";
      var watch = a.watch ? ' <span class="pill">high-ROI watch</span>' : "";
      return '<div class="msg ' + cls + '"><span class="t">' + new Date(a.t).toLocaleTimeString() + "</span>" +
        "<b>" + arrow + " " + esc(a.topic || "event") + "</b> · " +
        esc(a.title) + " <small class='muted'>" + esc(a.ticker) + "</small>" +
        (a.from !== null && a.to !== null && a.from !== a.to ? " · " + money(a.from) + " → " + money(a.to) : "") +
        extra + watch +
        ' <a href="' + esc(a.url) + '" target="_blank" rel="noopener">link ↗</a> · cause unverified</div>';
    }).join("");
    el.scrollTop = el.scrollHeight;
  }

  /* ---------- chart ---------- */
  var chartWindow = 60000;
  function renderPeriodControl(containerId, tickers) {
    var el = $(containerId);
    if (!el) return;
    var opts = [
      ["30000", "Last 30s"], ["60000", "Last 1m"], ["300000", "Last 5m"],
      ["900000", "Last 15m"], ["3600000", "Last 1h"], ["21600000", "Last 6h"]
    ];
    el.innerHTML = opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (Number(o[0]) === chartWindow ? " selected" : "") + ">" + o[1] + "</option>";
    }).join("");
    el.onchange = function () { chartWindow = Number(el.value); drawChart(); };
  }
  function chartMarkets() {
    var topic = E.state.topic;
    var ms = E.state.topicMatches.filter(function (m) { return topic === "All" || E.classify(m) === topic; });
    return ms;
  }
  function drawChart() {
    var c = $("chart");
    if (!c) return;
    var sel = E.state.selected;
    var s = sel ? (E.state.samples[sel] || []) : [];
    var now = Date.now();
    s = s.filter(function (p) { return p.t >= now - chartWindow; });
    var rect = c.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    c.width = Math.max(2, rect.width * dpr); c.height = Math.max(2, rect.height * dpr);
    var ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#2b3a37"; ctx.fillStyle = "#93a6a1"; ctx.font = "11px system-ui";
    for (var i = 0; i <= 4; i++) {
      var y = 14 + i * (h - 30) / 4;
      ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(w - 8, y); ctx.stroke();
      ctx.fillText("$" + (1 - i / 4).toFixed(2), 4, y + 4);
    }
    if (!s.length) { ctx.fillText("Select a market to record live price samples.", 46, h / 2); return; }
    var tmin = s[0].t, tmax = s[s.length - 1].t;
    if (tmax === tmin) tmax = tmin + 1000;
    ctx.strokeStyle = "#5fd3a4"; ctx.lineWidth = 2; ctx.beginPath();
    s.forEach(function (p, i) {
      var px = 40 + (p.t - tmin) / (tmax - tmin) * (w - 48);
      var py = 14 + (1 - p.p) * (h - 30);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
    var ob = E.state.orderbooks[sel];
    if (ob) {
      if (ob.best_yes_bid !== null) { var py = 14 + (1 - ob.best_yes_bid) * (h - 30); ctx.fillStyle = "#5fd3a4"; ctx.fillRect(40, py - 1, w - 8, 2); }
      if (ob.implied_yes_ask !== null) { var py2 = 14 + (1 - ob.implied_yes_ask) * (h - 30); ctx.fillStyle = "#ff8479"; ctx.fillRect(40, py2 - 1, w - 8, 2); }
    }
    ctx.fillStyle = "#93a6a1";
    ctx.fillText(new Date(tmin).toLocaleTimeString(), 40, h - 6);
    ctx.fillText(new Date(tmax).toLocaleTimeString(), Math.max(40, w - 72), h - 6);
  }

  /* ---------- market lab (selector + chart + orderbook) ---------- */
  function renderLab() {
    var selEl = $("labMarket");
    if (selEl) {
      var ms = chartMarkets();
      var prev = E.state.selected;
      selEl.innerHTML = ms.map(function (m) {
        return '<option value="' + esc(m.ticker) + '"' + (prev === m.ticker ? " selected" : "") + ">" + esc(m.title || m.ticker) + "</option>";
      }).join("") || "<option>No markets</option>";
      selEl.onchange = function () { E.state.selected = selEl.value; E.fetchOrderbook(selEl.value); drawChart(); };
      if (!prev && ms.length) { E.state.selected = ms[0].ticker; selEl.value = ms[0].ticker; }
    }
    renderPeriodControl("labPeriod", null);
    drawChart();
    renderOrderbook();
  }
  function renderOrderbook() {
    var el = $("orderbook");
    if (!el) return;
    var t = E.state.selected;
    if (!t) { el.innerHTML = '<p class="muted">Select a market to load order book depth.</p>'; return; }
    var ob = E.state.orderbooks[t];
    if (!ob) { el.innerHTML = '<p class="muted">Order book not loaded for ' + esc(t) + '.</p>'; return; }
    var yesRows = ob.yes.slice(0, 8).map(function (l) { return '<tr><td>YES bid</td><td class="num">' + money(l.p) + '</td><td class="num">' + fmt(l.c) + "</td></tr>"; }).join("") || '<tr><td colspan="3" class="empty">No YES bids</td></tr>';
    var noRows = ob.no.slice(0, 8).map(function (l) { return '<tr><td>NO bid</td><td class="num">' + money(l.p) + '</td><td class="num">' + fmt(l.c) + "</td></tr>"; }).join("") || '<tr><td colspan="3" class="empty">No NO bids</td></tr>';
    el.innerHTML =
      '<p class="muted">Best YES bid ' + money(ob.best_yes_bid) + ' · best NO bid ' + money(ob.best_no_bid) +
      ' → implied YES ask ' + money(ob.implied_yes_ask) + ". Bids only (official); YES ask is derived as 1 − best NO bid.</p>" +
      '<div class="tablewrap"><table><thead><tr><th>Side</th><th class="num">Price</th><th class="num">Contracts</th></tr></thead><tbody>' +
      yesRows + noRows + "</tbody></table></div>";
  }

  /* ---------- trading lab ---------- */
  function renderTrading() {
    var st = E.state;
    var realized = st.history.reduce(function (s, h) { return s + h.pnl; }, 0);
    var wins = st.history.filter(function (h) { return h.win; }).length;
    var stats = $("tStats");
    if (stats) stats.innerHTML =
      '<div class="card"><small>Mock cash</small><strong>' + money(st.cash) + "</strong></div>" +
      '<div class="card"><small>Open positions</small><strong>' + st.positions.length + "</strong></div>" +
      '<div class="card"><small>Settled trades</small><strong>' + st.history.length + "</strong></div>" +
      '<div class="card"><small>Realized P&L</small><strong style="color:' + (realized >= 0 ? "var(--green)" : "var(--red)") + '">' + (realized >= 0 ? "+" : "") + money(realized) + "</strong><small>win rate " + (st.history.length ? Math.round(100 * wins / st.history.length) : 0) + "%</small></div>";

    var strat = $("stratTable");
    if (strat) {
      var groups = {};
      st.history.forEach(function (h) { (groups[h.strategy] = groups[h.strategy] || []).push(h); });
      var rows = Object.keys(groups).map(function (k) {
        var h = groups[k]; var w = h.filter(function (x) { return x.win; }).length;
        var pnl = h.reduce(function (s, x) { return s + x.pnl; }, 0);
        var cost = h.reduce(function (s, x) { return s + x.costTotal || x.cost * x.qty; }, 0);
        return "<tr><td>" + esc(k) + '</td><td class="num">' + h.length + '</td><td class="num">' + w + '</td><td class="num">' + (h.length - w) +
          '</td><td class="num">' + (h.length ? Math.round(100 * w / h.length) : 0) + "%</td>" +
          '<td class="num">' + money(cost) + '</td><td class="num" style="color:' + (pnl >= 0 ? "var(--green)" : "var(--red)") + '">' + (pnl >= 0 ? "+" : "") + money(pnl) + "</td></tr>";
      }).join("");
      strat.innerHTML = rows || '<tr><td colspan="7" class="empty">No settled trades yet.</td></tr>';
    }

    var posEl = $("posTable");
    if (posEl) {
      posEl.innerHTML = st.positions.length
        ? st.positions.map(function (p) {
            var m = E.state.byTicker[p.ticker];
            var cur = m ? m.yes_bid : null;
            return "<tr><td>" + esc(p.title) + "<br><small class='muted'>" + esc(p.ticker) + "</small></td><td>" + topicPill(p.topic) +
              "</td><td>" + esc(p.side) + '</td><td class="num">' + fmt(p.qty) + '</td><td class="num">' + money(p.cost) +
              '</td><td>' + esc(p.strategy) + "</td><td class='num'>" + money(cur) + "</td></tr>";
          }).join("")
        : '<tr><td colspan="7" class="empty">No open paper positions. The engine opens them automatically per strategy.</td></tr>';
    }

    var settledEl = $("settledTable");
    if (settledEl) {
      settledEl.innerHTML = st.settled.length
        ? st.settled.slice(0, 100).map(function (s) {
            return "<tr><td><a href='" + esc(E.marketUrl({ ticker: s.ticker, event_ticker: s.event_ticker })) + "' target='_blank' rel='noopener'>" + esc(s.title || s.ticker) +
              "</a><br><small class='muted'>" + esc(s.ticker) + "</small></td><td>" + topicPill(s.topic) +
              '</td><td>' + (s.result === "yes" ? '<span class="pill yes">YES</span>' : s.result === "no" ? '<span class="pill no">NO</span>' : '<span class="pill flag">' + esc(s.result || "unverified") + "</span>") +
              '</td><td class="num">' + money(s.settlement_value) + '</td><td>' + esc(s.settlement_ts || "") + "</td></tr>";
          }).join("")
        : '<tr><td colspan="5" class="empty">No resolved tracked events yet. Outcomes are read from the official result / settlement fields.</td></tr>';
    }
  }

  /* ---------- sources page ---------- */
  var TABLES = [
    { id: "tEndpoints", title: "Endpoints", key: "endpoints" },
    { id: "tMarketFields", title: "Market response fields", key: "marketFields" },
    { id: "tUnits", title: "Units & conversions", key: "units" },
    { id: "tOrderbook", title: "Order book", key: "orderbook" },
    { id: "tWebsocket", title: "WebSocket channels", key: "websocket" },
    { id: "tAuth", title: "Authentication", key: "auth" },
    { id: "tSettlement", title: "Settlement & resolution", key: "settlement" },
    { id: "tChangelog", title: "Changelog highlights", key: "changelog" }
  ];
  function renderSources() {
    TABLES.forEach(function (t) {
      var el = $(t.id);
      if (!el || !REF[t.key]) return;
      var rows = REF[t.key].map(function (r) {
        return "<tr><td>" + esc(r.label) + "</td><td><code>" + esc(r.value) + "</code></td><td>" + esc(r.note) +
          '</td><td class="source"><a href="' + esc(r.source.url) + '" target="_blank" rel="noopener">' + esc(r.source.label) + " ↗</a></td></tr>";
      }).join("");
      el.innerHTML = '<h2>' + esc(t.title) + "</h2>" +
        '<div class="tablewrap"><table><thead><tr><th>Item</th><th>Value</th><th>Note</th><th>Official source</th></tr></thead><tbody>' +
        rows + "</tbody></table></div>";
    });
  }

  /* ---------- per-page render ---------- */
  function render() {
    setLive(E.state.connected, E.state.lastError);
    var page = document.body.getAttribute("data-page");
    if (page === "index" || page === "landing") {
      renderMarketTable("markets", E.state.topicMatches, { limit: 60 });
      renderChat("alertsPreview", E.state.alerts, false);
      renderChat("roiPreview", E.state.roiAlerts, true);
      var st = $("idxStats");
      if (st) st.innerHTML =
        '<div class="card"><small>Open markets (topics)</small><strong>' + E.state.topicMatches.length + "</strong></div>" +
        '<div class="card"><small>All events tracked</small><strong>' + E.state.topicMatches.length + "</strong></div>" +
        '<div class="card"><small>Alerts fired</small><strong>' + E.state.alerts.length + "</strong></div>" +
        '<div class="card"><small>High-ROI signals</small><strong>' + E.state.roiAlerts.length + "</strong></div>";
    } else if (page === "alerts") {
      renderChat("allChat", E.state.alerts, false);
      renderChat("roiChat", E.state.roiAlerts, true);
    } else if (["gas", "elections", "culture", "crypto", "golf"].indexOf(page) !== -1) {
      var topic = E.state.topic;
      var tm = E.state.topicMatches.filter(function (m) { return E.classify(m) === topic; });
      renderMarketTable("markets", tm, { limit: 100 });
      var al = E.state.alerts.filter(function (a) { return a.topic === topic; });
      var ro = E.state.roiAlerts.filter(function (a) { return a.topic === topic; });
      renderChat("alertsPreview", al, false);
      renderChat("roiPreview", ro, true);
    } else if (page === "trading") {
      renderTrading();
    } else if (page === "sources") {
      /* static, rendered on load */
    }
    renderLab();
  }

  function init() {
    buildChrome();
    var page = document.body.getAttribute("data-page");
    var topic = document.body.getAttribute("data-topic");
    if (topic) E.setTopic(topic);
    if (page === "sources") renderSources();
    if (page === "flagged") { /* static */ }
    if (page === "trading") {
      ["Momentum", "MeanReversion", "Value"].forEach(function (name) {
        var cb = $("strat_" + name);
        if (cb) { cb.checked = !!E.strategyFlags[name]; cb.onchange = function () { E.strategyFlags[name] = cb.checked; }; }
      });
      var clearBtn = $("clearTrades");
      if (clearBtn) clearBtn.onclick = function () { E.clearTrades(); };
      var manual = $("manualTrade");
      if (manual) manual.onclick = function () {
        var t = $("mTicker").value.trim();
        var side = $("mSide").value;
        var price = Number($("mPrice").value);
        var qty = Math.max(1, Math.floor(Number($("mQty").value) || 1));
        if (!t || !Number.isFinite(price) || price <= 0 || price >= 1) { $("manualMsg").textContent = "Enter a ticker and a price between $0.01 and $0.99."; return; }
        var m = E.state.byTicker[t];
        if (!m) { $("manualMsg").textContent = "Ticker not found in the current live market set."; return; }
        var ok = E.openPosition(m, side, price, $("mStrategy").value, qty);
        $("manualMsg").textContent = ok ? "Paper position recorded locally (no order sent)." : "Not enough mock cash for this position.";
        renderTrading();
      };
    }
    E.start();
    window.addEventListener("resize", function () { if (document.body.getAttribute("data-page") !== "sources") drawChart(); });
  }

  window.KalshiUI = { render: render, onCycle: render, drawChart: drawChart };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
