#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'observability smoke: missing %s\n' "$1" >&2
    exit 1
  fi
}

port_value() {
  awk -F= -v key="$1" '$1 == key { print $2 }'
}

poll_contains() {
  local label="$1"
  local needle="$2"
  shift 2
  local out

  for _ in $(seq 1 "${HARNESS_OBSERVABILITY_SMOKE_ATTEMPTS:-45}"); do
    out="$("$@" 2>/dev/null || true)"
    if printf '%s' "$out" | grep -Fq "$needle"; then
      printf 'observability smoke: %s round trip ok\n' "$label"
      return 0
    fi
    sleep 1
  done

  printf 'observability smoke: %s did not contain %s\n' "$label" "$needle" >&2
  printf '%s\n' "$out" >&2
  return 1
}

query_logs() {
  local service="$1"
  curl -fsS --get "http://localhost:${VL_PORT}/select/logsql/query" \
    --data-urlencode "query=service:\"${service}\" | fields _time,_msg,service,msg,traceId | limit 20"
}

query_traces() {
  local service="$1"
  curl -fsS --get "http://localhost:${VT_PORT}/select/jaeger/api/traces" \
    --data-urlencode "service=${service}" \
    --data-urlencode "limit=10"
}

run_emit() {
  local label="$1"
  local service="$2"
  shift 2

  local log_file="$ROOT/.harness/logs/${service}.jsonl"
  : >"$log_file"

  printf 'observability smoke: emitting %s as %s\n' "$label" "$service"
  OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTEL_OTLP_PORT}" \
  OTEL_SERVICE_NAME="$service" \
  HARNESS_TELEMETRY_DISABLED=0 \
    "$@" | tee -a "$log_file" >/dev/null

  poll_contains "${label} VictoriaLogs" "$service" query_logs "$service"
  poll_contains "${label} VictoriaTraces" "$service" query_traces "$service"
}

emit_typescript() {
  pnpm --filter @example/typescript emit
}

emit_rust() {
  cargo run --quiet --manifest-path "$ROOT/ws_apps/example-rust/Cargo.toml"
}

emit_python() {
  uv run --project "$ROOT/ws_apps/example-python" example-python
}

require_cmd curl
require_cmd docker
require_cmd pnpm
require_cmd cargo
require_cmd uv

PORTS="$("$ROOT/harness/stack/bin/stack" ports)"
OTEL_OTLP_PORT="$(printf '%s\n' "$PORTS" | port_value OTEL_OTLP_PORT)"
VL_PORT="$(printf '%s\n' "$PORTS" | port_value VL_PORT)"
VT_PORT="$(printf '%s\n' "$PORTS" | port_value VT_PORT)"

mkdir -p "$ROOT/.harness/logs"

"$ROOT/harness/stack/bin/stack" boot
sleep "${HARNESS_OBSERVABILITY_BOOT_WAIT_SECONDS:-5}"

stamp="$(date +%s)"

run_emit "TypeScript" "observability-smoke-typescript-${stamp}" emit_typescript
run_emit "Rust" "observability-smoke-rust-${stamp}" emit_rust
run_emit "Python" "observability-smoke-python-${stamp}" emit_python

printf 'observability smoke: PASS polyglot telemetry round trip ok\n'
