from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
HTML_FILES = sorted([ROOT / "index.html", ROOT / "flagged-for-review.html", *sorted((ROOT / "topics").glob("*.html"))])
OFFICIAL_HOSTS = {"docs.kalshi.com", "docs.github.com", "external-api.demo.kalshi.co"}
errors: list[str] = []


class PageAudit(HTMLParser):
    def __init__(self, path: Path) -> None:
        super().__init__(convert_charrefs=True)
        self.path = path
        self.ids: set[str] = set()
        self.references: list[tuple[str, str]] = []
        self.table_stack: list[str] = []
        self.rows: list[dict[str, object]] = []
        self.current_row: dict[str, object] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.add(str(attributes["id"]))

        for name in ("href", "src"):
            value = attributes.get(name)
            if value:
                self.references.append((tag, str(value)))

        if tag == "table":
            self.table_stack.append(str(attributes.get("class") or ""))
        elif tag == "tr":
            self.current_row = {
                "table_class": self.table_stack[-1] if self.table_stack else "",
                "links": [],
                "cells": 0,
                "data_cells": 0,
                "text": [],
            }
        elif tag in {"td", "th"} and self.current_row is not None:
            self.current_row["cells"] = int(self.current_row["cells"]) + 1
            if tag == "td":
                self.current_row["data_cells"] = int(self.current_row["data_cells"]) + 1
        elif tag == "a" and self.current_row is not None and attributes.get("href"):
            links = self.current_row["links"]
            assert isinstance(links, list)
            links.append(str(attributes["href"]))

    def handle_data(self, data: str) -> None:
        if self.current_row is not None and data.strip():
            text = self.current_row["text"]
            assert isinstance(text, list)
            text.append(data.strip())

    def handle_endtag(self, tag: str) -> None:
        if tag == "tr" and self.current_row is not None:
            row = self.current_row
            self.rows.append(row)
            table_class = str(row["table_class"])
            if "review-table" in table_class and int(row["data_cells"]) > 0:
                links = row["links"]
                assert isinstance(links, list)
                official = [link for link in links if urlsplit(link).hostname in OFFICIAL_HOSTS]
                if not official:
                    joined = " ".join(row["text"])
                    errors.append(f"{self.path.relative_to(ROOT)}: review table row has no official source link: {joined[:110]}")
            self.current_row = None
        elif tag == "table" and self.table_stack:
            self.table_stack.pop()


def audit_page(path: Path) -> PageAudit:
    parser = PageAudit(path)
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    audit_ids_cache[path.resolve()] = parser.ids

    for tag, reference in parser.references:
        parts = urlsplit(reference)
        if parts.scheme:
            if parts.scheme not in {"https", "mailto"}:
                errors.append(f"{path.relative_to(ROOT)}: non-HTTPS external reference: {reference}")
            if parts.scheme == "https" and not parts.hostname:
                errors.append(f"{path.relative_to(ROOT)}: malformed external reference: {reference}")
            continue

        local_path = unquote(parts.path)
        destination = (path.parent / local_path).resolve() if local_path else path.resolve()
        if ROOT.resolve() not in destination.parents and destination != ROOT.resolve():
            errors.append(f"{path.relative_to(ROOT)}: local path escapes repository: {reference}")
            continue
        if not destination.exists():
            errors.append(f"{path.relative_to(ROOT)}: broken local {tag} reference: {reference}")
            continue
        if parts.fragment and destination.suffix.lower() in {".html", ".htm"}:
            if destination == path.resolve():
                target_ids = parser.ids
            else:
                target_ids = audit_ids_cache.get(destination)
                if target_ids is None:
                    target_ids = audit_page(destination).ids
                    audit_ids_cache[destination] = target_ids
            if unquote(parts.fragment) not in target_ids:
                errors.append(f"{path.relative_to(ROOT)}: missing fragment #{parts.fragment} in {destination.relative_to(ROOT)}")
    return parser


audit_ids_cache: dict[Path, set[str]] = {}
for html_file in HTML_FILES:
    if not html_file.exists():
        errors.append(f"Missing expected page: {html_file.relative_to(ROOT)}")
        continue
    page = audit_page(html_file)
    audit_ids_cache[html_file.resolve()] = page.ids

app = (ROOT / "app.js").read_text(encoding="utf-8")
root_ids = audit_ids_cache.get((ROOT / "index.html").resolve(), set())
for element_id in re.findall(r'\$\("([^\"]+)"\)', app):
    if element_id not in root_ids:
        errors.append(f"app.js references an element id missing from index.html: {element_id}")

required_row_sources = [
    "addOfficialLink(sourceCell, marketApiUrl(market.ticker)",
    "addOfficialLink(foot, marketApiUrl(item.ticker)",
    "addOfficialLink(sourceCell, orderbookApiUrl(market.ticker)",
    "addOfficialLink(sourceCell, OFFICIAL_SOURCES.settlement",
    "addOfficialLink(sourceCell, marketApiUrl(trade.ticker)",
]
for source_call in required_row_sources:
    if source_call not in app:
        errors.append(f"app.js is missing a dynamic official-source link path: {source_call}")

if "localhost" in app or "127.0.0.1" in app:
    errors.append("app.js must not use localhost/127.0.0.1 as a browser API host")
if "https://news.google.com/search?q=${encodeURIComponent" not in app:
    errors.append("app.js is missing the explicitly labeled title-based news-search link")
if "isClosedOrTerminalMarket" not in app or "isYesNoSettled" not in app:
    errors.append("app.js must gate resolution outcomes on terminal status and an explicit yes/no result")

if errors:
    print("Static site verification failed:")
    for error in errors:
        print(f"- {error}")
    raise SystemExit(1)

print(f"Static site verification passed: {len(HTML_FILES)} pages, local links/fragments, HTTPS references, and source links on review/data rows.")
