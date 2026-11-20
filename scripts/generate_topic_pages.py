#!/usr/bin/env python3
"""Generate the five static topic pages from the shared dashboard shell."""

from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOPICS = (
    ("gas-prices", "Gas prices"),
    ("elections", "Elections"),
    ("culture", "Culture"),
    ("crypto", "Crypto"),
    ("golf", "Golf"),
)


def render_topic_page(root_html: str, slug: str, label: str) -> str:
    page = root_html
    page = page.replace(
        "<title>Kalshi Demo Monitor · Market overview</title>",
        f"<title>Kalshi Demo Monitor · {label}</title>",
    )
    page = page.replace(
        '<link rel="stylesheet" href="styles.css" />',
        '<link rel="stylesheet" href="../styles.css" />',
    )
    page = page.replace(
        '<script type="module" src="app.js"></script>',
        '<script type="module" src="../app.js"></script>',
    )
    page = page.replace('<body data-category="all">', f'<body data-category="{slug}">')
    page = page.replace('href="index.html"', 'href="../index.html"')
    for topic_slug, _ in TOPICS:
        page = page.replace(
            f'href="topics/{topic_slug}.html"',
            f'href="{topic_slug}.html"',
        )
    page = page.replace('href="flagged-for-review.html', 'href="../flagged-for-review.html')
    return page


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if committed topic pages differ from the root shell")
    args = parser.parse_args()

    root_html = (ROOT / "index.html").read_text(encoding="utf-8")
    mismatches: list[str] = []
    for slug, label in TOPICS:
        destination = ROOT / "topics" / f"{slug}.html"
        expected = render_topic_page(root_html, slug, label)
        if args.check:
            if not destination.exists() or destination.read_text(encoding="utf-8") != expected:
                mismatches.append(destination.relative_to(ROOT).as_posix())
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(expected, encoding="utf-8")

    if mismatches:
        print("Topic pages are out of sync with index.html:")
        for path in mismatches:
            print(f"- {path}")
        print("Run: python3 scripts/generate_topic_pages.py")
        return 1
    if args.check:
        print("Topic pages are synchronized with the dashboard shell.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
