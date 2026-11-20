"""Render the static site: shared navigation, topic page template, markdown reports, sources.

Pages are plain HTML + vanilla JS that read JSON written by build_site.py. No framework, no
build-time network access beyond build_site.py.
"""
import html
import json
import pathlib
import shutil

try:
    import markdown as md  # pip: markdown
except ImportError:  # pragma: no cover
    md = None

NAV = [
    ("index.html", "Home"),
    ("gas.html", "Gas prices"),
    ("golf.html", "Golf"),
    ("crypto.html", "Crypto"),
    ("culture.html", "Culture"),
    ("elections.html", "Elections"),
    ("moves.html", "Sharp moves"),
    ("resolved.html", "Resolved"),
    ("analysis.html", "Strategy lab"),
    ("summary.html", "Executive summary"),
    ("review.html", "Repo & API review"),
    ("flagged.html", "Flagged for review"),
    ("sources.html", "Sources"),
]


def nav_html(active):
    items = []
    for href, label in NAV:
        cls = ' class="active"' if href == active else ""
        items.append(f'<a href="{href}"{cls}>{html.escape(label)}</a>')
    return '<nav class="nav" aria-label="Site">' + "".join(items) + "</nav>"


def page(active, title, body, scripts=("assets/app.js",), extra_head=""):
    scripts_html = "".join(f'<script src="{s}"></script>' for s in scripts)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} · Kalshi demo monitor</title>
<link rel="stylesheet" href="assets/app.css">{extra_head}
</head><body data-page="{html.escape(active)}">
<header class="top"><div class="brand"><span class="mark">K</span><div><b>Kalshi demo monitor</b><small>Public market data · official API · simulation only</small></div></div>
<span class="pill" id="liveState">Loading…</span></header>
{nav_html(active)}
<main class="wrap">
<div class="notice"><b>Demo and simulation only.</b> Public, read-only market data from Kalshi's demo API. No account login, no API keys, no real or demo orders are placed. Simulated results are hypothetical. Not financial advice.</div>
{body}
</main>
<footer class="wrap foot">Data: Kalshi Trade API (<a href="https://docs.kalshi.com/getting_started/api_environments" target="_blank" rel="noopener">official docs</a>). Snapshot time shown on each page. <span id="footerNote"></span></footer>
{scripts_html}
</body></html>
"""


TOPIC_BODY = """
<section class="hero">
  <h1>{label}</h1>
  <p class="muted">{description} Table = open markets in this topic ranked by estimated 24-hour dollar volume. Click a row to chart it and see its order book.</p>
</section>
<section class="cards">
  <div class="card"><small>Open markets in topic</small><strong id="openTotal">—</strong></div>
  <div class="card"><small>Rows on this page</small><strong id="rowCount">—</strong></div>
  <div class="card"><small>Sharp moves ≥ $0.10 (this topic)</small><strong id="moveCount">—</strong></div>
  <div class="card"><small>Snapshot / live</small><strong id="snapshot" style="font-size:15px">—</strong><span class="muted" id="liveNote"></span></div>
</section>
<div class="toolbar">
  <input id="search" type="search" placeholder="Search title, ticker, outcome…" aria-label="Search">
  <select id="sortBy" aria-label="Sort">
    <option value="est">Sort: est. 24h $ (high→low)</option>
    <option value="vol">Sort: 24h contracts</option>
    <option value="oi">Sort: open interest</option>
    <option value="close">Sort: closes soonest</option>
    <option value="chg">Sort: largest |change| since prev</option>
  </select>
  <label class="check"><input type="checkbox" id="onlyDetail"> Only markets with order-book detail</label>
  <button id="moreBtn" type="button">Show more</button>
</div>
<div class="layout">
  <section class="box tablewrap">
    <table class="grid" id="marketTable">
      <thead><tr>
        <th>Market</th><th>Ticker</th><th class="num">Last YES</th><th class="num">YES bid</th><th class="num">YES ask</th>
        <th class="num">Δ vs prev</th><th class="num">24h contracts</th><th class="num">Est. 24h $</th>
        <th class="num">Open interest</th><th>Closes (UTC)</th><th>Source</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <p class="muted small" id="tableNote"></p>
  </section>
  <aside class="side">
    <div class="box" id="detailBox">
      <h2>Selected market</h2>
      <p class="muted" id="detailEmpty">Click a row in the table to chart its price and view its order book.</p>
      <div id="detail" hidden>
        <h3 id="dTitle"></h3>
        <p class="small"><a id="dApi" target="_blank" rel="noopener">Official API record</a> · <a id="dTerms" target="_blank" rel="noopener">Contract terms (PDF)</a></p>
        <p id="dResolved"></p>
        <div class="row"><label class="small">Chart range
          <select id="range">
            <option value="live">Seconds — live polled (since page opened)</option>
            <option value="1m">Minutes — 1-minute candles, last 6 h</option>
            <option value="1h">Hours — 1-hour candles, last 7 days</option>
            <option value="1d">Days — 1-day candles, last 90 days</option>
          </select></label></div>
        <svg id="chart" class="chart" viewBox="0 0 640 260" role="img" aria-label="YES price over time"></svg>
        <p class="small muted" id="chartNote"></p>
        <h3>Order book (live)</h3>
        <p class="small" id="obSummary"></p>
        <div class="two">
          <div><b class="small">YES bids (contracts at price)</b><table class="grid small-t"><thead><tr><th>Price</th><th class="num">Contracts</th></tr></thead><tbody id="obYes"></tbody></table></div>
          <div><b class="small">NO bids → implied YES asks</b><table class="grid small-t"><thead><tr><th>YES ask (1−NO bid)</th><th class="num">Contracts</th></tr></thead><tbody id="obNo"></tbody></table></div>
        </div>
        <p class="small muted">Order books show resting bids only; YES ask = 1.00 − best NO bid, per Kalshi's order-book documentation.</p>
        <h3>Sharp moves in this market</h3>
        <ul id="dMoves" class="small"></ul>
      </div>
    </div>
  </aside>
</div>
<p class="muted small">Estimated 24h $ = 24h contracts × last traded YES price (derived, not an official field). Open interest $ = open interest contracts × notional value per contract (derived). Live values refresh from the public REST API while this page is open; the table snapshot is rebuilt every 30 minutes.</p>
"""


def render_topic_pages(out, topics):
    for t in topics:
        body = TOPIC_BODY.format(label=html.escape(t["label"]), description=html.escape(t["description"]))
        doc = page(f"{t['id']}.html", f"{t['label']}", body, scripts=("assets/app.js",),
                   extra_head=f'<meta name="topic" content="{t["id"]}">')
        (out / f"{t['id']}.html").write_text(doc)


def render_markdown(root, out, src_rel, target, title, active):
    src = root / src_rel
    if not src.exists():
        return
    text = src.read_text()
    if md is not None:
        body = md.markdown(text, extensions=["tables", "fenced_code", "toc"])
    else:
        body = "<pre>" + html.escape(text) + "</pre>"
    body = f'<article class="prose">{body}</article><p class="muted small">Source file in repository: <code>{html.escape(src_rel)}</code></p>'
    (out / target).write_text(page(active, title, body, scripts=()))


def render(root, out, meta):
    site = root / "site"
    for sub in ("assets",):
        shutil.copytree(site / sub, out / sub, dirs_exist_ok=True)
    cfg_topics = json.loads((root / "config/topics.json").read_text())["topics"]
    shutil.copy(root / "config/sources.json", out / "data" / "sources.json")

    # Static pages: site/pages/<name>.html are body fragments whose first line is <!-- title: ... -->
    for f in sorted((site / "pages").glob("*.html")):
        raw = f.read_text()
        first, _, fragment = raw.partition("\n")
        title = first.replace("<!--", "").replace("-->", "").replace("title:", "").strip() or f.stem
        (out / f.name).write_text(page(f.name, title, fragment, scripts=("assets/app.js",)))

    render_topic_pages(out, cfg_topics)

    render_markdown(root, out, "reports/EXECUTIVE_SUMMARY.md", "summary.html", "Executive summary", "summary.html")
    render_markdown(root, out, "reports/REPO_REVIEW.md", "review.html", "Repo & API review", "review.html")
    render_markdown(root, out, "reports/API_VERIFICATION.md", "review_api.html", "API verification", "review.html")
    render_markdown(root, out, "reports/METHODOLOGY.md", "methodology.html", "Methodology", "sources.html")
    render_markdown(root, out, "reports/FLAGGED_FOR_REVIEW.md", "flagged_notes.html", "Flagged for review - notes", "flagged.html")

    (out / ".nojekyll").write_text("")
    print("rendered site pages:", sorted(p.name for p in out.glob("*.html")))
