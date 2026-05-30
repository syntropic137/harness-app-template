# `harness/observability` — OTel collector + Victoria* stack

> **Moved here from `infra/{otel,docker}/`** (bead
> `agentic-harness-lab-impl-f-harness-7yf`, S1 r3.2 C15). The harness's
> observability stack is **harness machinery** — the environment the agent
> operates in — NOT the consumer-app's deployment infra. `infra/` stays
> for the consumer-app's own infra (`doctor/`, `install/` for now).

## What's here

- `otel-collector.yaml` — OTel Collector contrib config. Receives OTLP/HTTP
  on `${OTEL_OTLP_PORT}` from ws_apps/* + harness/*, fans out to:
    - VictoriaLogs (logs)
    - VictoriaMetrics (metrics)
    - VictoriaTraces (traces)
- `compose.harness.yml` — Docker Compose stack for the four services
  (otel-collector + victorialogs + victoriametrics + victoriatraces).
  Ports come from environment variables that `harness/stack` (per slot
  `stack-manager`) allocates and writes.

## Volume layout

`compose.harness.yml` mounts the collector config from the same
directory (`./otel-collector.yaml` → `/etc/otelcol/config.yaml:ro`),
which is the file co-located here. Pre-S1-r3.2 the mount was
`../otel/otel-collector.yaml` (compose lived under `infra/docker/`,
config under `infra/otel/`). The move means a single directory rather
than a two-directory crawl.

## Boot

The lab justfile's `just stack boot` recipe (delegating to
`harness/stack/bin`, see [`../stack/`](../stack/)) reads
`compose.harness.yml`, allocates ports, generates the
`.env`-style port map, and invokes `docker compose -f
harness/observability/compose.harness.yml up`. Same flow as pre-move;
only the filesystem path changes.

## Ports

The compose file uses the following env vars (allocated by the stack
manager at boot):

| Var | Service | Default behavior |
|---|---|---|
| `OTEL_OTLP_PORT` | otel-collector OTLP/HTTP receiver | Port allocated per worktree |
| `VL_PORT`        | VictoriaLogs HTTP                  | Port allocated per worktree |
| `VM_PORT`        | VictoriaMetrics HTTP               | Port allocated per worktree |
| `VT_PORT`        | VictoriaTraces HTTP                | Port allocated per worktree |

The per-worktree allocation lets multiple worktrees of the same fork
run concurrent stacks without port collisions.

## Querying the stack

Use the `observability-queries` skill (`.claude/skills/observability-queries/`)
for canonical LogsQL / PromQL / TraceQL queries against this stack. The
skill knows the syntax pitfalls (severity not level; case-sensitive
enum; `| fields` projection mandatory) and the curl URLs.

## Why these picks

See `docs/adrs/ADR-0005-observability-stack.md` for the
research-backed slot decision (Victoria* + OTel Collector contrib vs.
the LGTM stack vs. SigNoz vs. OpenObserve).
