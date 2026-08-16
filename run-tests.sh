#!/bin/bash
# One entrypoint for the suite: vitest plus the tsc type gate. Args are
# forwarded verbatim to vitest. Quiet on green, full output on red.
# Node 22 comes from mise; the system node is too old for the substrate.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
status=0

test_out=$(mise exec -- npx vitest run --passWithNoTests "$@" 2>&1) || status=1
if [ $status -eq 0 ]; then
  echo "✅ Tests passed"
else
  echo "$test_out"
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
