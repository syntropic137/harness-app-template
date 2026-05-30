# Executive summary — what's been measured in this template

> **What this doc is:** the single-page rollup of every experiment, fitness gate, and verifiable claim shipped in this template. Read it if you only have five minutes. For depth, follow the per-experiment + per-bead links.
>
> **What we're building:** a forkable polyglot harness for AI coding agents — slots + plugin picks measured, not assumed. Every load-bearing decision has a hypothesis-first experiment behind it (`experiments/<date>--<slug>/`) and an ADR alongside (`docs/adrs/ADR-NNNN-*.md`).
>
> **Currency:** updated after every measurement-producing commit. **Last updated 2026-05-30** covering: bead arc `create-harness-app-n48` (gap-analysis → APSS canonical + sentrux preserved → sensors gate → cognitive complexity → APSS topology adapter → startup-time gate → ADR template).
>
> **Pattern note:** seeded per bead `create-harness-app-n48.15` (gap report G10). The lab's longer-form rollup lives at [`agentic-harness-lab/docs/executive-summary.md`](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/executive-summary.md); this file is the template-side equivalent.

## The top wins so far

1. **Sensors slot enforces architectural budgets on every push** (n48.4). The aggregator (`harness/sensors/`) reads dep-cruiser + ts-morph adapter output and `harness/sensors/baseline.json` is the committed floor. Per-folder `I` or `D` regressions fail the pre-push hook with a diff + remediation hint. First-run snapshot mode means a fresh fork bootstraps painlessly; thresholds promote as the codebase grows.

2. **Four adapters feed the same aggregator without conflict** (n48.3 + n48.5 + ADR-0017). Dep-cruiser (Ca/Ce/I), ts-morph abstractness (A), ts-morph complexity (cyclomatic + cognitive), and APSS topology coexist as available adapters. ADR-0017 is the **recorded** both-vs-reduce decision: APSS is canonical for future gates, but sentrux + the per-language adapters stay in the catalog rather than being silently retired.

3. **Startup-time fitness gate landed alongside the architecture gate** (n48.13). `harness/perf/bench.sh | harness/perf/gate.mjs` mirrors the sensors-gate baseline-snapshot pattern but compares hyperfine `mean` wall-clock with a 25% default tolerance. Soft-skips cleanly when hyperfine isn't installed; pre-push exercises it in 0.12 s on a no-op skip path.

4. **The harness eats its own dogfood** (n48 root + ADR-0017). `harness/.harness/governance.toml` is the policy the lab's own sensors gate enforces; ported verbatim into this fork as the eat-own-dogfood seed. Six pre-push gates now run on every push: typecheck-affected, test-affected, scripts-coverage (100% lines/branches/functions/statements), perf-gate, doc-validator (n48.6 — populated Rust crate), and ubs-diff.

5. **The discipline doc + reference catalog landed in canonical shape** (n48 + the operator's preservation rule). `docs/harness-engineering/README.md` is a verbatim port of the neural-hermes-data canonical (11-row references table, cross-checked against `/tmp/he-canonical.md`). The lab's five-principle framing is preserved at `docs/harness-engineering/lab-five-principles.md` as a supplementary doc. Memory file `preserve-references-on-port.md` codifies the rule that prevented the original drop.

## Experiments completed

| Date | Experiment | Hypothesis | Verdict | Artifacts |
|---|---|---|---|---|
| 2026-05-30 | `arch-analysis--martin-metrics-depcruiser` | dep-cruiser v17.4.0 emits Ca/Ce/I per module/folder for `ws_apps/example-typescript`, and the JSON is parseable into a short metrics report. | **TBD** (hypothesis + setup committed; runs/ folder has the raw output; verdict scorecard not yet completed in the per-experiment dir — superseded in practice by the follow-up below). | [`experiments/2026-05-30--arch-analysis--martin-metrics-depcruiser/`](../experiments/2026-05-30--arch-analysis--martin-metrics-depcruiser/) |
| 2026-05-30 | `depcruiser-arch-quality` | dep-cruiser v17.4.0 produces meaningful per-folder + per-module Martin metrics on the scaffold with no extra config, and the numbers justify populating the sensors slot. | **GO** (3 readings on `ws_apps/example-typescript/src`, balanced Ca=3 / Ce=3 / I=0.5; readings extrapolate into the sensors adapter chain). | [`experiments/2026-05-30--depcruiser-arch-quality/`](../experiments/2026-05-30--depcruiser-arch-quality/) |

## Fitness gates active on every push

| Gate | Dimension | Floor | Bead |
|---|---|---|---|
| `scripts-coverage` (vitest --coverage) | line/branch/function/statement coverage of `scripts/**/*.ts` | **100% / 100% / 100% / 100%** | inherited |
| `sensors-gate` (`harness/sensors/gate.mjs`) | per-folder Martin Instability + Distance from Main Sequence | baseline at `harness/sensors/baseline.json` (9 folders snapshot 2026-05-30); regression fails the hook | [`n48.4`](../.beads/issues.jsonl) (P0) |
| `perf-gate` (`harness/perf/bench.sh \| harness/perf/gate.mjs`) | hyperfine cold-start `mean` of `ws_apps/example-typescript` | baseline lands at `harness/perf/baseline.json` on first real hyperfine run; default tolerance 25%; soft-skips when hyperfine absent | [`n48.13`](../.beads/issues.jsonl) (P2) |
| `doc-validator` (`harness/doc-validator/bin/doc-validator`) | internal markdown link integrity + APSS ADR01 shape + manifest cross-references | hard fail on any broken intra-repo link or ADR-shape violation | [`n48.6`](../.beads/issues.jsonl) (P1) |
| `ubs-staged` / `ubs-diff` (UBS Ultimate Bug Scanner) | critical bug patterns on staged files / diff vs base | hard fail on critical | inherited |
| `secret-scan` (Gitleaks v8.x) | secret patterns on staged files | hard fail on any | inherited |
| `biome-format-lint` (Biome 2.x) | JS/TS format + lint on staged files | hard fail | inherited |
| `test-affected` / `typecheck-affected` (turbo) | affected-package tests + typecheck | hard fail | inherited |

## Where token weight actually lives (template variant of the lab's table)

The lab's EXP-1 + EXP-5 findings on real workloads were: observability queries dominate (~80%), then evidence artifacts (~10–15%), then skill / MCP loading (~5%), then shell output (~5%). This template inherits the same proportions until a re-measurement says otherwise — `docs/harness-engineering/lab-five-principles.md` principle #2 (token-aware) cites them.

## ADRs that codify these measurements

| ADR | Slot / topic | Status | Notes |
|---|---|---|---|
| [ADR-0006](./adrs/ADR-0006-sensors.md) | Sensors v0.2 | accepted; partially superseded | per-language adapter catalog (dep-cruiser, ts-morph, grimp, cargo-modules, go-arch-lint, sentrux) — all preserved as available |
| [ADR-0017](./adrs/ADR-0017-sensors-v03-apss-canonical.md) | Sensors v0.3 — APSS canonical | accepted | promotes APSS to canonical; **preserves** sentrux + the per-language adapters as available (not retired) |
| [ADR-0010](./adrs/ADR-0010-doc-validator.md) | Doc-validator | accepted | Rust crate populated under bead `n48.6`; wired pre-push |
| [ADR-0013](./adrs/ADR-0013-coverage-enforcement.md) | Coverage enforcement | accepted | 100/100/100/100 floor on `scripts/**/*.ts` |
| _(see [`docs/adrs/README.md`](./adrs/README.md) for the full index)_ | | | |

## Where things go from here

Beads still open under `create-harness-app-n48`:

- **n48.8** (P1) — port `upstream-update-flow.md` adapted for canonical→consumer flow + add a `just doctor` provenance check.
- **n48.9** (P1) — install / reference the upstream `harness-engineering` Claude plugin (13 principle skills).
- **n48.10** (P2) — audit in-tree skills against upstream principle skills (keep / merge-by-reference / retire).
- **n48.11** (P2) — port `docs/standard/v0.2.md` + `polyglot-monorepo-structure.md` (the 18-citation WebSearch-anchored layout doc).
- **n48.14** (P2) — `just review` orchestrator (blocked on n48.9).
- **n48.16** (P3) — seed `docs/retrospectives/`.
- **n48.17** (P3) — start `docs/evolution/v0.4.x-evolution.md`.
- **n48.18** (P3) — BoringBot extractive summary for the references catalog.

Beads landed in the `n48` arc (closed): `n48.3` (APSS topology adapter), `n48.4` (sensors gate), `n48.5` (cognitive-complexity adapter), `n48.6` (doc-validator populate), `n48.7` (sentrux+APSS recorded decision → ADR-0017), `n48.12` (ADR template), `n48.13` (startup-time gate), `n48.15` (this doc), `n48.19` (lab stack port), `n48.20` (lab versioning port).

## How this file stays current

Per the operator's framing (`create-harness-app-n48.15` acceptance criteria): the doc-validator should eventually treat this file as a *required artifact* — a fresh fork without an executive-summary should fail validation. The validator rule for that lands when the gap-analysis seed becomes a known-required surface (separate small bead, not filed in this commit — file when the rule is added).

Until then: update this file whenever a measurement-producing commit lands. The pattern is: name the experiment / fitness gate / ADR, link to the artifact, state the verdict in one sentence, move on. Avoid prose; the per-experiment dirs carry the depth.
