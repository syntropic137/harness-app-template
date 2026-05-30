# Decision docs (ADRs)

Every load-bearing pick in this template — which plugin fills each slot, which policy applies to every plugin — has a written rationale here. Forking inherits the full set; use these as **seeds for your own future decisions** alongside the inherited ones (same `docs/decisions/` tree, new files).

The docs group into three buckets: **slot ADRs** (one per slot in the Tool-Belt Harness Standard), **cross-cutting policy** (rules that apply to every slot), and **CHA-specific** (decisions about this canonical template's own evolution).

> **Reading order.** If you're trying to understand a specific plugin: jump to the slot ADR. If you're trying to understand the testing or coverage gates: read cross-cutting policy. If you're trying to understand why `just update` works the way it does: read [`cha-sync-source-of-truth.md`](./cha-sync-source-of-truth.md).

## Slot ADRs (11)

One per slot in the [Tool-Belt Harness Standard](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/standard/v0.2.md) v0.2. Each names the current plugin pick, the research that backs it, the alternatives considered, and when to re-evaluate.

| Slot | Pick | Doc |
|---|---|---|
| `stack-manager`       | Rust binary (bollard + portpicker) | [`stack-manager.md`](./stack-manager.md) |
| `inspector`           | Playwright + ffmpeg                | [`inspector.md`](./inspector.md) |
| `hooks`               | lefthook                           | [`hooks.md`](./hooks.md) |
| `telemetry-sdk`       | OpenTelemetry, per-language        | [`telemetry-sdk.md`](./telemetry-sdk.md) |
| `observability-stack` | VictoriaLogs/Metrics/Traces        | [`observability-stack.md`](./observability-stack.md) |
| `sensors` (opt-in)    | Rust aggregator + adapter set      | [`sensors.md`](./sensors.md) (hybrid summary) |
| `agent-plugins`       | `.claude/` canonical + symlinks    | [`agent-plugins.md`](./agent-plugins.md) |
| `task-runner`         | `just`                             | [`task-runner.md`](./task-runner.md) |
| `secret-scanner`      | Gitleaks                           | [`secret-scanner.md`](./secret-scanner.md) |
| `doc-validator`       | `harness-doc-validator` (Rust)     | [`doc-validator.md`](./doc-validator.md) |
| `versioning`          | cocogitto                          | [`versioning.md`](./versioning.md) |

## Cross-cutting policy (3)

Rules that apply to every slot — every plugin honors them regardless of language or implementation.

| Topic | Doc | Why it matters |
|---|---|---|
| Binary distribution | [`binary-distribution.md`](./binary-distribution.md) (hybrid summary) | How harness binaries (and your own Rust binaries, if you adopt the pattern) reach consumers without requiring a Rust toolchain. |
| Coverage enforcement | [`coverage-enforcement.md`](./coverage-enforcement.md) | The mechanical-enforcement contract for the testing pyramid (vitest thresholds, `cargo llvm-cov --fail-under-*`, `pytest --cov-fail-under`). PROTECTED config sentinels mark unmovable thresholds. |
| Strict typing | [`strict-typing.md`](./strict-typing.md) | TS/Python/Rust strict-mode posture; how `noPropertyAccessFromIndexSignature` + `noUncheckedIndexedAccess` interact with the polyglot-first rule. |

## CHA-specific decisions (1)

Decisions about this canonical template repo's own evolution. Distinct from slot/policy ADRs because they don't generalize to consumer forks — they explain how *this* repo is governed.

| Topic | Doc |
|---|---|
| Standalone framing + path-scoped update | [`cha-sync-source-of-truth.md`](./cha-sync-source-of-truth.md) |

That ADR is the reference for [`docs/updating.md`](../updating.md) and for `scripts/update.ts`. It explains:

- Why the canonical repo is standalone (the lab is R&D, not a live upstream).
- Why `just update` is path-scoped (consumer code is owned by the consumer, by construction).
- What was rejected (whole-repo merge, lab-as-upstream sync) and why.

## Reading by language

If you're language-specific and want only the docs that gate your code:

- **TypeScript / Node:** `hooks.md`, `task-runner.md`, `secret-scanner.md`, `doc-validator.md`, `versioning.md`, `coverage-enforcement.md`, `strict-typing.md`, `inspector.md`, `agent-plugins.md`, `observability-stack.md`, `telemetry-sdk.md` (Node SDK).
- **Rust:** all of the above except `inspector.md` (Playwright is Node-rooted); plus `binary-distribution.md` if you publish Rust binaries.
- **Python:** all except `inspector.md`; `telemetry-sdk.md` (Python SDK).
- **Go:** all except `inspector.md`; `telemetry-sdk.md` (when a Go telemetry plugin lands).

## When to add your own decision doc

Whenever your fork makes a non-trivial, load-bearing pick — a new linter, a new framework, an architectural shape that wasn't in the template — file a new ADR in this directory. The convention:

- File at `docs/decisions/<topic>.md` (kebab-case, descriptive).
- Top section: **Status** / **Date** / **Next review** (date + 6 months is a good default).
- **Current pick** (concrete: tool, version, install path).
- **Justification** (why this over alternatives; cite sources).
- **Alternatives considered** (what got rejected; one sentence on why).
- **When to re-evaluate** (the trip-conditions list).

The [`running-experiments`](../../.claude/skills/running-experiments/SKILL.md) skill is the canonical companion: if the pick is load-bearing on cost / wall-clock / reliability claims, file a hypothesis-first experiment under `experiments/<date>--<slug>/` before the ADR lands. The ADR cites the experiment's verdict.

## Hybrid summaries

Two docs ship as **outcome-only summaries**: [`binary-distribution.md`](./binary-distribution.md) and [`sensors.md`](./sensors.md). The full alternatives comparisons were authored upstream in the R&D lab and are preserved there; this repo ships the part you act on. Each hybrid summary links to its upstream source at the top.

The reason for the split: the comparison sections accumulate vendor evaluations, marketplace landscape notes, and pre-decision research that's historically useful but not load-bearing on the current pick. Carrying that material into every fork makes the docs heavier and slower to read at fork-time. The standalone-source ADRs (one per slot, plus the three cross-cutting policy docs) are self-contained.
