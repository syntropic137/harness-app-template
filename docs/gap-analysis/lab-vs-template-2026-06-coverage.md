# Lab vs Template Gap Analysis: Test Coverage and CI Tooling

Date: 2026-06-02

Template repo: `/data/projects/harness-app-template`

Lab repo: `/data/projects/NeuralEmpowerment--agentic-harness-lab`

## Verdict

The template does not carry the lab's full test, coverage, hook, and CI setup. It carries several strong local declarations, especially 100% coverage thresholds in `vitest.config.ts`, `ws_apps/example-typescript/vitest.config.ts`, `ws_apps/example-python/pyproject.toml`, and `harness/inspector/vitest.config.ts`. The gap is enforcement breadth: the normal template CI only covers `scripts/tests` plus fitness gates, and local hooks do not run the lab's full per-language coverage and strict type gates.

## Verified Findings

### 1. QA command is missing in the template

Lab evidence:

- `justfile:97-110` has `typecheck`, `lint`, and `qa: typecheck test lint`.
- `package.json:9-12` has root `test`, `test:coverage`, `typecheck`, and `lint` scripts.

Template evidence:

- `justfile:15-19` has `test` and `lint`, but `just --list` shows no `qa` and no `typecheck`.
- `package.json:8-13` has `build`, `test`, `test:scripts`, and `lint`, but no root `typecheck` or `qa`.
- `scripts/test.ts` runs `pnpm turbo run test` and then script coverage. There is no equivalent `scripts/typecheck.ts` or QA composition.

Impact:

The lab has a single operator command for the local quality sweep. The template requires agents to know several separate entrypoints, and there is no top-level command that mirrors the lab's `qa` contract.

Filed bead: `create-harness-app-e5r` - Add template QA recipe and root typecheck command.

### 2. TypeScript coverage aggregation is weaker

Lab evidence:

- `vitest.workspace.ts:22-32` composes package-level Vitest configs.
- `vitest.config.ts:18-22` includes app, package, and `harness/stack` TypeScript sources.
- `vitest.config.ts:53-58` sets 100% lines, functions, branches, and statements.
- `package.json:10` defines `test:coverage`.
- `justfile:93-95` defines `test-coverage`.
- `lefthook.yml:123-128` runs `pnpm test:coverage` as pre-push `cov-ts`.

Template evidence:

- There is no `vitest.workspace.ts`.
- Root `vitest.config.ts:8-22` includes only `scripts/tests/**/*.test.ts` and coverage for `scripts/**/*.ts`.
- `ws_apps/example-typescript/vitest.config.ts` has a 100% threshold, and `harness/inspector/vitest.config.ts` has a 100% threshold, but the root `just test` path does not run `test:coverage` for those packages.
- `harness/stack/vitest.config.ts` has coverage include and reporter settings but no threshold.
- `lefthook.yml` has `scripts-coverage`, but no `cov-ts` command that runs a workspace TypeScript coverage gate.

Impact:

The template protects scripts coverage, but it does not aggregate and enforce TypeScript package coverage the way the lab does. Existing protected package thresholds can be bypassed by normal template CI because `vitest run` without `--coverage` does not evaluate coverage thresholds.

Filed bead: `create-harness-app-k2n` - Add TypeScript workspace coverage gate for template packages.

### 3. Rust coverage gates are missing

Lab evidence:

- `Cargo.toml:31-39` defines workspace coverage metadata.
- `justfile:231-279` has `cov-rust`, `cov-doc-validator`, `cov-versioning`, `cov-sensors`, and `cov-py`.
- `lefthook.yml:131-138` runs `just cov-rust` when `cargo-llvm-cov` is available.
- `harness/doc-validator/Cargo.toml` and `harness/versioning/Cargo.toml` both declare 100% line and function coverage metadata.
- `harness/sensors/Cargo.toml` declares 95% line and 94% function coverage metadata.

Template evidence:

- Root `Cargo.toml` only lists `ws_apps/example-rust` as a workspace member and has no workspace coverage metadata.
- `harness/versioning/Cargo.toml` has 100% metadata, but there is no `just cov-versioning` recipe and no CI coverage step for it.
- `harness/doc-validator/Cargo.toml` has no coverage metadata.
- `justfile` has only a passthrough `cargo *args` recipe.
- `.github/workflows/versioning.yml` runs `cargo test --manifest-path harness/versioning/Cargo.toml`, not `cargo llvm-cov`.
- `lefthook.yml` has no `cov-rust`, `cov-doc-validator`, or `cov-versioning` command.

Impact:

Rust tests run, but line and function coverage thresholds are not enforced for the template Rust example or Rust harness slots.

Filed bead: `create-harness-app-9bd` - Add Rust llvm-cov gates for template Rust crates.

### 4. Python strict type and coverage gates are declared but not fully wired

Lab evidence:

- `apps/api-py/pyproject.toml` sets `--cov-fail-under=100` and strict mypy settings.
- `justfile:271-279` defines `cov-py`.
- `lefthook.yml:46-58` runs `ruff check`, `ruff format --check`, and `mypy` for staged Python files.
- `lefthook.yml:141-149` runs `just cov-py` when `uv` is available.

Template evidence:

- `ws_apps/example-python/pyproject.toml` sets `--cov-fail-under=100` and strict mypy settings.
- `ws_apps/example-python/package.json:6-10` has `typecheck` as `uv run python -m compileall src tests`, not mypy.
- `ws_apps/example-python/package.json:9` has `lint` as `uv run ruff check .`, but the template hook does not have Python-specific ruff or mypy staged checks.
- `lefthook.yml` has no `cov-py` command.
- `.github/workflows/test.yml` does not run the Python package.

Impact:

The Python example contains the right policy in `pyproject.toml`, but strict typing and coverage are not enforced by the template's top-level local or CI paths.

Filed bead: `create-harness-app-36o` - Add Python mypy and coverage gates for example-python.

### 5. Template CI is scripts-only plus fitness, not full workspace QA

Lab evidence:

- `.github/workflows/ci.yml:24-63` runs Biome lint, `pnpm -r typecheck`, `pnpm -r test`, and scaffolder coverage on both `ubuntu-latest` and `macos-latest`.
- `.github/workflows/ci.yml:65-109` dogfoods the harness sensors gate with the built Rust binary and patched sentrux.
- `.github/workflows/template-smoke.yml:31-98` scaffolds a project on both Linux and macOS, then tests generated Node, Rust, and Python examples.

Template evidence:

- `.github/workflows/test.yml:8-21` has a single `scripts` job that installs dependencies and runs `pnpm exec vitest run scripts/tests --coverage`.
- `.github/workflows/test.yml:23-40` has a `fitness` job for sensors and perf.
- The workflow does not run `pnpm turbo run lint`, `pnpm turbo run typecheck`, `pnpm turbo run test`, `just qa`, Rust coverage, Python coverage, or package TypeScript coverage.
- The workflow only runs on `ubuntu-latest`.

Impact:

The template's CI misses failures that the local `pnpm turbo run test` path can catch, and it misses package lint/typecheck surfaces entirely. It also lacks the lab's macOS parity signal.

Filed bead: `create-harness-app-3nr` - Expand template CI beyond scripts-only checks.

## Not Counted as Gaps

- The template does have a 100% root coverage threshold for `scripts/**/*.ts` in `vitest.config.ts`.
- The template does have 100% coverage declarations for the TypeScript example and inspector slot.
- The template does have 100% Python coverage policy in `ws_apps/example-python/pyproject.toml`.
- The template does have Rust lint policy in `ws_apps/example-rust/Cargo.toml`, `harness/doc-validator/Cargo.toml`, and `harness/versioning/Cargo.toml`.
- The template has extra gates that were added after the lab comparison surface, including `doc-validator`, `sensors-gate`, `perf-gate`, `ubs-diff`, and `versioning-release-check` in `lefthook.yml`, plus `.github/workflows/versioning.yml`.
- The lab's `template-smoke.yml` validates the lab scaffolder output. The template is already the generated output, so the analogous missing signal is not another scaffolder workflow; it is CI coverage for the template's own example apps and harness packages.

## Filed Beads

| Bead | Gap |
| --- | --- |
| `create-harness-app-e5r` | Add template QA recipe and root typecheck command |
| `create-harness-app-k2n` | Add TypeScript workspace coverage gate for template packages |
| `create-harness-app-9bd` | Add Rust llvm-cov gates for template Rust crates |
| `create-harness-app-36o` | Add Python mypy and coverage gates for example-python |
| `create-harness-app-3nr` | Expand template CI beyond scripts-only checks |
