---
name: "Telemetry SDK"
description: "Use official OpenTelemetry SDKs per language"
status: accepted
---

# ADR-0004: Telemetry SDK

**Date:** 2026-05-14
**Category:** Slot
**Next review:** 2026-11-14

## Context

The telemetry slot is inherently language-specific, but all languages need to emit compatible logs, metrics, and traces into the same harness observability stack.

## Decision

Use official OpenTelemetry SDKs per language: Node `@opentelemetry/sdk-node`, Rust `opentelemetry`/`opentelemetry-otlp`, and Python `opentelemetry-distro` plus framework instrumentation.

## Consequences

The template aligns on OTLP while preserving language-native instrumentation. SDK versions need periodic review because semantic conventions and Rust tracing support continue to evolve.

## Details

Per Standard v0.1 §4.4, this slot is intrinsically per-language. OTEL is the
mandated wire format (OTLP); the picks below are the official OTEL SDKs for
each of the three languages most likely to appear in a polyglot-monorepo
template.

## Current picks (per language)

### Node
- **Pick:** `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node`.
- **Version:** sdk-node `0.218.0` (latest, May 2026; unstable-track `0.x`
  matching the stable-track `2.x` for `@opentelemetry/api`). OTEL JS SDK 2.0
  shipped 2025 ([blog](https://opentelemetry.io/blog/2025/otel-js-sdk-2-0/)).
- **Auto-instrumentation:** yes, via `auto-instrumentations-node` (HTTP,
  Express, Fastify\*, pg, ioredis, …). \*Fastify instrumentation was removed
  from the meta-package in 2.x — install
  `@opentelemetry/instrumentation-fastify` directly.
- **Gotchas:** min Node `^18.19.0 || >=20.6.0`; TS target raised to ES2022;
  ESM apps need `--import` loader hook (a 2026 oneuptime post documents the
  recurring "auto-instrumentation silent on ESM" trap); default OTLP protocol
  is **HTTP/protobuf** (port 4318), not gRPC.

### Rust
- **Pick:** `opentelemetry` + `opentelemetry_sdk` + `opentelemetry-otlp`
  (plus `tracing-opentelemetry` if the app already uses the `tracing` crate).
- **Version:** `0.31.x` (April–May 2026). **Not yet 1.0** — tracked in
  [issue #3376](https://github.com/open-telemetry/opentelemetry-rust/issues/3376).
- **Stability:** Logs API and Metrics API are **stable** as of 0.28; Traces
  is **Beta** and is the explicit next graduation target before 1.0.
- **Gotchas:** breaking changes still land on every minor (see
  `docs/migration_0.28.md`); pick **one** async runtime feature
  (`rt-tokio` vs `rt-async-std`); `opentelemetry-otlp` default transport is
  gRPC via tonic — switch to `http-proto` feature when the collector is
  reached over an HTTP-only path; `tracing-opentelemetry` versions are
  pinned to specific `opentelemetry` minors, so bump them together.

### Python
- **Pick:** `opentelemetry-distro` + `opentelemetry-instrumentation` (for
  zero-code via `opentelemetry-instrument`) plus per-framework packages
  (`opentelemetry-instrumentation-fastapi`,
  `opentelemetry-instrumentation-flask`, …).
- **Version:** `opentelemetry-sdk` **1.41.1** (April 2026); semconv package
  is still `0.62b1` (unstable 0.Yb0 beta scheme per
  [versioning spec](https://opentelemetry.io/docs/specs/otel/versioning-and-stability/)).
- **Auto-instrumentation:** mature. `opentelemetry-bootstrap -a install`
  discovers installed libs and pulls matching instrumentation packages;
  `opentelemetry-instrument <cmd>` wraps the process with no code changes.
- **Gotchas:** FastAPI auto-instrumentation needs to wrap **before** the
  ASGI server imports the app (use the CLI wrapper, not in-process patching
  after uvicorn boots); semantic-conventions package is still pre-1.0 so
  attribute names can rename across minors — pin it.

## Justification
OTEL is the only cross-language observability standard with first-class OTLP
ingestion in the harness's `observability-stack` (OTEL Collector contrib →
VictoriaLogs/Metrics/Traces). Picking the official SDK per language
minimizes drift from the spec and from semantic conventions.

## Maintenance signal
All three SDKs are CNCF projects under active weekly-to-monthly release
cadence in 2026. Node SDK 2.x is current; Python is past 1.40; Rust is on
track to 1.0 with logs/metrics already stable.

## License
All three: **Apache-2.0**.

## Cross-platform
All three SDKs are pure library code (no native binaries) and work
identically on macOS/Linux/Windows. Transport choice is the only
platform-touching variable.

## Alternatives considered (vs other observability standards)
- **Vendor SDKs (Datadog, New Relic, Honeycomb beelines):** rejected —
  locks instrumentation to one backend; OTEL is the explicit lab choice.
- **OpenCensus / OpenTracing:** deprecated, subsumed by OTEL.
- **Prometheus client libs only (metrics-only):** insufficient — harness
  requires logs + metrics + traces on the same wire.
- **`tracing` (Rust) alone, no OTEL bridge:** rejected — emits to stdout
  only; `tracing-opentelemetry` bridge is the supported path.

## Open issues / when to re-probe
- **Rust 1.0:** re-probe when `opentelemetry-rust` ships 1.0 (graduation of
  Traces to stable). Triggers a Standard re-read for any breaking API.
- **Node default protocol:** if the harness's collector exposes only one of
  4317/4318, document it in the template README — SDKs default differently
  (Node→HTTP, Rust/Go→gRPC, Python→gRPC).
- **Python semconv stable:** when `opentelemetry-semantic-conventions`
  drops the `0.Yb0` beta and goes 1.x, audit attribute names in skills
  (`observability-queries` uses `severity`, etc.).
- **Auto-instrumentation token cost:** none of these picks have been probed
  against the lab's token-weight budget. Candidate for a running-experiments
  probe before promotion into a shipping template.

## Sources
- [@opentelemetry/sdk-node on npm](https://www.npmjs.com/package/@opentelemetry/sdk-node)
- [OpenTelemetry JS SDK 2.0 announcement](https://opentelemetry.io/blog/2025/otel-js-sdk-2-0/)
- [auto-instrumentations-node CHANGELOG](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/auto-instrumentations-node/CHANGELOG.md)
- [Fix OTel auto-instrumentation on Node ESM (oneuptime, 2026-02)](https://oneuptime.com/blog/post/2026-02-06-fix-otel-auto-instrumentation-nodejs-esm/view)
- [opentelemetry-rust releases](https://github.com/open-telemetry/opentelemetry-rust/releases)
- [opentelemetry-rust #3376 — graduate features before 1.0](https://github.com/open-telemetry/opentelemetry-rust/issues/3376)
- [opentelemetry-otlp on crates.io](https://crates.io/crates/opentelemetry-otlp)
- [opentelemetry-rust 0.28 migration notes](https://github.com/open-telemetry/opentelemetry-rust/blob/main/docs/migration_0.28.md)
- [opentelemetry-sdk on PyPI](https://pypi.org/project/opentelemetry-sdk/)
- [opentelemetry-semantic-conventions on PyPI](https://pypi.org/project/opentelemetry-semantic-conventions/)
- [Python zero-code auto-instrumentation example](https://opentelemetry.io/docs/zero-code/python/example/)
- [OTLP gRPC vs HTTP comparison (oneuptime, 2026-02)](https://oneuptime.com/blog/post/2026-02-06-otlp-grpc-vs-http-comparison/view)
- [OTEL versioning-and-stability spec](https://opentelemetry.io/docs/specs/otel/versioning-and-stability/)
- [OpenTelemetry semantic conventions 1.41.0](https://opentelemetry.io/docs/specs/semconv/)
