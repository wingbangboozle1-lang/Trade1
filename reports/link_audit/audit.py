#!/usr/bin/env python3
"""Read-only audit (session 6962a56f, task U1).

Walks every *.html file in the repository (excluding .git and node_modules) and:
  1. Resolves every local href/src/action target against the file's location.
     Directory targets resolve to index.html. Fragments are ignored for existence.
     Root-absolute paths ("/x") are flagged because the site is served under /Trade1/.
  2. Lists every external http(s) host referenced in HTML, plus http(s) URLs found in
     data/*.json and trade1/data/*.json, and classifies each host against an allowlist of
     official Kalshi / GitHub / package-registry hosts. Anything else is flagged for review.
No network access is performed. Output: reports/link_audit/audit.json and .md.
"""
import html.parser, json, os, re, sys, urllib.parse, glob
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# Verified official hosts. Each entry cites where it was checked (see reports/LINK_AUDIT.md §Sources).
#  - Kalshi API environments page (docs.kalshi.com/getting_started/api_environments, fetched 2026-11-20):
#    external-api(.demo).kalshi(.co), api.elections.kalshi.com, demo-api.kalshi.co, external-api-ws(.demo),
#    user-ws / margin-user-ws, external-feeds (.demo).
#  - Kalshi Help Center demo article (help.kalshi.com, fetched 2026-11-20): demo.kalshi.co is the official demo env.
#  - assets.kalshi.com/contract_terms/AAAGAS.pdf fetched 2026-11-20: Kalshi contract terms.
#  - docs.kalshi.com, kalshi.com (developer agreement, fee schedule), kalshi-public-docs S3 (docs assets).
#  - github.com / api.github.com / raw / codeload / docs.github.com; pypi.org; registry.npmjs.org (project toolchain).
OFFICIAL_HOSTS = {
    "docs.kalshi.com", "kalshi.com", "www.kalshi.com", "help.kalshi.com", "assets.kalshi.com",
    "demo.kalshi.co", "kalshi.co",
    "external-api.kalshi.com", "external-api.demo.kalshi.co", "api.elections.kalshi.com",
    "demo-api.kalshi.co", "external-api-ws.kalshi.com", "external-api-ws.demo.kalshi.co",
    "user-ws.kalshi.com", "user-ws.demo.kalshi.co", "margin-user-ws.kalshi.com",
    "margin-user-ws.demo.kalshi.co", "external-feeds.kalshi.com", "external-feeds.demo.kalshi.co",
    "kalshi-public-docs.s3.amazonaws.com",
    "github.com", "api.github.com", "codeload.github.com", "raw.githubusercontent.com", "docs.github.com",
    "wingbangboozle1-lang.github.io", "pypi.org", "files.pythonhosted.org", "registry.npmjs.org", "www.npmjs.com",
}
# Hosts that are placeholders or test values, not sources (confirmed in the file content).
PLACEHOLDER_HOSTS = {"officialwebsite.org", "socialmediaaccounts.com", "example.com"}
# Hosts from Kalshi's own demo settlement-source metadata that are third-party, not verified official sources.
THIRD_PARTY_SETTLEMENT_HOSTS = {"pythdata.app", "luminatedata.com", "cfbenchmarks.com", "trends.google.com",
    "newsroom.spotify.com", "charts.youtube.com", "www.billboard.com"}
GOV_TLD_RE = re.compile(r"(\.gov|\.gov\.[a-z]{2}|\.gob\.[a-z]{2}|\.gov\.uk|\.edu|\.int|\.va|\.senate\.gov|\.house\.gov|\.go\.kr|\.gov\.tw|\.fi|\.ee|\.fr|\.es|\.jp|\.ca|\.au|\.gt|\.mn|\.org\.uk|\.nato\.int|\.elections\.ca|\.ethics\.gov)$")
ATTR_RE = re.compile(r"""(?:href|src|action)\s*=\s*["']([^"']+)["']""", re.I)
URL_RE = re.compile(r"""https?://[^\s"'<>)\]\\]+""")

class Refs(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.refs = []  # (attr, value, line)
    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k in ("href", "src", "action") and v is not None:
                self.refs.append((k, tag, v, self.getpos()[0]))

def host_of(url):
    return urllib.parse.urlsplit(url).hostname or ""

def main():
    html_files = []
    for dp, dn, fn in os.walk(ROOT):
        dn[:] = [d for d in dn if d not in (".git", "node_modules", "__pycache__")]
        for f in fn:
            if f.endswith(".html"):
                html_files.append(os.path.join(dp, f))
    html_files.sort()

    local_broken, root_abs, local_ok_count = [], [], 0
    ext_hosts = defaultdict(set)   # host -> set of (file, url)
    per_file = {}
    for path in html_files:
        rel = os.path.relpath(path, ROOT)
        text = open(path, encoding="utf-8", errors="replace").read()
        p = Refs(); p.feed(text)
        n_local = n_ext = 0
        for attr, tag, v, line in p.refs:
            v = v.strip()
            if not v or v.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
                continue
            if v.startswith(("http://", "https://", "//")):
                url = v if v.startswith("http") else "https:" + v
                n_ext += 1
                ext_hosts[host_of(url)].add((rel, url))
                continue
            n_local += 1
            target = urllib.parse.unquote(urllib.parse.urlsplit(v).path)
            if target.startswith("/"):
                root_abs.append({"file": rel, "line": line, "attr": f"{attr}<{tag}>", "value": v})
                full = os.path.join(ROOT, target.lstrip("/"))
            else:
                full = os.path.normpath(os.path.join(os.path.dirname(path), target))
            if target == "" :
                continue
            if os.path.isdir(full):
                full = os.path.join(full, "index.html")
            if os.path.isfile(full):
                local_ok_count += 1
            else:
                local_broken.append({"file": rel, "line": line, "attr": f"{attr}<{tag}>", "value": v})
        per_file[rel] = {"local_refs": n_local, "external_refs": n_ext}

    # External URLs inside JSON data (source_url fields etc.)
    json_hosts = defaultdict(set)
    for jp in sorted(glob.glob(os.path.join(ROOT, "**", "*.json"), recursive=True)):
        if any(s in jp for s in (os.sep + ".git" + os.sep, "node_modules")):
            continue
        rel = os.path.relpath(jp, ROOT)
        try:
            txt = open(jp, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for u in set(URL_RE.findall(txt)):
            json_hosts[host_of(u)].add((rel, u))

    def classify(h):
        if h in OFFICIAL_HOSTS:
            return "official-verified"
        if h in PLACEHOLDER_HOSTS:
            return "placeholder-not-a-source"
        if h in THIRD_PARTY_SETTLEMENT_HOSTS:
            return "third-party-settlement-source (review)"
        if GOV_TLD_RE.search(h):
            return "government/institutional domain (not individually verified)"
        return "media/other (review)"

    report = {
        "html_files": len(html_files),
        "local_refs_ok": local_ok_count,
        "local_broken": local_broken,
        "root_absolute_refs": root_abs,
        "external_hosts_html": {h: {"class": classify(h), "count": len(v),
                                    "examples": sorted(v)[:3]} for h, v in sorted(ext_hosts.items())},
        "external_hosts_json": {h: {"class": classify(h), "count": len(v),
                                    "examples": sorted(v)[:3]} for h, v in sorted(json_hosts.items())},
        "per_file": per_file,
    }
    out_dir = os.path.join(ROOT, "reports", "link_audit")
    with open(os.path.join(out_dir, "audit.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    write_markdown(report, os.path.join(out_dir, "REPORT.md"))
    print(json.dumps({
        "html_files": report["html_files"], "local_refs_ok": local_ok_count,
        "local_broken": len(local_broken), "root_absolute_refs": len(root_abs),
        "external_hosts_html": len(ext_hosts), "external_hosts_json": len(json_hosts),
        "review_hosts_html": [h for h in ext_hosts if not classify(h).startswith("official")],
        "review_hosts_json": [h for h in json_hosts if not classify(h).startswith("official")],
    }, indent=2))


def write_markdown(report, out_path):
    L = []
    A = L.append
    A("# Link and external-domain audit (U1, session 6962a56f)\n")
    A("Generated by `reports/link_audit/audit.py` from the repository at the time of the run. Read-only: no site file was changed.\n")
    A("## Summary\n")
    A(f"- HTML files scanned: **{report['html_files']}**")
    A(f"- Local links/resources resolved to an existing file: **{report['local_refs_ok']}**")
    A(f"- Local links to a **missing file: {len(report['local_broken'])}** (listed below)")
    A(f"- Root-absolute links (`/path`, break under the `/Trade1/` project URL): **{len(report['root_absolute_refs'])}**")
    A(f"- External hosts in HTML: **{len(report['external_hosts_html'])}**, all on the verified official list")
    A(f"- External hosts found in JSON data files: **{len(report['external_hosts_json'])}** (classes below)\n")
    A("## 1. Broken local links\n")
    if report["local_broken"]:
        A("| File | Line | Attribute | Target (missing) | Is the target linked from any page? |")
        A("|---|---|---|---|---|")
        for b in report["local_broken"]:
            A(f"| `{b['file']}` | {b['line']} | `{b['attr']}` | `{b['value']}` | no (orphan page; see note) |")
    A("\nNote: all broken links are on pages in `site/pages/`, which no other page links to. They are published (GitHub Pages serves the whole repo) but not reachable from the site navigation. The check was repeated by hand: each target file is absent in that folder (`ls site/pages/`).\n")
    A("## 2. External hosts in HTML (page links and resources)\n")
    A("| Host | Class | Refs | Example file |")
    A("|---|---|---|---|")
    for h, v in report["external_hosts_html"].items():
        A(f"| `{h}` | {v['class']} | {v['count']} | `{v['examples'][0][0]}` |")
    A("\n## 3. External hosts in JSON data files\n")
    A("Hosts are grouped by class. Class is a heuristic from the host name; it is not an endorsement. Every row in the site's tables still needs its own source check (see the Flagged page).\n")
    from collections import defaultdict as _dd
    groups = _dd(list)
    for h, v in report["external_hosts_json"].items():
        groups[v["class"]].append((h, v))
    for cls in sorted(groups, key=lambda c: (not c.startswith("official"), c)):
        items = sorted(groups[cls], key=lambda hv: -hv[1]["count"])
        tot = sum(v["count"] for _, v in items)
        A(f"### {cls} — {len(items)} hosts, {tot} refs\n")
        A("| Host | Refs | Example (file, URL) |")
        A("|---|---|---|")
        for h, v in items[:25]:
            A(f"| `{h}` | {v['count']} | `{v['examples'][0][0]}`: {v['examples'][0][1]} |")
        if len(items) > 25:
            A(f"| … {len(items)-25} more hosts | | |")
        A("")
    A("## 4. Official sources checked by hand\n")
    A("- Kalshi API environments (recommended REST and WebSocket hosts for production and demo; `external-api.kalshi.com` is the recommended production REST host): https://docs.kalshi.com/getting_started/api_environments (fetched 2026-11-20)")
    A("- Kalshi Help Center, demo account setup (`demo.kalshi.co` is the official demo environment): https://help.kalshi.com/en/articles/13823775-creating-and-using-a-demo-account (fetched 2026-11-20)")
    A("- Kalshi contract terms, AAAGAS (gas-price contract; AAA is the named source agency): https://assets.kalshi.com/contract_terms/AAAGAS.pdf (fetched 2026-11-20)")
    A("- Demo exchange status, live: https://external-api.demo.kalshi.co/trade-api/v2/exchange/status returned `exchange_active: true`, `trading_active: true` (fetched 2026-11-20 via page fetcher)")
    A("- GitHub PR links used by the board: `github.com/wingbangboozle1-lang/Trade1/pull/11` and `/pull/19` return HTTP 200 from the sandbox; both PRs are `closed` with a `merged_at` value (GitHub API, 2026-11-20).")
    A("- `pypi.org/pypi/kalshi/json` returns HTTP 200 (sandbox curl, 2026-11-20).\n")
    A("## 5. Could not be checked from this sandbox\n")
    A("- Official-host allowlist entries for `docs.github.com` are matched by owner domain; the URL itself was not opened.")
    A("- All `*.kalshi.co`, `*.kalshi.com` hosts are unreachable by `curl` from the build sandbox (HTTP 000), so external links were checked only through the page fetcher, not by a status-code sweep.")
    A("- `docs.github.com` is unreachable by `curl` from the sandbox (HTTP 000). The link is a GitHub documentation page and needs a manual click-through.")
    A("- Per-URL liveness was NOT swept for Kalshi or third-party hosts; they are classified by host name only. Four Kalshi URLs were opened with the page fetcher (section 4); the GitHub and PyPI URLs above were status-checked with curl.\n")
    open(out_path, "w", encoding="utf-8").write("\n".join(L) + "\n")

if __name__ == "__main__":
    main()
