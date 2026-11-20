#!/usr/bin/env node
/*
 * Build + validation for the Kalshi dashboard (no bundler needed — it is a static
 * site). This script:
 *   1. Syntax-checks every site JS file with `node --check`.
 *   2. Extracts local asset + link references from every HTML file and verifies
 *      they resolve to real files (catches broken links).
 *   3. Verifies every topic/nav target page exists.
 *   4. Writes tools/build-report.json and exits non-zero on any failure.
 *
 * Run: node tools/build.mjs
 */
import { readdir, readFile, writeFile, stat, access } from "node:fs/promises";
import { constants as fsConst } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, resolve, relative } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const errors = [];
const warnings = [];
const report = { checkedAt: new Date().toISOString(), files: 0, errors, warnings };

async function exists(p) {
  try { await access(p, fsConst.F_OK); return true; } catch { return false; }
}

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

/* The site is served from the repo root (GitHub Pages source: branch main, path /).
 * Site HTML = root index.html + pages/*.html + site/*.html (site/ build, session sess-a1-9a0ad587).
 * Site JS = js/*.js + site/js/*.js. Vendored third-party JS (site/vendor) is skipped. */
/* One site only. Earlier parallel sessions' trees (a2ec5543/, site/, monitor/,
 * trade1/, pages/, categories/, js/, css/) were removed in this session — see
 * COORDINATION.md. Checking a directory that no longer exists is a no-op. */
const ROOT_PAGES = [
  "index.html", "dashboard.html", "trades.html", "data.html",
  "methods.html", "flagged.html", "sources.html",
  "resolved.html", "executive-summary.html", "suggestions.html",
];
const HTML_GLOB = ROOT_PAGES.concat(["topics"]);
const JS_GLOB = ["assets"];

async function checkJsSyntax(file) {
  return new Promise((res) => {
    execFile(process.execPath, ["--check", file], (err, _stdout, stderr) => {
      if (err) {
        errors.push(`JS syntax error in ${relative(ROOT, file)}: ${stderr}`);
        res(false);
      } else res(true);
    });
  });
}

/* Extract src=/href= targets from HTML, skipping external (http/mailto/#).
 * <script> blocks are stripped first: inside them `href="..."` is JavaScript
 * string concatenation (built at runtime), not a static document reference. */
function extractRefs(htmlRaw) {
  const html = htmlRaw.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const refs = [];
  const re = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1];
    if (/^(https?:|mailto:|#|tel:)/i.test(url)) continue;
    refs.push(url.split("#")[0].split("?")[0]);
  }
  return refs;
}

async function collect(globs) {
  const files = [];
  for (const g of globs) {
    const full = join(ROOT, g);
    if (!(await exists(full))) continue;
    const s = await stat(full);
    if (s.isFile()) files.push(full);
    else files.push(...await walk(full));
  }
  return files;
}

async function main() {
  const htmlFiles = (await collect(HTML_GLOB)).filter((f) => f.endsWith(".html"));
  const jsFiles = (await collect(JS_GLOB)).filter((f) => f.endsWith(".js"));
  report.htmlFiles = htmlFiles.map((f) => relative(ROOT, f));
  report.jsFiles = jsFiles.map((f) => relative(ROOT, f));

  // 1. JS syntax
  for (const f of jsFiles) { report.files++; await checkJsSyntax(f); }

  // 2. HTML references
  for (const f of htmlFiles) {
    report.files++;
    const html = await readFile(f, "utf8");
    for (const ref of extractRefs(html)) {
      if (!ref) continue;
      const target = normalize(resolve(dirname(f), ref));
      if (!await exists(target)) {
        errors.push(`Broken reference in ${relative(ROOT, f)}: "${ref}"`);
      }
    }
  }

  // 3. Nav/topic target pages exist
  const navTargets = [
    "index.html", "dashboard.html", "trades.html", "data.html", "methods.html",
    "flagged.html", "sources.html", "executive-summary.html", "suggestions.html",
    "topics/gas-prices.html", "topics/elections.html", "topics/culture.html",
    "topics/crypto.html", "topics/golf.html",
  ];
  for (const t of navTargets) {
    if (!await exists(join(ROOT, t))) errors.push(`Missing nav target: ${t}`);
  }

  // 4. docs exist
  for (const d of ["docs/executive-summary.md", "docs/api-reference.md", "docs/sources.md", "docs/verification.md", "docs/API_NOTES.md", "docs/EXECUTIVE_SUMMARY.md", "docs/SOURCES.md", "docs/FLAGGED.md", "COORDINATION.md"]) {
    if (!await exists(join(ROOT, d))) warnings.push(`Doc not found: ${d}`);
  }

  await writeFile(join(ROOT, "tools", "build-report.json"), JSON.stringify(report, null, 2));

  if (errors.length) {
    console.error(`BUILD FAILED — ${errors.length} error(s):`);
    errors.forEach((e) => console.error("  ✗ " + e));
    process.exit(1);
  }
  console.log(`BUILD OK — ${htmlFiles.length} HTML, ${jsFiles.length} JS files validated, 0 broken links.`);
  if (warnings.length) warnings.forEach((w) => console.log("  ⚠ " + w));
}

main();
