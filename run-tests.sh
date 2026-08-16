#!/bin/bash
# One entrypoint for the suite: node --test (type-stripped TS) plus the tsc
# type gate. Args are forwarded verbatim to the test runner. Quiet on green,
# full output on red. Node 22 comes from mise; the system node is too old.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
COV_TMP="$ROOT/coverage/tmp"
COV_SNAP="$ROOT/coverage/snapshot.json"
status=0

args=("$@")
[ ${#args[@]} -eq 0 ] && args=($(find "$ROOT/tests" -name '*.test.ts' 2>/dev/null))
if [ ${#args[@]} -eq 0 ]; then
  echo "✅ Tests passed (no test files yet)"
  exit 0
fi

# V8 coverage feeds the pre-commit CRAP gate (`liubai crap`); refreshed every run.
rm -rf "$COV_TMP"
test_out=$(NODE_V8_COVERAGE="$COV_TMP" mise exec -- node --test --experimental-strip-types --test-concurrency=1 "${args[@]}" 2>&1) || status=1
if [ $status -eq 0 ]; then
  echo "✅ Tests passed"
else
  echo "$test_out"
fi

# Merge whatever V8 wrote into the snapshot the CRAP gate reads, even on red —
# a stale snapshot makes the gate lie. Skipped when the liubai tooling is absent.
if liubai_bin="$(command -v liubai)" \
  && liubai_repo="$(dirname "$(dirname "$(readlink -f "$liubai_bin")")")" \
  && [ -f "$liubai_repo/engine/coverage-v8-cli.ts" ] \
  && [ -d "$COV_TMP" ] && [ -n "$(ls -A "$COV_TMP" 2>/dev/null)" ]; then
  mise exec -- node --experimental-strip-types "$liubai_repo/engine/coverage-v8-cli.ts" "$COV_TMP" "$ROOT" "$COV_SNAP" >/dev/null
fi

# tsc errors on a project with no input files, so skip the gate until code exists.
if find "$ROOT/src" "$ROOT/tests" -name '*.ts' -print -quit 2>/dev/null | grep -q .; then
  tsc_status=0
  tsc_out=$(mise exec -- npx tsc --noEmit 2>&1) || tsc_status=1
  if [ $tsc_status -eq 0 ]; then
    echo "✅ Types check clean"
  else
    echo "$tsc_out"
    status=1
  fi
fi

exit "$status"
