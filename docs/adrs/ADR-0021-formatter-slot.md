---
name: "Formatter slot — auto-fix staged files at commit time, swappable per language"
description: "Promote auto-formatting from an implicit lefthook command into a named, swappable slot in `harness.manifest.json`. Pre-commit runs the formatter against only the staged files and re-stages the result (lefthook `stage_fixed: true`), so the recorded commit always passes the same formatter check. Safe to hard-enforce because the operation is whitespace-equivalent and never blocks legitimate work."
status: accepted
---

<!--
ADR-0021 — closes the gap left by ADR-0003 (hooks slot wires lefthook) and
ADR-0010 (doc-validator slot) by giving the formatter the same first-class
treatment. Placement (lefthook pre-commit) and language-pair binding
(biome for JS/TS/JSON/MD/CSS/YAML, ruff for Python) are owned here.
-->

# ADR-0021: Formatter slot — auto-fix staged files at commit time, swappable per language

**Date:** 2026-06-10
**Category:** harness slots (`harness.manifest.json.slots.formatter`)
**Supersedes:** none (refines [ADR-0003](./ADR-0003-hooks.md) by promoting the formatter from an implicit lefthook command to a named slot)
**Next review:** 2026-12-10

## Context

The template ships two enforced formatters today:

| Languages                                  | Tool                       | Wiring                                              |
|--------------------------------------------|----------------------------|-----------------------------------------------------|
| JS / TS / JSON / JSONC / CSS / MD / YAML   | `biome check --write`      | `lefthook.yml` pre-commit `biome-format-lint` hook  |
| Python (`ws_apps/example-python`)          | `ruff format`              | `lefthook.yml` pre-commit `python-ruff-format` hook |

Both run on the staged set and rely on lefthook's `stage_fixed: true` to
re-add the rewritten files before the commit object is built. They are
already enforced in the sense that lefthook refuses the commit when the
formatter produces a non-zero exit (typically only on parse errors), and
the rewrites that *do* happen are silently absorbed by the same commit.

Until now the binding from "this template uses Biome + Ruff as
auto-fixing formatters" to "we will not break operator forks that swap
either tool" was implicit — it lived in the lefthook YAML and in
`harness/inspector/.../slot-contracts.md`, but `harness.manifest.json`
had no first-class `formatter` slot the way it has `secret-scanner`,
`doc-validator`, and `versioning`. That asymmetry made the formatter
look like a hook implementation detail rather than a swappable slot,
even though forks regularly want to swap (eg. ts-prettier for biome,
or black/blue for ruff).

The closed-loop fitness work in this branch ([ADR-0019](./ADR-0019-closed-loop-architectural-quality.md),
[ADR-0020](./ADR-0020-architectural-fitness-ratchet.md)) made the asymmetry
visible: an upward ratchet only tightens on quality wins, and a forked
fork that swapped Biome for Prettier without telling the manifest would
churn the ratchet through every commit because two formatters disagree
on trailing-comma policy. The formatter needs to be a named slot so the
ratchet (and any future tooling) can see which formatter a fork picked.

## Decision

Three related decisions, all accepted:

1. **`harness.manifest.json` gains a `formatter` slot.** The slot is
   `required: true` (every fork must have some formatter wired) and
   `swappable: true` (forks may replace the plugin). Default plugin is
   `biome+ruff`. The slot's `interface.type` is `config` and the
   `entrypoint` is `lefthook.yml`, mirroring the `hooks` slot — the
   formatter is wired through hook commands, not invoked as a top-level
   CLI.

2. **The formatter runs at pre-commit on the staged set only, with
   `stage_fixed: true`.** This is the fastest-tolerated feedback point
   for an auto-fixing tool: it runs before the commit object is built,
   it sees only the diff the operator is recording, and the rewritten
   files are re-staged so the recorded commit is already in canonical
   shape. The two member hooks (`biome-format-lint`,
   `python-ruff-format`) both pass `{staged_files}` to the underlying
   formatter and set `stage_fixed: true` so a fork that swaps a
   formatter has a copy-pasteable shape.

3. **Hard-enforce, no soft-skip wrappers.** Formatter rewrites are
   whitespace-equivalent — they never change program semantics — so a
   commit that fails the formatter fails it for one of two reasons: the
   file is a parse error (which the operator wants to know about) or
   the formatter binary is missing (which `pnpm exec` and `uv run`
   already wrap with a clear "command not found" exit). Both are
   actionable, so the formatter slot uses the same hard-enforce posture
   as `secret-scanner` rather than the soft-skip posture used by the
   slow gates (`cov-ts`, `sensors-gate`) that depend on heavyweight
   adapters.

## Consequences

- **Operator forks know exactly what to swap.** A fork that replaces
  Biome with Prettier needs to update one slot block in the manifest
  and one lefthook command; the rest of the harness (CI, ratchet, doc
  pipeline) treats the formatter as an opaque box behind the slot.
- **The fitness ratchet sees the formatter as a fixed input.** When
  the formatter slot's `plugin` field changes in the manifest, the
  baseline is expected to move (different formatter, different
  whitespace shape, different ts-morph readings). The `--update-baseline`
  escape hatch from [ADR-0020](./ADR-0020-architectural-fitness-ratchet.md)
  is the operator's audit trail for that move.
- **Pre-commit stays sub-2-second.** Both Biome and Ruff format only
  the staged set, so the marginal cost per commit scales with the
  diff, not the repo. The full-tree formatter scan is left to CI.
- **No new ADR backlog.** The formatter has been de facto enforced for
  months via `biome-format-lint`; this ADR just records the slot
  contract so future tooling and forks have a name to point at.

## Alternatives considered

- *Leave the formatter as an implicit lefthook command.* Rejected
  because the manifest already names ten slots; treating the
  formatter as the only un-named hook command makes it invisible to
  fork-readiness tooling.
- *Make the formatter slot run on the full repo at pre-commit.*
  Rejected because a 5,000-file Biome sweep takes 2-4 s and would
  punish every commit; the staged-set rewrite gives the same
  guarantee at constant cost.
- *Run the formatter at pre-push instead of pre-commit.* Rejected
  because the operator who staged the file is the one who can answer
  formatter questions; deferring to pre-push hides the rewrite in
  a separate session.

## References

- [ADR-0003-hooks.md](./ADR-0003-hooks.md) — selects lefthook as the
  hook plugin; this ADR rides on top.
- [ADR-0010-doc-validator.md](./ADR-0010-doc-validator.md) —
  parallel example of a slot that wraps a polyglot pipeline.
- [ADR-0020-architectural-fitness-ratchet.md](./ADR-0020-architectural-fitness-ratchet.md)
  — interacts with the formatter slot via the `--update-baseline`
  escape hatch when forks swap formatters.
- `harness.manifest.json` `slots.formatter` — the slot definition.
- `lefthook.yml` `pre-commit.biome-format-lint`,
  `pre-commit.python-ruff-format` — the wiring.
