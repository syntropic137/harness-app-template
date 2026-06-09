---
name: "APS-V1-0003 documentation standard integration"
description: "Adopt packaged APS-V1-0003 (documentation and context engineering) from apss v1.1.0 as a second documentation gate alongside the in-tree harness/doc-validator, per ADR-0018."
status: accepted
supersedes: doc-standard-EXP-V1-0004.md
---

# APS-V1-0003 Documentation Standard Integration

**Tracking ADR:** [ADR-0018 — APSS v1.1.0 integration](../adrs/ADR-0018-apss-v1-1-0-augmentation.md)
**Tracking bead:** `create-harness-app-s9f` (continuation; supersedes the EXP-V1-0004 note)
**Source standard:** APS-V1-0003 (`documentation`) shipped in [`apss` v1.1.0](https://crates.io/crates/apss) from the [agent-paradise-standards-system](https://github.com/AgentParadise/agent-paradise-standards-system) repository.
**Scope:** integration record. The decision and the slot contract live in [ADR-0018](../adrs/ADR-0018-apss-v1-1-0-augmentation.md); the *staged* adoption sequence below is the followup work owned by the integration lane.

## 0. Why this note exists

`docs/standards-integration/doc-standard-EXP-V1-0004.md` is the original research note that mapped the template's docs tree to the APSS draft documentation standard (`EXP-V1-0004` in PR 61). Its analysis still holds: the template has a strong ADR01 base under `docs/adrs/` but the broader EXP-V1-0004 surfaces (per-Markdown front matter, per-directory `README.md` indexes, per-directory `AGENTS.md`+`CLAUDE.md`, `.apss/config.toml`) are still missing.

That note has since been superseded by a packaged release. `apss` v1.1.0 ships the documentation standard as `APS-V1-0003`, available via `cargo install apss` and `apss add APS-V1-0003`. This note records:

1. the binding between the template and the *packaged* standard (not the PR-branch identifier `EXP-V1-0004`);
2. the integration contract — what *does* and *does not* change per [ADR-0018](../adrs/ADR-0018-apss-v1-1-0-augmentation.md);
3. the staged adoption work that survives from the EXP-V1-0004 note as the rollout punch list.

## 1. Binding to the packaged standard

| Artifact | Value |
|---|---|
| Standard ID | `APS-V1-0003` |
| Substandards (in-scope) | ADR01 (already enforced by `harness/doc-validator`; APS-V1-0003 enforces a strict superset), DOC02 (front matter), DOC03 (directory README + Index) |
| Distribution | crates.io (`apss` CLI + standards as cargo features) |
| Bootstrap | `cargo install apss` then `apss init && apss add APS-V1-0003 && apss install` |
| Validation entrypoint | `apss validate` (also wired into the pre-commit hook by `apss install`) |
| Lockfile | `apss.lock` (committed, alongside `APSS.yaml`) |
| Runtime cache | `.apss/` (build output; gitignored) |

`APSS.yaml` and `apss.lock` belong to the integration lane (Codex). This note does not assume any specific YAML shape beyond "`APS-V1-0003` is declared in `APSS.yaml`."

## 2. What ADR-0018 binds about this standard

The decision is *augment, never replace*. Concretely:

- **`harness/doc-validator` (the slot plugin from ADR-0010) stays.** It remains the source of truth for internal Markdown links, ADR shape, and the `harness.manifest.json#slots.<X>.decisionAt` cross-reference rule. None of that surface is duplicated by APS-V1-0003.
- **`apss validate` runs as an additional gate** at the same pre-commit/pre-push moments, wired through the `hooks` slot (lefthook) and discoverable through the `task-runner` slot (`justfile`).
- **Strictness reconciliation on overlap.** Both gates assert ADR01-shape rules. Where they overlap, APS-V1-0003 is the stricter (it requires front matter on `_template.md`, and its allowed-template mechanism replaces the underscore-prefix exclusion `harness/doc-validator` uses). The stricter wins; the slot is unchanged.
- **No slot-contract edits in `harness.manifest.json#slots.doc-validator.plugin` or `scripts/lib/slots.ts`.** The slot stays single-plugin; the *commit-time gate* is the union of two checks.

## 3. Gap surfaces inherited from the EXP-V1-0004 note

The packaged standard's structural rules are a near-perfect match for the gap list in `doc-standard-EXP-V1-0004.md` §6. The fixes carry over verbatim — only the *enforcement* changes (from "would be enforced by EXP-V1-0004" to "is enforced by APS-V1-0003 once `apss validate` is wired").

| ID | Gap | Disposition under APS-V1-0003 |
|---|---|---|
| G1 | Missing `.apss/config.toml` | `apss init` (or its successor `apss add APS-V1-0003`) generates the manifest surface; the template commits `APSS.yaml` and `apss.lock`. The `.apss/` runtime cache stays gitignored per the upstream README. |
| G2 | Most Markdown files lack front matter | `apss validate` fails until each `.md` under the docs root has `name` and `description`. Adopted incrementally; see §4. |
| G3 | Most docs directories lack `README.md` | Same; `apss validate` flags missing directory READMEs. |
| G4 | Most existing README files lack front matter | Same; the READMEs themselves are Markdown under the docs root. |
| G5 | Only `docs/adrs/` has per-directory `AGENTS.md` and `CLAUDE.md` | Per APS-V1-0003 (and the ADR-0007 agent-plugins pattern), every docs directory wants a canonical `AGENTS.md` and a vendored `CLAUDE.md` symlink. |
| G6 | `docs/adrs/AGENTS.md` and `docs/adrs/CLAUDE.md` lack YAML front matter | Add `name` and `description` front matter; APS-V1-0003 enforces this. |
| G7 | `docs/adrs/_template.md` may not satisfy strict ADR01 naming | APS-V1-0003 ADR01 has an explicit allowed-template mechanism that supersedes the local underscore-prefix exclusion. Declare the template in `APSS.yaml` (or its standard-config equivalent) so the slot plugin and APS-V1-0003 agree. |
| G8 | `harness/doc-validator` does not enforce DOC02/DOC03 yet | Per ADR-0018 the slot is *not* extended for this. APS-V1-0003 runs as the second gate. |
| G9 | No index-generation recipe | APS-V1-0003 ships index-generation as a standard command (e.g. `apss run APS-V1-0003 index --write`). Wire as a `just docs index` recipe in the integration lane. |

## 4. Staged adoption (owned by the integration lane)

Same shape the EXP-V1-0004 note proposed; only the *tool* changes. Each step lands as its own bead.

1. Bootstrap: `cargo install apss`; `apss init`; `apss add APS-V1-0003`; `apss install` (writes `apss.lock`, installs pre-commit hook). Commit `APSS.yaml` and `apss.lock`.
2. Wire `apss validate` into `lefthook.yml` alongside the existing `harness/doc-validator` invocation (`hooks` slot). Add a `just apss validate` recipe (`task-runner` slot).
3. Pick a low-risk first directory — `docs/sensors/` is a single-file dir, ideal — and bring it into APS-V1-0003 conformance: add front matter, generate `README.md` with `## Index`, add `AGENTS.md` + vendored `CLAUDE.md`. Run `apss validate` to prove the loop.
4. Roll the same shape through the remaining directories in groups: `docs/standard/`, `docs/harness-engineering/`, `docs/gap-analysis/`, `docs/coordination/`, `docs/retrospectives/`, `docs/superpowers/`, `docs/evolution/`.
5. Resolve the ADR01 overlap: add front matter to `docs/adrs/AGENTS.md` and `docs/adrs/CLAUDE.md`; decide whether `docs/adrs/_template.md` is declared via APS-V1-0003's template mechanism or moves outside `docs/adrs/`.
6. Once `apss validate` is green across the docs tree, wire the staleness check (e.g. `apss run APS-V1-0003 index --check`) into `just doctor` so drift surfaces at the same moment the template's other slot doctors run.

The order matters: steps 1–2 stand the gate up; steps 3–4 pay the migration debt; steps 5–6 close the door behind the migration.

## 5. Why the in-tree slot survives

The slot's value is the parts APS-V1-0003 does *not* enforce: `harness.manifest.json#slots.<X>.decisionAt` cross-references (a slot-contract rule, not a docs rule) and the lab-internal narrow link-checker scope that ADR-0010 picked precisely so the slot stays a single ≤1 MB binary with no language-runtime dep. Both properties are preserved by augmenting; both are lost by replacing.

If APS-V1-0003 later grows a manifest-cross-reference equivalent, the slot's `plugin` field becomes a candidate for a follow-up ADR. Until then, the slot is the load-bearing gate for that one rule.

## 6. Cross-references

- [ADR-0010 — Doc Validator](../adrs/ADR-0010-doc-validator.md)
- [ADR-0018 — APSS v1.1.0 integration](../adrs/ADR-0018-apss-v1-1-0-augmentation.md)
- [`doc-standard-EXP-V1-0004.md`](./doc-standard-EXP-V1-0004.md) — superseded research note. Its analysis (current docs tree, context-engineering benefits, worked `docs/sensors/` example) is preserved verbatim; only the gate identifier changes.
- [`fitness-function-APS-V1-0002.md`](./fitness-function-APS-V1-0002.md) — sibling integration record for APS-V1-0002 (architecture-fitness). The two integrations are independently sequenced.
