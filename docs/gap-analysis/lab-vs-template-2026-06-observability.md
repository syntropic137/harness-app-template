# Lab vs Template Gap Analysis: Observability and Telemetry

Date: 2026-06-02
Area: observability-stack and telemetry-sdk

## Verdict

The template does not yet match the lab well enough for a fork to get working observability out of the box.

The `observability-stack` compose and collector config are effectively at parity with the lab's Victoria stack. The gap is downstream of that stack: the template telemetry SDK is example-local, not a reusable slot implementation, and it does not explicitly wire the lab's full logs, metrics, and traces path. The advertised host-run examples also default to fixed ports while `just stack boot` allocates per-worktree ports.

No live Docker stack was booted for this report. Verification was against actual files and one read-only stack port command.

## Evidence Inventory

| Area | Lab files checked | Template files checked | Finding |
|---|---|---|---|
| Runtime observability compose | `infra/docker/compose.harness.yml`, `infra/otel/otel-collector.yaml` | `harness/observability/compose.harness.yml`, `harness/observability/otel-collector.yaml` | Same stack shape: OTEL Collector contrib 0.133.0 to VictoriaLogs 1.36.1, VictoriaMetrics 1.128.0, VictoriaTraces 0.4.0. |
| Scaffold observability compose | `templates/polyglot-monorepo/files/harness/observability/*` | `harness/observability/*` | Template files match the lab scaffold path, with path-local README differences only. |
| Stack manager integration | `harness/stack/src/commands/boot.ts`, `harness.config.ts` | `harness/stack/src/commands/boot.ts`, no root `harness.config.ts` | Template stack-manager includes `harness/observability/compose.harness.yml`, but default config has no app services. |
| Telemetry package | `packages/telemetry/package.json`, `src/node.ts`, `src/web.ts`, `src/resource.ts` | `ws_packages/.gitkeep`, no `ws_packages/telemetry` | Lab has a reusable `@harness/telemetry` package. Template has no telemetry package directory. |
| App telemetry | `apps/api`, `apps/web`, `apps/api-rust`, `apps/api-py`, `apps/api-cpp` | `ws_apps/example-typescript`, `ws_apps/example-rust`, `ws_apps/example-python` | Lab app telemetry includes explicit OTLP logs, metrics, and traces in several apps. Template examples are local hello-world bootstraps. |
| Query runbook | `.claude/skills/observability-queries/SKILL.md` in both repos | same | Skill text still uses lab command `pnpm harness inspect`. Template root `package.json` has no `harness` script. |
| Live proof | `experiments/2026-05-15--polyglot-telemetry-smoke/results.md`, `docs/retrospectives/021-batchspanprocessor-process-exit-flush.md` | no telemetry smoke under `experiments/` | Lab has a live trace landing proof and a shutdown retrospective. Template has only unit/integration tests without a live collector. |

## What Matches

The Victoria stack itself is not the problem. The lab runtime compose at `infra/docker/compose.harness.yml` and template compose at `harness/observability/compose.harness.yml` both define:

- `otel-collector` on OTLP HTTP port 4318, backed by collector config.
- `victorialogs` on 9428.
- `victoriametrics` on 8428.
- `victoriatraces` on 10428.
- Three named volumes for Victoria data.

The collector configs both define OTLP HTTP and internal OTLP gRPC receivers, a `batch` processor, the `transform/keep-essential` allow-list, and separate pipelines for metrics, logs, and traces. I am not filing a stack-compose gap.

The template stack-manager also has the right include hook. `harness/stack/src/commands/boot.ts` writes a generated compose file that includes `harness/observability/compose.harness.yml`, and `harness/stack/src/topology/compose.ts` injects `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` for services listed in `telemetry.services`.

## Gaps

### 1. Missing reusable telemetry-sdk package

Lab has `packages/telemetry/` as a real package:

- `src/node.ts` configures `NodeSDK` with `OTLPTraceExporter`, `OTLPMetricExporter`, and `OTLPLogExporter`.
- `src/web.ts` configures browser tracing.
- `src/resource.ts` centralizes `service.name`, `deployment.environment`, and `harness.*` attributes.
- `apps/api` and `apps/web` import it via `@harness/telemetry`.

Template has no equivalent directory under `ws_packages/` or `harness/telemetry-sdk/`. Its manifest declares the telemetry slot entrypoint as `ws_apps/*/src/telemetry.*`, so the current implementation is per-example source files rather than a rip-out-able shared plugin.

Tracked by existing bead: `create-harness-app-port-telemetry-shared-lib-zot`.

### 2. Logs and metrics are not actually wired like the lab

The lab sends more than traces:

- `packages/telemetry/src/node.ts` explicitly wires trace, metric, and log OTLP HTTP exporters.
- `apps/api-rust/src/main.rs` wires span, metric, and log exporters.
- `apps/api-py/src/main.py` wires span and log exporters.
- `apps/api-cpp/src/main.cpp` wires span, metric, and log exporters.

The template examples do not show explicit log or metric exporters. A repository search in the template found no `OTLPLogExporter`, `OTLPMetricExporter`, `BatchLogRecordProcessor`, `PeriodicExportingMetricReader`, `LoggerProvider`, or `MeterProvider` usage under `ws_apps`, `ws_packages`, or `harness`.

The example apps write JSON log lines to stdout, but the template collector config has only an OTLP receiver. There is no filelog receiver and no Docker log ingestion path. Therefore the example README claim "emit one span + one log line -> retrieve via observability-queries" is not supported by the current files unless the SDK or runtime adds log export elsewhere.

Tracked by existing bead: `create-harness-app-port-telemetry-shared-lib-zot`.

### 3. Host-run examples miss stack-manager allocated ports

The template examples are host-run only. No `Dockerfile` exists under `ws_apps/example-*`, and the template root has no `harness.config.ts`. The example READMEs say to run `just stack boot` and then run the example on the host.

That path has a port mismatch. In this checkout:

```text
harness/stack/bin/stack ports
OTEL_OTLP_PORT=38896
VL_PORT=38893
VM_PORT=38894
VT_PORT=38895
```

But the telemetry defaults and README snippets use fixed ports:

- `OTEL_EXPORTER_OTLP_ENDPOINT` defaults to `http://localhost:4318`.
- query snippets use `http://localhost:9428` and fixed Victoria endpoints.

After `just stack boot`, the host OTLP endpoint is `http://localhost:$OTEL_OTLP_PORT`, not always `http://localhost:4318`. A fork following the current README can boot the stack and still emit traces to the wrong port.

Tracked by new bead: `create-harness-app-observability-query-entrypoints-dae`.

### 4. Query skill uses lab command names

`.claude/skills/observability-queries/SKILL.md` says:

```sh
pnpm harness inspect
```

That is valid in the lab root package, where `package.json` defines `"harness": "pnpm --filter @harness/stack run harness --"`. The template root `package.json` has no `harness` script. The template entrypoints are `just stack inspect`, `just stack ports`, or `harness/stack/bin/stack`.

This matters because the skill is the agent-facing way to discover ports and query the stack. A copied lab command that fails is a direct observability usability gap.

Tracked by new bead: `create-harness-app-observability-query-entrypoints-dae`.

### 5. No live telemetry roundtrip smoke

The lab has a live smoke result at `experiments/2026-05-15--polyglot-telemetry-smoke/results.md` proving Node, Rust, and Python traces landed in VictoriaTraces. It also has retrospective 021 documenting the `BatchSpanProcessor` shutdown trap and why unit tests cannot catch it.

The template has no telemetry smoke experiment or recipe. The current experiments directory contains architecture metric experiments only. Template comments say the live OTLP path is manual and should live under an experiment, but that experiment is absent.

This is a real release-readiness gap because it is the only proof that bytes cross process, network, collector, and backend boundaries.

Tracked by new bead: `create-harness-app-telemetry-roundtrip-smoke-0ka`.

## Recommendations

1. Close `create-harness-app-port-telemetry-shared-lib-zot` first. Port or adapt the lab `packages/telemetry` package into `ws_packages/telemetry`, centralize resource attributes, and wire explicit OTLP exporters for the supported signals.
2. Close `create-harness-app-observability-query-entrypoints-dae` next. Make the skill and example READMEs use template commands and dynamic ports, including `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:$OTEL_OTLP_PORT` for host-run examples.
3. Close `create-harness-app-telemetry-roundtrip-smoke-0ka` before claiming the slot is shipping quality. The smoke should boot the stack, run the TS/Rust/Python examples, wait for flush, and query VictoriaTraces plus VictoriaLogs.

## Beads

| Gap | Bead |
|---|---|
| Missing shared telemetry package and missing logs/metrics wiring | `create-harness-app-port-telemetry-shared-lib-zot` |
| Host-run examples and query docs use wrong commands or fixed ports | `create-harness-app-observability-query-entrypoints-dae` |
| No live telemetry roundtrip smoke | `create-harness-app-telemetry-roundtrip-smoke-0ka` |

