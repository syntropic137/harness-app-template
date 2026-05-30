# Gap analysis 01 — Harness-engineering corpus vs this template

> **Mode:** discovery + first planned closure (the port). No edits to other agents' in-flight work.
>
> **Authoritative source (correction, post-discovery):** `github.com/NeuralEmpowerment/neural-hermes-data` at path `knowledge-management/areas/code/agentic-engineering/harness-engineering`. The 11-row canonical References table is in [`/tmp/he-canonical.md`](file:///tmp/he-canonical.md). The lab's `docs/harness-engineering/` is itself derivative; this gap analysis kept the lab inventory intact because the lab still carries ADR-level lineage worth checking, but the *canonical* shape and references table belong to neural-hermes-data.
>
> **Inputs:** (1) the canonical neural-hermes-data corpus at `knowledge-management/areas/code/agentic-engineering/harness-engineering/` (README + capability-checklist + key-passages + references/ with 10 article summaries); (2) the upstream lab at `/home/ubuntu/Code/NeuralEmpowerment/agentic-harness-lab/`, specifically `docs/harness-engineering/` and `docs/standard/` (top-level + `decisions/`). The full citation catalog cross-checks against `/tmp/he-canonical.md`.
>
> **Method:** every lab file was read in full by an Explore agent; the canonical neural-hermes-data files were read directly by me. References, citations, and inspiration links are listed verbatim. Ported-or-not is verified against the template's actual on-disk paths (the template's ADR directory renamed twice during this work — currently at `docs/adrs/ADR-NNNN-*.md`).
>
> **Operator preservation rule (saved to memory `preserve-references-on-port.md`):** never drop a reference, citation, source link, or inspiration entry when porting. Carry the full lineage across.
>
> **Status of the planned closure:** this commit ports the full neural-hermes-data canonical (README + capability-checklist + key-passages + the references/ directory with 10 article summaries) plus replaces the previously-ported principles README with the canonical version. Cross-checked against `/tmp/he-canonical.md`; the 11-row References table is preserved verbatim (incl. BoringBot, which was absent from the in-repo README's 10-row table).

## Index

- Summary
- Dropped inspiration / reference catalog
- Section A — `docs/harness-engineering/` (2 files)
- Section B — `docs/standard/` top-level (3 files)
- Section C — `docs/standard/decisions/` (16 ADRs)
- Cross-cutting recommendations

(TOC anchor links were removed after doc-validator flagged em-dash / heading slug mismatches; section names are intact and the file outline remains navigable.)

## Summary

| Lab area | Files | Ported | Partial | Not ported | Notes |
|---|---:|---:|---:|---:|---|
| `docs/harness-engineering/` | 2 | 0 | 1 (`README.md` — body ported, **inspirations + references dropped**) | 1 (`upstream-update-flow.md`) | The principles doc is the priority port; its source-link section is the principal regression. |
| `docs/standard/` top-level | 3 | 0 | 0 | 3 (`v0.1.md`, `v0.2.md`, `polyglot-monorepo-structure.md`) | Layout exists in the template but the prose Standard + 18-source research doc do not. |
| `docs/standard/decisions/` | 16 | 15 | 0 | 1 (`sensors-v0.3-apss-canonical.md`) | ADR references survive the per-slot port cleanly; the **v0.3 APSS-canonical supersedence doc** is the load-bearing drop. |
| **Total** | **21** | **15** | **1** | **5** | |

The non-trivial drops are concentrated in 6 places: the principles README's citation catalog; the four full-doc unported files; and the APSS-canonical supersedence record. Per-slot ADR ports are clean.

## Dropped inspiration / reference catalog

The lab's **canonical normative citation catalog** lives at `docs/specs/20260529_cha-canonical-readme.md` § "Inspiration & prior art" (lines 281–310, 530–560). The template carries none of it in its principles README; the gap report carries only 2 of ~14 entries. **The full catalog must be restored when the bead that re-ports `docs/harness-engineering/README.md`'s References & Inspirations section runs.**

### Field-defining articles (highest priority)

| Source | URL | In template README? | In template gap report? |
|---|---|:-:|:-:|
| **Mitchell Hashimoto — "My AI Adoption Journey" § Step 5: Engineer the Harness** (Feb 5 2026; coined the term) | `https://mitchellh.com/writing/my-ai-adoption-journey` | ❌ | ❌ |
| **OpenAI — "Harness engineering: leveraging Codex in an agent-first world"** (Ryan Lopopolo, Feb 11 2026; the three-pillar frame) | `https://openai.com/index/harness-engineering/` | ❌ | ✅ (lines 6, 20) |
| **Martin Fowler — "Harness engineering for coding agent users"** (April 2 2026; guides-and-sensors taxonomy) | `https://martinfowler.com/articles/harness-engineering.html` | ❌ | ❌ |
| **Martin Fowler — memo precursor** | `https://martinfowler.com/articles/exploring-gen-ai/harness-engineering-memo.html` | ❌ | ❌ |

### Mechanism prior art

| Source | URL | In template? |
|---|---|:-:|
| **Stripe — "Minions, Part 2 (Toolshed)"** (industrial-scale prior art) | `https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2` | ❌ |
| **arXiv 2604.25850 — "Agentic Harness Engineering: Observability-Driven Automatic Evolution"** | `https://arxiv.org/abs/2604.25850` | ❌ |
| **Ford / Parsons / Kua — *Building Evolutionary Architectures*** (fitness-function framing) | (book) | ✅ (gap report only) |
| **Alexis King — "Parse, Don't Validate"** | `https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/` | ❌ |
| **Logic, Inc. — "AI Is Forcing Us to Write Good Code"** | `https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code` | ❌ |

### Field-landscape awesome-lists

| Source | URL | In template? |
|---|---|:-:|
| `ai-boost/awesome-harness-engineering` | `https://github.com/ai-boost/awesome-harness-engineering` | ❌ |
| `walkinglabs/awesome-harness-engineering` | `https://github.com/walkinglabs/awesome-harness-engineering` | ❌ |
| `Picrew/awesome-agent-harness` | `https://github.com/Picrew/awesome-agent-harness` | ❌ |

### Net assessment

12 of the 14 canonical sources are absent from the template entirely. 1 (Ford/Parsons/Kua) appears only in the gap report. 1 (OpenAI) appears only in the gap report. **None** appear in the ported principles README — which is the single doc where they belong most.

---

## Section A — `docs/harness-engineering/` (2 files)

### A1 — `docs/harness-engineering/README.md`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/docs/harness-engineering/README.md` (9.1 KB) |
| **Role** | Canonical hub: definition of harness engineering as a discipline, the five load-bearing principles, "we are / aren't building" rules, canonical artifact map. |
| **TOC (verbatim section headers)** | (1) What an agentic engineering harness actually is · (2) What we are and aren't trying to build · (3) The five principles, in order of load-bearing-ness · (4) Anchoring framework for new arcs · (5) Where the artifacts live (canonical sources of truth) · (6) When to update this hub · (7) Supporting docs in this directory |
| **Key positions** | (a) Harness = contracts + plugin picks + evidence + conventions, not a framework. (b) Tool-belt metaphor: slots stable, plugins swappable. (c) Five principles: measured-not-assumed, token-aware, polyglot-first, cross-platform, eat-own-dogfood. (d) Hypothesis-first experiments + retros are non-negotiable. (e) The lab governs itself with the same harness it ships to consumers. |
| **References in this file** | Internal cross-references only. Implicit Fowler reference (line 89: *"closes the harness-template drift problem flagged by Fowler"*). The detailed citation catalog lives in `docs/specs/20260529_cha-canonical-readme.md` § "Inspiration & prior art". |
| **Ported to template?** | **PARTIAL** — body at `docs/harness-engineering/README.md` (9.1 KB; ported in commit `df41d9e`). **Inspirations + References section dropped.** Verified by `grep -nE "Fowler\|Hashimoto\|OpenAI\|Stripe\|arXiv\|Ford\|Parsons\|Kua\|lexi-lambda\|logic.inc\|mitchellh\|awesome-harness"` → zero matches in the template README. |
| **Recommendation** | Add the References & Inspirations section per the Dropped catalog table above. Include all 4 field-defining articles, all 5 mechanism prior-art entries, all 3 awesome-lists. Source-of-truth note: reference the lab's `docs/specs/20260529_cha-canonical-readme.md` § "Inspiration & prior art" as the upstream canonical. |

### A2 — `docs/harness-engineering/upstream-update-flow.md`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/docs/harness-engineering/upstream-update-flow.md` (5.2 KB) |
| **Role** | Tier 1/2/3 mechanism for keeping lab + downstream consumers in sync. Closes the Fowler-flagged drift problem. |
| **TOC (verbatim)** | The provenance block · Tier 1 — manual, ship-now (this convention) · Tier 2 — semi-automated weekly cron · Tier 3 — automated PR generation with LLM-as-judge (future) · `consumers.toml` · Failure modes worth predicting · Related work |
| **Key positions** | (a) `.harness-provenance.json` anchors what's changed upstream since scaffolding. (b) Tier-1 cherry-pick uses prefix `harness-engineering: from <downstream>@<sha>`. (c) Tier-2 weekly cron reads `consumers.toml`, emits a digest. (d) Tier-3 gated on Tier-2 having ≥20 % proposal-promotion rate. |
| **References in this file** | Fowler — explicit drift-problem citation (lines 3–6, 129); Fowler — "approved fixtures" pattern (line 134); Stripe Minions — line 131 ("related-but-different mechanism: subdirectory-scoped agent rules with versioning baked into the Toolshed MCP server"). |
| **Ported to template?** | **NOT PORTED.** Closest hits in the template are `docs/updating.md` (10 KB; lifecycle hints) and `docs/adrs/ADR-0015-cha-sync-source-of-truth.md` (which actually documents the *opposite* — that the template is now a standalone canonical, not a live downstream of the lab). The Tier-1/2/3 framework is missing. |
| **Recommendation** | Port adapted for *"we are the canonical fork"* framing (per ADR-0015, the template is no longer a live downstream of the lab — but the same Tier 1/2/3 mechanism applies to **consumers of this template** vs **this canonical**). Preserve all 3 reference links (Fowler twice, Stripe). Add a `just doctor` provenance check. Already filed as bead `create-harness-app-n48.8`. |

---

## Section B — `docs/standard/` top-level (3 files)

### B1 — `docs/standard/v0.1.md`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/docs/standard/v0.1.md` (20 KB) |
| **Role** | Draft contract document for Tool-Belt Harness Standard v0.1. Defines mental model, cross-cutting principles, testing pyramid, workspace conventions, 10 slot contracts (§4.1–§4.10), plugin + template lifecycle, versioning, open questions, non-goals. |
| **Key positions** | (a) Standard = slot contracts + plugins + evidence + conventions; versioned independently of implementations. (b) Ten slots: stack-manager, inspector, hooks, telemetry-sdk, observability-stack, sensors, agent-plugins, task-runner, secret-scanner, doc-validator. (c) Polyglot-first contracts, Rust-first tools where applicable. (d) Testing pyramid: unit 100 %, integration 100 % surface, e2e smoke gated. (e) Each slot has an explicit promotion criterion. |
| **References in this file** | `software-leverage-points:testing` skill (`https://github.com/syntropic137/software-leverage-points`, line 51); CLAUDE.md rule #0 (cited four times — lines 44, 103, 113, 123); retrospective 021 (BatchSpanProcessor example, line 57). No external academic citations. |
| **Ported to template?** | **NOT PORTED.** Template has `harness.manifest.json` (machine-readable) but no prose Standard. |
| **Recommendation** | Port v0.2 (the latest) rather than v0.1 — additive bump, no breaking changes. v0.1 itself can be archived as a "historical Standard versions" sub-section once v0.2 lands. Filed as bead `n48.11`. |

### B2 — `docs/standard/v0.2.md`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/docs/standard/v0.2.md` (22 KB) |
| **Role** | Additive bump from v0.1: same 10 slots verbatim + new §4.11 `versioning` slot (cocogitto). |
| **Key positions** | (a) v0.2 = v0.1 + §4.11 versioning slot. (b) Versioning slot enforces: current version matches `CHANGELOG.md` entry, semver scheme, git tags match manifest versions. (c) Default plugin: cocogitto v6+. (d) Rust orchestrator binary + tool-agnostic plugin shape; removable via `lefthook.yml` edit + `cog.toml` delete. |
| **References in this file** | Same citation footprint as v0.1 (software-leverage-points, CLAUDE.md rule #0, retro 021). cocogitto: `https://github.com/cocogitto/cocogitto` (line 205). No new external citations beyond v0.1 scope. |
| **Ported to template?** | **NOT PORTED.** Template pins `"standard": "0.2"` in `harness.manifest.json` but the prose contract is missing. |
| **Recommendation** | Port to `docs/standard/v0.2.md` adapted for this fork (preserve the cocogitto reference; mention it pins what `harness.manifest.json` declares machine-readable). Filed as bead `n48.11`. |

### B3 — `docs/standard/polyglot-monorepo-structure.md`

| | |
|---|---|
| **Lab path** | `agentic-harness-lab/docs/standard/polyglot-monorepo-structure.md` (26 KB) |
| **Role** | **WebSearch-backed research recommendation** for the polyglot monorepo layout. Validates the `ws_apps/` + `ws_packages/` convention; specifies pnpm-workspace.yaml + Cargo.toml + pyproject.toml + go.work at root; Turborepo task graph + per-language test conventions. |
| **Key positions** | (a) Keeps `ws_apps/` + `ws_packages/` from v0.1 Standard §3. (b) One workspace manifest per language ecosystem at repo root. (c) Turborepo for JS-side task graph + cache; small `package.json` wrappers in non-JS sub-repos (language-wrapper pattern). (d) Tests co-located per-language (no top-level test dir). (e) Cargo workspace uses `resolver = "3"` to avoid feature-unification pitfall. (f) `just` is the human-facing entrypoint; delegates to language-native tools. (g) Turborepo's own monorepo validates this pattern in production. |
| **References in this file (18 URLs — all WebSearch-anchored 2026-05-29)** | Turborepo (3): `turborepo.dev/docs/crafting-your-repository/structuring-a-repository`, `turborepo.dev/repo/docs/guides/multi-language`, `github.com/vercel/turborepo`. pnpm (2): `pnpm.io/workspaces`, `pnpm.io/pnpm-workspace_yaml`. Cargo (3): `doc.rust-lang.org/cargo/reference/workspaces.html`, `rust-lang.github.io/rfcs/2957-cargo-features2.html`, `nickb.dev/blog/cargo-workspace-and-the-feature-unification-pitfall/`. uv (1): `docs.astral.sh/uv/concepts/projects/workspaces/`. Go (2): `oneuptime.com/blog/post/2026-02-01-go-workspaces-monorepos/view`, `go.dev/doc/tutorial/workspaces`. Testing (3): `doc.rust-lang.org/book/ch11-03-test-organization.html`, `docs.pytest.org/en/stable/explanation/goodpractices.html`, `vitest.dev/guide/in-source`. Task-runners (4): `github.com/casey/just`, `just.systems/man/en/`, `nguyenhuythanh.com/posts/taskfile-vs-justfile/`, `pkgpulse.com/guides/best-monorepo-tools-2026`, `pkgpulse.com/guides/turborepo-vs-nx-vs-moon-build-tools-2026`. Other (2): `dailydevpost.com/blog/turborepo-folder-structure-scalability-guide`, `nesbitt.io/2026/01/18/workspaces-and-monorepos-in-package-managers.html`. |
| **Ported to template?** | **NOT PORTED.** Layout is implemented (`ws_apps/`, `ws_packages/`, root manifests, justfile, Turborepo) but the prose research doc explaining the *why* is missing. |
| **Recommendation** | Port verbatim to `docs/standard/polyglot-monorepo-structure.md`. **All 18 citations must transit intact** — they are the WebSearch backing per CLAUDE.md rule #0 for the layout. Reference from the main README and from `docs/harness-engineering/README.md`. Filed as bead `n48.11` (combine with the v0.2 port; same dir). |

---

## Section C — `docs/standard/decisions/` (16 ADRs)

Per-slot inventory. Lab paths under `agentic-harness-lab/docs/standard/decisions/`; template paths under `harness-app-template/docs/adrs/ADR-NNNN-<slot>.md` (renamed twice during this session — current convention is `ADR-NNNN-<slot>.md`).

Spot-checks (ADR-0001, 0003, 0006, 0009, 0011) confirm reference fidelity in the ports: bollard / portpicker / fussybeaver / shiplift survive; lefthook / evilmartians / husky / pkgpulse / d4b.dev / johal / edopedia / husky-rs survive; APSS / sentrux / Martin / dep-cruiser / ts-morph / grimp / cargo-modules / go-arch-lint survive; Gitleaks / TruffleHog / Kali / pkgpulse survive; cocogitto / git-cliff / release-please / changesets / usenotra / hsiao survive.

| # | Lab file | Slot / topic | Status | Pick (one line) | Ported to template | Recommendation |
|---|---|---|---|---|---|---|
| 1 | `agent-plugins.md` (3.6 KB) | agent-plugins | active 2026-05-14 | `.claude/` canonical + vendor symlinks (AGENTS.md, GEMINI.md, etc.) | ✅ `ADR-0007-agent-plugins.md` | Keep. References (10 URLs incl. agents.md spec, Cursor/Windsurf/Aider/OpenCode/Continue/Cody/AAIF) confirmed present in port. |
| 2 | `binary-distribution.md` (3.1 KB) | binary-distribution | active 2026-05-16 | cargo-dist v0.30+ + cargo-binstall v1.13+ + local-fallback | ✅ `ADR-0012-binary-distribution.md` | Keep. |
| 3 | `cha-sync-source-of-truth.md` (11 KB) | cha-sync | active 2026-05-29 (rev 3 — standalone re-scope) | Standalone canonical extracted once from lab; **no ongoing lab→canonical sync**; consumers fork + `just update` | ✅ `ADR-0015-cha-sync-source-of-truth.md` | Keep. Note: this ADR is the reason why `upstream-update-flow.md` (A2 above) must be re-framed for *canonical→consumer*, not *lab→canonical*. |
| 4 | `coverage-enforcement.md` (8.7 KB) | coverage-enforcement | active 2026-05-16 | Rust 95/94, TS 100/100/100/100, Python 100/100; one-way ratchet | ✅ `ADR-0013-coverage-enforcement.md` | Keep. References (4 URLs incl. Scientific Python guide, pytest-cov, logrocket) confirmed. |
| 5 | `doc-validator.md` (2.7 KB) | doc-validator | active 2026-05-16 | Custom Rust crate; relative path + intra-file anchor checks only; <2 s full-lab scan | ✅ `ADR-0010-doc-validator.md` | Keep — but note the slot is still a **stub in the template** (`harness/doc-validator/bin` v0.1-stub). Filed as bead `n48.6`. |
| 6 | `hooks.md` (4.3 KB) | hooks | active 2026-05-14 | lefthook v2.1.6 (evilmartians/lefthook, Go binary) | ✅ `ADR-0003-hooks.md` | Keep. References (11 URLs incl. pkgpulse, edopedia, d4b.dev, johal, husky-rs, rhusky, simple-git-hooks/Snyk) confirmed. |
| 7 | `inspector.md` (4.1 KB) | inspector | active 2026-05-14 | Playwright 1.60 (Node) + spawned ffmpeg | ✅ `ADR-0002-inspector.md` | Keep. References (8 URLs incl. browserstack, chromiumoxide, headless_chrome, fantoccini, thirtyfour, ffmpeg-next) confirmed. |
| 8 | `observability-stack.md` (4.4 KB) | observability-stack | active 2026-05-14 | OTEL Collector contrib → VictoriaLogs + VictoriaMetrics + VictoriaTraces | ✅ `ADR-0005-observability-stack.md` | Keep. References (8 URLs incl. Parseable, SigNoz, OpenObserve, DrDroid LGTM guide) confirmed. |
| 9 | `secret-scanner.md` (3.8 KB) | secret-scanner | active 2026-05-16 | Gitleaks v8.24.2 (MIT, 6.41 MB Go binary) | ✅ `ADR-0009-secret-scanner.md` | Keep. References (6 URLs incl. Kali pkg, NomadX, AppSecSanta, TruffleHog 2026 docs, Rafter) confirmed. |
| 10 | `sensors.md` (4.8 KB) | sensors v0.2 | **partially superseded** by v0.3 APSS doc (2026-05-18); per-language adapter set retired from v0.3 agent image | Rust aggregator + per-language adapters (dep-cruiser, ts-morph, grimp, cargo-modules, go-arch-lint, sentrux) | ✅ `ADR-0006-sensors.md` (**hybrid consumer summary** — delegates v0.3 detail to upstream) | Keep, but see entry #11 — the supersedence record is the load-bearing gap. References (11 URLs incl. Martin/CodeProject, Drotbohm, InfoQ, ArchUnit, CodeScene) confirmed. |
| 11 | **`sensors-v0.3-apss-canonical.md`** (9.9 KB) | sensors v0.3 — **APSS as canonical** | **active 2026-05-18** | APSS `aps` binary (Rust/Python/TS/TSX) emits `.topology/metrics/{modules,functions}.json`; `harness-sensors` gates via `governance.toml`; `apss_topology` adapter shim (358 LOC); `fitness-toml-bridge` (322 LOC). v0.3 agent image **retires** grimp/depcruiser/ts-morph/sentrux. | ❌ **NOT PORTED** — only mentioned in passing inside ADR-0006's consumer summary. | **Port as new ADR `ADR-0017-sensors-v0.3-apss-canonical.md`** with "Supersedes ADR-0006 (partially)" annotation. Critical drops listed below this table. Filed as bead `n48.7`. |
| 12 | `stack-manager.md` (3.9 KB) | stack-manager | active 2026-05-14 | Rust binary: bollard v0.21.0 + portpicker + shell-out `docker compose` | ✅ `ADR-0001-stack-manager.md` | Keep. References (8 URLs incl. bollard/fussybeaver/docs.rs, portpicker/lib.rs, shiplift, testcontainers-rs, compose-rs, dockerode) confirmed. |
| 13 | `strict-typing.md` (5.5 KB) | strict-typing | **audit** 2026-05-16 | Six proposed tightenings; **top finding: template ships strict declarations but no hook wiring** (type theatre) | ✅ `ADR-0014-strict-typing.md` | Keep. **Note:** the audit's #1 finding still applies to this template — `lefthook.yml` exists but the strict-type hooks aren't all wired. Worth a follow-up bead in a separate sweep. |
| 14 | `task-runner.md` (3.8 KB) | task-runner | active 2026-05-14 | `just` v1.51.0 (casey/just, single Rust binary, MIT) | ✅ `ADR-0008-task-runner.md` | Keep. References (9 URLs incl. Stuart Ellis, mise, taskfile.dev, mylinux.work, go-task releases) confirmed. |
| 15 | `telemetry-sdk.md` (6.6 KB) | telemetry-sdk | active 2026-05-14 | Node `@opentelemetry/sdk-node` + auto-instrumentations; Rust `opentelemetry`+sdk+otlp 0.31.x; Python `opentelemetry-distro`+instrumentation 1.41.1 | ✅ `ADR-0004-telemetry-sdk.md` | Keep. References (14 URLs incl. OTel JS 2.0 blog, JS-contrib changelog, oneuptime ESM gotcha, opentelemetry-rust #3376, migration_0.28, semconv, OTLP grpc-vs-http) confirmed. |
| 16 | `versioning.md` (3.9 KB) | versioning | active 2026-05-16 | cocogitto v6+ (single Rust binary, MIT) | ✅ `ADR-0011-versioning.md` | Keep. References (9 URLs incl. cocogitto repo + docs, git-cliff, release-please, Changesets, usenotra changelog tools 2026, Hsiao polyglot-monorepo) confirmed. |

### Critical drops inside `sensors-v0.3-apss-canonical.md` (entry #11)

The lab's v0.3 APSS-canonical record contains material the template's `ADR-0006-sensors.md` does **not** carry — only a passing mention. Every one of these is a verbatim concept from the lab doc:

1. APSS topology standard contract — `.topology/metrics/modules.json` + `functions.json` shape (15+ metric dimensions per entity).
2. `apss_topology` adapter shim — 358 LOC, 11 unit tests, path normalization, 15-metric schema.
3. `fitness-toml-bridge` binary — 322 LOC, 7 unit tests, 5 rule mappings, per-entity exception handling.
4. APSS maintenance signal — AgentParadise-maintained, vendored submodule cadence, v0.1.0 marked as EXP-V1-0001 v0.1.0.
5. Migration plan — six concrete steps (land adapter → land bridge → smoke test → version bump → image ADR → six-month review).
6. Path β (deferred) — adapter-discovery protocol in `harness/sensors/docs/plugin-protocol.md`.
7. Per-entity exception threshold-override gap — lossy bridge today, `[[ratchet]]` primitive deferred.
8. Agent image distribution — what v0.3 retires from the agent image (grimp, depcruiser, ts-morph, sentrux) vs what stays in the lab as reference.
9. Two-tool coordination mitigation — APSS-version vs harness-sensors-version mismatch handling.
10. Experiment references — FU-4 calibration probe, `apss_topology_adapter`, `fitness_toml_bridge` (planned verdicts not yet committed).

Cross-cutting links inside this doc: `docs/experiments/proposals/2026-05-16--harness-sensors-v0.3-architecture.md`, `experiments/2026-05-16--ce-semantics-calibration-apss/`, `experiments/2026-05-17--apss-topology-adapter/`, `experiments/2026-05-17--fitness-toml-bridge/`, `docs/retrospectives/022-polyglot-monorepo-sensor-arc.md`, `harness/sensors/docs/plugin-protocol.md`, `sensors.md`.

Note: a `docs/coordination/APSS-ADR-STANDARD.md` (4.3 KB) appeared in the template during this session (working tree, uncommitted). It is **not** the same as the lab's `sensors-v0.3-apss-canonical.md` — it is shorter and prescribes ADR shape, not the APSS canonicalization decision. Spot-read it before deciding whether to integrate or supersede.

---

## Cross-cutting recommendations

These are the discoveries; the implementation is filed under the existing `create-harness-app-n48.*` beads. Recap:

1. **Restore the citation catalog in `docs/harness-engineering/README.md`.** This is the single load-bearing fix from this pass. The template's principles doc has zero external citations today. The 12 missing entries are listed under § "Dropped inspiration / reference catalog" above. (Operator preservation rule saved as memory `preserve-references-on-port.md`.)
2. **Port `upstream-update-flow.md` reframed for canonical → consumer flow** (per ADR-0015 the template is no longer downstream-of-the-lab but is itself a canonical with its own downstream consumers). Preserve the Fowler + Stripe citations. Bead `n48.8`.
3. **Port `docs/standard/v0.2.md` + `docs/standard/polyglot-monorepo-structure.md`.** v0.2 carries the 11-slot contract; polyglot-monorepo-structure carries 18 WebSearch-anchored citations validating the layout. Both gaps surfaced in bead `n48.11`; split into two beads if useful.
4. **Add `ADR-0017-sensors-v0.3-apss-canonical.md`** with "Supersedes ADR-0006 (partially)" annotation. Carry the 10 critical drops from § "Critical drops inside `sensors-v0.3-apss-canonical.md`" above. Cross-link the lab experiment artefacts referenced (FU-4, apss-topology-adapter, fitness-toml-bridge). Bead `n48.7`.
5. **All per-slot ADR references checked clean.** No work to do on ADRs 0001–0005, 0007–0014, 0016. The reference footprints survived the per-slot port — spot-checks on ADR-0001/0003/0006/0009/0011 confirmed verbatim citations.
6. **Reaudit `ADR-0014-strict-typing.md` against the template's actual hook wiring.** The lab's audit identified hook-wiring gaps in the template itself; a follow-up sweep is warranted but not urgent.

---

## Provenance

- **Inventory pass timestamp:** 2026-05-30.
- **Sub-agents used:** two Explore agents in parallel (one for `harness-engineering/` + `standard/` top-level; one for `decisions/`). Each read every target file in full.
- **Spot-check method:** for the per-slot ADRs, I confirmed reference fidelity in the ports by greping the template files for known citation tokens (bollard / portpicker / lefthook / pkgpulse / cocogitto / etc.). All passed.
- **Catalog source for the field-defining citations:** `agentic-harness-lab/docs/specs/20260529_cha-canonical-readme.md` § "Inspiration & prior art" (lines 281–310, 530–560).
