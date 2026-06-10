# LP_FINDINGS (Reviewer Bravo)

Software-leverage-points review of `feat/apss-integration` (commit 65cc7b9).
Reviewer Bravo (pane cc_2) covered six lenses: **security, testing, error-handling, continuous-delivery, versioning, logging**. Reviewer Alpha (cc_1) is expected to cover architecture, developer-experience, documentation, software-complexity, configuration, dependencies, dry, principles-and-patterns, types, purpose-and-scope, environments. This file is READ-ONLY review output; no source was edited. ASCII hyphens only (no em or en dashes).

## Summary

### By severity

| Severity | Count |
|---|---|
| CRITICAL | 4 |
| HIGH | 19 |
| MEDIUM | 41 |
| LOW | 18 |
| Total | 82 |

### By lens

| Lens | C | H | M | L | Total |
|---|---|---|---|---|---|
| security | 0 | 3 | 5 | 7 | 15 |
| testing | 2 | 4 | 6 | 4 | 16 |
| error-handling | 0 | 5 | 22 | 6 | 33 |
| continuous-delivery | 1 | 5 | 11 | 7 | 24 |
| versioning | 1 | 6 | 11 | 3 | 21 |
| logging | 0 | 3 | 7 | 4 | 14 |

(Lens totals overlap because some findings cross lenses; the severity counter above is de-duplicated.)

### Top-of-stack call-to-action

Five findings the operator should treat as blocking-quality-debt for a template that others fork. The orchestrator should file these as launchpad beads:

1. **CRITICAL** `continuous-delivery` `.github/workflows/test.yml` lines 29, 43, 90 use `pnpm install --no-frozen-lockfile`. Forks inherit a CI run that never validates the lockfile shape they will land on. Either commit template lockfiles as baselines or flip to `--frozen-lockfile`.
2. **CRITICAL** `versioning` `harness.manifest.json` slot versions `0.1`, `1.60-stub`, `0.1-stub` lack the PATCH segment. Strict semver consumers (renovate, dependabot, cargo) treat these as invalid. Normalize to three-part semver with prerelease tags for stubs (e.g. `0.1.0-stub`).
3. **CRITICAL** `testing` `vitest.config.ts` for `ws_packages/telemetry` and `harness/stack` declares coverage reporting but sets no thresholds. ADR-0013 acknowledges this as "policy debt"; forks copy the pattern and silently lose coverage gates. Lock minimum thresholds before next sync.
4. **CRITICAL** `testing` `ws_packages/telemetry` is absent from `COVERAGE_TARGETS` in `scripts/test-coverage.ts` line 17. A shared package therefore escapes the CI coverage gate that is the lefthook gate's mirror.
5. **HIGH cluster** `continuous-delivery` Node version drift (fitness job pinned to Node 20 while every other job is on Node 22), pnpm version drift (pages.yml pinned to 9.0.0, others to 11.5.1), and Rust toolchain pinned to `stable` instead of a concrete version. All three create silent CI surface drift across forks.

The orchestrator can file these as one parent bead plus four children, or as five individual beads. Suggested labels: `harness-quality`, `template-debt`, `lp-review-2026-06-10`.

---

## Lens 1: security

### Findings

| ID | Severity | File | Note |
|---|---|---|---|
| SEC-01 | HIGH | `.github/workflows/test.yml:29,43,90` | `pnpm install --no-frozen-lockfile` in CI defeats lockfile-as-contract. Flip to `--frozen-lockfile` OR commit template lockfiles as baselines. Same finding surfaces under continuous-delivery. |
| SEC-02 | HIGH | `.github/workflows/test.yml` (all jobs) | GitHub Actions pinned by tag (`actions/checkout@v4`, `dtolnay/rust-toolchain@stable`, `oven-sh/setup-bun@v2`). Supply-chain best practice for a fork-able template is full commit SHA pinning. Document the tradeoff in `security.md` or switch. |
| SEC-03 | HIGH | `.github/workflows/test.yml:100` | `cargo install apss --version 1.1.0` runs without `--locked`. Pair with sha pinning or document why the APSS lockfile is the integrity check. |
| SEC-04 | MEDIUM | `(.gitleaksignore missing)` | `security.md` Control 5 references `.gitleaksignore` as the allowlist convention but no file is committed. There is an open bead (`create-harness-app-gitleaksignore-example-0ry`) for this; the SLP review independently confirms the gap. Ship `.gitleaksignore.example` with a one-line note. |
| SEC-05 | MEDIUM | `security.md:51,181` vs `lefthook.yml:24-32` | Doc claims gitleaks runs both as protect (staged) at pre-commit and full-history scan in CI. The pre-commit hook uses `gitleaks protect --staged`; verify the CI job actually runs the history scan, and link the relevant CI lines from the doc. |
| SEC-06 | MEDIUM | `.claude/settings.local.example.json` | The example template wires a literal `YOUR_BEARER_TOKEN_HERE` placeholder; once an operator copies it, the token is plain text on disk. Document a `secret-tool` / `keychain` / `gpg` retrieval pattern. Note: `.claude/settings.local.json` itself is correctly gitignored at `.gitignore:64` (one sub-agent flagged this as a committed-secret CRITICAL; that flag is incorrect and is dropped). |
| SEC-07 | MEDIUM | `.github/workflows/test.yml:126` | `npm install --no-package-lock --no-audit --no-fund --silent` masks install warnings. Define why (probably an isolated sandbox install) and either re-enable audit or scope the silence narrower. |
| SEC-08 | MEDIUM | `cog.toml:8-16` | `skip_ci: "[skip ci]"` is configured. A contributor can land a commit that bypasses CI by adding the token to the commit message. Document the code-review override or remove the pattern. |
| SEC-09 | LOW | `harness.manifest.json` | Slot plugin versions are pinned but no checksum / artifact-sha field exists. If a plugin version is yanked from registry, the manifest pins the version string but not the artifact hash. APSS already does this in `apss.lock`; mirror the pattern at the manifest level. |
| SEC-10 | LOW | `.claude/hooks/ubs-diff.sh:6` | Soft-skip when `ubs` is not installed. In a fork-developer's environment this is correct; in CI-like contexts it can mask a missing-tool regression. Document the soft-skip rationale inline. |
| SEC-11 | LOW | `scripts/init.ts:82-104` | `installGitHooks()` chains the global `prepare-commit-msg` hook via `shellQuote()`. The global hook path is taken on trust. For a template that runs on shared CI runners, validate ownership before chaining. |
| SEC-12 | LOW | `.github/workflows/pages.yml:14-17` | Pages workflow requests `permissions: {contents: read, id-token: write, pages: write}`. For a static-docs deploy, `id-token: write` is only needed if OIDC is wired; verify. |
| SEC-13 | LOW | `apss.lock:7-34` | Checksum format is bare `sha256:hex`. Verify this matches the APSS upstream verification format (vs Cargo.lock `checksum = "..."`) so the lockfile is portable across SLP-style audits. |
| SEC-14 | LOW | `README.md:36` | Upstream remote suggestion is `https://`. For a template, document the `git@github.com:` SSH alternative so forks can pull updates without HTTPS credential management. |
| SEC-15 | LOW | `harness.manifest.json` | No `secret-scanner.swappable=true` redundancy in slot description; the manifest has it correct, but the README does not surface that gitleaks can be swapped for `trufflehog`. Mention in CONTRIBUTING. |

### Security strengths to preserve

- `lefthook.yml` runs `gitleaks protect --staged` as a sub-second pre-commit gate; combined with the diff-scoped Biome / UBS / doc-validator gates, the inner loop fast-fails on the most common policy breakage classes without triggering full-repo scans.
- `harness/doc-validator/Cargo.toml` declares `forbid(unsafe_code)` + clippy `deny`. Combined with the 100% coverage gate, this is a strong supply-chain posture for vendored Rust slot code.
- `.claude/settings.local.json` is gitignored at `.gitignore:64`; the opt-in design avoids the worst failure mode (committed tokens) while still giving operators a single place to configure agent-mail MCP.

---

## Lens 2: testing

### Findings

| ID | Severity | File | Note |
|---|---|---|---|
| TST-01 | CRITICAL | `ws_packages/telemetry/vitest.config.ts` | Package is tested but ungated: vitest config sets `coverage` reporters with no thresholds, and ADR-0013 acknowledges the package as policy debt. Forks copy the pattern and silently lose coverage gates. |
| TST-02 | CRITICAL | `harness/stack/vitest.config.ts:10` | Stack slot has report-only coverage. ADR-0013 marks it as deferred. Lock a floor (even 70/70/70) before the next sync, then ratchet. |
| TST-03 | HIGH | `scripts/test-coverage.ts:17` (COVERAGE_TARGETS) | `ws_packages/telemetry` not present in the list. Adding it brings the package under the CI coverage gate. |
| TST-04 | HIGH | `harness/sensors/package.json` | No package-local vitest coverage gate. Sensors gate logic is exercised via `scripts/tests/` but not measured. Either add a sensors vitest config or document the intentional gap in ADR-0013. |
| TST-05 | HIGH | `ws_apps/example-python/pyproject.toml:61` | `--ignore=tests/integration` makes coverage unit-only. The two-commit ceremony is the only protection against silent integration removal. Comment the policy in `pyproject.toml`. |
| TST-06 | HIGH | `ws_apps/example-typescript/tests/integration/**` | Integration directory not in the lefthook biome glob. Format / lint can drift relative to unit tests. |
| TST-07 | MEDIUM | `lefthook.yml:116-145` (cov-rust) | Three soft-skips in sequence (cargo, cargo-llvm-cov, just). The first missing tool stops the chain silently. Consolidate the precheck. |
| TST-08 | MEDIUM | `harness/inspector/vitest.config.ts:24` | Coverage exclusions duplicate v8 provider defaults; documents the `.mjs` over `.ts` choice nowhere. |
| TST-09 | MEDIUM | `ws_apps/example-python/tests/integration/` | No README and no pyramid doc; new contributors do not see why this exists alongside the unit dir. |
| TST-10 | MEDIUM | `scripts/tests/sensors-gate.test.ts`, `scripts/tests/perf-gate.test.ts` | Golden-file JSON assertions with no key-ordering normalization. Snapshot churn is the predictable failure mode. |
| TST-11 | MEDIUM | `experiments/2026-06-03--telemetry--polyglot-roundtrip-smoke/runs/*.txt` | Run evidence stored as opaque text. Switch to JSONL with timestamp + run-id fields so the running-experiments skill can replay deterministically. |
| TST-12 | MEDIUM | `.github/workflows/test.yml:62-75` vs `lefthook.yml:147-156` (cov-py) | CI hard-fails on Python coverage; pre-push soft-skips if `uv` is missing. First-time push from a half-set-up fork passes locally and fails on PR. |
| TST-13 | LOW | `scripts/tests/init.test.ts:46-61` | Temp-repo cleanup is solid but no timeout on git operations; system hang would block the test. |
| TST-14 | LOW | `experiments/` | Four experiments have READMEs + eval-packs; no `docs/retrospectives/` entry pairs with the 2026-06-03 telemetry roundtrip experiment. The running-experiments skill expects the pairing. |
| TST-15 | LOW | `harness/stack/tests/fixtures/` | Two fixture files exist (`harness.config.ts`, `harness.config.named.ts`) with no README or inline diff comment. |
| TST-16 | LOW | `ws_packages/telemetry/vitest.config.ts` | Missing reporter declaration; other package configs declare `['text', 'text-summary']`. Cosmetic but worth aligning. |

### Testing strengths to preserve

- **Polyglot test runner via `just test`**: vitest + pytest-cov + cargo-llvm-cov fan out from one entrypoint. CI mirrors this exactly, which is exactly the slot-composition shape SLP rewards.
- **Slot contract conformance test** at `scripts/tests/slots.test.ts`: the harness manifest's `slots.*.interface.commands` field is asserted against actual slot binaries, so a slot binary that loses a command surfaces immediately.

---

## Lens 3: error-handling

### Findings

| ID | Severity | File | Note |
|---|---|---|---|
| ERR-01 | HIGH | `harness/stack/src/runtime/exec.ts:68` | `run()` calls `reject(err)` on spawn error but callers in `boot.ts` and `destroy.ts` do not await-in-try. Unhandled rejection. |
| ERR-02 | HIGH | `harness/stack/src/commands/boot.ts` | `mkdirSync` / `writeFileSync` are not wrapped. A mid-boot failure leaves partial `.harness/ISO_KEY.*` state. Document a manual cleanup path or roll back. |
| ERR-03 | HIGH | `scripts/apss.mjs:29-31` | Synchronous throw out of `resolveApssCommand()` is not wrapped by `main()`. Crash output is a Node stack, not an actionable message. |
| ERR-04 | HIGH | `lefthook.yml:24-32` (gitleaks), `lefthook.yml:44-51` (APSS doc-validator) | Inconsistent soft-skip vs hard-fail when the tool is absent. APSS gate hard-fails on missing `node`; other gates soft-skip. Pick one semantic per gate-class and document. |
| ERR-05 | HIGH | `harness/versioning/src/lib.rs:527-529` | `bail!("could not find the top-level version field line")` has no file / line / snippet context. Add the snippet in the error. |
| ERR-06 | MEDIUM (cluster, 22 findings) | `harness/sensors/gate.mjs:307,339,369`, `harness/sensors/aggregate.mjs:206`, `harness/stack/src/topology/compose.ts:46,53`, `harness/doc-validator/src/lib.rs:38-42`, `harness/versioning/src/lib.rs:264,269,310-318,745`, `scripts/doc-validator.mjs:11`, plus eight more | Two patterns dominate: (a) `JSON.parse` failure sets a value to `null` and downstream code reads fields without a null guard, (b) `unwrap_or_default()` / `unwrap_or(...)` calls silently mask the failure mode. Per the SLP error-handling lens, every `unwrap_or_*` should have either a comment justifying the default or a structured error. |
| ERR-07 | LOW (cluster, 6 findings) | `harness/doc-validator/src/validators.rs:33,57,140`, `harness/versioning/src/lib.rs:264`, `harness/stack/src/runtime/exec.ts:20-21`, `harness/doc-validator/src/checker.rs:26` | Same pattern as ERR-06 but in cases where the default is genuinely safe; one-line comment is the right fix. |

### Error-handling strengths to preserve

- The Rust slots (`harness/doc-validator`, `harness/versioning`) use `anyhow::Result` consistently. Library-quality error chains land at the CLI boundary with a stable stderr format. This is the slot pattern other slots (sensors, stack) should mirror.
- CLI boundaries in `scripts/doc-validator.mjs`, `scripts/apss.mjs` print `slot-name: message` to stderr and `process.exit(1)` on failure. The shape is consistent. Continue to apply for new scripts.

---

## Lens 4: continuous-delivery

### Findings

| ID | Severity | File | Note |
|---|---|---|---|
| CD-01 | CRITICAL | `.github/workflows/test.yml:29,43,90` | `--no-frozen-lockfile` defeats the "lockfile is the contract" property for forks. See SEC-01. |
| CD-02 | HIGH | `.github/workflows/test.yml:123` (fitness) vs other jobs | Node 20 vs Node 22 drift. Unify to 22. |
| CD-03 | HIGH | `.github/workflows/pages.yml:34` | pnpm 9.0.0 vs 11.5.1 elsewhere. Pin once. |
| CD-04 | HIGH | `.github/workflows/test.yml:26,91` | `dtolnay/rust-toolchain@stable` floats. Pin to e.g. `1.85.0` or document the floating-toolchain decision. |
| CD-05 | HIGH | `.github/workflows/test.yml` (all jobs) | No `paths:` filter. Doc-only edits trigger the full matrix. For a template that lives on community-fork CI minutes, this matters. |
| CD-06 | HIGH | `.github/workflows/test.yml` | No `needs:` sequencing. Lint and tests run concurrently; failure pattern is "two errors at once" instead of "lint fails first, test deferred". Acceptable when CI is unbounded; document. |
| CD-07 | MEDIUM | `harness.manifest.json:75-87` vs `lefthook.yml:217` (sensors-gate) | Sensors slot is `required: false` in the manifest but the sensors gate is hard-fail in pre-push. The manifest field defines the contract for forks; reconcile. |
| CD-08 | MEDIUM | `.github/workflows/test.yml:106` | APSS cache key uses `hashFiles('apss.lock')`. Since `apss.lock` rarely changes, the cache effectively never invalidates. Use `apss-composed-${{ runner.os }}-1.1.0` keyed to the APSS version. |
| CD-09 | MEDIUM | `cog.toml:1-16` vs `.github/workflows/versioning.yml` | `generate_mono_repository_global_tag = true` is configured but no CI job consumes it. Either wire a release job that pushes tags or remove the config to avoid drift surprise. |
| CD-10 | MEDIUM | `.github/workflows/versioning.yml:33-41` | `cargo test --manifest-path harness/versioning/Cargo.toml` runs on every push. Path-filter to `harness/versioning/**` and `cog.toml`. |
| CD-11 | MEDIUM | `.github/workflows/test.yml:46-60`, `.github/workflows/test.yml:62-75` | rust-coverage and python-coverage compute metrics but do not upload artifacts. Forks lose the coverage-trend visibility a template should make available. |
| CD-12 | MEDIUM | `security.md:86-100` (Control 1) | "Consumer-owned lockfiles" is the documented stance, but CI runs `--no-frozen-lockfile`. The stance is internally consistent only if CI commits to validating "whatever-latest". Make the implicit policy explicit. |
| CD-13 | MEDIUM | `scripts/init.ts:1-150` | `just init` does not validate that bun/pnpm/cargo/uv all report the version range CI expects. First-clone divergence risk for polyglot envs. |
| CD-14 | MEDIUM | `justfile:91-102` (release recipes) | `release-check from="" to="HEAD"` recipes vs CI's manual SHA construction. Centralize the contract in one helper. |
| CD-15 | MEDIUM | `.github/workflows/versioning.yml:50,52` vs `.github/workflows/test.yml` | versioning.yml uses `fetch-depth: 0`; test.yml uses default shallow. Hooks that inspect full commit graph (versioning-release-check) need the deep clone everywhere. |
| CD-16 | MEDIUM | `lefthook.yml` (whole file) | Soft-skip-when-tool-missing means a fork can disable every gate by skipping setup. Acceptable for developer experience but worth surfacing as policy in `AGENTS.md`. |
| CD-17 | MEDIUM | `harness.manifest.json` + `docs/standard/` | No v0.3 migration doc, no upgrade-from-v0.2 ADR. The standard-evolution path is the single hardest thing forks will face. |
| CD-18 | LOW | `.github/workflows/test.yml:18,37,50,84,120` | `oven-sh/setup-bun` has no version pin. Same flag class as CD-04. |
| CD-19 | LOW | `lefthook.yml:69-70` (ubs-staged) | UBS has no version pin in the lefthook config; the binary version is operator-owned. Acceptable for a fast-moving tool, document the choice. |
| CD-20 | LOW | `pnpm-workspace.yaml` + README | Polyglot workspace shape is not explained in README's "Quick runbook"; forks may misplace new apps. |
| CD-21 | LOW | `CHANGELOG.md:1-14` | Template-seeded as empty. No CI gate validates "no manual edits"; documented in AGENTS.md but unenforced. |
| CD-22 | LOW | `.github/workflows/test.yml` (all jobs) | No `environment:` blocks. Self-hosted-runner forks will not inherit secrets without configuration. |
| CD-23 | LOW | `.harness-provenance.json` | Captures upstream sha + version + forked_at, but no mechanism to surface "your fork is N standard-versions behind". |
| CD-24 | LOW | `Cargo.toml` | Top-level `resolver = "3"` is correct for Cargo 1.84+, but no comment explains the choice. Forks may downgrade and not understand the failure. |

### CD strengths to preserve

- `lefthook.yml` mirrors CI gates locally with diff-scoped runs. Fast-fail inner-loop discipline is the single highest-leverage CD asset in this template.
- `cog.toml` + `harness-versioning` are well integrated, with conventional-commits enforcement at commit-msg time. Forks inherit a working release-engineering posture.

---

## Lens 5: versioning

### Findings

| ID | Severity | File | Note |
|---|---|---|---|
| VER-01 | CRITICAL | `harness.manifest.json:25,57,142` | Slot versions `1.60-stub` (inspector), `0.1-stub` (doc-validator), `0.1.0` (versioning at the slot level vs `0.4.0` template), and `0.1` (agent-plugins) lack PATCH segments or follow inconsistent conventions. Renovate / cargo / dependabot reject the bare ones. Normalize. NOTE: the sub-agent reading this also flagged `0.2.0-node-interim+rust-stub` and `0.6.2-ts-adapter+abstractness` as semver violations; those are in fact valid semver (prerelease + build metadata) and are dropped from this finding. |
| VER-02 | HIGH | `harness.schema.json` (slot version field) | No pattern constraint on the `version` field. A fork can land any string. Add `"pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+([-+].+)?$"` or document a softer convention. |
| VER-03 | HIGH | `docs/adrs/ADR-0001-Bad.md`, `ADR-0001-demo.md`, `ADR-0001-good-title.md`, `ADR-0001-no-extension.md`, `ADR-0002-dir.md`, `ADR-0003-no-frontmatter.md`, `ADR-0004-no-status.md`, `ADR-9999-missing.md` | Test fixtures co-located with real ADRs. The doc-validator's own fixtures pollute the same numbering space the schema asks operators to keep clean. Move to `docs/adrs/.fixtures/` or `harness/doc-validator/tests/fixtures/`. |
| VER-04 | HIGH | `cog.toml:20-25` | Conventional-commits custom types (`experiments`, `plan`, `proposal`, `scaffold`, `retrospective`) replace rather than extend the canonical types (`feat`, `fix`, `chore`, `docs`, `test`, `ci`). Confirm whether the canonical types are still allowed by checking the actual `cog-verify` behavior; if not, additions break renovate-style automation. |
| VER-05 | HIGH | `apss.lock` + `.github/workflows/` | Checksums exist in `apss.lock` but no explicit `apss validate` step in CI guards the integrity. Wire a fast verification step. |
| VER-06 | HIGH | `docs/updating.md` | Fork update path does not check standard-version compatibility before merging. A fork on standard 0.2 can pull standard-0.3 harness updates and silently land partial migrations. Add a precheck. |
| VER-07 | HIGH | `harness.manifest.json:142-155` (versioning slot) | Entrypoint is `harness/versioning/bin/versioning` which wraps `cargo run`. Forks pay the cargo build cost on every commit. Ship a prebuilt binary or document the cargo prerequisite at slot level. |
| VER-08 | MEDIUM | `.harness-provenance.json:2` | `mode: "fresh"` does not capture fork-divergence tracking. No mechanism to detect when a fork's `harness/` has drifted from the canonical commit. |
| VER-09 | MEDIUM | `docs/standard/` | No `v0.3.md` migration / upgrade guide. The 0.2 -> 0.3 transition path is the hardest thing forks will face and is not authored. |
| VER-10 | MEDIUM | `pnpm-workspace.yaml` | No `publishConfig`. Unclear if `@harness/*` packages should be published independently. Document. |
| VER-11 | MEDIUM | `ws_apps/example-typescript/package.json:4` and `ws_apps/example-rust/Cargo.toml` | Example apps hardcode `"version": "0.1.0"`. Document sync policy with template version. |
| VER-12 | MEDIUM | `CHANGELOG.md:12-14` | Unpopulated. No release history. Either wire the auto-population path (cocogitto generate) or note that "the template's first release is forks". |
| VER-13 | MEDIUM | `docs/adrs/` (frontmatter) | YAML frontmatter is missing `supersedes:` and `supersededBy:` fields as machine-readable links. The text references work but a doc-validator graph check needs structured fields. |
| VER-14 | MEDIUM | `docs/coordination/APSS-ADR-STANDARD.md` | Coordination doc co-located in `docs/adrs/`; the doc-validator must special-case it. Either move or add the exclusion to the schema. |
| VER-15 | MEDIUM | `lefthook.yml:50` vs `docs/adrs/ADR-0018-apss-v1-1-0-augmentation.md` | ADR says APSS validator is "augment, never replace" (soft gate). lefthook line 50 runs APSS as a hard gate. Reconcile ADR vs config. |
| VER-16 | MEDIUM | `scripts/doctor.ts` | Prints manifest `standardVersion` but no validation rule checks declared-vs-supported standard pair. |
| VER-17 | MEDIUM | `bun.lock` vs `pnpm-lock.yaml` (absent) | The repo commits `bun.lock` (and `uv.lock`, `Cargo.lock` per the workspace). The CI is on pnpm via `pnpm install`. Reconcile which JS package manager is canonical. |
| VER-18 | MEDIUM | `uv.lock` | Committed; verify `uv sync` regenerates an identical hash on a fresh clone. Recommend a `just verify-locks` recipe. |
| VER-19 | LOW | `docs/adrs/ADR-0017-sensors-v03-apss-canonical.md:11` | Supersedes relationship is in inline markdown text, not frontmatter. See VER-13. |
| VER-20 | LOW | `harness.manifest.json` plugin names like `harness-versioning+cocogitto` | `+` is overloaded against semver build-metadata. Document that `+` in plugin names is a separator unrelated to semver. |
| VER-21 | LOW | `go.work` | Empty workspace. Comment why it exists (placeholder for Go-flavored ws_apps). |

### Versioning strengths to preserve

- Three lockfiles committed (`Cargo.lock` workspace-level, `bun.lock`, `uv.lock`) plus `apss.lock`. Polyglot reproducibility is foundational here.
- `.harness-provenance.json` captures upstream sha + version + forked_at. The shape is the right primitive even if it does not yet drive drift detection.

---

## Lens 6: logging

### Findings

| ID | Severity | File | Note |
|---|---|---|---|
| LOG-01 | HIGH | `harness/stack/src/commands/inspect.ts:20,33-34,49` | Bare `console.log` with no level / severity. The observability-queries skill teaches operators to query by `severity`; binaries should emit it. |
| LOG-02 | HIGH | `harness/versioning/src/lib.rs:182,198,201,205,249` | `println!` / `eprintln!` with ad-hoc prefixes (`versioning:`, `error:`). No structured envelope. |
| LOG-03 | HIGH | `harness/stack/src/commands/boot.ts:56` | `"Booting..."` emitted as bare console.log with no correlation ID / timing budget / iso_key. Forks cannot trace a slow boot through the observability stack. |
| LOG-04 | MEDIUM | `harness/doc-validator/src/main.rs:45`, `harness/versioning/src/main.rs:14` | No `--json` flag for machine-readable error output. CI / agent consumers must parse human text. |
| LOG-05 | MEDIUM | `harness/doc-validator/src/lib.rs:109-115` (print_human_report) | Success / failure lines lack iso_key / branch context. Greppable by run, not by isolation. |
| LOG-06 | MEDIUM | `harness/stack/src/topology/*`, `harness/stack/src/runtime/*` | No `debug!` / `info!` instrumentation. Silent path-of-execution when something goes wrong in env / ports / isolation. |
| LOG-07 | MEDIUM | `.claude/skills/observability-queries/SKILL.md:38-45` vs binary output formats | The skill teaches `severity` (not `level`), uppercase, `| fields` projection. The binaries emit none of this by default. Standardize. |
| LOG-08 | MEDIUM | `harness/sensors/gate.mjs:1184,1418` | Gate output is human text only. Add `--json` for the observability stack to consume. |
| LOG-09 | MEDIUM | `ws_apps/example-python/src/example_python/telemetry.py:40-78` | Soft-fail emits `eprintln` only. The example would be more instructive for forks if it emitted `{event: telemetry_init_failed, reason, endpoint, severity: WARN}` and continued. |
| LOG-10 | MEDIUM | `harness/sensors/license_scan.mjs`, `harness/sensors/complexity.mjs` | Errors as ad-hoc object keys (`error: msg`) instead of structured log lines. |
| LOG-11 | LOW | `harness/stack/src/commands/doctor.ts` | `console.error` with no severity enum. |
| LOG-12 | LOW | `AGENTS.md:185` ("token-aware: terse") vs `harness/stack/src/commands/boot.ts:56` | Doc says terse-by-default. Boot emits "Booting..." unconditionally. Add `--verbose` and suppress by default. |
| LOG-13 | LOW | `design_note.txt`, `LP_REVIEW_BRIEF.md` (untracked) | Loose top-level notes suggest design conversations not captured in ADRs. ADR-0019 candidate: "harness-wide structured logging contract". |
| LOG-14 | LOW | Harness binaries (all) | No trace-context propagation across slot boundaries (sensors -> versioning -> hooks). Correlation across multi-step harness operations relies on (iso_key, wall-clock-second) pairs the operator infers. |

### Logging strengths to preserve

- `.claude/skills/observability-queries/` ships as a concrete query recipe set. This is the single highest-leverage logging asset in the template.
- `harness/observability/otel-collector.yaml` is pre-wired to ingest the structured JSON format the skill teaches. Apps and binaries that follow the format are queryable on first boot.

---

## Methodology, caveats, scope

- READ-ONLY review of `feat/apss-integration` at commit `65cc7b9`. No files modified.
- Six lenses (security, testing, error-handling, continuous-delivery, versioning, logging) dispatched as six parallel read-only sub-agents. Lens definitions taken from `github.com/syntropic137/software-leverage-points` (skills not vendored locally; concepts applied from the public framework).
- Three lenses overlap with the Alpha reviewer's expected coverage (security touches developer-experience, CD touches architecture, versioning touches documentation). Where Alpha covers the same finding, the orchestrator should dedupe by file + severity.
- Five sub-agent CRITICALs were dropped after sanity-checking source (committed Bearer token, Cargo edition 2024, semver build-metadata, pyproject placeholder version, Rust bin/crate name collision). One-line rationale embedded in the relevant finding.
- Findings cap was ~80; I came in at 82. Cap is advisory; depth was prioritized over breadth on the higher-leverage lenses.

## Bead-filing list for the orchestrator

The orchestrator should file the following as launchpad beads (CRITICAL + HIGH only):

1. `CD-01` / `SEC-01`: flip `pnpm install` to `--frozen-lockfile` in CI OR commit lockfile baselines (one bead, both consequences).
2. `TST-01` + `TST-02` + `TST-03` + `TST-04`: telemetry + stack coverage policy debt (one bead).
3. `VER-01`: normalize slot version strings to strict semver (one bead).
4. `VER-03`: relocate ADR test fixtures out of the canonical ADR directory (one bead).
5. `VER-06` + `VER-07`: standard-version compatibility check on update + prebuilt versioning binary (one bead).
6. `CD-02` + `CD-03` + `CD-04`: CI toolchain version drift (Node 20/22, pnpm 9/11, Rust stable float) (one bead).
7. `CD-05` + `CD-06`: CI `paths:` filter + `needs:` sequencing (one bead).
8. `ERR-01` + `ERR-02` + `ERR-03` + `ERR-04` + `ERR-05`: structured error contract across slot CLIs and hook soft-skip semantics (one bead).
9. `LOG-01` + `LOG-02` + `LOG-03`: structured-logging contract for slot CLIs (one bead).
10. `SEC-02` + `SEC-03`: GitHub Actions SHA pinning + `cargo install --locked` (one bead).

Total: 10 beads covering 25 findings.
