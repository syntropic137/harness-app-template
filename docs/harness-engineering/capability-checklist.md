# Harness Engineering Capability Checklist

Distilled from the OpenAI Harness Engineering article and adjacent observability discussions. Organized as a practical checklist for building an effective agent operational nervous system.

The harness transforms the application into an environment that agents can perceive, reason about, and manipulate safely. That's the paradigm shift.

---

## 1. Isolated App Instances Per Task / Worktree

OpenAI: "app bootable per git worktree"

Agents need reproducibility, parallelism, isolation, deterministic debugging.

- [ ] Create isolated git worktree per task
- [ ] Launch isolated app instance
- [ ] Isolated ports
- [ ] Isolated DB/schema
- [ ] Isolated logs/metrics/traces
- [ ] Automatic teardown
- [ ] Restartability

---

## 2. Browser / UI Legibility (CDP Integration)

OpenAI wired Chrome DevTools directly into the runtime. Agent eyes + agent senses.

- [ ] Browser automation
- [ ] Page navigation
- [ ] Click/type interactions
- [ ] DOM snapshots
- [ ] Screenshots
- [ ] Runtime event observation
- [ ] Console log inspection
- [ ] Network request inspection
- [ ] Performance inspection
- [ ] JS error inspection
- [ ] Before/after state comparison
- [ ] UI validation
- [ ] Re-run validation loops

---

## 3. Full Local Observability Stack

Logs, metrics, traces exposed to the agent.

- [ ] Query logs
- [ ] Query metrics
- [ ] Query traces
- [ ] Correlate telemetry
- [ ] Reason over telemetry
- [ ] Compare telemetry across runs
- [ ] Observe startup/runtime behavior
- [ ] Observe user journeys
- [ ] Detect latency regressions
- [ ] Detect performance bottlenecks
- [ ] Detect failures automatically

---

## 4. Telemetry Query Interfaces

- [ ] LogsQL / LogsQL querying
- [ ] PromQL querying
- [ ] Trace querying
- [ ] VictoriaLogs API
- [ ] VictoriaMetrics API
- [ ] VictoriaTraces API

---

## 5. Telemetry Ingestion (OpenTelemetry + OTLP)

- [ ] OTLP logs
- [ ] OTLP metrics
- [ ] OTLP traces
- [ ] OpenTelemetry instrumentation
- [ ] Central telemetry ingestion

---

## 6. Telemetry Pipeline (Vector-Based Routing)

Pipeline: app → Vector → observability stack

- [ ] Telemetry routing
- [ ] Telemetry fanout
- [ ] Stream processing
- [ ] Telemetry enrichment
- [ ] Buffering/retries
- [ ] Structured log transforms

---

## 7. Autonomous Validation Loop

The actual harness loop.

- [ ] Observe
- [ ] Apply fix
- [ ] Restart app
- [ ] Re-run workload
- [ ] Re-run UI journey
- [ ] Compare before/after
- [ ] Iterate until clean

---

## 8. Performance Regression Validation

Examples: "ensure startup under 800ms", "no span exceeds two seconds"

- [ ] Startup timing validation
- [ ] Span duration validation
- [ ] User journey latency validation
- [ ] Benchmarking
- [ ] Performance gates
- [ ] CI performance checks

---

## 9. Long-Running Agent Capabilities

OpenAI: "single Codex runs work on a single task for upwards of six hours"

- [ ] Long-running tasks
- [ ] Autonomous iteration
- [ ] Durable execution
- [ ] Persistent task context
- [ ] Retry loops
- [ ] Failure recovery

---

## 10. Repository Knowledge / Context Engineering

OpenAI: "give Codex a map" instead of giant AGENTS.md files.

- [ ] Structured repository knowledge
- [ ] Task-relevant docs
- [ ] Localized instructions
- [ ] Skills system
- [ ] Architectural maps
- [ ] Repo discoverability
- [ ] Progress tracking

---

## 11. Skills / Operational Procedures

"created skills", "skills for working with DOM snapshots"

- [ ] Reusable operational procedures
- [ ] Debugging skills
- [ ] UI investigation skills
- [ ] Log investigation skills
- [ ] Trace investigation skills
- [ ] Restart procedures
- [ ] Validation procedures

---

## 12. Application Legibility

The deepest idea: the app becomes machine-readable operationally.

- [ ] Runtime state visibility
- [ ] UI visibility
- [ ] Operational visibility
- [ ] Failure visibility
- [ ] Causal traceability
- [ ] User journey observability
- [ ] Deterministic debugging

---

## Condensed Checklist

### Infrastructure
- [ ] isolated worktrees
- [ ] isolated app instances
- [ ] isolated telemetry
- [ ] restartability
- [ ] teardown

### Browser Legibility
- [ ] CDP integration
- [ ] navigation
- [ ] screenshots
- [ ] DOM snapshots
- [ ] console inspection
- [ ] network inspection
- [ ] runtime events

### Observability
- [ ] logs
- [ ] metrics
- [ ] traces
- [ ] telemetry correlation
- [ ] telemetry reasoning

### Query Layer
- [ ] LogsQL
- [ ] PromQL
- [ ] trace queries

### Telemetry Pipeline
- [ ] OTLP
- [ ] OpenTelemetry
- [ ] Vector routing
- [ ] telemetry transforms

### Autonomous Loop
- [ ] apply fixes
- [ ] restart
- [ ] rerun workloads
- [ ] rerun UI journeys
- [ ] compare before/after
- [ ] iterate until clean

### Performance
- [ ] startup benchmarks
- [ ] latency validation
- [ ] span validation
- [ ] CI quality gates

### Long-Running Agents
- [ ] durable execution
- [ ] retry loops
- [ ] recovery

### Repo Intelligence
- [ ] skills
- [ ] architectural maps
- [ ] localized docs
- [ ] structured repo knowledge

### Application Legibility
- [ ] operational visibility
- [ ] deterministic debugging
- [ ] causal reasoning
- [ ] runtime introspection
