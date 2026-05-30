---
name: "Observability Stack"
description: "Use OTEL Collector with VictoriaLogs, VictoriaMetrics, and VictoriaTraces"
status: accepted
---

# ADR-0005: Observability Stack

**Date:** 2026-05-14
**Category:** Slot
**Next review:** 2026-11-14

## Context

Agentic engineering requires a local, queryable observability stack that can run on developer machines without heavyweight SaaS dependencies.

## Decision

Use OTEL Collector contrib in front of VictoriaLogs, VictoriaMetrics, and VictoriaTraces, queried with LogsQL, PromQL, and TraceQL.

## Consequences

The stack stays laptop-friendly and single-node while preserving standard OTLP ingestion. The team must re-benchmark if VictoriaTraces stalls or a lighter single-binary stack proves better.

## Details

## Current pick
OTEL Collector (contrib) fronting **VictoriaLogs**, **VictoriaMetrics**, and **VictoriaTraces** — three single-binary services behind one OTLP ingress, queried via LogsQL / PromQL / TraceQL. Matches today's `infra/` reference.

## Justification
- All three Victoria* components ship as **single Go binaries** with first-class OTLP/HTTP ingest and run "smoothly on Raspberry Pi" — the laptop-friendliness bar the slot promotion criterion (<30s cold boot) demands ([VictoriaLogs docs](https://docs.victoriametrics.com/victorialogs/)).
- **VictoriaTraces** is now a maintained 2026 release line with a stable single-node binary, closing the gap that previously forced us to consider Tempo for traces ([VictoriaTraces releases](https://github.com/VictoriaMetrics/VictoriaTraces/releases/), [docs](https://docs.victoriametrics.com/victoriatraces/)).
- LogsQL ergonomics are already encoded in the `observability-queries` skill (severity-not-level, `| fields` projection, no `|~` regex pipe); switching would re-spend that token-projection learning.
- Query languages match upstream defaults (PromQL/LogsQL), so agent skills and Grafana dashboards travel.

## Maintenance signal
Active. VictoriaMetrics shipped v1.141.0–v1.142.0 in April 2026 with VictoriaLogs Splunk-ingest + LogsQL tooling; January 2026 round-up shows steady cross-stack releases ([latest updates blog](https://victoriametrics.com/blog/our-latest-updates-across-the-victoriametrics-observability-ecosystem/index.html)).

## License
Apache-2.0 across VictoriaMetrics / VictoriaLogs / VictoriaTraces and the OTEL Collector contrib distribution.

## Cross-platform (resource-friendly for laptop dev?)
Yes. Three small Go binaries + OTEL Collector in docker-compose; each Victoria* component idles in tens of MB and scales linearly. Materially lighter than the LGTM stack (Loki + Tempo + Mimir + Grafana are four separate services, each heavier) and avoids ClickHouse JVM-class memory floors that SigNoz/OpenObserve-with-CH inherit ([Parseable 2026 roundup](https://www.parseable.com/blog/ten-best-open-source-observability-platforms-2026)).

## Alternatives considered
- **SigNoz** — strongest single-pane-of-glass UX and OTel-native, but ClickHouse + query-service + frontend + alertmanager is a heavier compose footprint than we need on a laptop ([SigNoz architecture](https://signoz.io/docs/architecture/)). Re-probe if we want a built-in APM UI.
- **OpenObserve** — Rust single-binary, object-store backed, claims ~140× lower storage cost vs Elasticsearch ([OpenObserve top-10](https://openobserve.ai/blog/top-10-observability-platforms/)). Compelling; loses on (a) LogsQL/PromQL muscle memory we already have, (b) SQL-flavored query language is a different agent-skill investment. Strong re-probe candidate at next review.
- **Grafana LGTM (Loki+Tempo+Mimir)** — mature but four services for what Victoria* does in three lighter ones ([LGTM guide](https://drdroid.io/engineering-tools/lgtm-stack-for-observability-a-complete-guide)).
- **Quickwit / ClickHouse-direct / Parseable / GreptimeDB** — interesting on storage cost at scale; overkill for dev-laptop slot contract.
- **Honeycomb Refinery** — sampling proxy, not a backend; orthogonal.

## Open issues / when to re-probe
- Re-probe if VictoriaTraces stalls or if OpenObserve's single-binary + object-store story compresses cold-boot/disk below Victoria*'s.
- Promotion criterion (cold-boot <30s, survives destroy→boot) was asserted by the upstream lab's evaluation pass; if your fork's harness diverges materially, re-bench against your current `harness/observability/` compose at next review.

## Sources
- [VictoriaLogs docs](https://docs.victoriametrics.com/victorialogs/)
- [VictoriaTraces docs](https://docs.victoriametrics.com/victoriatraces/) · [releases](https://github.com/VictoriaMetrics/VictoriaTraces/releases/)
- [VictoriaMetrics 2026 updates](https://victoriametrics.com/blog/our-latest-updates-across-the-victoriametrics-observability-ecosystem/index.html)
- [Parseable: Best open-source observability 2026](https://www.parseable.com/blog/ten-best-open-source-observability-platforms-2026)
- [SigNoz architecture](https://signoz.io/docs/architecture/)
- [OpenObserve: top observability platforms 2026](https://openobserve.ai/blog/top-10-observability-platforms/)
- [LGTM stack guide](https://drdroid.io/engineering-tools/lgtm-stack-for-observability-a-complete-guide)
