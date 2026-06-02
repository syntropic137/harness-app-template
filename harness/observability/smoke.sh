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
  local command="$3"
  local out

  for _ in $(seq 1 30); do
    out="$(eval "$command" 2>/dev/null || true)"
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

require_cmd curl
require_cmd pnpm

PORTS="$("$ROOT/harness/stack/bin/stack" ports)"
OTEL_OTLP_PORT="$(printf '%s\n' "$PORTS" | port_value OTEL_OTLP_PORT)"
VL_PORT="$(printf '%s\n' "$PORTS" | port_value VL_PORT)"
VT_PORT="$(printf '%s\n' "$PORTS" | port_value VT_PORT)"

mkdir -p "$ROOT/.harness/logs"

"$ROOT/harness/stack/bin/stack" boot

service="observability-smoke-$(date +%s)"
log_file="$ROOT/.harness/logs/${service}.jsonl"

OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTEL_OTLP_PORT}" \
OTEL_SERVICE_NAME="$service" \
  pnpm --filter @example/typescript emit | tee -a "$log_file" >/dev/null

log_query="service:\"${service}\" | fields _time,_msg,service,msg,traceId"
log_cmd="curl -fsS --get 'http://localhost:${VL_PORT}/select/logsql/query' --data-urlencode 'query=${log_query}'"
trace_cmd="curl -fsS --get 'http://localhost:${VT_PORT}/select/jaeger/api/traces' --data-urlencode 'service=${service}' --data-urlencode 'limit=10'"

poll_contains "VictoriaLogs" "$service" "$log_cmd"
poll_contains "VictoriaTraces" "$service" "$trace_cmd"
