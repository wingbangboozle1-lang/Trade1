/* Trade1 — ui.js — formatting, table builders, source links, status, export.
 * Link policy (docs/FLAGGED.md F5/F6): every row links the exact demo REST URL that produced the
 * value + the official kalshi.com series page; news links are clearly-labeled searches.
 */
"use strict";

(function () {
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function money(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return ""; // never infer
    return "$" + Number(v).toFixed(dp === undefined ? 2 : dp);
  }
  function cents(v) { return isNaN(v) ? "" : "$" + Number(v).toFixed(2); }
  function num(v, dp) { return (v === null || v === undefined || isNaN(v)) ? "" : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp || 0 }); }
  function clock(t) { return new Date(t).toLocaleTimeString([], { hour12: false }); }
  function dateTime(t) {
    return new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function ago(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    return Math.floor(s / 3600) + "h ago";
  }
  function stamp(id, t) { const e = document.getElementById(id); if (e) e.textContent = "updated " + clock(t); }
  function html(id, s) { const e = document.getElementById(id); if (e) e.innerHTML = s; }

  // ---- verified link builders ----
  function apiUrl(path, params) {
    const qs = params ? "?" + Object.entries(params).filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") : "";
    return T1.API_BASE + path + qs;
  }
  function kalshiSeriesUrl(seriesTicker) {
    return `https://kalshi.com/markets/${String(seriesTicker || "").toLowerCase()}`;
  }
  function newsSearchUrl(title) {
    return "https://news.google.com/search?q=" + encodeURIComponent(title || "") + "&hl=en-US";
  }
  function sourceCell(seriesTicker, apiPath, apiParams) {
    return `<a class="src" href="${esc(apiUrl(apiPath, apiParams))}" target="_blank" rel="noopener" title="Open the exact demo API call that produced these values">API</a>` +
      ` · <a class="src" href="${esc(kalshiSeriesUrl(seriesTicker))}" target="_blank" rel="noopener" title="Official Kalshi page for this series">Kalshi</a>`;
  }
  function settlementLinks(sources, max) {
    const list = (sources || []).slice(0, max || 3);
    if (!list.length) return "";
    return list.map((s) => `<a class="src" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(" · ");
  }
  function newsLink(title) {
    return `<a class="src news" href="${esc(newsSearchUrl(title))}" target="_blank" rel="noopener" title="News search — labeled as a search, not a verified cause">news?</a>`;
  }

  // ---- status pill + error banner ----
  function initStatus(pillId, bannerId) {
    const pill = document.getElementById(pillId);
    const banner = document.getElementById(bannerId);
    KalshiAPI.onStatus((s) => {
      if (pill) {
        pill.className = "pill " + (s.ok === true ? "pill-ok" : s.ok === false ? "pill-bad" : "pill-idle");
        pill.textContent = s.ok === true ? "● Live — Kalshi demo API" : s.ok === false ? "● API issue — retrying" : "● Connecting…";
      }
      if (banner && s.ok === false && /Fetch failed/.test(s.msg)) {
        banner.style.display = "block";
      }
    });
  }

  // ---- CSV export ----
  function downloadCSV(filename, headers, rows) {
    const csv = [headers.join(",")].concat(rows.map((r) => r.map((c) => {
      const s = String(c == null ? "" : c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---- delta coloring ----
  function deltaHtml(d) {
    if (d === null || d === undefined || isNaN(d)) return "";
    const cls = d > 0 ? "up" : d < 0 ? "down" : "";
    const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "•";
    return `<span class="${cls}">${arrow} ${cents(Math.abs(d))}</span>`;
  }

  function topicBadge(topicId) {
    const t = T1.TOPICS[topicId];
    if (!t) return "";
    return `<span class="topic-badge" style="background:${t.accent}1a;color:${t.accent}">${t.icon} ${esc(t.label)}</span>`;
  }

  window.UI = {
    esc, money, cents, num, clock, dateTime, ago, stamp, html,
    apiUrl, kalshiSeriesUrl, newsSearchUrl,
    sourceCell, settlementLinks, newsLink,
    initStatus, downloadCSV, deltaHtml, topicBadge,
  };
})();
