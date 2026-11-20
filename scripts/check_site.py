"""Static checks for the built site: every internal href/src resolves, every JSON file parses,
and every data file the JS requests exists. Exit code 1 on any failure (blocks deploy)."""
import json
import pathlib
import re
import sys
from html.parser import HTMLParser

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
errors = []


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k in ("href", "src") and v:
                self.refs.append((tag, v))


pages = sorted(out.glob("*.html"))
if not pages:
    errors.append("no HTML pages found")
for page in pages:
    p = Links()
    p.feed(page.read_text(encoding="utf-8"))
    for tag, ref in p.refs:
        if ref.startswith(("http://", "https://", "mailto:", "#", "javascript:")):
            continue
        target = (out / ref.split("#")[0].split("?")[0]).resolve()
        if not target.exists():
            errors.append(f"{page.name}: broken {tag} -> {ref}")
        if out not in target.parents and target != out:
            errors.append(f"{page.name}: link escapes site root -> {ref}")

for jf in sorted((out / "data").glob("*.json")):
    try:
        json.loads(jf.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"{jf.name}: invalid JSON ({exc})")

js = (out / "assets" / "app.js").read_text(encoding="utf-8")
for ref in sorted(set(re.findall(r"getJSON\(\s*[`'\"]([^`'\"]+)[`'\"]", js))):
    if "${" in ref:
        ref_pattern = ref.split("${")[0]
        if not any(p.name.startswith(ref_pattern.split("/")[-1]) for p in (out / "data").glob("*.json")):
            errors.append(f"app.js requests missing data family: {ref}")
        continue
    if not (out / ref).exists():
        errors.append(f"app.js requests missing file: {ref}")

for topic in ("gas", "golf", "crypto", "culture", "elections"):
    if not (out / f"data/topic-{topic}.json").exists():
        errors.append(f"missing data/topic-{topic}.json")

print(f"checked {len(pages)} pages")
if errors:
    print("FAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("OK: no broken internal links; all JSON parses; required data present")
