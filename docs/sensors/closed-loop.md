---
name: "Architectural-fitness closed loop"
description: "How the APS-V1-0001 producer, the apss_topology.mjs shim, the aggregator's APSS merge, gate.mjs hard-enforcement, and the regenerable apss code-topology viz diagram form a closed-loop hard requirement, and how a coding agent consumes the feedback on every run."
---

# Architectural-fitness closed loop

> **Companion to [ADR-0019](../adrs/ADR-0019-closed-loop-architectural-quality.md)**.
> The ADR records the *decision* that architectural quality is a continuous
> closed-loop hard requirement. This doc explains *how* the loop runs and
> *how a coding agent consumes the feedback*. If you read only one paragraph,
> read [§"The agent contract"](#the-agent-contract).

## The four stages

```
PRODUCE → CONSUME → MERGE → ENFORCE  ──feedback──▶  any coding agent
```

| Stage | Owner | Artifact | What it does |
|---|---|---|---|
| **PRODUCE** | `apss` composed binary (APS-V1-0001 code-topology) | `.topology/metrics/{modules,functions,coupling}.json` | Static-analyses the workspace source on every cycle. Real data, regenerated each run, never committed. |
| **CONSUME** | [`harness/sensors/apss_topology.mjs`](../../harness/sensors/apss_topology.mjs) | `{ tool: 'apss-topology', available: true, readings: [...] }` | The ADR-0017 shim seam. Reads the producer's artifacts; emits per-source readings the aggregator merges. |
| **MERGE** | [`harness/sensors/aggregate.mjs#mergeApssTopology`](../../harness/sensors/aggregate.mjs) | workspace report with `m.apss.*` per module + `apss_*` rollups per folder | Attaches APSS metrics to every workspace module *without* overwriting the legacy Ca/Ce/I/A/D values. Preservation-first. |
| **ENFORCE** | [`harness/sensors/gate.mjs`](../../harness/sensors/gate.mjs) | exit code + structured stdout | Compares the current run's APSS metrics against `harness/sensors/baseline.json`. Exit 0 = PASS. Exit non-zero = FAIL. |

The loop is *closed* in the control-theory sense: the gate's verdict drives the agent's next code edit, which re-enters the loop at PRODUCE on the next commit. No human step. No place for the loop to silently break.

## What runs each cycle

"Every cycle" means each of these surfaces invokes the producer **before** the gate, so the gate always evaluates against real APSS data:

- **`pre-commit` and `pre-push` (hooks slot)** — lefthook runs the producer first, then `just sensors gate`. Producer failure = cycle failure (the commit is rejected). This is the operator's "governance-every-run" framing (recorded in ADR-0017 §Discipline).
- **`just sensors gate` (task-runner slot)** — composes producer + gate so a direct invocation from a human or agent shell gives the same closed loop the commit hooks give.
- **CI architecture-fitness job** — same composition; the verdict propagates to the PR status check.

A side effect of "producer runs every cycle": there is no way to see a stale gate verdict. The producer regenerates the artifacts from the *current* source on every run, so the gate's verdict is always about the post-edit tree.

## What "real APSS data" replaces

Before [ADR-0019](../adrs/ADR-0019-closed-loop-architectural-quality.md) closed the loop, the producer was not wired. The shim returned `{ available: false }`, the aggregate report tagged itself `apssAvailable: false`, and `gate.mjs` fell through to the legacy dep-cruiser / ts-morph / complexity baselines:

```js
// gate.mjs FITNESS_METRICS — every APSS reader has a legacy fallback
value: (report) =>
  maxNumber([
    ...apssFunctionValues(report, 'cognitive'),       // ← APSS first
    ...moduleValues(report, (m) => m.max_cognitive),  // ← legacy fallback
    ...folderValues(report, (f) => f.max_cognitive),  // ← legacy fallback
  ]),
```

With the producer wired, the APSS branch returns real values and the gate enforces against the canonical APS-V1-0001 measurement layer. The legacy branches stay as the safety net for when APSS is temporarily unavailable (offline developer, fresh clone before `apss install`, producer binary build failure).

You can verify which path the gate took by looking at the gate's stdout: a closed loop on a healthy clone shows non-zero `evaluated` counts per APSS dimension. A degraded path (legacy fallback) shows `no adapter wired` next to APSS-specific dimensions.

## The agent contract

The gate is designed for mechanical agent consumption. Five contract points:

1. **Exit code.** `0` = PASS. Non-zero = FAIL. An agent that wraps `just sensors gate` in `if ! just sensors gate; then ...; fi` (or checks `$?`) gets the verdict for free. There is no ambiguous "warning" exit code — warnings (advisory regressions) coexist with exit 0; only hard regressions on enforced dimensions exit non-zero.

2. **Verdict line.** Line 1 of stdout is **exactly** one of:
   ```text
   VERDICT: PASS sensors gate
   VERDICT: FAIL sensors gate
   ```
   Grep-friendly. Intentionally first so it survives noisy adapter output (`gate.mjs#renderReport`). An agent that only reads the first line still gets the answer.

3. **Per-folder regression diff.** Each regression appears as:
   ```text
   ws_apps/example-ts  I: 0.420 -> 0.580  (+0.160)
   ```
   The agent reads `<folder>  <metric>: <baseline> -> <current>  (+<delta>)` and knows exactly which workspace folder regressed on which metric by how much. Mechanically actionable: open the folder, fix the offending coupling/complexity, re-run.

4. **Per-dimension APSS fitness summary.** Each of the 8 APSS dimensions is listed with its tag and counts:
   ```text
   [ENFORCED] MT01 Maintainability: evaluated 3, failed 1, warned 0
   [ENFORCED] MD01 Modularity and Coupling: evaluated 4, failed 0, warned 0
   [ENFORCED] ST01 Structural Integrity: evaluated 1, failed 0, warned 0
   [ENFORCED] SC01 Security: no adapter wired
   ...
   [advisory] AC01 Accessibility: no adapter wired
   [advisory] AV01 Availability: no adapter wired
   ```
   The agent learns which of MT01/MD01/ST01/SC01/LG01/PF01 (enforced) and AC01/AV01 (advisory) gated, and how many rules ran. `no adapter wired` is informational — it means that dimension is declared but has no producer wired in this template; consumer forks add their own.

5. **Remediation hint.** When the gate fails, the stdout includes the literal remediation instruction:
   ```text
   If the regression is intentional (refactor, slot redesign), update the
   baseline deliberately: `just sensors gate --update-baseline` and commit
   the resulting harness/sensors/baseline.json as part of the same change.
   ```
   The agent reads it, decides whether the regression is intentional (rare) or a genuine quality slip (common), and either updates the baseline deliberately or fixes the code. No human disambiguation needed.

That's the entire contract. Five mechanical signals; no out-of-band channels; no `ask the human`.

## How a coding agent uses the feedback

A typical loop iteration, from the agent's perspective:

```
1. The agent makes a code edit (refactor, new feature, bug fix).

2. The agent runs `just sensors gate` (directly, or implicitly via the
   pre-commit hook on `git commit`).

3. Read the exit code.
     - 0  → done. Commit if not already committed.
     - ≠0 → keep going.

4. Read line 1 to confirm `VERDICT: FAIL sensors gate`.

5. Parse the "regressions:" block. Each line names a folder, a metric,
   the baseline floor, the current value, and the delta.

6. For each regression line:
     a. Open the named folder.
     b. The metric name names the architectural property that worsened
        (efferent_coupling = a module now imports more outward deps;
         instability = a module's I value rose toward the unstable side;
         distance_from_main_sequence = a module drifted off Martin's
         main sequence; max_cognitive / max_cyclomatic = a function got
         harder to read).
     c. Use the per-dimension summary to know which APSS dimension
        flagged it (MT01 maintainability, MD01 modularity-and-coupling,
        ST01 structural integrity, …).
     d. Fix the code.

7. Re-run `just sensors gate`. If still failing, repeat.

8. If the regression is intentional (a deliberate refactor that legitimately
   moves the floor), run `just sensors gate --update-baseline`, review the
   `harness/sensors/baseline.json` diff, and commit the new floor in the
   same commit as the refactor — per docs/sensors/coverage-and-gate.md.
```

The agent never needs to ask "what is the architecture-quality bar?" The bar is the committed `baseline.json`. The diff between current and baseline *is* the agent's instruction set for the next edit.

## Regenerating the architectural diagram

The same producer artifacts that feed the gate also feed `apss code-topology viz`:

```sh
# Generate the architectural diagram on demand (output format determined
# by the packaged APS-V1-0001 viz subcommand — Graphviz DOT, Mermaid, etc.).
apss run APS-V1-0001 viz
```

Because the diagram is generated from the same `.topology/metrics/*.json` files the gate consumed, **there is no drift between "what the diagram shows" and "what the gate measured."** The diagram is regenerable, never committed (it would drift across branches and rebases), and always reflects the current source tree.

A coding agent that wants to *see* the architecture as a picture (rather than read the numerical gate verdict) runs the viz recipe and inspects the output. The diagram is a visualization of the same data the gate enforces against — useful for human review and for agent-driven architectural refactors where the picture makes the structure obvious.

## Failure modes and how the gate surfaces them

| Failure | How the loop signals it | Remediation |
|---|---|---|
| Producer binary missing (no `apss install` yet) | Gate's stdout shows `apssAvailable: false`; APSS-specific dimensions show `no adapter wired`. Gate still runs on legacy adapters. | `just bootstrap` (which runs `apss install`). |
| Producer binary present but fails to emit artifacts | Same as above (shim sees no `.topology/` directory). The producer step exits non-zero on the cycle surface (lefthook), so the cycle fails before the gate runs. | Read the producer's stderr; fix the source-tree issue or the `APSS.yaml` configuration. |
| Producer emits but artifacts are malformed | Shim returns `{ available: false, error: '...' }`; gate falls back to legacy adapters. The shim's error string surfaces in the aggregate report. | Inspect the error string; usually a version skew between `apss.lock` and the installed `apss` binary. Re-run `apss install`. |
| New workspace folder, no baseline floor | Gate's stdout shows `new (no baseline floor yet): <folder>`. Gate exits 0 (no regression possible against a missing floor). | If the new folder is intentional, run `just sensors gate --update-baseline` and commit the floor with the folder. |
| Genuine regression on enforced dimension | `VERDICT: FAIL sensors gate`, regression diff lines, exit non-zero. | Fix the code; the diff tells you which folder + metric. |
| Genuine regression on advisory dimension (AC01, AV01) | Reported in `advisory_regressions` count; gate exits 0. Advisory dimensions never block; they surface for visibility. | Address at the agent's discretion; advisory-by-design until a consumer fork wires a real adapter (rendered frontend, running service). |

## Cross-references

- [ADR-0017 — Sensors v0.3 — APSS canonical, sentrux preserved](../adrs/ADR-0017-sensors-v03-apss-canonical.md) — named the shim seam.
- [ADR-0018 — APSS v1.1.0 integration — augment, never replace](../adrs/ADR-0018-apss-v1-1-0-augmentation.md) — settled that the gate routes via the shim, not by direct `apss run APS-V1-0002`.
- [ADR-0019 — Closed-loop architectural quality](../adrs/ADR-0019-closed-loop-architectural-quality.md) — the decision this doc explains.
- [`docs/sensors/coverage-and-gate.md`](./coverage-and-gate.md) — the operator-facing baseline-update flow.
- [`docs/standards-integration/fitness-function-APS-V1-0002.md`](../standards-integration/fitness-function-APS-V1-0002.md) — the integration analysis and the open R1 to R5 disclosure roadmap.
- [`harness/sensors/apss_topology.mjs`](../../harness/sensors/apss_topology.mjs) — the shim implementation.
- [`harness/sensors/aggregate.mjs`](../../harness/sensors/aggregate.mjs) — the aggregator + `mergeApssTopology`.
- [`harness/sensors/gate.mjs`](../../harness/sensors/gate.mjs) — the gate, `DIMENSION_ORDER`, `FITNESS_METRICS`, and `renderReport`.
- [`harness/sensors/baseline.json`](../../harness/sensors/baseline.json) — the committed floor.
