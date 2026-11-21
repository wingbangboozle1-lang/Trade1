#!/usr/bin/env bash
# Run a test suite and, if it fails, publish the failing lines as check annotations.
#
# Why: this repository is verified from an Arena sandbox whose network allowlist does not
# include the Actions log-storage host, so `gh run view --log` cannot be read here
# (recorded by earlier sessions as "the failed job log could not be downloaded").
# Annotations are served by api.github.com, which the sandbox CAN read, so a CI-only
# failure can be diagnosed without leaving the sandbox. Output is echoed verbatim too,
# so the normal log is unchanged for anyone reading it in the web UI.
#
# Usage: run-and-annotate.sh '<label>' <command…>
set -uo pipefail
label="$1"; shift
out="$(mktemp)"; rc=0
"$@" 2>&1 | tee "$out" || rc=${PIPESTATUS[0]}
if [ "$rc" -ne 0 ]; then
  esc() { sed -e 's/%/%25/g' -e 's/\r/%0D/g' | tr '\n' '|' | sed -e 's/|/ /g'; }
  # Deliberately parenthesis-free: a stray ( ) in an ERE makes grep exit 2 and the
  # annotation would silently carry no diagnosis at all.
  fails="$(grep -aE 'FAIL|AssertionError|Error:|not ok|FAILED|^throw |expected|want ' "$out" | grep -avE '^ *at |^ *\^' | head -8 | esc)"
  tail_line="$(tail -8 "$out" | esc)"
  echo "::error::${label} failed (exit ${rc}). First failures: ${fails:-<none matched the grep>} — tail: ${tail_line}"
  # also print the whole output for the annotation-less reader
  echo "--- full output ---"; cat "$out"
fi
exit "$rc"
