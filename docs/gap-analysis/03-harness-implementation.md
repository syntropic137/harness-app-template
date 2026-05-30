# Gap analysis 03 — Lab `harness/` implementations vs this template

> **Mode:** discovery + planning input for closure beads.
>
> **Inputs:** lab `harness/` (11 subdirs) vs template `harness/` (6 subdirs). Read by an Explore sub-agent; this report is the consolidation.
>
> **Companion docs:** [`01-harness-engineering.md`](./01-harness-engineering.md) (docs side), [`02-decisions-adr.md`](./02-decisions-adr.md) (ADR side), [`04-learnings-examples.md`](./04-learnings-examples.md) (retros/experiments), [`05-apss-conformance.md`](./05-apss-conformance.md) (APSS surface), [`00-consolidated.md`](./00-consolidated.md) (rollup).
>
> **Preservation rule (operator):** never delete; record decisions as ADRs; keep lab reference impls. This report does not propose any deletion — every gap proposes additive work.

## Summary

| Lab subdir | Real / stub / mixed | Template counterpart | State | Direction |
|---|---|---|---|---|
| `.harness/` (governance.toml) | Real | none | — | **Missing — eat-own-dogfood foundation.** |
| `create-harness-app/` | Real (Node ESM) | `scripts/init.ts` | One-shot init | Lab is a reusable scaffolder; template is a bootstrap. |
| `doc-validator/` | Real (Rust crate, 638 LOC) | `harness/doc-validator/` | Bash stub | **Major gap.** |
| `downstream-crawler/` | Indeterminate (only `target/` visible) | none | — | Source elsewhere or pruned; investigate before porting. |
| `hooks/` | Real (Node ESM, 3 hooks + tests) | `harness/hooks/` (template-side) | Partial | Template missing `template-hygiene-gate.mjs`. |
| `inspector/` | Real (Node ESM, 3 tools) | `harness/inspector/` | Real, near-identical | No gap. |
| `inspector-ue/` | Real (UE-specific) | none | — | Out of scope for generic template. |
| `sensors/` | Real (Rust crate, ~5.6k LOC, 5 adapters, plugin discovery, 95/94 % coverage) | `harness/sensors/` | Node ESM partial (2 adapters, report-only, no tests) | **Largest single gap.** |
| `stack/` | Real (Node/TS, 714 LOC, 5 cmds, 15 tests) | `harness/stack/` | Stub (Rust placeholder ~51 LOC) | **Major gap.** |
| `ue-plugin/` | Real (UE C++) | none | — | Out of scope. |
| `versioning/` | Real (Rust crate, 301 LOC, 100/100 coverage) | none | — | Cocogitto is wired globally (cog.toml + ADR-0011) but the per-package orchestrator crate is not ported. |
| _(template-only)_ | — | `observability/` | Config files | Likely a template-side addition; no lab counterpart in `harness/`. |

The single biggest gap is `harness/sensors/` — the lab ships ~5.6k LOC of Rust with 5 adapters, plugin discovery, and policy gating; the template ships ~18 KB of Node ESM with 2 adapters and explicit report-only behavior.

---

## Section A — Lab subdirs

### A1 — `harness/.harness/`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/harness/.harness/governance.toml` (37 lines) |
| **What it is** | Self-instrumentation governance file. The lab's own sensors gate runs against this manifest: `./target/release/harness-sensors gate harness/`. |
| **Public surface** | n/a — consumed by `harness-sensors gate`. |
| **Real / stub** | Real. Active fitness gates for the harness's own code (acyclicity ≥0.95, cyclomatic complexity, god-file detection). |
| **Dogfood** | **Yes.** This file is the harness eating its own dogfood (principle #5 in `docs/harness-engineering/lab-five-principles.md`). |
| **Template equivalent** | **None.** No `.harness/` directory exists in the template. |
| **Recommendation** | Port verbatim to `template/.harness/governance.toml` (or `template/harness/.harness/governance.toml` to match the lab's exact path). Initial values stay the lab's; consumers can ratchet up. **First-step implementing target** because it's the foundation for n48.4's gate. |

### A2 — `harness/create-harness-app/`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/harness/create-harness-app/{bin/cli.mjs, src/{scaffold,maintain}.mjs, scripts/{sync,clean}-templates.mjs}` (2 src + 1 bin + 2 scripts + 3 test files) |
| **What it is** | Node ESM scaffolder — canonical CLI for generating new harness-based projects from a template manifest. |
| **Public surface** | `bin/create-harness-app` with implicit subcommands via `scaffold.mjs` + `maintain.mjs`. |
| **Real / stub** | Real. Production scaffolder that consumes template manifests. |
| **Dogfood** | Yes — lab uses it to generate downstream projects. |
| **Template equivalent** | `scripts/init.ts` — a one-shot bootstrap that runs *inside* this template, not a reusable shipper. |
| **Direction of divergence** | Lab's scaffolder is the *upstream* tool that creates copies of *this template*. ADR-0016 already records the intent to ship a separate `create-harness-app` npx wrapper repo, so this gap is governed by a recorded plan rather than missing entirely. |
| **Recommendation** | Out of scope for this template — the canonical `create-harness-app` belongs in its own npx-deployable repo per ADR-0016. No port action needed *here*. |

### A3 — `harness/doc-validator/`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/harness/doc-validator/` |
| **What it is** | Rust crate. `Cargo.toml`, `src/{lib.rs, main.rs, checker.rs, scanner.rs}`. **638 LOC**. 1 test file. |
| **Public surface** | `[[bin]] harness-doc-validator` — validates internal markdown cross-references inside a crate. |
| **Real / stub** | Real. 100/100 coverage gates enforced in `Cargo.toml`. |
| **Dogfood** | Yes — the lab runs this on its own docs. |
| **Template equivalent** | `harness/doc-validator/bin/doc-validator` — **18-line bash stub**. Prints help + "not implemented". |
| **Recommendation** | Port the Rust crate as-is into `template/harness/doc-validator/`. Keep the bash bin as a thin dispatcher (or replace with the Rust binary). Wire into pre-push lefthook per bead `n48.6`. **High leverage** (covered by bead n48.6 — the existing P1 doc-validator-populate bead). |

### A4 — `harness/downstream-crawler/`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/harness/downstream-crawler/` |
| **What it is** | Only `target/` visible (build artifact). 863 files, mostly build output. No `Cargo.toml`, `package.json`, or source files in the surface listing. |
| **Real / stub** | Indeterminate. Likely a compiled artifact whose source lives elsewhere or was pruned. |
| **Template equivalent** | None. |
| **Recommendation** | Investigate before porting — find the source. If it's the Tier-2 cron-crawler from `docs/harness-engineering/upstream-update-flow.md`, the canonical port lives under bead `n48.8` (upstream-update-flow.md + provenance check). **No new bead** until the source is located. |

### A5 — `harness/hooks/`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/harness/hooks/{check-staged-size.mjs, template-hygiene-gate.mjs, track-perf.mjs}` + 2 test files. |
| **What it is** | Node ESM executables for lefthook integration. Pre-commit gates. |
| **Public surface** | 3 hooks. |
| **Real / stub** | Real. |
| **Dogfood** | Yes — lab runs them on every commit. |
| **Template equivalent** | `template/harness/hooks/{check-staged-size.mjs, track-perf.mjs}` + 1 test file. `template-hygiene-gate.mjs` is **not present** but on review the lab file header says: *"Lab-only by design — consumer projects don't need this. Path-filter: gate only fires when the push touches `templates/` or `harness/create-harness-app/`."* This template has neither path. |
| **Recommendation** | **Don't port unless the template grows a `templates/` sub-tree** for downstream-fork seeding. Filed as a deferred note in `00-consolidated.md`, not a bead. |

### A6 — `harness/inspector/`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/harness/inspector/{keyframe-grid,record-flow,screenshot-pair}.mjs` (no tests, no `package.json`). |
| **What it is** | Node ESM Playwright wrappers for evidence capture. |
| **Real / stub** | Real. |
| **Template equivalent** | `template/harness/inspector/` — same three files + a vitest config + `package.json`. |
| **Recommendation** | No gap. Template is functionally equivalent (with a small *additive* improvement — it has a `package.json`). |

### A7 — `harness/inspector-ue/`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/harness/inspector-ue/{ue-control,ue-live-coding-timer}.mjs` + 3 tests + vitest config. |
| **What it is** | Node ESM Unreal Engine-specific inspectors. |
| **Template equivalent** | None. |
| **Recommendation** | Out of scope for the generic polyglot template. If a UE-specific fork wants them, they port locally. **No bead.** |

### A8 — `harness/sensors/` — **the largest gap**

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/harness/sensors/` |
| **What it is** | Rust crate. `Cargo.toml` + `build.rs` + 15 source files in `src/` (lib.rs, bin/harness_sensors.rs, 5 adapters: `basic_project`, `depcruiser`, `grimp_instability`, `sentrux`, `ts_morph_abstractness`; plus aggregator, cli, command, policy, workspaces, ignore modules). |
| **Size signal** | ~5,686 LOC. 5 test files. 1 example (`governance.toml`). 1 docs file (`plugin-protocol.md` — draft v0.3). |
| **Public surface** | `[[bin]] harness-sensors`. Plugin discovery via `$HARNESS_SENSORS_PATH` for `harness-adapter-*` executables. Subcommands include `gate` (per the lab's plugin-protocol docs). |
| **Real / stub** | Real, production-grade. **Coverage enforced: lines ≥95 %, functions ≥94 %.** |
| **Dogfood** | Yes — gated against `harness/.harness/governance.toml`. |
| **Template equivalent** | `template/harness/sensors/{aggregate.mjs, abstractness.mjs, bin/sensors}`. ~18 KB Node ESM. **2 adapters** (dep-cruiser + ts-morph). **No tests** in the slot itself (vitest cases live under `scripts/tests/sensors-*.test.ts`). **Report-only**, no `gate` subcommand. |
| **Gap dimensions** | (1) Language: lab Rust / template Node. (2) Adapters: 5 lab / 2 template (no `basic_project`, no `grimp_instability`, no `sentrux` adapter shim). (3) Plugin discovery: present in lab / absent in template. (4) Policy gating: present in lab / explicitly deferred in template. (5) Coverage gates on the slot itself: 95/94 % lab / 0 template (the template's 100 % coverage gate runs on `scripts/`, not on `harness/sensors/aggregate.mjs`). (6) Extensibility: arbitrary polyglot plugins in lab / hard-coded tools in template. (7) Size: ~10× the lab's LOC. |
| **Recommendation** | Multi-step closure already filed: `n48.3` (port APSS canonical + keep sentrux available), `n48.4` (gate, baseline mode), `n48.5` (cognitive-complexity adapter), `n48.7` (the both-vs-reduce recorded decision — closed by ADR-0017 in this commit). The lab's Rust crate is the **landing-zone target** for the eventual swap; the Node aggregator stays as a working starter per ADR-0017. **Preservation-first**: keep the Node aggregator until the Rust port lands. |

### A9 — `harness/stack/`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/harness/stack/` (Node/TS crate with `package.json`, tsx + yaml + zod runtime deps). |
| **What it is** | Topology + runtime + commands modules. 5 CLI subcommands: `boot`, `stop`, `destroy`, `inspect`, `doctor`. |
| **Size signal** | ~714 LOC across 14 TypeScript source files. 15 test files. |
| **Public surface** | `bin/harness.ts` as the CLI entry; package `exports` for `.` and bin `harness`. |
| **Real / stub** | Real. Functional Docker Compose orchestrator with port allocation + runtime isolation. |
| **Dogfood** | Yes — lab uses for multi-service dev environments. |
| **Template equivalent** | `template/harness/stack/{Cargo.toml, src/main.rs, src/lib.rs}` + `bin/stack.sh`. **Rust stub crate, ~51 LOC**. `is_stub()` helper for detection. |
| **Direction** | Template is a deliberate Rust placeholder (per `Cargo.toml` comments) awaiting a real Rust rewrite. Not a port of the lab's Node/TS impl — a different language choice for the template's eventual implementation. |
| **Recommendation** | This is the inverse of the sensors situation: lab has the working impl in Node/TS; the template's contract (ADR-0001) names a Rust binary that doesn't exist yet. **Preservation-first**: keep both — the Node/TS lab impl as reference, the Rust stub as the future target. File a new closure bead for "port lab `harness/stack/` Node-TS as the working stack-manager until the Rust binary lands" (proposed P2). |

### A10 — `harness/ue-plugin/`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/harness/ue-plugin/AgenticHarnessHelper/{*.uplugin, Source/*}` (UE C++ plugin). |
| **Template equivalent** | None. |
| **Recommendation** | Out of scope. **No bead.** |

### A11 — `harness/versioning/`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/harness/versioning/{Cargo.toml, src/{lib,main}.rs}`. 301 LOC, no tests in-tree (lab's coverage gate enforces 100/100 in `Cargo.toml`). |
| **What it is** | Rust binary wrapping cocogitto for per-package version detection in polyglot monorepos. |
| **Public surface** | `[[bin]] harness-versioning`. |
| **Real / stub** | Real. |
| **Template equivalent** | None — cocogitto is wired globally (via `cog.toml` + ADR-0011) but the per-package orchestrator is not ported. |
| **Recommendation** | File a closure bead: port the lab's `harness/versioning/` crate as `template/harness/versioning/` so the per-package version-bump signal is available locally. P3 (cocogitto already covers the project-wide case). |

---

## Section B — Template-only

### B1 — `harness/observability/`

| | |
|---|---|
| **Template path** | `template/harness/observability/{README.md, compose.harness.yml, otel-collector.yaml}`. ~2.7 KB README + configs. |
| **What it is** | OTEL Collector + VictoriaLogs / Metrics / Traces compose stack. Per ADR-0005, this is the observability-stack slot's plugin. |
| **Real / stub** | Config-only (no code). Real configuration; the *implementation* is upstream Docker images. |
| **Lab counterpart** | No exact equivalent in `lab/harness/` — the lab's observability is wired through `lab/infra/` (not inspected here). |
| **Direction** | Template-additive: a slot the lab keeps elsewhere is folded into `harness/` here, which is consistent with the consumer-fork shape. **No port action needed.** |

---

## Top-5 leverage ports for the governance-every-run north star

Ranked by impact on the operator's mid-task framing — fitness functions that run continuously, not on-demand.

| Rank | Item | Source | Bead |
|---:|---|---|---|
| 1 | **`.harness/governance.toml`** — the policy file the harness gates itself against. Eat-own-dogfood foundation. | `lab/harness/.harness/governance.toml` (A1) | New (file alongside `n48.4`). |
| 2 | **`harness/sensors/` Rust crate** with 5 adapters + plugin discovery + gate subcommand. The actual signal layer. | `lab/harness/sensors/` (A8) | `n48.3` + `n48.4` + `n48.5` already cover; ADR-0017 records the both-vs-reduce decision. |
| 3 | **`harness/doc-validator/` Rust crate** (638 LOC, 100/100 coverage) — replaces the 18-line bash stub. Per-run markdown + ADR enforcement. | `lab/harness/doc-validator/` (A3) | `n48.6` already covers. |
| 4 | _(reserved — was `template-hygiene-gate.mjs`; on re-read the lab file is path-filtered to `templates/` + `harness/create-harness-app/`, which this template doesn't have. **Not a port.**)_ | — | None. |
| 5 | **`harness/stack/` Node/TS impl** as the working stack-manager until the Rust binary lands. Enables running the other gates in isolated environments. | `lab/harness/stack/` (A9) | File a new bead (proposed P2). |

Also worth filing (lower priority): `harness/versioning/` Rust crate (A11, proposed P3); investigate `harness/downstream-crawler/` source (A4, n48.8 may already cover).

---

## Provenance

- **Inventory pass timestamp:** 2026-05-30.
- **Sub-agent:** one Explore agent walked both `harness/` trees in full.
- **Cross-checks done:** spot-checked Cargo.toml `[[bin]]` declarations, test-file counts, LOC sizes, presence of stubs vs real impls.
- **Preservation rule:** every recommendation above is additive; no lab implementation proposed for deletion. Both sentrux and APSS coexist per ADR-0017.
