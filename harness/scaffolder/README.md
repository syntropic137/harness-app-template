# `@harness/scaffolder` — `create-harness-app` MVP

Internal MVP of the `create-harness-app` scaffolder. The canonical design
spec lives at
[`docs/superpowers/specs/create-harness-app-scaffolder-design.md`](../../docs/superpowers/specs/create-harness-app-scaffolder-design.md);
this slot implements MVP phase v0.1 from spec section 8.

## What this is

A small Node CLI that turns the canonical template tree into a clean,
fork-ready project. It is the mechanical equivalent of "GitHub `Use this
template`, then `just init`, then delete the template-only artifacts":

1. Copy the canonical template into `<dest>`, excluding build/cache
   directories.
2. Strip the template-only paths listed in
   [`strip-list.json`](./strip-list.json) (per spec section 5).
3. Run `bun run scripts/init.ts <name> --no-verify` from `<dest>` to
   reuse the substitution engine in `scripts/init.ts` (rename example
   workspace members, write `.harness-provenance.json`, fix the root
   `pyproject.toml` name, fix the harness compose name, strip the
   `<!-- TEMPLATE-DOC-* -->` block from `README.md`).
4. Fresh `git init -b main` + one commit (unless `--no-git`).
5. Print a next-steps banner pointing at `just bootstrap` / `just qa` /
   `just fitness`.

The MVP is **internal only**. No `npm publish` step lands in this slot
and `harness/versioning/` is not touched. Publishing the CLI to npm is
operator-gated and deferred to a follow-up change.

## Usage

```sh
# Internal invocation (canonical template root resolved from the entry
# script location). Outputs ./my-app.
bun run harness/scaffolder/bin/create-harness-app.mjs my-app --yes

# Dry run: print the planned operations, no writes.
bun run harness/scaffolder/bin/create-harness-app.mjs my-app --yes --dry-run

# Skip the fresh git init in the destination.
bun run harness/scaffolder/bin/create-harness-app.mjs my-app --yes --no-git

# Help and version.
bun run harness/scaffolder/bin/create-harness-app.mjs --help
bun run harness/scaffolder/bin/create-harness-app.mjs --version
```

The MVP surface (spec section 8.1.5):

| Flag                   | Meaning                                                       |
|------------------------|---------------------------------------------------------------|
| `<name>`               | project name (`^[a-z0-9][a-z0-9-]{0,213}$`).                  |
| `--yes`, `-y`          | skip prompts; use defaults (current MVP default).             |
| `--dry-run`            | print the planned operations, no writes.                       |
| `--no-git`             | do not run `git init` in the destination.                      |
| `--version`, `-V`      | print the CLI version.                                         |
| `--help`, `-h`         | show help.                                                     |
| `--template-root <p>`  | override the template source root (testing / internal).        |
| `--dest <path>`        | destination directory. Default: `./<name>`.                    |
| `--strip-list <path>`  | override the `strip-list.json` location.                       |

Out of scope for the MVP (deferred to v2 per spec section 8.2):
interactive `prompts` flow, `--ref <tag-or-sha>` clone mode, slot
selection, `--template <id>`, `--print-license`, and the
`just branch-protection setup` recipe.

## Correctness oracle

The scaffolder's correctness contract is exactly the fork-readiness
invariant in
[`docs/superpowers/specs/2026-06-02-fork-readiness-design.md`](../../docs/superpowers/specs/2026-06-02-fork-readiness-design.md):
a freshly scaffolded project must pass `just bootstrap && just qa && just
fitness --quick` green from a clean checkout.

That contract is enforced by the `scaffolder-fork-check` CI job in
`.github/workflows/test.yml`: it runs the scaffolder against the current
checkout into a tmpdir, then runs `just bootstrap`, `just qa`, and
`just fitness --quick --format=summary` inside the generated project.
Because the scaffolder reuses `scripts/init.ts` and the gate set, this
job is symmetric with the existing `fork-check` job: anything that
breaks `fork-check` also breaks `scaffolder-fork-check`.

## Files in this slot

- [`bin/create-harness-app.mjs`](./bin/create-harness-app.mjs) — Node
  entrypoint (a few lines; dispatches to `scaffolder.mjs#main`).
- [`scaffolder.mjs`](./scaffolder.mjs) — implementation. All side
  effects (filesystem, spawn, process exit, env) are
  dependency-injected so the unit tests reach 100 percent coverage
  without real I/O.
- [`strip-list.json`](./strip-list.json) — paths stripped from the
  copied template before commit-zero (spec section 5).
- [`tests/scaffolder.test.ts`](./tests/scaffolder.test.ts) — vitest
  unit tests (100 percent coverage gate per
  [`vitest.config.ts`](./vitest.config.ts)).
- [`README.md`](./README.md) — this file.
