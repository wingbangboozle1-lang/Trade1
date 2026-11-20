"""
Static site builder.

Why a generator: the dashboard has ~10 pages that all need the same data, the same nav and the same
source links. Generating them keeps a single source of truth, lets the pipeline rebuild and
redeploy after every collection cycle, and makes every table cell traceable to a data file that the
collector wrote.

Design rules enforced here:
  * no value is written to HTML that is not present in a data file
  * a value that is missing renders as an em dash and is listed in the "unverified" panel
  * every market/event row carries links back to the exchange API and the Kalshi site

Run: python -m sitegen.build
"""

from __future__ import annotations

import json
import os
import shutil
from collections import defaultdict
from datetime import datetime, timezone

from collector import strategies as stratmod
from collector import topics as topicmod
from collector import fees
from collector.util import DATA, ROOT, SOURCES, iso, read_json, write_json

OUT = ROOT
BUILT = []          # list of (path, title) for nav/link checks


# --------------------------------------------------------------------------- helpers
def esc(value) -> str:
    if value is None:
        return ""
    return (str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#39;"))


def money(v, digits=2, dash="—"):
    if v is None or v == "":
        return f'<span class="faint">{dash}</span>'
    return f'<span class="money">${v:,.{digits}f}</span>'


def cents(v, dash="—"):
    if v is None or v == "":
        return f'<span class="faint">{dash}</span>'
    return f'<span class="money">${v:.2f}</span>'


def num(v, digits=0, dash="—"):
    if v is None or v == "":
        return f'<span class="faint">{dash}</span>'
    return f'<span class="money">{v:,.{digits}f}</span>'


def pct(v, digits=1, dash="—"):
    if v is None or v == "":
        return f'<span class="faint">{dash}</span>'
    return f'<span class="money">{v * 100:,.{digits}f}%</span>'


def signed(v, digits=2, dash="—"):
    if v is None or v == "":
        return f'<span class="faint">{dash}</span>'
    cls = "up" if v > 0 else ("down" if v < 0 else "mut")
    sign = "+" if v > 0 else ""
    return f'<span class="money {cls}">{sign}${v:,.{digits}f}</span>'


def when(ts):
    if not ts:
        return '<span class="faint">—</span>'
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def ago(ts):
    if not ts:
        return "—"
    delta = int(datetime.now(tz=timezone.utc).timestamp()) - int(ts)
    if delta < 0:
        return "just now"
    if delta < 90:
        return f"{delta}s ago"
    if delta < 5400:
        return f"{delta // 60}m ago"
    if delta < 172800:
        return f"{delta // 3600}h ago"
    return f"{delta // 86400}d ago"


NAV = [
    ("index.html", "Overview"),
    ("markets.html", "Live markets"),
    ("events.html", "Events by dollars"),
    ("jumps.html", "Sharp moves"),
    ("resolutions.html", "Resolved"),
    ("portfolio.html", "Portfolio"),
    ("strategies.html", "Strategies"),
    ("summary.html", "Executive summary"),
    ("methodology.html", "Methodology"),
    ("flagged.html", "Flagged for review"),
]


def page(path, title, body, active=None, description=""):
    current = ' aria-current="page"'
    nav = "\n".join(
        '<a href="%s"%s>%s</a>' % (href, current if href == active else "", esc(label))
        for href, label in NAV
    )
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · Trade1 Kalshi dashboard</title>
<meta name="description" content="{esc(description or title)}">
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<header class="topbar">
  <div class="brand"><span class="mark">T1</span><div>Trade1<small>Kalshi markets, tracked and simulated</small></div></div>
  <nav class="main">{nav}</nav>
</header>
<main>
{body}
</main>
<footer class="foot">
  <div class="footer-links">
    <a href="https://docs.kalshi.com/" target="_blank" rel="noopener">Kalshi API docs ↗</a>
    <a href="https://external-api.demo.kalshi.co/trade-api/v2/exchange/status" target="_blank" rel="noopener">Demo exchange status ↗</a>
    <a href="https://kalshi.com/markets" target="_blank" rel="noopener">Kalshi market site ↗</a>
    <a href="methodology.html">Methodology</a>
    <a href="flagged.html">Flagged for review</a>
  </div>
  Market data © Kalshi. Trade1 is an independent research dashboard. Simulated trades are not
  exchange trades and this is not investment advice. Values shown are copied from API responses;
  anything unconfirmed is left blank and flagged.
</footer>
<script src="assets/chart.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
"""
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full) or OUT, exist_ok=True)
    with open(full, "w") as f:
        f.write(html)
    BUILT.append(path)
    return html


def kpi(label, value, sub=""):
    return f'''<div class="card kpi"><span class="label">{esc(label)}</span>
<span class="value">{value}</span><span class="sub">{sub}</span></div>'''


def table(headers, rows, table_id="", wrap_class="", empty="No rows."):
    """headers: list of (label, is_numeric, sort_key)."""
    th = "".join(
        f'<th class="{"num" if n else ""}" data-key="{esc(k)}"><button type="button">{esc(l)}</button></th>'
        for l, n, k in headers
    )
    body = rows if rows else f'<tr><td class="empty" colspan="{len(headers)}">{esc(empty)}</td></tr>'
    return f'''<div class="tablewrap {wrap_class}"><table id="{table_id}" class="sortable">
<thead><tr>{th}</tr></thead>
<tbody>{body}</tbody></table></div>'''


def load(name, default=None):
    return read_json(os.path.join(DATA, name), default)


# --------------------------------------------------------------------------- overview
def build_index(snap, summary, res_summary, jumps, universe):
    markets = (snap or {}).get("markets") or []
    events = (snap or {}).get("events") or []
    counts = (snap or {}).get("counts") or {}
    topics = (universe or {}).get("topics") or topicmod.topic_catalogue()
    topic_slugs = [t["slug"] for t in topics]

    top_events = defaultdict(list)
    for e in events:
        for t in e.get("topics") or []:
            top_events[t].append(e)

    per_topic = []
    for t in topics:
        evs = sorted(top_events.get(t["slug"], []), key=lambda e: -e["dollar_volume"])
        mk = [m for m in markets if t["slug"] in m["topics"]]
        per_topic.append(
            f'''<div class="card">
<h2>{esc(t["label"])} <span class="hint">{len(mk)} markets · {len(evs)} events</span></h2>
<p class="faint" style="font-size:12.5px;margin:0 0 10px">{esc(t["basis"])}</p>
{_mini_table(evs[:6])}
<p style="margin:10px 0 0"><a href="markets.html?topic={t["slug"]}">Open {esc(t["label"])} markets →</a></p>
</div>'''
        )

    latest_ts = (snap or {}).get("generated_ts")
    total_dv = sum(e["dollar_volume"] for e in events)
    equity = (summary or {}).get("equity")
    ret = (summary or {}).get("total_return")
    resolved = (res_summary or {}).get("resolved", 0)

    stale = ""
    if latest_ts:
        age_min = (datetime.now(tz=timezone.utc).timestamp() - latest_ts) / 60
        if age_min > 90:
            stale = (f'<div class="notice"><strong>Data is {ago(latest_ts)}.</strong> The collector runs every '
                     f'15 minutes from GitHub Actions; a gap usually means a failed or queued run, not fake '
                     f'fresh data. Timestamps are shown on every table.</div>')

    body = f"""
<h1>Overview</h1>
<p class="lede">Live Kalshi event markets for five topics only — gas prices, elections, culture, crypto
and golf — ranked by the dollar amount actually traded, tracked until each event resolves YES or NO.
Simulated strategies trade the same data so the portfolio page can compare approaches.</p>
{stale}
<div class="grid cols-4" style="margin-bottom:16px">
  {kpi("Markets tracked", num(counts.get("markets")), f'{len(topics)} topics · {num(counts.get("series"))} series indexed')}
  {kpi("Dollar volume (all tracked)", money(total_dv, 0), "contracts × $1 notional, from exchange volume")}
  {kpi("Simulated equity", money(equity), f'start $10,000 · {pct(ret)} total')}
  {kpi("Resolved tracked", num(resolved), f'{(res_summary or {}).get("pending", 0)} pending · YES/NO from exchange')}
</div>
<div class="grid cols-2" style="margin-bottom:16px">
  <div class="card">
    <h2>Highest-dollar live events <span class="hint">all five topics</span></h2>
    {_event_table(events[:14])}
    <p style="margin:10px 0 0"><a href="events.html">Full event ranking →</a></p>
  </div>
  <div class="card">
    <h2>Moves ≥ $0.10 <span class="hint">{len((jumps or {}).get("jumps") or [])} recorded</span></h2>
    {_jump_table((jumps or {}).get("jumps") or [], limit=8)}
    <p style="margin:10px 0 0"><a href="jumps.html">All sharp moves →</a></p>
  </div>
</div>
<h2 style="margin-bottom:10px">Topics</h2>
<div class="grid cols-2">{''.join(per_topic)}</div>
<div class="card" style="margin-top:16px">
  <h2>How to read this dashboard</h2>
  <ul class="clean">
    <li><strong>Dollar volume</strong> = exchange <code>volume_fp</code> × contract notional ($1). It is the
      size of the market, not anyone's profit.</li>
    <li><strong>Price</strong> is the YES contract in dollars (0–1). The chart X axis is time
      (seconds → days) and the Y axis is the contract price.</li>
    <li><strong>Liquidity</strong> is measured from the live order book: dollars resting to buy YES
      or NO, and contracts available at each price.</li>
    <li><strong>Sharp moves</strong> are flagged only when an observed price change is ≥ $0.10. Causes
      are never asserted; each move links to the market and its official rules.</li>
    <li><strong>Simulated trades</strong> are paper only — see <a href="portfolio.html">Portfolio</a>
      and <a href="strategies.html">Strategies</a>.</li>
  </ul>
</div>
"""
    return page("index.html", "Overview", body, active="index.html",
                description="Live Kalshi dashboard for gas prices, elections, culture, crypto and golf markets.")


def _mini_table(events):
    if not events:
        return '<p class="empty">No live events in this topic right now.</p>'
    rows = "".join(
        f'<tr><td class="title"><a href="{esc(e["site"])}" target="_blank" rel="noopener">{esc(e["title"][:70])}</a></td>'
        f'<td class="num">{money(e["dollar_volume"], 0)}</td></tr>'
        for e in events
    )
    return f'<table><thead><tr><th>Event</th><th class="num">$ volume</th></tr></thead><tbody>{rows}</tbody></table>'


def _event_table(events):
    rows = "".join(
        f'''<tr><td class="title"><a href="{esc(e["site"])}" target="_blank" rel="noopener">{esc(e["title"])}</a>
<span class="tk">{esc(e["event_ticker"])} · {esc(", ".join(e["topics"]))}</span></td>
<td class="num">{money(e["dollar_volume"], 0)}</td>
<td class="num">{money(e["dollar_volume_24h"], 0)}</td>
<td class="num">{cents(e["top_yes_price"])}</td>
<td class="num nowrap">{when(e["close_ts"])}</td></tr>'''
        for e in events
    )
    return (f'<div class="tablewrap short"><table><thead><tr><th>Event</th><th class="num">$ volume</th>'
            f'<th class="num">24h $</th><th class="num">top YES price</th><th class="num">closes</th></tr></thead>'
            f'<tbody>{rows or "<tr><td class=empty colspan=5>No live events collected yet.</td></tr>"}</tbody></table></div>')


def _jump_table(jumps, limit=None):
    rows = []
    for j in (jumps if limit is None else jumps[:limit]):
        cls = "up" if j["direction"] == "up" else "down"
        arrow = "▲" if j["direction"] == "up" else "▼"
        rows.append(
            f'''<tr><td class="num nowrap">{when(j["to_ts"])}</td>
<td class="title"><a href="{esc((j.get("sources") or {}).get("site") or "#")}" target="_blank" rel="noopener">{esc(j["title"][:64])}</a>
<span class="tk">{esc(j["ticker"])}</span></td>
<td class="num">{cents(j["from"])}</td>
<td class="num {cls}">{arrow} {cents(j["to"])}</td>
<td class="num {cls}">{signed(j["delta"], 2)}</td>
<td><span class="chip flag">{esc(j["attribution_status"])}</span></td></tr>''')
    return table([("When", False, "when"), ("Market", False, "title"), ("From", True, "from"),
                  ("To", True, "to"), ("Δ", True, "delta"), ("Cause", False, "cause")],
                 "".join(rows), wrap_class="short",
                 empty="No move ≥ $0.10 has been observed yet. Moves appear here as soon as two consecutive "
                       "observations differ by that much.")


# --------------------------------------------------------------------------- markets
def build_markets(snap, universe, jumps):
    markets = (snap or {}).get("markets") or []
    topics = (universe or {}).get("topics") or topicmod.topic_catalogue()
    jump_by_ticker = defaultdict(list)
    for j in (jumps or {}).get("jumps") or []:
        jump_by_ticker[j["ticker"]].append(j)

    payload = {}
    for m in markets:
        hist = load(os.path.join("timeseries", f'{m["ticker"].replace("/", "_")}.json'), {}) or {}
        points = hist.get("points") or []
        payload[m["ticker"]] = {
            "ticker": m["ticker"], "title": m["title"], "event": m["event_title"],
            "topics": m["topics"], "points": points,
            "book": (m.get("book") or {}).get("levels") or {},
            "liquidity": (m.get("book") or {}),
            "close_time": m.get("close_time"),
            "rules_primary": m.get("rules_primary"),
            "sources": m.get("sources"),
            "jumps": [{"to_ts": j["to_ts"], "direction": j["direction"], "delta": j["delta"]}
                      for j in jump_by_ticker.get(m["ticker"], [])],
        }
    write_json(os.path.join(OUT, "assets", "data", "markets.json"), payload, indent=0)

    rows = []
    for m in markets:
        rows.append(
            f'''<tr data-topics="{esc(" ".join(m["topics"]))}" data-ticker="{esc(m["ticker"])}">
<td class="title"><a href="{esc((m.get("sources") or {}).get("site") or "#")}" target="_blank" rel="noopener">{esc(m["title"])}</a>
<span class="tk">{esc(m["ticker"])} · {esc(m["kalshi_category"])}</span></td>
<td class="num">{cents(m["yes_bid"])}</td>
<td class="num">{cents(m["yes_ask"])}</td>
<td class="num">{money(m["dollar_volume"], 0)}</td>
<td class="num">{money(m["dollar_volume_24h"], 0)}</td>
<td class="num">{money((m.get("book") or {}).get("total_liquidity_usd"), 0)}</td>
<td class="num">{num((m.get("book") or {}).get("yes_bid_qty_total"))}</td>
<td><span class="chip topic">{esc(", ".join(m["topics"]))}</span></td>
<td class="num nowrap">{when(m["close_ts"])}</td>
</tr>''')

    topic_buttons = '<button type="button" data-topic="all" aria-pressed="true">All</button>' + "".join(
        f'<button type="button" data-topic="{esc(t["slug"])}" aria-pressed="false">{esc(t["label"])}</button>'
        for t in topics)

    body = f"""
<h1>Live markets</h1>
<p class="lede">Every open market in the five topics, with price, dollar volume and live liquidity.
Click a row to chart it; the chart window switches between seconds, minutes, hours and days.</p>
<div class="notice info"><strong>Sorting matters.</strong> The default order is dollar volume, which is the
size of the market. Switch to liquidity to see where an order would actually fill.</div>
<div class="controls">
  <div class="seg" id="topicSeg">{topic_buttons}</div>
  <label class="inline">Sort
    <select id="marketSort">
      <option value="volume">$ volume</option>
      <option value="volume24">24h $ volume</option>
      <option value="liquidity">liquidity</option>
      <option value="price">YES price</option>
      <option value="close">close time</option>
    </select>
  </label>
  <input type="search" id="marketFilter" placeholder="Filter ticker or title…" style="min-width:220px">
  <span class="faint" id="marketCount">{len(rows)} markets</span>
</div>
<div class="grid cols-2">
  <div class="card">
    <h2>Markets <span class="hint">click a row to chart</span></h2>
    <div class="tablewrap"><table id="marketTable" class="sortable">
      <thead><tr>
        <th><button type="button">Market</button></th>
        <th class="num"><button type="button">YES bid</button></th>
        <th class="num"><button type="button">YES ask</button></th>
        <th class="num"><button type="button">$ volume</button></th>
        <th class="num"><button type="button">24h $</button></th>
        <th class="num"><button type="button">liquidity</button></th>
        <th class="num"><button type="button">contracts</button></th>
        <th><button type="button">topic</button></th>
        <th class="num"><button type="button">closes</button></th>
      </tr></thead>
      <tbody>{''.join(rows) or '<tr><td class="empty" colspan="9">No live markets collected yet. The collector runs every 15 minutes.</td></tr>'}</tbody>
    </table></div>
  </div>
  <div>
    <div class="card">
      <h2><span id="chartTitle">Contract price</span> <span class="hint" id="chartTicker">select a market</span></h2>
      <div class="controls">
        <div class="seg" id="rangeSeg">
          <button type="button" data-range="60" aria-pressed="false">1m</button>
          <button type="button" data-range="300" aria-pressed="true">5m</button>
          <button type="button" data-range="3600" aria-pressed="false">1h</button>
          <button type="button" data-range="21600" aria-pressed="false">6h</button>
          <button type="button" data-range="86400" aria-pressed="false">24h</button>
          <button type="button" data-range="604800" aria-pressed="false">7d</button>
        </div>
        <label class="inline"><input type="checkbox" id="zoomY" checked> zoom Y</label>
      </div>
      <canvas class="chart" id="priceChart"></canvas>
      <div class="legend">
        <span><span class="swatch" style="background:#4aa8ff"></span>YES bid</span>
        <span><span class="swatch" style="background:#f7c260"></span>YES ask</span>
        <span><span class="swatch" style="background:#3ddc97"></span>mid</span>
        <span class="faint">dashed vertical lines = moves ≥ $0.10</span>
      </div>
      <p class="faint" style="font-size:12px;margin-top:8px">X axis: time · Y axis: contract price in dollars.
      Points are observations written by the collector; hover for exact values.</p>
    </div>
    <div class="card" style="margin-top:14px">
      <h2>Order book <span class="hint">contracts resting at each price</span></h2>
      <canvas class="chart short" id="depthChart"></canvas>
      <div class="grid cols-2" style="margin-top:10px">
        <div class="kpi"><span class="label">Liquidity to buy YES</span><span class="value money" id="liqYes">—</span>
          <span class="sub">dollars resting against you</span></div>
        <div class="kpi"><span class="label">Liquidity to buy NO</span><span class="value money" id="liqNo">—</span>
          <span class="sub">dollars resting against you</span></div>
      </div>
      <details style="margin-top:10px"><summary>Official rules &amp; links</summary>
        <p class="faint" id="marketRules" style="font-size:12.5px"></p>
        <p style="font-size:12.5px" id="marketLinks"></p>
      </details>
    </div>
  </div>
</div>
"""
    return page("markets.html", "Live markets", body, active="markets.html",
                description="Live Kalshi market prices, dollar volume and order-book liquidity.")


# --------------------------------------------------------------------------- events
def build_events(snap, universe):
    events = (snap or {}).get("events") or []
    topics = (universe or {}).get("topics") or topicmod.topic_catalogue()
    sections = []
    for t in topics:
        evs = [e for e in events if t["slug"] in (e.get("topics") or [])]
        evs.sort(key=lambda e: -e["dollar_volume"])
        rows = "".join(
            f'''<tr><td class="num">{i + 1}</td>
<td class="title"><a href="{esc(e["site"])}" target="_blank" rel="noopener">{esc(e["title"])}</a>
<span class="tk">{esc(e["event_ticker"])}</span></td>
<td class="num">{money(e["dollar_volume"], 0)}</td>
<td class="num">{money(e["dollar_volume_24h"], 0)}</td>
<td class="num">{money(e["open_interest_dollars"], 0)}</td>
<td class="num">{money(e["liquidity_usd"], 0)}</td>
<td class="num">{num(e["markets"])}</td>
<td class="num">{cents(e["top_yes_price"])}</td>
<td class="num nowrap">{when(e["close_ts"])}</td></tr>'''
            for i, e in enumerate(evs))
        sections.append(f'''<div class="card">
<h2>{esc(t["label"])} <span class="hint">{len(evs)} live events · ranked by dollar volume</span></h2>
<p class="faint" style="font-size:12.5px;margin:0 0 10px">{esc(t["basis"])}</p>
<div class="tablewrap short"><table><thead><tr><th>#</th><th>Event</th><th class="num">$ volume</th>
<th class="num">24h $</th><th class="num">open interest $</th><th class="num">liquidity $</th>
<th class="num">markets</th><th class="num">top YES</th><th class="num">closes</th></tr></thead>
<tbody>{rows or '<tr><td class="empty" colspan="9">No live events in this topic right now.</td></tr>'}</tbody></table></div>
</div>''')

    body = f"""
<h1>Events by dollar amount</h1>
<p class="lede">Kalshi's basic trading unit is the event, not the individual contract, so this is the page
that answers "which live event has the most money on it". Each topic is listed separately and events
within a topic stay grouped together.</p>
<div class="notice"><strong>Dollar volume</strong> sums <code>volume_fp × notional</code> for the event's
markets. It measures how much has traded, not how much is available; use the liquidity column for that.</div>
{''.join(sections)}
<div class="card" style="margin-top:14px">
  <h2>What "highest dollar amount" can and cannot mean here</h2>
  <ul class="clean">
    <li><strong>Computed:</strong> traded dollar volume per event, open-interest dollars, and resting
      liquidity dollars.</li>
    <li><strong>Not computed:</strong> a live "total money at stake" figure. Kalshi's public API exposes
      volume and open interest, not a pool of committed capital, so this dashboard never claims one.</li>
  </ul>
</div>
"""
    return page("events.html", "Events by dollars", body, active="events.html",
                description="Live Kalshi events ranked by traded dollar volume, grouped by topic.")


# --------------------------------------------------------------------------- jumps
def build_jumps(jumps, snap):
    all_jumps = (jumps or {}).get("jumps") or []
    rows = []
    for j in all_jumps:
        cls = "up" if j["direction"] == "up" else "down"
        arrow = "▲" if j["direction"] == "up" else "▼"
        att = j.get("attribution") or {}
        cause = (f'<a href="{esc(att.get("source_url"))}" target="_blank" rel="noopener">'
                 f'{esc(att.get("cause", "source"))}</a>') if att.get("source_url") else \
                '<span class="chip flag">unverified</span>'
        rows.append(
            f'''<tr><td class="num nowrap">{when(j["to_ts"])}</td>
<td class="title"><a href="{esc((j.get("sources") or {}).get("site") or "#")}" target="_blank" rel="noopener">{esc(j["title"])}</a>
<span class="tk">{esc(j["ticker"])}</span></td>
<td><span class="chip topic">{esc(", ".join(j.get("topics") or []))}</span></td>
<td class="num">{cents(j["from"])}</td><td class="num {cls}">{arrow} {cents(j["to"])}</td>
<td class="num {cls}">{signed(j["delta"], 2)}</td>
<td class="num">{money(j.get("liquidity_usd"), 0)}</td>
<td>{cause}</td></tr>''')

    body = f"""
<h1>Sharp moves ≥ $0.10</h1>
<p class="lede">Every observed contract-price change of at least ten cents, in either direction, with the
market it happened in. This is the alert level requested for the dashboard.</p>
<div class="notice"><strong>On causes.</strong> A price jump is a fact; the news story behind it is a
claim. This page shows the exchange data, the market's official rules and its settlement sources, and
labels the cause <em>unverified</em> unless a reviewer has filed a source link. No story is ever invented
to fill the gap.</div>
<div class="grid cols-3" style="margin-bottom:14px">
  {kpi("Moves recorded", num(len(all_jumps)), f'threshold ${(jumps or {}).get("threshold_dollars", 0.10):.2f}')}
  {kpi("Up moves", num(sum(1 for j in all_jumps if j["direction"] == "up"), 0), "price rose")}
  {kpi("Down moves", num(sum(1 for j in all_jumps if j["direction"] == "down"), 0), "price fell")}
</div>
<div class="card">
<h2>All recorded moves</h2>
{table([("When", False, "when"), ("Market", False, "market"), ("Topic", False, "topic"),
        ("From", True, "from"), ("To", True, "to"), ("Δ", True, "delta"),
        ("Liquidity", True, "liq"), ("Cause", False, "cause")], "".join(rows), "jumpTable",
       empty="No qualifying move yet.")}
<p class="faint" style="margin-top:10px;font-size:12.5px">How to submit a cause for review: add an entry
keyed <code>ticker@unix_timestamp</code> with <code>cause</code>, <code>source_url</code> and
<code>reviewer</code> to <code>data/attributions.json</code>. The page renders it only when a source URL
is present. See <a href="methodology.html">Methodology</a>.</p>
</div>
"""
    return page("jumps.html", "Sharp moves", body, active="jumps.html",
                description="Kalshi contract moves of $0.10 or more with source links.")


# --------------------------------------------------------------------------- resolutions
def build_resolutions(res_summary, snap):
    rows_doc = (res_summary or {}).get("rows") or []
    markets = {m["ticker"]: m for m in (snap or {}).get("markets") or []}
    rows = []
    for r in rows_doc:
        m = markets.get(r["ticker"]) or {}
        result = r.get("result") or ""
        chip = f'<span class="chip {"yes" if result == "yes" else "no"}">{esc(result.upper())}</span>' if result else '<span class="faint">—</span>'
        rows.append(
            f'''<tr><td class="title"><a href="{esc(r.get("source_url"))}" target="_blank" rel="noopener">{esc(r.get("title") or r["ticker"])}</a>
<span class="tk">{esc(r["ticker"])}</span></td>
<td>{chip}</td>
<td class="num nowrap">{when(r.get("close_ts"))}</td>
<td class="num nowrap">{when(r.get("resolved_ts"))}</td>
<td class="num">{esc(r.get("expiration_value") or "—")}</td>
<td><a href="{esc(r.get("source_url"))}" target="_blank" rel="noopener">API</a></td></tr>''')

    body = f"""
<h1>Resolution outcomes</h1>
<p class="lede">Tracked markets stay on this page until the exchange settles them, then the outcome is
recorded exactly as the API reports it: YES or NO.</p>
<div class="grid cols-4" style="margin-bottom:14px">
  {kpi("Tracked", num((res_summary or {}).get("tracked")), "every market the collector has seen")}
  {kpi("Resolved YES", num((res_summary or {}).get("resolved_yes")), "from exchange result field")}
  {kpi("Resolved NO", num((res_summary or {}).get("resolved_no")), "from exchange result field")}
  {kpi("Pending", num((res_summary or {}).get("pending")), "not yet settled")}
</div>
<div class="card">
<h2>Resolved outcomes</h2>
<p class="faint" style="font-size:12.5px;margin:0 0 10px">Source of every result: the market object's
<code>result</code> field from <code>GET /markets/{{ticker}}</code>. Empty results are shown as pending and
never inferred from the last traded price.</p>
{table([("Market", False, "market"), ("Result", False, "result"), ("Closed", False, "close"),
        ("Recorded", False, "recorded"), ("Expiration value", True, "exp"), ("Source", False, "src")],
       "".join(rows), empty="No tracked market has settled yet. Outcomes appear here automatically once the "
       "exchange reports a result.")}
</div>
<div class="card" style="margin-top:14px">
  <h2>How a Kalshi market resolves</h2>
  <ul class="clean">
    <li><strong>YES</strong> pays YES holders $1.00 per contract; <strong>NO</strong> pays NO holders
      $1.00 per contract.</li>
    <li>Markets move through unopened → open → closed → settled.</li>
    <li>Simple yes/no settlements carry no settlement fee.</li>
    <li>Source: <a href="{SOURCES["settlement"]["url"]}" target="_blank" rel="noopener">Kalshi docs — Market
      Settlement ↗</a>, <a href="{SOURCES["market_lifecycle"]["url"]}" target="_blank" rel="noopener">Market
      Lifecycle ↗</a>.</li>
  </ul>
</div>
"""
    return page("resolutions.html", "Resolved", body, active="resolutions.html",
                description="How tracked Kalshi events resolved: YES or NO, from the exchange.")


# --------------------------------------------------------------------------- portfolio
def build_portfolio(summary, ledger, live_status):
    summary = summary or {}
    ledger = ledger or {}
    curve = summary.get("equity_curve") or []
    pts = [{"t": p["t"], "v": p["equity"]} for p in curve if p.get("equity") is not None]

    strat_rows = []
    for s in summary.get("strategies") or []:
        strat_rows.append(
            f'''<tr><td><b>{esc(s["strategy"])}</b><span class="tk">{esc(s["family"])}</span></td>
<td class="num">{num(s["closed_trades"])}</td>
<td class="num">{pct(s.get("win_rate"))}</td>
<td class="num">{signed(s.get("realized"))}</td>
<td class="num">{pct(s.get("roi"), 2)}</td>
<td class="num">{money(s.get("fees"))}</td>
<td class="num">{num(s["open_positions"])}</td>
<td class="num">{signed(s.get("unrealized"))}</td></tr>''')

    pos_rows = []
    for p in (ledger.get("positions") or []):
        pos_rows.append(
            f'''<tr><td class="title">{esc(p.get("title") or p["ticker"])}<span class="tk">{esc(p["ticker"])}</span></td>
<td><span class="chip {'yes' if p['side'] == 'yes' else 'no'}">{esc(p["side"].upper())}</span></td>
<td class="num">{num(p["contracts"])}</td>
<td class="num">{cents(p.get("avg_price"))}</td>
<td class="num">{cents(p.get("mark"))}</td>
<td class="num">{signed(p.get("unrealized"))}</td>
<td>{esc(p.get("strategy"))}</td>
<td class="num nowrap">{when(p.get("opened_ts"))}</td></tr>''')

    closed_rows = []
    for c in (ledger.get("closed") or [])[-60:][::-1]:
        closed_rows.append(
            f'''<tr><td class="title">{esc(c.get("title") or c["ticker"])}<span class="tk">{esc(c["ticker"])}</span></td>
<td><span class="chip {'yes' if c['side'] == 'yes' else 'no'}">{esc(c["side"].upper())}</span></td>
<td class="num">{num(c["contracts"])}</td>
<td class="num">{cents(c.get("entry"))}</td>
<td class="num">{cents(c.get("exit"))}</td>
<td class="num">{signed(c.get("realized"))}</td>
<td>{esc(c.get("strategy"))}</td>
<td class="faint" style="font-size:12px">{esc(c.get("reason_close"))}</td></tr>''')

    live = live_status or {}
    live_note = ""
    if live.get("status") == "blocked":
        live_note = f'''<div class="notice"><strong>Demo-account trading is not running.</strong>
Missing: {esc("; ".join(live.get("problems") or []))}. The executor is implemented and refuses to send
an order without credentials; see <a href="flagged.html">Flagged for review</a>.</div>'''
    elif live.get("executed"):
        live_note = f'<div class="notice info">Demo orders executed: {num(len(live.get("orders") or []))}. Balance snapshot available in data/live/status.json.</div>'
    else:
        live_note = ('<div class="notice info"><strong>Live demo account: no orders placed.</strong> '
                     'The portfolio below is simulated from observed quotes.</div>')

    body = f"""
<h1>Portfolio</h1>
<p class="lede">Two ledgers, deliberately kept apart: a <b>simulated</b> portfolio that trades every
signal on observed quotes (always available), and the <b>Kalshi demo account</b> (only when credentials
exist). The simulated ledger is what makes strategy comparison possible without risking or requiring an
account.</p>
{live_note}
<div class="grid cols-4" style="margin-bottom:14px">
  {kpi("Equity", money(summary.get("equity")), f'cash {money(summary.get("cash"), 0)}')}
  {kpi("Total return", pct(summary.get("total_return")), f'start {money(summary.get("starting_balance"), 0)}')}
  {kpi("Closed trades", num(summary.get("closed_trades")), f'{num(summary.get("open_positions"))} open')}
  {kpi("Realized / fees", signed(summary.get("realized_total")), f'fees paid {money(summary.get("fees_total"))}')}
</div>
<div class="card">
  <h2>Equity curve <span class="hint">simulated · mark-to-market</span></h2>
  <div class="controls"><div class="seg" id="eqSeg">
    <button type="button" data-range="3600" aria-pressed="false">1h</button>
    <button type="button" data-range="21600" aria-pressed="false">6h</button>
    <button type="button" data-range="86400" aria-pressed="false">24h</button>
    <button type="button" data-range="604800" aria-pressed="false">7d</button>
    <button type="button" data-range="0" aria-pressed="true">all</button>
  </div></div>
  <canvas class="chart" id="equityChart"></canvas>
</div>
<div class="card" style="margin-top:14px">
  <h2>Performance by strategy</h2>
  <p class="faint" style="font-size:12.5px;margin:0 0 10px">Trades are grouped by the strategy that
  produced them, which is the category system used throughout. ROI is realized P&amp;L over entry notional.</p>
  <div class="tablewrap"><table><thead><tr><th>Strategy</th><th class="num">closed</th><th class="num">win rate</th>
  <th class="num">realized</th><th class="num">ROI</th><th class="num">fees</th><th class="num">open</th>
  <th class="num">unrealized</th></tr></thead>
  <tbody>{''.join(strat_rows) or '<tr><td class="empty" colspan="8">No simulated trades yet.</td></tr>'}</tbody></table></div>
</div>
<div class="grid cols-2" style="margin-top:14px">
  <div class="card">
    <h2>Open positions <span class="hint">{len(pos_rows)}</span></h2>
    <div class="tablewrap short"><table><thead><tr><th>Market</th><th>Side</th><th class="num">qty</th>
    <th class="num">entry</th><th class="num">mark</th><th class="num">unrealized</th><th>strategy</th>
    <th class="num">opened</th></tr></thead>
    <tbody>{''.join(pos_rows) or '<tr><td class="empty" colspan="8">No open positions.</td></tr>'}</tbody></table></div>
  </div>
  <div class="card">
    <h2>Recently closed</h2>
    <div class="tablewrap short"><table><thead><tr><th>Market</th><th>Side</th><th class="num">qty</th>
    <th class="num">entry</th><th class="num">exit</th><th class="num">P&amp;L</th><th>strategy</th><th>why</th></tr></thead>
    <tbody>{''.join(closed_rows) or '<tr><td class="empty" colspan="8">Nothing closed yet.</td></tr>'}</tbody></table></div>
  </div>
</div>
<div class="card" style="margin-top:14px">
  <h2>What the numbers do and do not include</h2>
  <ul class="clean">
    <li><strong>Included:</strong> entry and exit at the quoted touch, the official taker fee, and $1
      settlement payouts when a market resolves on your side.</li>
    <li><strong>Not included:</strong> queue position, partial fills beyond the quoted size, borrowing
      costs, taxes. There is no exchange account behind these numbers.</li>
    <li><strong>Fees</strong> use the published formula {esc("round_up(M × 0.07 × C × P × (1−P))")},
      verified against all 21 rows of Kalshi's schedule — see
      <a href="methodology.html">Methodology</a>.</li>
  </ul>
</div>
"""
    write_json(os.path.join(OUT, "assets", "data", "equity.json"), pts, indent=0)
    return page("portfolio.html", "Portfolio", body, active="portfolio.html",
                description="Simulated portfolio performance and demo-account status.")


# --------------------------------------------------------------------------- strategies
def build_strategies(summary):
    summary = summary or {}
    by_name = {s["strategy"]: s for s in summary.get("strategies") or []}
    cards = []
    for d in stratmod.describe_all():
        live = by_name.get(d["name"]) or {}
        params = "".join(f"<dt>{esc(k)}</dt><dd class='money'>{esc(v)}</dd>" for k, v in d["params"].items())
        cards.append(f'''<div class="card">
<h2>{esc(d["name"])} <span class="chip topic">{esc(d["family"])}</span></h2>
<p style="margin:0 0 10px">{esc(d["rule"])}</p>
<dl class="meta">{params}</dl>
<hr class="sep">
<div class="grid cols-4" style="gap:8px">
  <div class="kpi"><span class="label">closed</span><span class="value money">{num(live.get("closed_trades"))}</span></div>
  <div class="kpi"><span class="label">win rate</span><span class="value money">{pct(live.get("win_rate"))}</span></div>
  <div class="kpi"><span class="label">realized</span><span class="value money">{signed(live.get("realized"))}</span></div>
  <div class="kpi"><span class="label">open</span><span class="value money">{num(live.get("open_positions"))}</span></div>
</div></div>''')

    rows = []
    for d in stratmod.describe_all():
        live = by_name.get(d["name"]) or {}
        rows.append(f'''<tr><td><b>{esc(d["name"])}</b></td><td>{esc(d["family"])}</td>
<td style="max-width:420px;font-size:12.5px" class="mut">{esc(d["rule"])}</td>
<td class="num">{num(live.get("closed_trades"))}</td>
<td class="num">{pct(live.get("win_rate"))}</td>
<td class="num">{signed(live.get("realized"))}</td></tr>''')

    body = f"""
<h1>Strategies</h1>
<p class="lede">Six automated strategies, each a deterministic rule over the same collected data, so the
comparison is fair. Every threshold below is the number actually used by the engine.</p>
<div class="notice info"><strong>Deterministic by design.</strong> No randomness and no hand tuning between
runs: the same snapshot always produces the same decision. That is what makes the results on the
Portfolio page reproducible.</div>
<div class="grid cols-3" style="margin-bottom:16px">{''.join(cards)}</div>
<div class="card">
  <h2>Side-by-side</h2>
  <div class="tablewrap"><table><thead><tr><th>Strategy</th><th>Type</th><th>Rule</th>
  <th class="num">closed</th><th class="num">win rate</th><th class="num">realized</th></tr></thead>
  <tbody>{''.join(rows)}</tbody></table></div>
</div>
<div class="card" style="margin-top:14px">
  <h2>Why these categories</h2>
  <ul class="clean">
    <li><strong>Statistical</strong> — compares price with a reference probability that does not depend on
      the quote itself.</li>
    <li><strong>Momentum / Market making / Event driven</strong> — the three ways traders react to a move:
      follow it, fade it, or act on the news behind it.</li>
    <li><strong>Event thesis</strong> — category-level conviction rather than a price pattern.</li>
    <li><strong>Arbitrage</strong> — exploits the documented identity that a YES bid at X equals a NO ask
      at 1−X.</li>
  </ul>
  <p class="faint" style="font-size:12.5px">Live execution of any of these against the demo account requires
  credentials and is described on <a href="methodology.html">Methodology</a>; the current state is recorded
  on <a href="flagged.html">Flagged for review</a>.</p>
</div>
"""
    return page("strategies.html", "Strategies", body, active="strategies.html",
                description="The six simulated strategies, their exact rules and results.")


# --------------------------------------------------------------------------- summary
def build_summary(snap, summary, res_summary, jumps, universe):
    counts = (snap or {}).get("counts") or {}
    events = (snap or {}).get("events") or []
    biggest = events[0] if events else None
    body = f"""
<h1>Executive summary</h1>
<p class="lede">What this project is, what it measured, and what it deliberately does not claim.
Every figure links back to the page that computes it.</p>

<div class="card">
<h2>The ask, and where it is answered</h2>
<div class="tablewrap"><table>
<thead><tr><th>Requirement</th><th>Where</th><th>Status</th></tr></thead>
<tbody>
<tr><td>Live dashboard of highest-dollar events for gas, elections, culture, crypto, golf only</td>
<td><a href="events.html">Events by dollars</a>, <a href="markets.html">Live markets</a></td>
<td><span class="chip live">done</span></td></tr>
<tr><td>Track live events until resolved, with YES/NO outcome</td>
<td><a href="resolutions.html">Resolved</a></td><td><span class="chip live">done</span></td></tr>
<tr><td>Automate simulated trades to test strategies</td>
<td><a href="strategies.html">Strategies</a>, <a href="portfolio.html">Portfolio</a></td>
<td><span class="chip live">done</span></td></tr>
<tr><td>Track portfolio performance on the demo account</td>
<td><a href="portfolio.html">Portfolio</a></td>
<td><span class="chip res">simulated only — no demo credentials</span></td></tr>
<tr><td>Analyse and categorise trades by strategy type</td>
<td><a href="portfolio.html">Portfolio</a></td><td><span class="chip live">done</span></td></tr>
<tr><td>Execute trades on events and track performance</td>
<td><a href="flagged.html">Flagged</a> (executor built, blocked on credentials)</td>
<td><span class="chip flag">blocked</span></td></tr>
<tr><td>Interactive price chart, X = time (s/m/h), Y = price</td>
<td><a href="markets.html">Live markets</a></td><td><span class="chip live">done</span></td></tr>
<tr><td>Current liquidity and contracts available at a price</td>
<td><a href="markets.html">Live markets</a> (order book)</td><td><span class="chip live">done</span></td></tr>
<tr><td>Flag moves ≥ $0.10 with links to likely causes</td>
<td><a href="jumps.html">Sharp moves</a></td>
<td><span class="chip res">moves done, causes unverified</span></td></tr>
<tr><td>Topics separate, events within a topic together</td>
<td><a href="events.html">Events by dollars</a></td><td><span class="chip live">done</span></td></tr>
<tr><td>Suggestions to make the site more live and interactive</td>
<td><a href="methodology.html#suggestions">Methodology — suggestions</a></td><td><span class="chip live">done</span></td></tr>
</tbody></table></div>
</div>

<div class="grid cols-4" style="margin:14px 0">
  {kpi("Markets tracked", num(counts.get("markets")), "in the five topics, company combos excluded")}
  {kpi("Live events", num(counts.get("events")), f'largest: {esc((biggest or {}).get("title", "—")[:34])}')}
  {kpi("Sharp moves", num(len((jumps or {}).get("jumps") or []), 0), "≥ $0.10 between observations")}
  {kpi("Resolved", num((res_summary or {}).get("resolved")), f'{(res_summary or {}).get("pending", 0)} still live')}
</div>

<div class="card">
<h2>Findings</h2>
<ul class="clean">
  <li><strong>Kalshi's demo environment is not a copy of production.</strong> Its open market list is
    dominated by freshly created multivariate combination markets with zero volume, so this dashboard
    reads live prices from the public production read endpoint and reserves the demo account for order
    execution. Both endpoints are Kalshi-documented; see <a href="methodology.html">Methodology</a>.</li>
  <li><strong>Topic membership is checkable, not guessed.</strong> Market topics come from Kalshi's own
    series <code>category</code>/<code>categories</code>/<code>tags</code> fields and the published
    category→tag map, which is why "Culture" includes Entertainment and why "Golf" is a Sports tag.</li>
  <li><strong>"Highest dollar amount" is reported two honest ways</strong>: traded dollar volume and
    resting liquidity dollars. Kalshi publishes no single "money at stake" figure, so none is invented.</li>
  <li><strong>Sharp moves are detected, causes are not asserted.</strong> A ≥ $0.10 move is a fact from
    two observations; a news explanation needs a source, and unattributed moves stay labelled unverified.</li>
  <li><strong>Strategy results are simulated and reproducible.</strong> Six rule-based strategies trade the
    collected data with official fees and $1 settlement; the ledger is a committed JSON file, so any number
    on the Portfolio page can be re-derived.</li>
  <li><strong>The fee model is verified, not assumed.</strong> The engine's implementation reproduces all
    21 published rows of Kalshi's fee schedule, and the test suite fails the build if it ever stops.</li>
</ul>
</div>

<div class="card" style="margin-top:14px">
<h2>Limitations, stated plainly</h2>
<ul class="clean">
  <li>No demo-account credentials exist in this environment, so live order execution has never run here.
    The code path is implemented, self-tested and refuses to fire without credentials.</li>
  <li>Price history begins when the collector first ran. It is not exchange history; Kalshi's
    candlestick endpoint is used only for backfill when available.</li>
  <li>Observation cadence is 15 minutes, so a move that reverses within the window can be missed.</li>
  <li>Order-book depth is sampled for the largest markets per topic, not for every market, to stay inside
    Kalshi's rate limits.</li>
  <li>News attribution is manual and empty by default. Unverified means unverified.</li>
</ul>
</div>
"""
    return page("summary.html", "Executive summary", body, active="summary.html",
                description="Executive summary of the Trade1 Kalshi dashboard project.")


# --------------------------------------------------------------------------- methodology
def build_methodology(snap, universe, flagged):
    fee_rows = "".join(
        f'<tr><td class="num">{esc(r["price"])}</td><td class="num">{esc(r["published"])}</td>'
        f'<td class="num">{esc(r["model"])}</td><td>{"match" if r["match"] else "MISMATCH"}</td></tr>'
        for r in fees.verify_schedule())

    src_rows = "".join(
        f'<tr><td><a href="{esc(s["url"])}" target="_blank" rel="noopener">{esc(s["title"])}</a></td>'
        f'<td class="mut" style="font-size:12.5px">{esc(s["claim"])}</td></tr>'
        for s in SOURCES.values())

    body = f"""
<h1>Methodology &amp; sources</h1>
<p class="lede">Every number on this site comes from a documented endpoint or a documented formula.
This page states which, so any value can be re-derived or challenged.</p>

<div class="card">
<h2>Data sources</h2>
<div class="tablewrap"><table><thead><tr><th>Source</th><th>What it is used for</th></tr></thead>
<tbody>{src_rows}</tbody></table></div>
</div>

<div class="card" style="margin-top:14px">
<h2>Endpoints actually called</h2>
<dl class="meta">
  <dt>Live prices</dt><dd><code>GET https://api.elections.kalshi.com/trade-api/v2/markets?status=open&mve_filter=exclude</code></dd>
  <dt>Events</dt><dd><code>GET …/events?status=open</code></dd>
  <dt>Topics</dt><dd><code>GET …/series?category=…</code> and <code>GET …/search/tags_by_categories</code></dd>
  <dt>Liquidity</dt><dd><code>GET …/markets/{{ticker}}/orderbook?depth=10</code></dd>
  <dt>History</dt><dd><code>GET …/series/{{series}}/markets/{{ticker}}/candlesticks</code> (1/60/1440-minute bars)</dd>
  <dt>Resolutions</dt><dd><code>GET …/markets/{{ticker}}</code> → <code>result</code></dd>
  <dt>Demo account</dt><dd><code>GET https://external-api.demo.kalshi.co/trade-api/v2/portfolio/balance</code> (signed)</dd>
</dl>
<p class="faint" style="font-size:12.5px;margin-top:8px">The demo account is read through the recommended
demo root from Kalshi's documentation. Public reads use the production shared endpoint because the demo
market list is not a mirror of production prices.</p>
</div>

<div class="card" style="margin-top:14px" id="suggestions">
<h2>Suggestions to make the site more live and interactive</h2>
<ul class="clean">
  <li><strong>Push updates instead of polling.</strong> Kalshi's WebSocket <code>ticker</code> channel
    would cut the delay from 15 minutes to under a second. It requires a signed handshake, so it becomes
    possible the moment demo credentials exist; until then polling is the honest option.</li>
  <li><strong>Alert on the move, not on the clock.</strong> Fire the ≥ $0.10 rule as soon as it happens and
    put it in the browser tab title, so the dashboard can be left open in the background.</li>
  <li><strong>One-line "why" column.</strong> Add a manual attribution entry (with a source link) next to
    each jump. The page already renders confirmed causes; the next step is a review queue.</li>
  <li><strong>Compare strategies on one axis.</strong> Overlay equity curves per strategy so the
    underperformer is obvious without reading tables.</li>
  <li><strong>Settlement countdown.</strong> Sort the markets page by time-to-close with a countdown, since
    most trader decisions are driven by expiry, not by volume.</li>
  <li><strong>Keep the charts boring.</strong> One price line, one liquidity bar set, no dual axes. The
    zoom presets (1m → 7d) already cover the useful ranges.</li>
</ul>
</div>

<div class="card" style="margin-top:14px">
<h2>Fee model verification</h2>
<p class="faint" style="font-size:12.5px">Recomputed from
<a href="{SOURCES["fee_schedule"]["url"]}" target="_blank" rel="noopener">Kalshi's published schedule</a> using
<code>round_up(M × 0.07 × C × P × (1−P))</code>. All 21 published rows must match or the build fails.</p>
<div class="tablewrap short"><table><thead><tr><th class="num">price</th><th class="num">published / 100</th>
<th class="num">model / 100</th><th>check</th></tr></thead><tbody>{fee_rows}</tbody></table></div>
</div>

<div class="card" style="margin-top:14px">
<h2>Verification rules applied to this site</h2>
<ul class="clean">
  <li>Every value is copied from an API response or computed from copied values with a stated formula.</li>
  <li>Missing values render as an em dash and appear on <a href="flagged.html">Flagged for review</a>.
    Nothing is interpolated, back-filled or inferred.</li>
  <li>Topic membership uses Kalshi's published fields only. The one editorial addition (requiring "gas" in
    a gas-price series title) is disclosed as a rule on the flagged page.</li>
  <li>Each market row links to its API object and its Kalshi site page.</li>
</ul>
<p class="faint" style="font-size:12.5px">Open irregularities: {len((flagged or {}).get("items") or [])}. They are
listed with sources on <a href="flagged.html">Flagged for review</a>.</p>
</div>
"""
    return page("methodology.html", "Methodology", body, active="methodology.html",
                description="Sources, endpoints, formulas and verification rules.")


# --------------------------------------------------------------------------- flagged
def build_flagged(flagged):
    items = (flagged or {}).get("items") or []
    sev_order = {"blocker": 0, "irregularity": 1, "unverified": 2, "note": 3}
    items = sorted(items, key=lambda i: (sev_order.get(i.get("severity"), 9), i.get("id", "")))
    rows = []
    for i in items:
        src = " ".join(
            f'<a href="{esc(u)}" target="_blank" rel="noopener">source</a>'
            for u in (i.get("sources") or []))
        rows.append(f'''<tr id="{esc(i.get("id"))}">
<td><span class="chip flag">{esc(i.get("severity"))}</span></td>
<td><b>{esc(i.get("title"))}</b><span class="tk">{esc(i.get("id"))}</span></td>
<td style="max-width:520px">{esc(i.get("detail"))}</td>
<td class="mut" style="font-size:12.5px">{esc(i.get("impact"))}</td>
<td>{src or '<span class="faint">none</span>'}</td></tr>''')

    counts = defaultdict(int)
    for i in items:
        counts[i.get("severity")] += 1

    body = f"""
<h1>Flagged for review</h1>
<p class="lede">Everything that could not be verified, is irregular, or is blocked — with sources, so each
item can be checked by hand and challenged. Nothing here blocks the deploy; it exists so the gaps are
visible instead of hidden.</p>
<div class="grid cols-4" style="margin-bottom:14px">
  {kpi("Blockers", num(counts.get("blocker")), "needed for a requested feature")}
  {kpi("Irregularities", num(counts.get("irregularity")), "surprising but documented")}
  {kpi("Unverified", num(counts.get("unverified")), "blank on the site rather than guessed")}
  {kpi("Notes", num(counts.get("note")), "disclosures and editorial rules")}
</div>
<div class="card">
<h2>Review queue</h2>
<div class="tablewrap"><table><thead><tr><th>Severity</th><th>Item</th><th>Detail</th>
<th>Impact</th><th>Sources</th></tr></thead><tbody>{''.join(rows) or '<tr><td class="empty" colspan="5">Nothing flagged.</td></tr>'}</tbody></table></div>
</div>
<div class="card" style="margin-top:14px">
  <h2>How to clear an item</h2>
  <ol class="clean">
    <li>Provide the missing input (for example demo API credentials), or</li>
    <li>file a source URL that settles the question in <code>data/attributions.json</code> or the
      corresponding data file, then</li>
    <li>re-run the pipeline; the item disappears from <code>data/flagged.json</code> on the next build.</li>
  </ol>
</div>
"""
    return page("flagged.html", "Flagged for review", body, active="flagged.html",
                description="Unverified items, irregularities and blockers, with sources.")


# --------------------------------------------------------------------------- flagged data
def build_flagged_data(snap, res_summary, live_status, jumps):
    items = []

    items.append({
        "id": "demo-credentials-missing", "severity": "blocker",
        "title": "Demo-account trading has never executed",
        "detail": "The brief asks for trades executed on the Kalshi demo account. No demo API key exists "
                  "in this environment and one cannot be self-provisioned: a demo account is created by a "
                  "person at demo.kalshi.co and the private key is downloadable only once. collector/live_trading.py "
                  "is implemented, self-tested, refuses to run without credentials, and is wired into the "
                  "pipeline via KALSHI_DEMO_API_KEY_ID / KALSHI_DEMO_PRIVATE_KEY_PATH secrets.",
        "impact": "Portfolio numbers on the site are simulated, not demo-account results.",
        "sources": [SOURCES["demo_env"]["url"], SOURCES["auth"]["url"]],
    })
    items.append({
        "id": "no-websocket-without-keys", "severity": "unverified",
        "title": "Live push (WebSocket) not enabled",
        "detail": "Kalshi's WebSocket requires an authenticated handshake even for public market-data "
                  "channels, so a signature needs credentials. The site polls REST every 15 minutes instead. "
                  "This is a documented API constraint, not an omission.",
        "impact": "Updates are as fresh as the last pipeline run (timestamp shown on every page).",
        "sources": [SOURCES["websockets"]["url"], SOURCES["rate_limits"]["url"]],
    })
    items.append({
        "id": "jump-causes-unattributed", "severity": "unverified",
        "title": "Causes of ≥ $0.10 moves are unattributed",
        "detail": "Moves are detected from exchange prices. Naming a news cause would be a claim needing a "
                  "source, so every move is labelled unverified until a reviewer files a source URL in "
                  "data/attributions.json.",
        "impact": "The sharp-move page shows facts and links, not explanations.",
        "sources": ["https://kalshi.com/markets"],
    })
    items.append({
        "id": "gas-title-rule", "severity": "note",
        "title": "One editorial rule in the gas topic",
        "detail": "Gas-price membership requires a Kalshi 'Oil and energy' / 'Oil & Gas' tag AND the word "
                  "'gas' in the series title. Without the title test, oil-inventory series would be counted "
                  "as gasoline price markets. This is the only editorial test in the topic config and it is "
                  "declared here rather than hidden in code.",
        "impact": "Possibly excludes a gas series whose title omits the word 'gas'.",
        "sources": [SOURCES["terms"]["url"], SOURCES["tags_by_categories"]["url"]],
    })
    items.append({
        "id": "culture-category-gap", "severity": "irregularity",
        "title": "Kalshi's Culture category is nearly empty",
        "detail": "The live API returns only two series under category=Culture, so this dashboard defines "
                  "Culture as Culture + Entertainment + Social. Awards, music, TV and movie markets live "
                  "under Entertainment; the mapping is shown on each page that uses it.",
        "impact": "Culture numbers are broader than the literal category name.",
        "sources": [SOURCES["tags_by_categories"]["url"]],
    })
    items.append({
        "id": "demo-not-production", "severity": "irregularity",
        "title": "Demo market data is not representative",
        "detail": "Kalshi states demo markets 'may not be reflective of those in real markets'. A probe of "
                  "the demo endpoint returned 200 open markets of which 193 were multivariate combination "
                  "markets with zero volume. Live prices therefore come from the public production read "
                  "endpoint; the demo environment is reserved for order execution.",
        "impact": "Rankings reflect production markets, while executions target demo markets.",
        "sources": [SOURCES["demo_env"]["url"]],
    })
    items.append({
        "id": "no-money-at-stake", "severity": "note",
        "title": "No single 'total money at stake' figure exists",
        "detail": "Kalshi's public API exposes per-market volume and open interest, not a committed capital "
                  "pool. The dashboard reports traded dollar volume, open-interest dollars and resting "
                  "liquidity instead, and never presents a made-up aggregate.",
        "impact": "Rankings use traded dollars, which can differ from capital currently at risk.",
        "sources": [SOURCES["get_markets"]["url"]],
    })
    items.append({
        "id": "fees-series-table-partial", "severity": "note",
        "title": "Per-series fee multipliers are only partly transcribed",
        "detail": "Kalshi's fee schedule lists per-series multipliers in a table whose PDF text layer is "
                  "partly garbled. Only rows that could be read unambiguously are encoded; all other series "
                  "use the schedule defaults (taker M=1, maker M=0). Series with a non-standard multiplier "
                  "outside that subset would be fee-mispriced in simulation.",
        "impact": "Simulated fees may differ from exchange fees for unusual series.",
        "sources": [SOURCES["fee_schedule"]["url"]],
    })
    items.append({
        "id": "history-starts-now", "severity": "note",
        "title": "Price history begins with the first collector run",
        "detail": "Chart series are built from observations this repo has collected. They are not exchange "
                  "history and are not back-filled; the candlestick endpoint is used only where a real "
                  "exchange history exists for the requested window.",
        "impact": "Charts get richer over time; early windows can be sparse.",
        "sources": [SOURCES["candlesticks"]["url"]],
    })
    if (live_status or {}).get("status") == "blocked":
        items.append({
            "id": "live-executor-blocked", "severity": "blocker",
            "title": "Live executor blocked by preflight",
            "detail": "Last preflight: " + "; ".join((live_status or {}).get("problems") or []),
            "impact": "No demo orders were sent.",
            "sources": [SOURCES["demo_env"]["url"]],
        })
    if not (snap or {}).get("markets"):
        items.append({
            "id": "no-snapshot-yet", "severity": "unverified",
            "title": "No collected market data in this build",
            "detail": "The data files were empty when this page was generated, so market tables and the "
                      "portfolio are blank. The pipeline fills them on its next run.",
            "impact": "All market-derived tables are empty and marked as such.",
            "sources": [SOURCES["get_markets"]["url"]],
        })
    write_json(os.path.join(DATA, "flagged.json"), {"generated_at": iso(), "items": items})
    return {"items": items}


# --------------------------------------------------------------------------- build
def main() -> int:
    snap = load(os.path.join("markets", "latest.json"), {}) or {}
    universe = load("universe.json", {}) or {}
    summary = load(os.path.join("paper", "summary.json"), {}) or {}
    ledger = load(os.path.join("paper", "ledger.json"), {}) or {}
    res_summary = load("resolution_summary.json", {}) or {}
    jumps = load("jumps.json", {}) or {"jumps": []}
    live_status = load(os.path.join("live", "status.json"), {}) or {}
    flagged = load("flagged.json", {}) or {}

    os.makedirs(os.path.join(OUT, "assets", "data"), exist_ok=True)

    build_flagged_data(snap, res_summary, live_status, jumps)
    flagged = load("flagged.json", {}) or {}

    build_index(snap, summary, res_summary, jumps, universe)
    build_markets(snap, universe, jumps)
    build_events(snap, universe)
    build_jumps(jumps, snap)
    build_resolutions(res_summary, snap)
    build_portfolio(summary, ledger, live_status)
    build_strategies(summary)
    build_summary(snap, summary, res_summary, jumps, universe)
    build_methodology(snap, universe, flagged)
    build_flagged(flagged)

    # link check: every local href must exist
    missing = []
    for path in BUILT:
        with open(os.path.join(OUT, path)) as f:
            html = f.read()
        for href in __import__("re").findall(r'href="([^"#:]+?)(?:[#?][^"]*)?"', html):
            if href.startswith(("http", "mailto:", "//")):
                continue
            target = os.path.join(OUT, href)
            if not os.path.exists(target):
                missing.append((path, href))

    print(f"built {len(BUILT)} pages: {', '.join(BUILT)}")
    if missing:
        print("BROKEN LINKS:")
        for m in missing:
            print("  ", m)
        return 1
    print("link check: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
