#!/usr/bin/env bash
# harness/perf/bench.sh — startup-time bench (bead n48.13).
#
# Runs hyperfine against ws_apps/example-typescript's cold-start path
# (node --import tsx --import telemetry.ts main.ts) and prints the
# canonical hyperfine JSON to stdout for harness/perf/gate.mjs to
# compare against the committed baseline.
#
# Skips cleanly when hyperfine is not installed — matches the existing
# `command -v` guard pattern used by the lefthook ubs-staged /
# gitleaks / pnpm hooks.  Skip emits a `{available: false}` JSON sentinel
# so the gate logic treats it as a no-op (mirrors the apss_topology
# adapter's pattern from bead n48.3).
#
# Telemetry is disabled via HARNESS_TELEMETRY_DISABLED=1 so the bench
# measures cold start, not OTEL collector connectivity.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
EXAMPLE_DIR="$REPO_ROOT/ws_apps/example-typescript"

if ! command -v hyperfine >/dev/null 2>&1; then
  printf '%s\n' "warning: hyperfine not found — install via 'apt install hyperfine' or 'brew install hyperfine'; skipping perf bench" >&2
  printf '%s\n' '{"results": [], "available": false, "reason": "hyperfine-not-installed"}'
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "warning: node not found — skipping perf bench" >&2
  printf '%s\n' '{"results": [], "available": false, "reason": "node-not-installed"}'
  exit 0
fi

if [ ! -d "$EXAMPLE_DIR/node_modules" ]; then
  printf '%s\n' "warning: $EXAMPLE_DIR/node_modules missing — run 'just bootstrap' first; skipping perf bench" >&2
  printf '%s\n' '{"results": [], "available": false, "reason": "deps-not-installed"}'
  exit 0
fi

cd "$EXAMPLE_DIR"

# --warmup 1 absorbs filesystem-cache effects; --runs 5 keeps the bench
# under ~15s wall-clock on a typical laptop.  --show-output discarded
# because the example writes a single JSON log line we don't need here.
#
# hyperfine writes its human-readable progress table to STDOUT, so
# `--export-json /dev/stdout` interleaves the table with the JSON and yields
# an unparseable stream for harness/perf/gate.mjs. Export to a temp file and
# emit ONLY that file's JSON on stdout.
bench_json="$(mktemp -t harness-perf-bench-XXXXXX.json)"
trap 'rm -f "$bench_json"' EXIT
HARNESS_TELEMETRY_DISABLED=1 hyperfine \
  --warmup 1 \
  --runs 5 \
  --export-json "$bench_json" \
  --command-name "example-typescript-start" \
  "node --import tsx --import ./src/telemetry.ts src/main.ts" \
  >/dev/null 2>&1
cat "$bench_json"
