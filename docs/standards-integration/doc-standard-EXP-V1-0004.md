---
name: "APSS EXP-V1-0004 documentation standard integration (superseded)"
description: "Original research note mapping the template documentation tree to the APSS Documentation and Context Engineering standard from PR 61. Superseded by APS-V1-0003 (packaged in apss v1.1.0); preserved verbatim for lineage."
status: superseded
superseded_by: doc-standard-APS-V1-0003.md
---

> **Superseded.** The PR-branch identifier `EXP-V1-0004` was promoted to the
> packaged standard `APS-V1-0003` in `apss` v1.1.0 (crates.io). The current
> integration record is [`doc-standard-APS-V1-0003.md`](./doc-standard-APS-V1-0003.md),
> bound by [ADR-0018](../adrs/ADR-0018-apss-v1-1-0-augmentation.md).
>
> This note is preserved verbatim because its gap analysis (G1–G9), worked
> `docs/sensors/` example, and proposed adoption sequence remain the
> rollout punch list under the packaged standard — only the *gate
> identifier* changed. Do not edit the body of this note; record new
> integration decisions in the successor file.

# APSS EXP-V1-0004 Documentation Standard Integration

**Bead:** create-harness-app-s9f
**Source standard:** AgentParadise PR 61, `feat: EXP-V1-0004 documentation and context engineering standard`
**Scope:** research and proposal only. Do not migrate the full docs tree in this bead.

## Summary

The template already has a strong ADR01 base under `docs/adrs`: plural directory, `ADR-NNNN-title.md` naming, front matter, lifecycle status, required `## Context`, `## Decision`, and `## Consequences` sections, a README index, and ADR-specific `CLAUDE.md` plus `AGENTS.md` context files with backlink guidance.

The broader EXP-V1-0004 parent standard is not yet implemented across the whole docs tree. The template has root agent context via canonical `AGENTS.md` plus vendor symlinks, and the `harness/doc-validator` slot enforces internal Markdown links, ADR shape, manifest decision references, and principle docs. The missing layer is docs-wide structure: front matter on every Markdown file, `README.md` plus generated `## Index` in every docs directory, per-directory context files outside `docs/adrs`, and an explicit `.apss/config.toml`.

## Standard Surface From PR 61

The parent standard defaults to `docs/` as the documentation root and requires or recommends these surfaces:

| Surface | EXP-V1-0004 rule | Template state |
|---|---|---|
| `.apss/config.toml` | Project config location. Missing config is allowed and defaults apply. | Missing. Defaults would point to `docs/`, but the template should pin config once it opts in. |
| Markdown front matter | Every `.md` under docs root should have YAML front matter with at least `name` and `description`. | Partial. Snapshot before this note: 24 of 65 Markdown files had front matter. |
| Directory README | Every docs directory must have `README.md`. | Partial. Snapshot before this note: 3 of 12 docs directories had README files. |
| README `## Index` | Every README should contain a generated `## Index` table from sibling file front matter. | Present for `docs/adrs`; not broadly present. |
| Directory context files | Every docs directory should contain `CLAUDE.md` and `AGENTS.md`. | Present only in `docs/adrs`. |
| Root context files | Root `CLAUDE.md` and `AGENTS.md` must exist; root context should reference docs. | Present. `AGENTS.md` is canonical and `CLAUDE.md`, `GEMINI.md`, `.codex`, and `.gemini` point at it. |
| ADR01 substandard | `docs/adrs`, `ADR-\d{3,5}-...`, front matter with `name`, `description`, `status`, Fowler lifecycle, context files, standard headers, dead reference checks. | Mostly present and enforced by `harness/doc-validator`. See gaps below for `_template.md` and context-file front matter. |

The standard also adds CLI operations in the upstream system:

```sh
aps run docs validate
aps run docs validate --json
aps run docs index
aps run docs index --write
```

The template does not currently vendor or wrap that CLI. Its local equivalent is the `doc-validator` slot, which is narrower today.

## Current Docs Structure

Current high-level tree:

```text
docs/
  adrs/
  coordination/
  evolution/
  gap-analysis/
  harness-engineering/
    references/
  retrospectives/
  sensors/
  standard/
  superpowers/
    specs/
```

The tree is useful, but it is still organized as human-authored folders rather than a machine-indexed context graph. The most complete directory is `docs/adrs`, because earlier work already aligned it with the ADR01 substandard.

## Context Engineering Benefits

EXP-V1-0004 fits the template because it turns documentation into a predictable retrieval surface for agents:

| Benefit | Why it matters for this template |
|---|---|
| Fast orientation | Agents can read a directory README index before opening many files. This lowers token cost and reduces wrong-file exploration. |
| Frontmatter-driven search | `name`, `description`, and `status` let tooling classify docs without reading full bodies. This helps future vector indexes, lightweight grep summaries, and doc-validator reports. |
| Local context files | Per-directory `AGENTS.md` gives task-specific guidance near the files being edited. Agents do not need to keep the entire root context in memory. |
| Canonical context reuse | The template already uses root `AGENTS.md` as canonical text with vendor symlinks. The same pattern can apply per docs directory: canonical `AGENTS.md`, with `CLAUDE.md` as a symlink or exact mirror where needed. |
| Better stale-doc detection | Generated indexes make missing files, renamed files, and stale summaries visible in CI. This extends the existing doc-validator discipline from links and ADRs to the entire docs corpus. |
| Smaller prompts | A generated index plus a short directory context file can answer "what is here" in tens of lines instead of requiring an agent to scan every document. |

## Concrete Gap List

| Gap | Impact | Proposed fix |
|---|---|---|
| G1: Missing `.apss/config.toml` | The repo relies on upstream defaults instead of declaring its docs root, ADR directory, and index fields. | Add `.apss/config.toml` with `docs.root = "docs"`, `docs.adr.directory = "adrs"`, context-file requirements, and index fields. |
| G2: Most Markdown files lack front matter | Files cannot drive generated indexes or structured discovery. | Add `name` and `description` to every docs Markdown file. ADRs should keep `status`; other docs may add `status`, `category`, or `source` only if useful. |
| G3: Most docs directories lack README files | Agents and humans must enumerate directories manually. | Add `README.md` to every docs directory with a generated `## Index` section. |
| G4: Most existing README files lack front matter | README files are themselves Markdown under the docs root, so they should be self-describing too. | Add front matter to README files before or during index generation. |
| G5: Only `docs/adrs` has per-directory context files | Agents entering `gap-analysis`, `harness-engineering`, or `standard` lack local orientation. | Add `AGENTS.md` and `CLAUDE.md` to each docs directory. Prefer canonical `AGENTS.md` body and `CLAUDE.md` symlink or mirror. |
| G6: `docs/adrs/AGENTS.md` and `docs/adrs/CLAUDE.md` lack YAML front matter | ADR01 context exists, but the parent front matter rule is not satisfied for these Markdown files. | Add `name` and `description` front matter to both ADR context files. |
| G7: `docs/adrs/_template.md` may not satisfy strict upstream ADR01 naming | The local doc-validator skips underscore templates, but PR 61 ADR01 excludes only `README.md`, `CLAUDE.md`, and `AGENTS.md` from ADR filename validation. | Either configure an allowed ADR template exclusion when upstream supports it, move the template outside `docs/adrs`, or name it through a standard template mechanism. |
| G8: `harness/doc-validator` does not enforce DOC02 or DOC03 yet | Local CI checks ADRs and links but not docs-wide front matter, README indexes, context files, or `.apss/config.toml`. | Extend the doc-validator slot or wrap `aps run docs validate` once APSS tooling is consumable. Keep current link and ADR checks. |
| G9: No index-generation recipe | Manual README index updates do not scale beyond ADRs. | Add a future `just docs index` recipe that previews and writes indexes, then wire stale-index checking into `just doctor` or pre-push. |

## Worked Example: Restructure `docs/sensors`

This is a concrete example, not a migration performed in this bead. `docs/sensors` is a good first target because it has one document and no README or context files.

### Before

```text
docs/sensors/
  coverage-and-gate.md
```

### After

```text
docs/sensors/
  AGENTS.md
  CLAUDE.md -> AGENTS.md
  README.md
  coverage-and-gate.md
```

If symlinks are not acceptable for a downstream platform, `CLAUDE.md` can be an exact copy of `AGENTS.md`. The root template already uses symlinks successfully, so the default should match that canonical AGENTS layout.

### `docs/sensors/coverage-and-gate.md`

```markdown
---
name: "Sensors Coverage and Gate"
description: "Explains how the sensors slot reports architecture metrics and gates regressions"
---

# Sensors Coverage and Gate

Existing body remains here.
```

### `docs/sensors/README.md`

```markdown
---
name: "Sensors Documentation"
description: "Index of sensors slot documentation and architecture fitness gate notes"
---

# Sensors Documentation

This directory documents the sensors slot, its architecture fitness adapters, and the gate behavior that protects regressions.

## Index

| Document | Description |
|----------|-------------|
| [Sensors Coverage and Gate](coverage-and-gate.md) | Explains how the sensors slot reports architecture metrics and gates regressions |
```

### `docs/sensors/AGENTS.md`

```markdown
---
name: "Sensors Documentation Agent Context"
description: "Local guidance for agents editing sensors documentation"
---

# Sensors Documentation Agent Context

Start with [README.md](README.md) for the local index.

When changing sensors docs, preserve the distinction between available adapters and enforced gates. If a change alters a load-bearing sensors decision, update or add an ADR under [../adrs](../adrs/) and keep backlinks current.
```

### `docs/sensors/CLAUDE.md`

```text
AGENTS.md
```

The text above is the committed symlink target. The file content resolves to the `AGENTS.md` body in normal clones, mirroring the root context pattern.

## Proposed Adoption Sequence

1. Add `.apss/config.toml` and document the repo-specific defaults.
2. Extend `harness/doc-validator` with a docs-wide EXP-V1-0004 mode, or add an APSS CLI wrapper if the upstream `aps` command becomes the preferred implementation.
3. Start with one low-risk directory, such as `docs/sensors`, and prove generated indexes, front matter parsing, and context-file validation.
4. Migrate remaining directories in small groups: `docs/standard`, `docs/harness-engineering`, `docs/gap-analysis`, then `docs/superpowers`.
5. Resolve ADR-specific edge cases: add front matter to ADR context files and decide where `_template.md` belongs under strict ADR01.
6. Wire stale index checking into `just doctor` first, then pre-push once the tree is clean.

## Recommendation

Adopt EXP-V1-0004 as a docs governance layer on top of the existing harness doc-validator slot. Do not replace the current doc-validator checks. Instead, add the parent-standard checks incrementally:

- Keep ADR01 enforcement in `docs/adrs` as the proven base.
- Use canonical `AGENTS.md` bodies with `CLAUDE.md` symlinks or mirrors per docs directory.
- Treat generated README indexes as the agent-facing navigation layer.
- Treat front matter as the machine-readable metadata layer.
- Use `.apss/config.toml` to pin the template's default surface and make downstream forks explicit.

This gives the template an agent-efficient documentation map without forcing agents to load all docs into context or relying on hand-maintained directory summaries.
