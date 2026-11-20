"""
Topic membership.

The earlier prototype matched topic names against titles as a keyword heuristic; that is
flagged for review. This module instead uses the fields Kalshi publishes on every series and
event:

  * series `category` (exactly one) and `categories` (all it appears under) — glossary:
    https://docs.kalshi.com/getting_started/terms
  * series `tags` (subcategories) — authoritative category->tag map:
    https://docs.kalshi.com/api-reference/search/get-tags-for-series-categories
  * event `category` — https://docs.kalshi.com/api-reference/events/get-events

Rules live in config/topics.json so the mapping is data, not code, and can be audited.
"""

from __future__ import annotations

import json
import os
import re

from .util import CONFIG


def load_config(path: str | None = None) -> dict:
    path = path or os.path.join(CONFIG, "topics.json")
    with open(path) as f:
        return json.load(f)


def _rule_matches(rule: dict, series: dict) -> bool:
    cats = set(series.get("categories") or [])
    if series.get("category"):
        cats.add(series["category"])
    if rule.get("categories") and not (cats & set(rule["categories"])):
        return False
    if rule.get("tags"):
        tags = set(series.get("tags") or [])
        if not (tags & set(rule["tags"])):
            return False
    if rule.get("title_regex"):
        title = " ".join(filter(None, [series.get("title"), series.get("event_title")]))
        if not re.search(rule["title_regex"], title):
            return False
    return True


def topics_for_series(series: dict, config: dict | None = None) -> list[str]:
    config = config or load_config()
    hits = []
    for slug, topic in config["topics"].items():
        if any(_rule_matches(rule, series) for rule in topic["rules"]):
            hits.append(slug)
    return hits


def is_excluded(ticker: str, config: dict | None = None) -> bool:
    config = config or load_config()
    return any((ticker or "").upper().startswith(p.upper()) for p in config.get("exclude_ticker_prefixes", []))


def index_series(series_list: list[dict], config: dict | None = None) -> dict:
    """series_ticker -> {topics, category, categories, tags, title, settlement_sources}."""
    config = config or load_config()
    index = {}
    for s in series_list or []:
        ticker = s.get("ticker")
        if not ticker:
            continue
        index[ticker] = {
            "series_ticker": ticker,
            "title": s.get("title") or "",
            "category": s.get("category") or "",
            "categories": s.get("categories") or ([s["category"]] if s.get("category") else []),
            "tags": s.get("tags") or [],
            "frequency": s.get("frequency") or "",
            "contract_terms_url": s.get("contract_terms_url") or "",
            "settlement_sources": s.get("settlement_sources") or [],
            "topics": topics_for_series(s, config),
        }
    return index


def topic_catalogue(config: dict | None = None) -> list[dict]:
    config = config or load_config()
    out = []
    for slug, t in config["topics"].items():
        out.append({
            "slug": slug,
            "label": t["label"],
            "blurb": t["blurb"],
            "basis": t.get("basis", ""),
            "sources": t.get("sources", []),
            "note": t.get("note", ""),
            "rules": t.get("rules", []),
        })
    return out
