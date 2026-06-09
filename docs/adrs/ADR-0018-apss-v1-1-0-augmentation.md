---
name: "APSS v1.1.0 integration — augment doc-validator with APS-V1-0003; route fitness signals via the apss_topology shim"
description: "Adopt packaged apss v1.1.0 by ADDING APS-V1-0003 as a second documentation gate alongside the in-tree harness/doc-validator and by ROUTING harness/sensors/gate.mjs fitness signals through the existing ADR-0017 apss_topology.mjs shim — never replacing either."
status: accepted
---

<!--
ADR-0018 — APSS v1.1.0 integration (architecture/ADR lane).
Authoritative spec for the ADR contract: ../coordination/APSS-ADR-STANDARD.md.

Lane: architecture / docs only. Implementation (config/scripts/harness/lefthook
wiring) is owned by the integration lane; this ADR records the *shape* of the
decision and the contract Codex's wiring is reviewed against.
-->

# ADR-0018: APSS v1.1.0 integration — augment, never replace

**Date:** 2026-06-09
**Category:** Cross-cutting (doc-validator slot + sensors slot)
**Supersedes:** none (layers on top of ADR-0010 and ADR-0017)
**Next review:** 2026-12-09

## Context

Two prior ADRs frame the surface this decision lands on:

- [ADR-0010 — Doc Validator](./ADR-0010-doc-validator.md) picked a custom Rust crate at `harness/doc-validator/` to enforce internal Markdown cross-references, ADR shape, and manifest decisionAt pointers. The slot is intentionally narrow (no external URL checks, no docs-wide structural rules).
- [ADR-0017 — Sensors v0.3](./ADR-0017-sensors-v03-apss-canonical.md) made APSS the canonical cross-language architecture-fitness signal and preserved sentrux + the per-language adapters as available. The shim `harness/sensors/apss_topology.mjs` consumes `.topology/metrics/{modules,functions,coupling}.json` and surfaces APSS readings to `harness/sensors/gate.mjs`. The Node aggregator stays as a working starter until the APSS adapter shim is fully wired.

Two research notes sit beside ADR-0017 in `docs/standards-integration/`:

- `doc-standard-EXP-V1-0004.md` mapped the template's docs tree to the APSS draft documentation standard (PR 61, then identifier `EXP-V1-0004`). It is research-only.
- `fitness-function-APS-V1-0002.md` audited the harness sensors gate against APSS APS-V1-0002 (then a PR 63 branch) and recommended stance (3): adopt the APSS vocabulary and artifact contracts; hold the harness's enforcement posture; file an R1 to R5 disclosure upstream.

The standard has now shipped. The `apss` v1.1.0 CLI is installable from crates.io (`cargo install apss`). Standards are delivered as cargo crates referenced from a user-owned `APSS.yaml` manifest and locked in `apss.lock`. APS-V1-0002 (architecture-fitness) and APS-V1-0003 (documentation and context engineering) are both packaged. The CLI surface is:

```text
apss init             # generate APSS.yaml
apss add <standard>   # add a standard (e.g. APS-V1-0003, APS-V1-0002)
apss install          # resolve from crates.io, write apss.lock, install git hooks
apss validate         # validate (also runs from the pre-commit hook)
apss run <std> <cmd>  # delegate to a composed binary
```

The question this ADR closes is *how* the template adopts that packaged surface without losing what ADR-0010 and ADR-0017 already established. Concretely:

1. The `harness/doc-validator` slot already enforces three classes of check (internal links, ADR shape, manifest cross-refs). Should APSS APS-V1-0003 replace it, sit on top of it, or be wired through it?
2. The `harness/sensors/gate.mjs` gate already implements an APS-V1-0002-shaped baseline (8 dimensions, the `INCUBATING_DIMENSION_ERROR_DOWNGRADED` diagnostic, the per-metric ratchet) and consumes APSS topology artifacts through the `apss_topology.mjs` shim. Should `gate.mjs` start invoking `apss run APS-V1-0002` directly, or keep routing fitness signals through the shim?

Holding to the preservation-first rule used in [ADR-0017](./ADR-0017-sensors-v03-apss-canonical.md) and the operator's `create-harness-app-n48.3` framing — *do not unilaterally retire existing work; record the both-vs-reduce trade-off as a decision* — both questions have the same answer.

## Decision

Two related decisions, both accepted:

1. **Augment the doc-validator slot with APS-V1-0003.** The packaged APS-V1-0003 documentation gate is added as a *second*, additive check that runs alongside the existing `harness/doc-validator` Rust crate. Neither replaces the other. The slot contract (`harness.manifest.json#slots.doc-validator`) remains pointed at the custom Rust crate; APS-V1-0003 is invoked through the project-level `apss validate` (or `apss run APS-V1-0003 validate`) entrypoint that Codex wires into the `hooks` slot and `task-runner` slot. The slot stays single-plugin; the *commit-time gate* becomes "both gates must pass."

2. **Route fitness signals through `apss_topology.mjs` (ADR-0017 shim), not by direct `apss run APS-V1-0002` invocation from `gate.mjs`.** The harness sensors gate continues to compute and enforce its 8-dimension baseline; APSS-canonical readings flow into the gate through the existing shim, which already reads `.topology/metrics/{modules,functions,coupling}.json` (the producer artifacts APS-V1-0001 defines). When Codex wires the project to invoke `apss run APS-V1-0001 topology` (or its equivalent producer), the shim will see and merge those artifacts on the next run with no edit to `gate.mjs`. The gate's enforcement posture (stance (3) from `docs/standards-integration/fitness-function-APS-V1-0002.md`) is preserved.

Concretely:

- `harness.manifest.json#slots.doc-validator.plugin` stays `harness-doc-validator` (the custom Rust crate). The `implementation` field is updated to note that the project also runs `apss validate` as an *additional* documentation gate; APS-V1-0003 is named in the slot's `decisionAt` chain via this ADR.
- `harness.manifest.json#slots.sensors` is unchanged. The shim referenced in ADR-0017 (`harness/sensors/apss_topology.mjs`) remains the single integration point. `gate.mjs` does not call `apss run` directly.
- A project-level `APSS.yaml` declares the two standards the template adopts (`APS-V1-0003` and, when its R1 to R5 disclosure clears upstream, `APS-V1-0002`) and pins `apss.lock`. Both files belong to Codex's lane.
- The `hooks` slot (lefthook) gains an APSS pre-commit/pre-push entry that runs `apss validate`. The existing `harness/doc-validator` entry stays. Both must pass.
- The `task-runner` slot exposes `just apss validate` (or similar) so the augmented gate is discoverable.

Deliberate non-choices:

- **No renumbering of ADR-0010.** The custom doc-validator pick is unchanged. APS-V1-0003 is an additional, packaged gate, not a successor pick.
- **No edit to ADR-0017's shim seam.** `apss_topology.mjs` continues to be the only point that consumes APSS-canonical topology artifacts.
- **No upgrade of `gate.mjs` to call `apss run APS-V1-0002` in this ADR.** That is a separate decision tied to the upstream R1 to R5 disclosure for ST01 / SC01 / LG01 / PF01 (per `docs/standards-integration/fitness-function-APS-V1-0002.md` §6). The roadmap there is unchanged.

## Consequences

- **What this enables.** Two complementary documentation gates: ADR-0010's ADR-shape and internal-link rules survive verbatim; APS-V1-0003's docs-wide structural rules (front matter, README indexes, per-directory context files, `.apss/config.toml`) become enforceable too — both at commit time. Fitness signals from packaged APS-V1-0001 producers (when added) flow into `gate.mjs` through the same `apss_topology.mjs` seam ADR-0017 named, so the upgrade is transparent to consumers.
- **What this constrains.** The `harness.manifest.json#slots.doc-validator.plugin` field stays single-valued; the slot contract in `scripts/lib/slots.ts` is unchanged. Any future move to a single combined doc-validator binary is a separate ADR. Likewise, `gate.mjs` MUST NOT shell out to `apss run APS-V1-0002` until the R1 to R5 disclosure path closes; the shim is the only seam.
- **Migration cost.** Codex's wiring adds `APSS.yaml`, `apss.lock`, an `apss install` step (e.g., in `just bootstrap`), and two lefthook entries (`apss validate`, plus retaining the existing `harness/doc-validator` entry). The template gains a new install-time dependency on the `apss` binary, paid once per fork (`cargo install apss`). The docs tree will accumulate APS-V1-0003 surfaces (front matter on every `.md`, README indexes, per-directory `AGENTS.md`+`CLAUDE.md`) — `docs/standards-integration/doc-standard-APS-V1-0003.md` (superseding the EXP-V1-0004 note) tracks the staged adoption.
- **Preservation audit.** No removals. (1) `harness/doc-validator` stays as the slot plugin and remains the source of truth for ADR-shape and internal-link rules. (2) `harness/sensors/gate.mjs` and `harness/sensors/baseline.json` are unchanged by this ADR. (3) The `apss_topology.mjs` shim from ADR-0017 keeps its role. (4) The two research notes in `docs/standards-integration/` are *promoted*, not deleted: the EXP-V1-0004 note becomes the now-superseded `doc-standard-EXP-V1-0004.md` pointing at its packaged successor `doc-standard-APS-V1-0003.md`; the APS-V1-0002 note is updated for the packaged crate (its substantive analysis and roadmap remain).

## Details

### Why augment instead of replace the doc-validator

The narrow scope ADR-0010 picked is exactly the part APS-V1-0003 does *not* duplicate. ADR-0010 enforces:

- internal Markdown link integrity (relative paths + intra-file anchors);
- the ADR canonical-section shape (`Context`, `Decision`, `Consequences`);
- `harness.manifest.json#slots.<X>.decisionAt` pointer existence.

APS-V1-0003 enforces (per the `doc-standard-EXP-V1-0004.md` research note, now superseded by `doc-standard-APS-V1-0003.md`):

- per-Markdown front matter (`name`, `description`);
- per-directory `README.md` with a generated `## Index`;
- per-directory `AGENTS.md` (and `CLAUDE.md`);
- `.apss/config.toml` presence;
- ADR01 substandard rules (a strict superset of ADR-0010's ADR-shape rule).

The two surfaces overlap only on the ADR01 substandard. In that overlap APS-V1-0003 is *stricter* than ADR-0010 (front-matter on `_template.md`, explicit-allowlist instead of underscore-prefix), so when both gates run the strictness wins — a desirable outcome. Outside the overlap, the two gates are complementary: removing `harness/doc-validator` would lose the manifest-cross-reference rule APSS does not have; removing APSS would lose every docs-wide structural rule.

A single combined doc-validator binary (one custom Rust crate that also runs APS-V1-0003) would mean reimplementing APSS's tooling inside the slot. That path is rejected for the same reason ADR-0010 picked a narrow custom crate in the first place: scope creep past ~400 LoC means we are no longer maintaining "the thin Markdown checker"; we are maintaining a docs-tree governor that already exists upstream as a packaged binary.

### Why route fitness through the shim, not by direct `apss run`

The shim seam is the load-bearing decision in ADR-0017. It lets `gate.mjs` consume APSS topology readings without inheriting APSS's full fitness machinery (the §6 composite score, the §5 per-entity exceptions, the §9 adapter contract). Stance (3) in `docs/standards-integration/fitness-function-APS-V1-0002.md` is "adopt vocabulary and artifact shapes; hold enforcement posture; file upstream." That stance is preserved verbatim by routing through the shim. The `apss_topology.mjs` adapter already:

- reads APSS's canonical producer artifacts (`.topology/metrics/{modules,functions,coupling}.json`) when present;
- hoists Tier 1 flat coupling fields into a per-module `.apss` sub-object so legacy readings remain available as fallback;
- emits `{ tool: 'apss-topology', available: false, readings: [] }` when APSS is not installed (no `.topology/` directory).

Direct `apss run APS-V1-0002` invocation from `gate.mjs` would inherit two surfaces we explicitly *don't* want yet: (i) the `INCUBATING_DIMENSION_ERROR_DOWNGRADED` downgrade on ST01 / SC01 / LG01 / PF01 happens at the APSS layer instead of being controlled by the harness manifest, so the gate would lose enforcement on four dimensions where the harness has working adapters; (ii) the producer-artifact requirement on APS-V1-0001 becomes a hard install-time dependency rather than a best-effort consumption. Both moves are admissible — they are exactly stance (1) in the fitness-function note — but they are out of scope for the augment-not-replace ADR.

When the upstream R1 to R5 disclosure (per `docs/standards-integration/fitness-function-APS-V1-0002.md` §7) closes for ST01 / SC01 / LG01 / PF01, that promotion is a separate ADR. This one preserves the current enforcement posture.

### Slot contract compatibility (review hook)

This ADR is a contract for Codex's wiring lane. The slot contract definitions live at:

- `harness.manifest.json#slots.{doc-validator,sensors,hooks,task-runner}`;
- `scripts/lib/slots.ts` — the `SlotConfig` shape and `resolveSlotInvocation` resolver.

Codex's wiring is expected to:

- Keep `slots.doc-validator.plugin = "harness-doc-validator"` and `slots.doc-validator.interface.entrypoint = "harness/doc-validator/bin/doc-validator"`. The `implementation` text is updated to name APS-V1-0003 as an additional gate; this ADR is added to the slot's `decisionAt` chain.
- Leave `slots.sensors` unchanged; the integration is entirely under `harness/sensors/apss_topology.mjs` and a new `APSS.yaml` at the repo root.
- Add an `apss install` step to `just bootstrap` (task-runner slot).
- Add two `hooks` entries: `apss validate` (new) plus the existing `harness/doc-validator` invocation (retained).

The design-review step (Agent Mail thread, this lane to Codex) walks each of those points against the actual diff.

### Alternatives considered

- **Replace the custom doc-validator with APS-V1-0003.** Rejected: loses the manifest-cross-reference check, regresses the slot's "single binary, no external dependency" posture (ADR-0010 §1), and forces every fork to install `apss` even when they don't want the docs-wide structural rules. Rejected on the preservation rule.
- **Wire `apss validate` *through* the `harness-doc-validator` binary** (the slot binary spawns `apss`). Rejected: makes the doc-validator binary's runtime depend on `apss` being installed, which violates ADR-0010's "no language-runtime dep" property and conflates two different scopes into one error message. Cleaner to keep them as two parallel gates.
- **Invoke `apss run APS-V1-0002` directly from `gate.mjs`.** Rejected: see "Why route fitness through the shim" above. Inherits the §3.4 downgrade automatically.
- **Defer adoption until the upstream R1 to R5 disclosure closes.** Rejected: the documentation gate (APS-V1-0003) is independently load-bearing and packaged; nothing about it is blocked on the architecture-fitness upstream story. Adopting them separately is the cheaper sequencing.

### Sources

- `apss` v1.1.0 — `cargo install apss`; CLI surface verified from the installed binary (`apss --help`).
- [ADR-0010 — Doc Validator](./ADR-0010-doc-validator.md).
- [ADR-0017 — Sensors v0.3 — APSS canonical, sentrux preserved](./ADR-0017-sensors-v03-apss-canonical.md).
- [`docs/standards-integration/doc-standard-EXP-V1-0004.md`](../standards-integration/doc-standard-EXP-V1-0004.md) — research note (superseded by APS-V1-0003 packaged release; see `doc-standard-APS-V1-0003.md`).
- [`docs/standards-integration/fitness-function-APS-V1-0002.md`](../standards-integration/fitness-function-APS-V1-0002.md) — recommendation and roadmap; preserved.
- AgentParadise standards system: https://github.com/AgentParadise/agent-paradise-standards-system.

### Backlinks

Code, docs, and manifests that will reference this ADR when Codex's wiring lands (add the exact identifier `ADR-0018-apss-v1-1-0-augmentation` when wiring):

- `harness.manifest.json#slots.doc-validator.implementation` and an additional `decisionAt`-chain entry.
- `harness.manifest.json#slots.hooks` (lefthook config) and `harness.manifest.json#slots.task-runner` — both gain APSS entries.
- `harness/doc-validator/README.md` — note "this slot enforces ADR shape + internal links + manifest cross-refs; APS-V1-0003 (packaged) runs as an additional gate at pre-commit."
- `harness/sensors/apss_topology.mjs` — header comment updated to point at this ADR alongside ADR-0017.
- `APSS.yaml` and `apss.lock` at repo root.
- `lefthook.yml` — `apss validate` entry.
- `justfile` — `just apss validate` recipe; `just bootstrap` includes `apss install --offline` or equivalent.

### When to re-evaluate

- The R1 to R5 disclosure for ST01 / SC01 / LG01 / PF01 closes upstream — re-evaluate routing fitness via direct `apss run APS-V1-0002` (would promote stance (1) over (3)).
- APS-V1-0003 grows a manifest-cross-reference rule equivalent to what `harness/doc-validator` enforces — re-evaluate whether the custom crate's scope is still load-bearing.
- A single packaged `apss` binary subsumes ADR-0010's surface entirely — re-evaluate the slot's `plugin` field.
- The two gates ever disagree on the ADR01 substandard's overlap in a way that surprises an operator — re-evaluate strictness reconciliation.
