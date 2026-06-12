# create-harness-app scaffolder: design

- Date: 2026-06-12
- Status: design (operator review pending)
- Author: Claude Code (fable), on branch `docs/create-harness-app-scaffolder-spec`
- Supersedes (depth, not direction): [`ADR-0016 Create Harness App Wrapper`](../../adrs/ADR-0016-createapp-wrapper-design.md) (status: proposed). This spec keeps ADR-0016's direction and decisions, then extends it to implementation depth.

## Context

Two facts that drive every decision in this spec:

1. The GitHub repo [`syntropic137/create-harness-app`](https://github.com/syntropic137/create-harness-app) currently mirrors the full monorepo. It has no `bin/`, no `package.json#bin`, no `npx` front door. The "generator that turns this monorepo into a new project" does not exist yet.
2. The monorepo already ships a working in-repo onboarding flow: `just init <name>` (see [`scripts/init.ts`](../../../scripts/init.ts)) renames the example workspace members, rewrites `package.json` / `pyproject.toml` / compose names, writes `.harness-provenance.json`, runs `pnpm install` / `cargo check` / `uv sync`, and installs lefthook. `just fork-check` (see [`scripts/fork-check.ts`](../../../scripts/fork-check.ts)) snapshots HEAD into a temp dir and runs the documented onboarding plus the full gate suite, so we already have a deterministic answer to "is a fresh fork green?".

The missing piece is the entry-point: a user types `npm create harness-app@latest my-app` (or `npx create-harness-app my-app`) and lands on a clean project that is the moral equivalent of "GitHub `Use this template`, then `just init`, then delete the template-only artifacts". This spec designs that entry point.

## Goal

A user runs one command and gets a self-contained, fork-ready project that:

- Has no template-only artifacts (internal beads, launchpad-CI, in-flight gap analyses, this very spec, and so on).
- Has a fresh `git init` with one commit, no upstream pointer to the canonical template.
- Passes `just bootstrap && just qa && just fitness` green from the new directory, with the same fork-readiness bar that [`docs/superpowers/specs/2026-06-02-fork-readiness-design.md`](./2026-06-02-fork-readiness-design.md) defined.
- Carries the full architectural-fitness governance (the 9 APSS dimensions plus the ratchet, the fail-closed gates, the 12-slot manifest) so the generated project is itself canonical, not a stripped toy.

Non-goal for this spec: any change to the in-repo `just init` flow. The scaffolder is additive and uses `just init` internally; it does not replace it.

## Current state, summarised

| Thing                                  | Status today                                                                                  |
|----------------------------------------|-----------------------------------------------------------------------------------------------|
| Canonical monorepo                     | `syntropic137/harness-app-template` (this repo). Mirrored as `create-harness-app` repo too.   |
| In-repo onboarding                     | `just init <name>` works end to end; renamings + provenance + tool verify all wired.          |
| Fresh-clone gate                       | `just fork-check` (script `scripts/fork-check.ts`, CI job `fork-check` in `test.yml:314`).    |
| npx scaffolder                         | Does not exist. ADR-0016 approves the direction; no code yet.                                  |
| Template package on npm                | Not published.                                                                                |
| Slot count                             | 13 in manifest (added `profiling`); spec text on the standard often says 12 plus formatter.   |

## 1. Mechanism: how the scaffolder turns the template into a project

Three real options, in increasing complexity:

| Option | Description | Pros | Cons |
|---|---|---|---|
| A. `degit` / `giget` style tarball fetch (current ADR-0016 sketch) | Download GitHub tarball, extract, run substitutions, `git init`. | Tiny CLI, fast `npx` startup, no shelling out to `git clone`. CLI release is decoupled from template releases. | GitHub anonymous tarball rate limit (60/hr/IP). No partial-checkout: every fetch downloads the full template (~tens of MB). No way to pin a template version without a tag-aware fetcher. |
| B. Embedded template snapshot inside the npm package | Vendor the template into the published `create-harness-app` npm package; the CLI just copies its own bundled files into the destination. | Works offline, no rate limit, repeatable for a given CLI version. Zero network beyond `npm install`. | Couples template releases to npm-package releases. The npm tarball grows ~tens of MB. Diverges from the canonical repo unless the publish flow is mechanically tied to a template tag. |
| C. `git clone --depth=1 --branch=<tag>` of the canonical repo | Shell out to system `git`. | Cheap, well-understood, pins template to a tag. Supports any git transport including SSH. | Requires git on PATH (true for every realistic dev box). Brings the template's `.git/` along until we strip it. |

Recommendation: B (embedded template snapshot), with C (`git clone --depth=1`) as the documented escape hatch for the `--ref <tag-or-sha>` flag and for environments behind a proxy that cannot reach `registry.npmjs.org`. A (degit / GitHub tarball) is rejected as the default because the rate limit is a real foot-gun for an autonomous swarm that scaffolds many projects from one IP.

Why B beats A and C as default:

- The biggest hidden cost of any scaffolder is "the template moved while you were typing". B makes that impossible: for a given CLI version, the template is byte-identical for everyone on Earth, today, tomorrow, and after the canonical repo force-pushes. That property is worth the tarball weight.
- The npm install step is going to happen anyway (the user is calling `npm create`). Bundling the snapshot inside that npm install removes the second network round-trip.
- The "tied to a tag" property maps cleanly to the `versioning` slot already in this repo (`cocogitto`, `harness/versioning/`).

The publish-time sync between the canonical repo and the npm package is the hard problem; see §7.

## 2. CLI UX

The published package name is `create-harness-app` so that `npm create harness-app@latest <name>` resolves correctly. The same package also exposes the `create-harness-app` bin so that `npx create-harness-app@latest <name>` is identical.

### Invocations

```
npm create harness-app@latest my-app
npx create-harness-app@latest my-app
pnpm create harness-app my-app
```

All three resolve to the same `bin/create-harness-app.mjs` entry point.

### Surface

```
create-harness-app <name> [options]

Arguments:
  <name>                    project name; must match ^[a-z0-9][a-z0-9-]{0,213}$
                            (same validator as scripts/init.ts validateProjectName)

Options:
  --template <id>           template variant. Default and only initial value:
                            polyglot-monorepo. Reserved for future variants.
  --ref <tag-or-sha>        pin to a specific template ref. Default: the snapshot
                            shipped with this CLI version. Implies clone mode.
  --skip-install            skip the in-init pnpm/cargo/uv steps. Default: run.
  --no-git                  do not run git init in the destination. Default: init.
  --no-bootstrap            do not run just bootstrap. Default: do not run it
                            anyway; see §"Bootstrap handoff" below.
  --yes, -y                 skip all interactive prompts; use defaults.
  --dry-run                 print the planned file operations to stdout. No writes.
  --print-license           print the inherited template license and exit.
  --version, -V             print the CLI version (which pins a template snapshot).
  --help, -h                show this help text.
```

### Interactive prompts (when `--yes` is not set)

The CLI uses `prompts` (per ADR-0016) and asks at most four questions:

1. Project name (defaulted from positional, validated).
2. Destination directory (defaulted to `./<name>`; rejected if non-empty unless `--force`).
3. Which optional slots to keep:
   - inspector (Playwright; ~300 MB browser download on first use).
   - sensors (architectural fitness gates; ~10 MB Rust binary; recommended default ON).
   - profiling (hyperfine + CDP traces; recommended default OFF).
   - observability-stack (Docker compose; recommended default OFF unless user opts in).
4. Which `ws_apps` examples to keep: TypeScript / Python / Rust (any subset, default all three).

In `--yes` mode, all optional slots are kept and all three example apps stay. This matches the "canonical fork is the full thing" stance, see §3.

### Bootstrap handoff

The CLI does NOT run `just bootstrap` automatically. The final output is the next-steps banner:

```
created my-app at ./my-app

next:
  cd my-app
  just bootstrap     # one-time tool install + lefthook
  just qa            # workspace lint + typecheck + test
  just fitness       # READ-ONLY architectural-fitness report
```

Reason: `just bootstrap` is slow (90+ seconds), it shells out to `pnpm`, `cargo`, `uv`, may fail on missing tools, and hiding those failures behind one progress spinner produces the exact opaque-installation foot-gun ADR-0016 already calls out. The right place to fail loudly is in `just bootstrap`, not inside an npm `postinstall`. The user types one extra command and gets a real terminal showing what each tool is doing.

## 3. What a generated project includes

The generated project is the canonical template minus the template-only artifacts. It is NOT a minimal tier. Reason: the moat is the governance, not the slot inventory. Stripping sensors or doc-validator from the default scaffold would turn this template into "yet another monorepo starter", which it explicitly is not.

Concretely, the generated project includes:

- All 13 slots present in [`harness.manifest.json`](../../../harness.manifest.json): stack-manager, inspector, hooks, telemetry-sdk, observability-stack, sensors, profiling, agent-plugins, task-runner, secret-scanner, doc-validator, versioning, formatter.
- The full 9-dimension APSS fitness coverage (MT01, MD01, ST01, SC01, LG01, AC01, PF01, AV01, CV01). AC01 and AV01 stay advisory by design, per [`docs/sensors/dimensions-reference.md`](../../sensors/dimensions-reference.md).
- The fail-closed posture on every gate (coverage absent / malformed is hard-fail per PR #40; timing fail-closed per PR #31; secret-scanner fail-closed per ADR-0009; dep-audit fail-closed per ADR-0023).
- The baseline-relaxation guard (`harness/sensors/baseline_guard.mjs`).
- The ratchet behaviour (`ADR-0020-architectural-fitness-ratchet.md`) and the committed baseline at `harness/sensors/baseline.json`.
- The `lefthook.yml` pre-commit and pre-push hook set as-is, including the fitness summary line.
- The `.github/workflows/test.yml` workflow, including the `fork-check` job.
- The branch-protection setup as documented under [`ADR-0022 Merge gating`](../../adrs/ADR-0022-merge-gating.md), exposed as a one-shot `just branch-protection setup` recipe the user opts into after pushing the first commit (the scaffolder cannot apply branch protection during `npm create` because there is no remote yet).
- The full `docs/` tree from the canonical template, MINUS the template-only sub-trees (see §5).

The interactive prompt in §2 lets the user drop optional slots, but the default with `--yes` is "keep everything". The rationale is that the scaffolder cost of including a slot is one tarball entry; the cost of leaving it out is that the user has to re-derive its glue when they later want it.

## 4. Templating and parameterization

The scaffolder reuses `scripts/init.ts` as the substitution engine. Specifically, after copying the snapshot into the destination, the CLI executes the same logic that lives in `initProject`:

- Rename `ws_apps/example-typescript` -> `ws_apps/<name>-typescript` (and python, rust).
- Replace `@example/typescript` -> `@<name>/typescript` (and python, rust).
- Update `pyproject.toml` root name to `<name>-monorepo`.
- Update `harness/observability/compose.harness.yml` `name:` to `<name>`.
- Strip the `<!-- TEMPLATE-DOC-START -->...END -->` block from `README.md`.
- Remove `TEMPLATE.md` and `.github/ISSUE_TEMPLATE/template-question.md`.
- Write `.harness-provenance.json` with `mode: "fresh"`, `canonical_repo` set to the canonical template URL, `canonical_commit` set to the snapshot SHA (NOT the user's `HEAD` because there is no user commit yet), and `forked_at` set to now.

Why reuse instead of fork: keeping one substitution path means the `just init` flow (used by every existing fork) and the `npx` flow stay observably identical. The fork-check CI job already exercises `just init`; if the scaffolder calls the same code, fork-check is also our scaffolder regression test.

Mechanically, the CLI invokes `scripts/init.ts` as a child process via `bun run scripts/init.ts <name> --no-verify` (where `--no-verify` skips the in-init `pnpm install` / `cargo check` / `uv sync` because those belong to `just bootstrap`). `bun` is a hard dependency of every fork already (`bin/init` shebang); installing the CLI's `node_modules` brings `bun` along as an optionalDependency for environments that lack it.

Variables: project name is the only substitution input. The org name (for npm publish, GitHub remote, and so on) is intentionally not asked; the user wires the remote themselves after `git init`. This matches ADR-0016's "leave to the user to avoid opaque installation errors".

## 5. What to strip from the canonical monorepo for a clean project

The "canonical template" carries non-trivial template-only state. The scaffolder strips it after copy and before commit-zero. The strip list:

| Path                                                                 | Why strip                                                  |
|----------------------------------------------------------------------|------------------------------------------------------------|
| `.beads/`                                                            | Per-repo bead store. Generated projects start fresh.       |
| `.ntm/`                                                              | Local tmux session state. Never belongs in a fresh clone.  |
| `.cm/`, `.am-state/` (if present)                                    | Same: local agent broker state.                            |
| `TEMPLATE.md`                                                        | Template-only doc.                                         |
| `.github/ISSUE_TEMPLATE/template-question.md`                        | Template-only.                                             |
| `docs/gap-analysis/`                                                 | Template-only gap analyses against the lab.                |
| `docs/retrospectives/00*-*`                                          | Lab-evolution retros that do not apply to a fresh fork.    |
| `docs/superpowers/specs/`                                            | Template-only program docs (including THIS spec).          |
| `docs/standard/v0.1.md`                                              | Historical standard; keep v0.2 only.                       |
| `docs/evolution/`                                                    | Template's own evolution log.                              |
| `docs/standards-integration/` (review with operator)                 | Likely keep; these are normative APSS conformance docs.    |
| `experiments/`                                                       | Hypothesis-first probes from the template's own evolution. |
| The `<!-- TEMPLATE-DOC-START -->...END -->` block in `README.md`     | Already removed by `scripts/init.ts`.                      |
| `harness-engineering-gap-report.md` (root)                           | Template-only.                                             |
| `docs/harness-engineering-gap-report.md`                             | Template-only.                                             |

The strip list lives in source as `harness/scaffolder/strip-list.json`. The scaffolder reads it; the canonical repo's CI asserts every path in the strip list exists in HEAD (so a rename in the canonical repo cannot silently break the scaffolder). After strip, the scaffolder runs `scripts/doc-validator.mjs` against the stripped tree before commit-zero, to guarantee no link points at a stripped path.

Open question for operator (does not block the spec): do the in-tree skill audits under `docs/superpowers/` (skill-by-skill notes from bead n48.10) ship with the scaffolded project? Recommendation: no, those are template-internal; the upstream principle skills (referenced, not vendored) are what the fork actually consumes.

## 6. The hard problem: staying in sync with an evolving template

Three options:

| Option | Description | Where the drift lives |
|---|---|---|
| Sync-A. Pull `main` at install time. | The CLI fetches the canonical `main` tarball each time. | The user's resolved project depends on what `main` looked like at the second they ran the command. Two users running the same `create-harness-app@1.2.3` get different output. |
| Sync-B. Pinned snapshot per CLI release. | Each published CLI version embeds a frozen snapshot of a specific template commit. The CLI bin advertises `templateVersion` and `templateCommit` in its `--version` output. | Drift accumulates between template `main` and the last-published CLI. Mitigated by automation: a "publish CLI" GitHub Actions workflow watches `main` and cuts a new patch release whenever the canonical template tags a new release. |
| Sync-C. Publish-from-template CI on every tag. | The canonical repo's `versioning.yml` is the only place that publishes the CLI. Cutting `v0.5.0` on the template publishes `create-harness-app@0.5.0` to npm. The CLI repo on GitHub is regenerated from the template tag and is read-only. | None, by construction. The cost is that the CLI is no longer an independently versioned package. |

Recommendation: Sync-C with Sync-B as the implementation mechanism. The canonical template's `versioning.yml` calls `cocogitto` to compute the next semver, runs the existing release flow, then runs an extra step that builds a pruned-and-shrunk snapshot of `HEAD` and publishes `create-harness-app@<same-version>` to npm. The CLI's own repo at `github.com/syntropic137/create-harness-app` is removed in favour of generation-from-template; this matches [`ADR-0015 CHA Sync Source of Truth`](../../adrs/ADR-0015-cha-sync-source-of-truth.md) which already says the template is the canonical artifact and other repos are mirrors, not live sources.

Concrete mechanism:

1. The canonical template grows a new top-level directory `harness/scaffolder/` containing:
   - `bin/create-harness-app.mjs` (the CLI entry, ~200 LoC, uses `prompts` + `picocolors`).
   - `package.json` declaring `"name": "create-harness-app"`, `"bin"`, peerDeps as appropriate.
   - `strip-list.json` (see §5).
   - `tests/` with unit tests for the strip + substitute path and an integration test that runs the CLI end to end against a fixture.
2. The publish job (`.github/workflows/versioning.yml` or a sibling) on tag:
   1. Computes the snapshot: `git archive HEAD` minus `harness/scaffolder/strip-list.json` paths, plus the `harness/scaffolder/bin/` and `harness/scaffolder/package.json`.
   2. Validates the snapshot by running the existing `just fork-check` against it.
   3. Publishes to npm with provenance enabled (`npm publish --provenance`).
3. The CLI does NOT have its own GitHub repo. The npm package's `repository` field points back at this template repo.

This collapses "the scaffolder" from a separate-repo, separately-versioned project into a slot inside the canonical template. The result: a user installing `create-harness-app@x.y.z` is mechanically guaranteed to receive the bytes from template tag `vx.y.z`. There is no other shape that gives this property without continuous human attention.

## 7. Fork-readiness invariant

The bar is unchanged from [`docs/superpowers/specs/2026-06-02-fork-readiness-design.md`](./2026-06-02-fork-readiness-design.md): a freshly scaffolded project MUST pass `just bootstrap && just qa && just fitness` green from a clean clone. The scaffolder reuses the existing fork-check machinery (`scripts/fork-check.ts`) to enforce this:

- The CI job `fork-check` in `.github/workflows/test.yml:314` continues to run on every PR.
- A new CI job `scaffolder-fork-check` runs after `fork-check`: it builds the CLI, runs `node bin/create-harness-app.mjs scaffolder-smoke --yes` into a tmpdir, then runs `just bootstrap && just qa && just fitness --quick --format=summary` inside the generated project.
- Both jobs are required status checks on `main`, extending the [`ADR-0022 Merge gating`](../../adrs/ADR-0022-merge-gating.md) list.

The invariant is symmetric: anything that breaks `fork-check` also breaks `scaffolder-fork-check`, because both ultimately copy the same bytes and run the same gate. The scaffolder cannot regress the fork-readiness bar without the fork-readiness bar regressing first.

## 8. Phasing

### MVP (v0.1, target: cuttable from this template's next tag after the spec merges)

1. Land `harness/scaffolder/` containing the CLI, `strip-list.json`, and tests.
2. Add the `scaffolder-fork-check` CI job.
3. Add the publish-on-template-tag step to `versioning.yml`.
4. Publish `create-harness-app@<template-version>` to npm with provenance.
5. CLI surface (subset of §2): `<name>` positional, `--yes`, `--dry-run`, `--no-git`, `--version`, `--help`. No interactive prompts; no slot selection; no `--template <id>`; no `--ref`.
6. Default behaviour: every slot, every example app, fresh `git init` with one commit, next-steps banner with `just bootstrap` + `just qa` + `just fitness`.

Out of scope for MVP: any prompt UI beyond yes-mode defaults; clone-mode; template variants beyond `polyglot-monorepo`.

### v2 (target: after a real user runs MVP twice)

1. Add interactive `prompts` flow (§2).
2. Add `--ref <tag-or-sha>` and the `git clone --depth=1` mechanism (§1 option C) as the documented escape hatch for proxied environments and for pinning to a specific template SHA in research-mode forks.
3. Add slot selection (drop sensors, inspector, profiling, observability-stack at scaffold time). This requires `strip-list.json` to grow per-slot strip entries.
4. Add `--template <id>` if and only if a second template variant exists in this repo. Until then, the flag is reserved.
5. Add a `just branch-protection setup` recipe that runs `gh api` against the newly-created remote, applies the ADR-0022 required-status-checks list, and prints the resulting protection JSON for the user to commit as documentation.

## 9. Top 3 design recommendations (for operator review)

1. Move the scaffolder into the canonical template as a slot (`harness/scaffolder/`) and publish it from the template's own release CI on every tag. This collapses the "stay in sync" problem from "watch two repos and remember to release" to "follow the template's existing versioning slot". See §6.
2. Default to "include everything, run nothing": every slot and every example survives the scaffold; the CLI never runs `just bootstrap`; the final output is a three-line next-steps banner that puts `just bootstrap` and `just qa` and `just fitness` in the user's hand. See §2's bootstrap handoff and §3.
3. Reuse `scripts/init.ts` as the substitution engine; reuse `scripts/fork-check.ts` as the scaffolder's correctness oracle. The scaffolder is mechanically constrained to produce output observably equivalent to `Use this template + just init`, because both go through the same code. See §4 and §7.

## Decisions log

- 2026-06-12: Spec home is `docs/superpowers/specs/` (matches the existing fork-readiness design doc shape; doc-validator accepts any markdown file with resolvable links outside `docs/adrs/`). [author]
- 2026-06-12: Embedded snapshot (Mechanism B) is the default; clone-mode is the v2 escape hatch. [author]
- 2026-06-12: Scaffolder lives inside the canonical template as `harness/scaffolder/`, published from the template's own release CI. [author]
- 2026-06-12: Bootstrap is NOT run by the CLI; it stays a deliberate user action. [author]
- 2026-06-12: `scripts/init.ts` and `scripts/fork-check.ts` are reused, not re-implemented. [author]

## Pointers

- ADR predecessor: [`ADR-0016 Create Harness App Wrapper`](../../adrs/ADR-0016-createapp-wrapper-design.md).
- Sync ADR: [`ADR-0015 CHA Sync Source of Truth`](../../adrs/ADR-0015-cha-sync-source-of-truth.md).
- Fork-readiness program: [`2026-06-02-fork-readiness-design.md`](./2026-06-02-fork-readiness-design.md).
- Substitution engine: [`scripts/init.ts`](../../../scripts/init.ts).
- Correctness oracle: [`scripts/fork-check.ts`](../../../scripts/fork-check.ts).
- Slot manifest: [`harness.manifest.json`](../../../harness.manifest.json).
- Fitness dimensions: [`docs/sensors/dimensions-reference.md`](../../sensors/dimensions-reference.md).
- Merge gating reference: [`ADR-0022 Merge gating`](../../adrs/ADR-0022-merge-gating.md).
