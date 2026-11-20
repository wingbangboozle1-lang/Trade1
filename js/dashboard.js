/*
 * Dashboard rendering: market tables, price charts, orderbook/liquidity, and
 * sharp-move annotations. Table rows carry a link to the official Kalshi source.
 */

(function (global) {
  "use strict";

  const CFG = global.KD_CONFIG;
  const fmt$ = (v) => (v === null || v === undefined ? "" : "$" + Number(v).toFixed(2));
  const fmtNum = (v) => (v === null || v === undefined ? "" : Number(v).toLocaleString());

  function marketRow(m, linkBase) {
    const src = linkBase + "/markets/" + encodeURIComponent(m.ticker);
    const resCell = m.resolved
      ? `<span class="pill ${m.resolution === 'yes' ? 'pill-yes' : m.resolution === 'no' ? 'pill-no' : 'pill-warn'}">${escapeHtml(m.resolution || "?")}</span>`
      : `<span class="muted">open</span>`;
    return `<tr>
      <td class="ticker"><a href="${src}" target="_blank" rel="noopener">${escapeHtml(m.ticker)}</a></td>
      <td class="title-cell">${escapeHtml(m.title)}<div class="muted small">${escapeHtml(m.series || "—")}</div></td>
      <td class="num">${fmt$(m.yes_bid)}<span class="muted"> / ${fmt$(m.yes_ask)}</span></td>
      <td class="num">${fmt$(m.last_price)}</td>
      <td class="num">${fmtNum(m.volume)}</td>
      <td class="num">${fmtNum(m.open_interest)}</td>
      <td class="num">${m.resolved ? fmt$(m.last_price) : ""}</td>
      <td>${resCell}</td>
      <td class="src"><a href="${src}" target="_blank" rel="noopener">Kalshi ↗</a></td>
    </tr>`;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderTopicTable(topicKey) {
    const host = document.getElementById("market-table");
    if (!host) return;
    const meta = CFG.TOPIC_META[topicKey];
    const markets = (global.KD_store.state.topics[topicKey] || []);
    const base = global.KD_store.state.base || "https://external-api.demo.kalshi.co/trade-api/v2";

    host.innerHTML = `
      <div class="table-head">
        <h2>${meta.icon} ${meta.name} — Live Events</h2>
        <p class="muted">${meta.blurb}. Highest dollar-volume markets first. Sorted and tracked until resolution.</p>
      </div>
      ${markets.length
        ? `<table class="data-table">
          <thead><tr>
            <th>Ticker</th><th>Event</th><th>YES bid/ask</th><th>Last</th>
            <th>Volume</th><th>Open Int.</th><th>Close price</th><th>Resolved</th><th>Source</th>
          </tr></thead>
          <tbody>${markets.map((m) => marketRow(m, base)).join("")}</tbody>
        </table>`
        : `<div class="empty">No live ${meta.name} markets were returned by the Kalshi demo API. This can happen if the API is unreachable from this browser or no series match the topic. <span class="flag">unverified</span></div>`}
    `;
  }

  /* Render the selected market detail: line chart + depth chart + sharp moves. */
  function renderMarketDetail() {
    const tickerEl = document.getElementById("detail-ticker");
    const chartHost = document.getElementById("price-chart");
    const depthHost = document.getElementById("depth-chart");
    const sharpHost = document.getElementById("sharp-moves");
    if (!tickerEl || !chartHost) return;

    const ticker = tickerEl.dataset.ticker;
    const store = global.KD_store;
    const m = store.state.markets[ticker];
    if (!m) {
      chartHost.innerHTML = `<div class="empty">No data for <code>${escapeHtml(ticker)}</code> yet.</div>`;
      return;
    }

    // Title + status
    document.getElementById("detail-title").textContent = m.title;
    document.getElementById("detail-meta").innerHTML =
      `<span class="pill ${m.resolved ? (m.resolution === 'yes' ? 'pill-yes' : 'pill-no') : 'pill-open'}">${m.resolved ? 'resolved ' + escapeHtml(m.resolution) : 'live'}</span> ` +
      `ticker <code>${escapeHtml(m.ticker)}</code> · series <code>${escapeHtml(m.series || '—')}</code>`;

    // price chart
    if (!chartHost._chart) {
      chartHost._chart = new global.KD_charts.LineChart(chartHost.querySelector("canvas"));
    }
    const win = global.KD_store.state.chartWindow || 900;
    chartHost._chart.setWindow(win);
    chartHost._chart.setData(store.state.series[ticker] || []);
    chartHost._chart.render();

    // depth chart
    if (!depthHost._chart) {
      depthHost._chart = new global.KD_charts.DepthChart(depthHost.querySelector("canvas"));
    }
    const book = store.state.books[ticker];
    depthHost._chart.setData(book ? book.yes : [], book ? book.no : []);
    depthHost._chart.render();

    // sharp moves >= threshold with source links
    const sharp = store.state.sharpMoves[ticker] || [];
    const thresh = CFG.SHARP_MOVE_THRESHOLD_DOLLARS;
    sharpHost.innerHTML = `<h3>Sharp moves (≥ ${fmt$(thresh)})</h3>` + (sharp.length
      ? `<ul class="sharp-list">${sharp.slice(-20).reverse().map((s) =>
          `<li><span class="${s.delta > 0 ? 'up' : 'down'}">${s.delta > 0 ? "+" : ""}${s.delta.toFixed(2)}</span> ` +
          `<span class="muted">${new Date(s.t).toLocaleTimeString()}</span> · ` +
          `from ${fmt$(s.from)} → ${fmt$(s.to)} · ` +
          `<a href="${store.state.base}/markets/${encodeURIComponent(ticker)}" target="_blank" rel="noopener">market ↗</a></li>`).join("")}</ul>`
      : `<p class="muted">No price moves ≥ ${fmt$(thresh)} detected while tracking.</p>`);
  }

  function bindChartWindow(select) {
    if (!select) return;
    select.addEventListener("change", () => {
      global.KD_store.state.chartWindow = Number(select.value);
      global.KD_store.notify();
      renderMarketDetail();
    });
  }

  function selectTicker(ticker) {
    const el = document.getElementById("detail-ticker");
    if (el) { el.dataset.ticker = ticker; }
    document.getElementById("detail-panel").classList.remove("hidden");
    renderMarketDetail();
  }

  /* Wire up click-to-view for market rows across the site. */
  function wireTables() {
    document.querySelectorAll("[data-topic] tbody").forEach((tbl) => {
      tbl.addEventListener("click", (e) => {
        const a = e.target.closest("a[data-ticker]");
        // (rows use direct links; detail panel selected via data-detail)
      });
    });
    document.querySelectorAll("[data-detail]").forEach((el) => {
      el.addEventListener("click", () => selectTicker(el.dataset.detail));
    });
  }

  function init() {
    wireTables();
    const winSel = document.getElementById("chart-window");
    if (winSel) {
      winSel.innerHTML = CFG.CHART_WINDOWS
        .map((w) => `<option value="${w.seconds}">${w.label}</option>`).join("");
      winSel.value = "900";
      bindChartWindow(winSel);
    }
  }

  global.KD_dashboard = { init, renderTopicTable, renderMarketDetail, selectTicker, escapeHtml, fmt$, fmtNum };
})(window);
