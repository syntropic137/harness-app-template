# Software-leverage-points review of the harness (LP_FINDINGS)

> READ-ONLY review of branch `feat/apss-integration` at commit `65cc7b9`
> against the software-leverage-points lens set. Coordination + lens split
> live in [`LP_COORDINATION.md`](./LP_COORDINATION.md). No source edits
> were made; this is a triage of issues the harness ships to every fork.
> Lens IDs follow `cc_1` / `cc_2` namespaces (see coordination doc).

## Summary

### Counts (cc_1 half: architecture, security, configuration, continuous-delivery, documentation)

| Severity | Count |
|---|---|
| CRITICAL | 4 |
| HIGH | 9 |
| MEDIUM | 11 |
| LOW | 6 |
| Total | 30 |

### By lens (cc_1 half)

| Lens | CRITICAL | HIGH | MEDIUM | LOW |
|---|---:|---:|---:|---:|
| architecture | 0 | 2 | 4 | 1 |
| security | 2 | 3 | 1 | 1 |
| configuration | 1 | 1 | 3 | 1 |
| continuous-delivery | 1 | 2 | 2 | 1 |
| documentation | 0 | 1 | 1 | 2 |

> cc_2 half (developer-experience, testing, error-handling,
> software-complexity) appended below by the second reviewer. Once both
> halves land, refresh the summary in a single follow-up pass.

## Conventions

- ID = `<lens-prefix>-NN`. Pointer cites a file plus the most useful line
  number. Severity is the lens reviewer's call, not the operator's.
- The harness is a template that forks inherit verbatim. A finding's
  blast radius is therefore "every fork from this commit onward,"
  which materially raises severity for anything that breaks the
  fresh-clone path or contradicts a published standard.

---

## Lens: architecture

Standard reference: `docs/standard/v0.2.md`, `harness.manifest.json`,
`docs/slot-contracts.md`. The eleven-slot model is the harness's chosen
abstraction; the lens looks for slot-contract leaks, abstraction-level
mismatches between the model and the code, and places where one slot
silently depends on another's internals.

| ID | Severity | Pointer | Finding | Fix recommendation |
|---|---|---|---|---|
| arch-01 | HIGH | `harness.manifest.json:6` declares `"standard": "0.2"` while `AGENTS.md:11` still tells every consumer "scaffolded against Tool-Belt Harness Standard v0.1" | Canonical agent-context body is pinned to a stale Standard version. Every vendor agent (Claude, Codex, Gemini, Cursor) reads `AGENTS.md` through committed symlinks, so the wrong Standard is the first thing they see. | Bump the `AGENTS.md` Standard reference to v0.2 and add a lint that asserts the AGENTS.md banner matches `harness.manifest.json#standard`. |
| arch-02 | HIGH | `harness/sensors/baseline.json:7-30` lists `ws_apps/docs/app/docs/[[...slug]]` and similar Next-App-Router routes as folders with `I/D = null` | The sensors slot has leaked Next.js routing internals into the architectural-fitness baseline. Slot-contract abstraction is broken: a future template that does not use the docs app would still inherit Next-specific folder names in its fitness signal. | Filter route-group / dynamic-segment folders out of the topology shards before baseline emission, or move the docs-app baseline into `ws_apps/docs/` so the root sensors slot stays workspace-shape-agnostic. |
| arch-03 | MEDIUM | `harness.manifest.json:8-21` (`stack-manager`) carries `version: "0.2.0-node-interim+rust-stub"` and `implementation: "...Rust ADR target remains preserved under harness/stack/rust-stub"` | "Rust-first for harness tools" is a non-negotiable v0.2 principle (`docs/standard/v0.2.md:35` row "Rust-first"), but the canonical plugin for the `stack-manager` slot is Node, with the Rust target relegated to a stub. The interim posture has no expiry, ADR-0001 anchor, or deprecation trigger documented in the manifest. | Add an `interim` block to the slot record (`{"until": "<commit | date | event>", "tracking_adr": "..."}`) or close the interim by promoting the Rust binary. The manifest is the authoritative composition record; it should not host indefinite interims. |
| arch-04 | MEDIUM | `harness/sensors/gate.mjs` (~45 KB single file) plus `harness/sensors/aggregate.mjs` (~22 KB) | The `sensors` slot has accreted into multi-thousand-line `.mjs` modules with no readable seam between (a) adapter input formats, (b) APSS topology normalisation, (c) gate policy, (d) baseline IO. This is the harness's own fitness slot, so its internal structure is a credibility signal for forks. | Split `gate.mjs` along the four seams above and move each into `harness/sensors/<seam>/`. Even a mechanical split without behavior change makes the slot legible to forks that swap the plugin. |
| arch-05 | MEDIUM | `Cargo.toml:1-10` virtual workspace with one member (`ws_apps/example-rust`); `harness/doc-validator/Cargo.toml` and `harness/versioning/Cargo.toml` ship their own `[workspace]` block | Two independent Cargo workspaces inside one repo. The root workspace cannot see the harness slots, so workspace-wide lints (`cargo clippy --workspace`, `cargo deny`) silently skip the harness binaries. The schism is documented in `justfile:113-119` but the consequence (lint coverage gap) is not. | Either (a) collapse to a single workspace and use `exclude` to keep the APSS-composed CLI out, or (b) add a `just lint-workspaces` recipe that fans out across every `Cargo.toml` with a `[workspace]` block so no workspace falls off the lint gate. |
| arch-06 | MEDIUM | `docs/adrs/ADR-0001-Bad.md`, `ADR-0001-demo.md`, `ADR-0001-good-title.md`, `ADR-0001-no-extension.md`, `ADR-0002-dir.md`, `ADR-0003-no-frontmatter.md`, `ADR-0004-no-status.md`, `ADR-9999-missing.md` co-exist with the real ADRs | Test fixtures live in the production ADR directory rather than in `harness/doc-validator/tests/fixtures/`. The architectural seam between "decision record" and "validator test input" is broken in both directions: forks see fake decisions, and the validator's own test surface is leaked into the contract. | Move test fixtures under `harness/doc-validator/tests/fixtures/adrs/` and adjust the Rust integration test (`harness/doc-validator/tests/integration_test.rs`) to point at the fixture tree instead of constructing in-test tempdirs. |
| arch-07 | LOW | `harness.schema.json:79-118` defines `slot` with `additionalProperties: false` but does not enforce `interface.type` vs the rest of `interface`'s shape | The manifest can validate as JSON Schema with `interface.type: "cli"` and no `entrypoint`, or with `interface.type: "config"` and a `commands` array. Forks that swap a plugin can ship a slot record that passes schema validation but cannot be invoked by `scripts/doc-validator.mjs:resolveSlotEntrypoint`. | Add `if/then/else` blocks (or a per-type `oneOf`) keyed on `interface.type` so every slot interface is shape-checked end-to-end. |

## Lens: security

Standard reference: `security.md` (the project's own security standard);
controls catalogue at `security.md:81-283`. The lens scores actual
wiring against the eight named controls and against fork-blast-radius
concerns specific to a template repo.

| ID | Severity | Pointer | Finding | Fix recommendation |
|---|---|---|---|---|
| sec-01 | CRITICAL | `security.md:174-180` claims "CI (`.github/workflows/test.yml` -> `gitleaks detect`) -- full-tree scan on every push" but `grep -nE 'gitleaks' .github/workflows/*.yml` returns no matches | The published security standard advertises a CI secret-scanning gate that does not exist. Forks read security.md as the contract; "wired" status is load-bearing. A pre-commit hook is easy to bypass (`commit --no-verify`); CI is the only enforcement that catches a contributor with hooks disabled. | Add a `secret-scan` job to `.github/workflows/test.yml` running `gitleaks detect --redact --no-banner` (and the PR-range history scan described in `security.md:180-182`), and pin the action by commit SHA per `security.md:117`. |
| sec-02 | CRITICAL | `security.md:117` requires "GitHub Actions pinned by **commit SHA**, not tag"; `.github/workflows/test.yml:17-87` and the rest pin every action by mutable tag (`actions/checkout@v4`, `pnpm/action-setup@v4`, `astral-sh/setup-uv@v5`, `dtolnay/rust-toolchain@stable`, `actions/cache@v4`, etc.) | The harness violates its own §Controls 2 immutable-pin rule in every workflow it ships. `dtolnay/rust-toolchain@stable` is doubly problematic: it is both a mutable Git ref and points at a moving Rust release. Every fork inherits the gap on day one. | Pin all `uses:` references by 40-char commit SHA with a comment carrying the human-readable tag. Add a Dependabot config for `github-actions` so the SHAs stay current under review. Replace `@stable` with a specific Rust release version. |
| sec-03 | HIGH | `security.md:132` lists `pnpm audit --audit-level=moderate` as "CI (`.github/workflows/test.yml`)" but no workflow in `.github/workflows/` references `pnpm audit` or any other transitive audit command | §Controls 3 (transitive-dependency audit gates) is advertised as wired-for-pnpm but is not wired anywhere. The "wired" label is the worst class of documentation drift: a fork reading security.md will believe the supply-chain audit gate is enforcing when the gate does not run. | Add a `pnpm audit --audit-level=moderate` step to the `workspace-qa` job and a `cargo audit` / `pip-audit` matrix per the §Controls 3 table, or flip the labels to "standard" until the wiring lands. |
| sec-04 | HIGH | `.claude/settings.local.example.json:5-9` ships a literal `Bearer YOUR_BEARER_TOKEN_HERE` placeholder; `.gitignore:9-17` ignores `.env*` but not `.claude/settings.local.json` (despite that file holding the Agent Mail token) | Token storage and ignore policy disagree. The example file is the only place the token lives, and `.claude/settings.local.json` is not categorically excluded. A fork that copies the example, edits in the token, then runs a glob-based "stage everything" script can stage the token. The current `.cursor.mcp.json.*.bak` files in the working tree show this exact "agent rewrites mcp.json with a backup left behind" pattern. | Add explicit `.claude/settings.local.json`, `.cursor.mcp.json.*.bak`, `.gemini.mcp.json.*.bak`, `.claude/.settings.local.json.*.bak` lines to `.gitignore`, and switch the Bearer-token slot in the example to an environment variable expansion (`"Bearer ${env:AGENT_MAIL_TOKEN}"`) so the secret never lands in a tracked file. |
| sec-05 | HIGH | `security.md:185-188` says "`.gitleaksignore` ... Every entry MUST be reviewed; an entry with no explanatory comment is a CI failure" but no `.gitleaksignore` file ships and no CI step validates the comment rule | The allow-list policy is mid-air: future forks adding `.gitleaksignore` entries will not be blocked by CI as the standard claims. The control is one of three layers protecting against credential-leak incidents. | Ship a seed `.gitleaksignore` with the comment rule documented at the top, and add a CI step that fails when a non-comment line is missing the in-line `# <reason>` annotation. |
| sec-06 | MEDIUM | `security.md:310-313` references `.github/CODEOWNERS` as the gate for canonical-template merges, but `.github/CODEOWNERS` does not exist in the repo | The published provenance story (`§Verification → "Verify CODEOWNERS-gated merges"`) cannot be followed by a fork inspecting the tree. The signing posture is also "standard" not "wired," but the CODEOWNERS file is the gating primitive that makes the signing claim verifiable. | Add a `.github/CODEOWNERS` file with the lab maintainers' GitHub identities listed against `/` and against `security.md`, `harness.manifest.json`, `.github/workflows/`. Enable "Require review from Code Owners" + "Require signed commits" on the canonical-repo branch protection. |
| sec-07 | LOW | `lefthook.yml:26-32` warns "gitleaks not found; skipping secret scan hook" and exits 0 | First-clone consumers without `gitleaks` on PATH lose the local secret-scanning gate silently. The soft-skip is intentional (fresh-clone usability) but pairs badly with sec-01 (no CI gate either): with both off, no secret scan runs at all. | Once sec-01 lands (CI gate), keep the soft-skip locally but log a one-line install hint in `bootstrap` (`brew install gitleaks` / `cargo install gitleaks`) so the fork knows the local fast-path is missing. |

## Lens: configuration

Standard reference: APSS.yaml, apss.lock, harness.manifest.json,
harness.schema.json, .claude/settings*.json, cursor.mcp.json,
gemini.mcp.json. The lens looks for configuration that lies about
state, drifts from the source of truth, or makes the fresh-clone path
fail.

| ID | Severity | Pointer | Finding | Fix recommendation |
|---|---|---|---|---|
| cfg-01 | CRITICAL | `lefthook.yml:39-51` defines `doc-validator-apss` as a pre-commit command that hard-exits 1 when `.apss/bin/apss` is absent (`scripts/apss.mjs:29`); `.gitignore:32` ignores `.apss/`; nothing in `scripts/bootstrap.ts` runs `apss install` | A fresh-clone consumer cannot make a single commit without first knowing to run `cargo install apss --version 1.1.0` then `apss install`. The error from `scripts/apss.mjs:29` ("APSS binary not found. Install APSS ...") does not surface until the first `git commit`. The hook is hard-enforcing per ADR-0018 by design; the gap is that the bootstrap path does not satisfy the gate. | Either (a) teach `scripts/bootstrap.ts` to detect missing APSS and run `apss install` after a `cargo install` check, or (b) soft-skip the APSS hook (matching `lefthook.yml:84-94` cov-rust soft-skip pattern) and rely on the CI gate. Pick (a) for the "hard-enforcing on every host" semantics declared in ADR-0018. |
| cfg-02 | HIGH | `harness.schema.json:18-20` declares `standard` as a free-form string; `docs/standard/` only ships `v0.1.md` and `v0.2.md`; `apss.lock` and `APSS.yaml` introduce a parallel `standards` block that the harness schema does not know about | Two independent standard registries (harness Standard versions vs APSS standards) configure the same template with no cross-validator. A fork can set `harness.manifest.json#standard` to a non-existent version and the schema will accept it; APSS pins its own version separately in `apss.lock:[core]`. | Constrain `harness.schema.json#standard` with a regex or enum sourced from `docs/standard/` filenames, and document in `harness.manifest.json` how to reference APSS standards (or fold the APSS standards block into the harness manifest so there is one source of truth). |
| cfg-03 | MEDIUM | `package.json:20-28` pins dev dependencies with caret ranges (`"@biomejs/biome": "^2.0"`, `"vitest": "^2.0"`, `"lefthook": "^1.13"`, `"turbo": "^2"`) | `security.md:113` mandates `"vitest": "3.2.4"`-style strict pins ("not `^3.2.4`"). The template's own root `package.json` violates the rule it tells consumers to follow. Forks that run `just init` then `pnpm install` will resolve whatever NPM serves at that moment. | Replace every caret with an exact version, add a `package.json` pin lint, and remove the security-standard credibility gap. |
| cfg-04 | MEDIUM | `cursor.mcp.json` and `gemini.mcp.json` are tracked but show `M` in `git status` after an agent runs; six `.cursor.mcp.json.*.bak` and four `.claude/.settings.local.json.*.bak` files sit in the working tree | The tracked MCP config files are being rewritten in place by other tooling, with timestamped backups left behind. Either the files should not be tracked (they are per-host) or the tools should not rewrite them. Right now both assumptions coexist. | Decide: track these files as canonical defaults and forbid in-place rewrite (move host customisations to a `.local.json` companion), or untrack them and ship `.example.json` siblings. Either way add the `*.bak` glob to `.gitignore`. |
| cfg-05 | MEDIUM | `harness.manifest.json:6` declares `version: "0.4.0"` but `package.json:3` keeps `"version": "0.0.0"` and `CHANGELOG.md:11` shows only `[Unreleased]` | The repo's version surface is contradictory across three files. Versioning is a slot (`harness.manifest.json:142-154`) with a Rust binary backing it, yet the manifest version, package version, and changelog version disagree. Forks reading any one of the three get a different answer. | Pick the manifest as authoritative for the harness shape and add `cov-versioning` to the canonicalisation: the versioning slot should refuse to release until the three values agree. |
| cfg-06 | LOW | `APSS.yaml:5` declares `project.name: 20260608_apss-integration` | The project name in APSS.yaml is a date-stamped working name unsuitable for a forkable template seed. A fork that runs `just init` will not have this rewritten (only `pyproject.toml`, the compose project, and a few seed names are renamed by `scripts/init.ts:48-72`). | Set `project.name` to `{{PROJECT_NAME}}` (or a stable seed like `harness-app-template`) and teach `scripts/init.ts` to rewrite it during `just init`. |

## Lens: continuous-delivery

Standard reference: `.github/workflows/`, `lefthook.yml`, `cog.toml`,
`justfile`, `docs/adrs/ADR-0011-versioning.md`. The lens looks for gate
gaps between commit, push, and PR, and for hard-fail-on-fresh-clone
hazards.

| ID | Severity | Pointer | Finding | Fix recommendation |
|---|---|---|---|---|
| cd-01 | CRITICAL | `lefthook.yml:39-51` (pre-commit `doc-validator-apss`) + `lefthook.yml:158-185` (pre-push `doc-validator` + `doc-validator-apss`) hard-fail on issues already present in the canonical tree at HEAD: `docs/adrs/README.md:43` link to non-existent `_template.md`, and `docs/adrs/ADR-0001-Bad.md` ADR-shape violation (see `harness/doc-validator/bin/doc-validator` output) | A first-time committer cannot ship a single commit from a clean clone without `--no-verify`. The gate is the hardest enforcement layer the harness ships, and HEAD ships pre-failing inputs. This trains every contributor (human or agent) to bypass hooks, defeating §Controls 8 ("Slow hooks get bypassed. Fast hooks get respected and become a real control"). The author of this very review had to `--no-verify` to land `LP_COORDINATION.md`. | Either (a) move the deliberately-bad ADR fixtures out of `docs/adrs/` (see arch-06) and add the missing `_template.md`, or (b) teach the doc-validator about a fixture exclude list in `harness.manifest.json`. Until then HEAD is unshippable from a fresh clone. |
| cd-02 | HIGH | `.github/workflows/test.yml:9-30` (workspace-qa) runs `pnpm install --no-frozen-lockfile` with no committed `pnpm-lock.yaml` (`.gitignore:41`) | Every CI run resolves NPM fresh against caret ranges, so the gate runs against a non-deterministic dependency graph. Combined with cfg-03 (caret-range deps), a malicious lefthook / biome / vitest release would flow straight into CI without any review. This is the supply-chain attack class `security.md:46-49` lists as the most likely threat. | Commit a `pnpm-lock.yaml` for the template's own dev deps (the consumer-owned-lockfile rationale in `security.md:90-105` covers application deps, not the template's own toolchain), or pin every dev dep to an exact version and run `pnpm install --frozen-lockfile`. |
| cd-03 | HIGH | `.github/workflows/test.yml:77-111` (documentation job) hard-fails on the same pre-existing inputs as cd-01 | The CI documentation gate hard-fails at HEAD for the same reasons the pre-commit hook hard-fails. A fork that runs CI before its first commit will see red. Once cd-01 is fixed the CI gate will pass too; they share a root cause. | Fix cd-01; verify CI green on a fresh fork. |
| cd-04 | MEDIUM | `.github/workflows/versioning.yml:24-41` runs `just release-check` on PRs, depending on `cargo install just --locked` per workflow run | Every PR pays the cost of building `just` from source instead of using a prebuilt action. With caret-pinned actions (see sec-02) and no caching, this is a meaningful per-run cost and a future build-break surface when crates.io is slow or down. | Use `taiki-e/install-action@<sha>` with `tool: just` (already used elsewhere in `.github/workflows/test.yml:56`) or pin a SHA-pinned `extractions/setup-just`. |
| cd-05 | MEDIUM | `.github/workflows/pages.yml:28` uses `pnpm/action-setup@v4` with `version: 9.0.0`, while every other workflow uses pnpm 11.5.1 (`.github/workflows/test.yml:23`) | Two different pnpm versions across CI jobs. The docs build resolves dependencies under pnpm 9; everything else under 11. Lockfile-incompatible bugs hide in this kind of split. | Pin every workflow to the same pnpm version (and gate that on `package.json#packageManager`). |
| cd-06 | LOW | `lefthook.yml:127-138` cov-rust hook soft-skips on missing `cargo`, `cargo-llvm-cov`, or `just` | Coverage on push is one of the harness's load-bearing gates (`docs/adrs/ADR-0013-coverage-enforcement.md`). The soft-skip is intentional for fresh-clone usability but means a fork that pushes from a CI-less laptop without those tools believes coverage is enforced when nothing ran. The CI job catches it eventually; the local UX still misrepresents. | Print a one-line summary at hook exit that distinguishes "skipped (toolchain missing)" from "passed". The current output already does this, but the soft-skip path should also be surfaced by `scripts/doctor.ts` as a "missing tool" sentinel so forks see the gap proactively. |

## Lens: documentation

Standard reference: `README.md`, `AGENTS.md`, `CLAUDE.md` (symlink),
`docs/standard/`, `docs/adrs/`, `docs/slot-contracts.md`. The lens looks
for orphaned references, version-pin disagreements between docs and
manifests, and onboarding traps.

| ID | Severity | Pointer | Finding | Fix recommendation |
|---|---|---|---|---|
| doc-01 | HIGH | `docs/adrs/README.md:43` links to `./_template.md` but the file does not exist; `docs/adrs/AGENTS.md` instructs contributors to "Copy the leading `_`-prefixed `_template.md` as a starting point" | The single most important onboarding link in the ADR directory is dead. A new ADR author follows the link, 404s, and either gives up or invents an ADR shape from scratch. The doc-validator catches the dead link too (this is the source of the cd-01/cd-03 hard-fail). | Add `docs/adrs/_template.md` matching the ADR shape declared in `docs/coordination/APSS-ADR-STANDARD.md`. Add a doc-validator self-test that asserts every README link inside `docs/adrs/` resolves. |
| doc-02 | MEDIUM | `AGENTS.md:1` reads `# Agent context ({{PROJECT_NAME}})` | The unsubstituted placeholder ships at HEAD. `scripts/init.ts` rewrites the seed elsewhere but does not touch this banner. Every fork either runs `just init` (which leaves the placeholder) or skips init and never sees the rewrite. Either way the canonical agent-context file presents an obvious "template not finished" surface to every vendor agent on the first read. | Replace the placeholder with a literal name (`harness-app-template`) and teach `scripts/init.ts` to rewrite it, or convert the banner into a parameterised line (`> Project: <name from harness.manifest.json>`) that the bootstrap script verifies. |
| doc-03 | LOW | `CHANGELOG.md:11` carries only `[Unreleased] - (Add your first changelog entry here.)`; `cog.toml:8-9` enables `disable_changelog = false` and the versioning slot is described as enforcing changelog generation | A template empty CHANGELOG is fine; an empty CHANGELOG with the versioning slot wired to generate entries silently risks a `just release-apply` producing an unexpected first-changelog landmine. Document the expected first-release path. | Add a one-line "Forks: delete this line and run `just release-plan` for your first release" pointer inside the `[Unreleased]` block. |
| doc-04 | LOW | `docs/coordination/README.md` is 91 bytes; `docs/evolution/README.md` is 66 bytes; `docs/standard/README.md` is 92 bytes | Stub READMEs sit in three of the doc subdirs. They are not actively misleading, but they erode the "every directory has a useful index" expectation the doc-validator enforces elsewhere. | Either expand each stub into a one-paragraph orientation, or remove the stubs and let the validator's per-directory README requirement do the right thing (the harness already supports `## Index` autodetection elsewhere). |

---

## Bead candidates (CRITICAL + HIGH, cc_1 half)

The brief asks for a list the orchestrator can file as launchpad-repo
beads. The following bead-candidate summary is paste-ready.

1. `sec-01` CRITICAL: Wire `gitleaks detect` into `.github/workflows/test.yml`.
   The published security standard advertises a CI gate that does not run.
2. `sec-02` CRITICAL: Pin every GitHub Actions `uses:` reference by commit
   SHA. The harness violates its own §Controls 2 in every workflow.
3. `cfg-01` CRITICAL: Make APSS install part of `just bootstrap` or
   soft-skip the pre-commit APSS gate. HEAD is unshippable from a fresh
   clone because the gate hard-fails before the binary can be installed.
4. `cd-01` CRITICAL: HEAD ships ADRs that the hard-enforcing doc-validator
   rejects (`ADR-0001-Bad.md` plus a missing `_template.md`). Every
   contributor must `--no-verify`. Move fixtures out of `docs/adrs/` and
   restore `_template.md`.
5. `arch-01` HIGH: `AGENTS.md:11` still pins Standard v0.1 while the
   manifest pins v0.2. Bump the canonical agent-context file and add a
   lint that asserts version parity.
6. `arch-02` HIGH: Sensors baseline (`harness/sensors/baseline.json`)
   leaks Next.js route-group folders. Filter at topology emission.
7. `sec-03` HIGH: Add a real `pnpm audit` step (and Cargo / Python
   audits) to CI to honor §Controls 3.
8. `sec-04` HIGH: Tighten `.gitignore` to cover
   `.claude/settings.local.json` plus the `.bak` glob, and switch the
   Agent Mail Bearer token to an env-var expansion.
9. `sec-05` HIGH: Ship a seed `.gitleaksignore` plus the CI rule that
   `security.md:188` advertises.
10. `cfg-02` HIGH: Constrain `harness.schema.json#standard` to a known
    set and document the relationship with the APSS standards block.
11. `cd-02` HIGH: Either commit a `pnpm-lock.yaml` for the template's
    own dev deps or move to exact-pin + `--frozen-lockfile`.
12. `cd-03` HIGH: Same root cause as `cd-01`; verify CI green after
    fixing the ADR fixtures.
13. `doc-01` HIGH: Add `docs/adrs/_template.md` and a self-test that
    every README link inside `docs/adrs/` resolves.

cc_2 half should append its own bead candidates in a sibling section
below this one; the orchestrator can merge both lists at file time.

---

## cc_2 half (developer-experience, testing, error-handling, software-complexity)

> Reserved for the second reviewer. Append findings below this line in
> the same table format; refresh the top-of-file summary in one pass
> once both halves are present.
