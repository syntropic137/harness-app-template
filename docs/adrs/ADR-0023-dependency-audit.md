---
name: "Dependency Audit"
description: "Polyglot CVE / supply-chain audit gate at CI; fast lockfile-integrity at pre-push"
status: accepted
---

# ADR-0023: Dependency / Supply-Chain Audit

**Date:** 2026-06-10
**Category:** Slot
**Next review:** 2026-12-10

## Context

The template already enforces correctness (typecheck + tests + coverage),
architectural fitness (sensors ratchet), secret hygiene
([[ADR-0009-secret-scanner.md]]), and conventional-commit/merge gating
([[ADR-0022-merge-gating.md]]). The last major uncovered quality pillar
is supply-chain risk: a high-CVSS advisory in a transitive dep can land
in a fork the moment it pulls upstream and goes entirely unobserved
unless a gate trips. This ADR introduces that gate.

The template is polyglot — TypeScript (pnpm workspace), Rust (cargo
workspaces in three places: root `Cargo.toml`, `harness/doc-validator`,
`harness/versioning`), and Python (uv workspace under
`ws_apps/example-python`). A single-language audit would leave two of
the three lanes blind, so the gate has to scan all three.

## Decision

Add a `dep-audit` slot with two tiers:

- **CI (`dep-audit` job in `.github/workflows/test.yml`)** — full CVE
  audit per lane, fail-closed on missing tooling. This is the
  authoritative enforcement surface.
- **Pre-push (`dep-audit-lockfile` lefthook command)** — fast
  lockfile-integrity check per lane (no network), soft-skip when the
  lockfile or its tool is absent. This is an ergonomics surface, not a
  security one; it catches drift between the manifest and the lockfile
  before the slower CI lane runs.

Per-lane wire-up:

| Lane | CI tool | Severity floor | Pre-push integrity command |
|---|---|---|---|
| JS / TS | `pnpm audit --audit-level=high --prod` | HIGH or CRITICAL | `pnpm install --frozen-lockfile --lockfile-only` |
| Rust | `cargo audit --file <each>/Cargo.lock` (three manifests) | any advisory | _(none — see below)_ |
| Python | `uv export … \| uvx pip-audit -r -` per project | any advisory | `uv lock --check` |

Rust lockfile integrity is intentionally absent from the pre-push tier.
`cargo metadata --locked --offline` is the obvious analogue of the JS /
Python integrity commands, but it requires the registry cache to be
populated; a fresh-clone box gets a hard failure ("attempting to make
an HTTP request, but --offline was specified") that has nothing to do
with lockfile drift. Dropping `--offline` triggers a network round-trip
that violates the fast-pre-push tier. The CI dep-audit job covers
Rust lockfile drift indirectly: `cargo generate-lockfile` followed by
`cargo audit --file` will fail on a structurally broken lockfile.

The orchestrator lives at `scripts/dep-audit.ts` so each lane is unit
tested via injected `spawn` / filesystem adapters (see
`scripts/tests/dep-audit.test.ts`). Lane skipping is differentiated:

- A missing **manifest** is SKIP and does not contribute to the failure
  count (this is how forks that delete the Python example still get a
  green CI).
- A missing **tool** in CI is FAIL — no audit means no signal, which
  defeats the gate. (The pre-push surface inverts this and soft-skips,
  consistent with the inner-loop posture of every other lefthook hook.)

## Consequences

The template gains a fail-closed CVE gate covering every dependency
manager it scaffolds. Fork consumers inherit it for free: as long as
they keep the workflow file and the script, a new HIGH/CRITICAL CVSS
advisory in any transitive dep blocks merge until they remediate or
explicitly ignore.

Failure modes the gate intentionally does not catch:

- **Typosquatting / dependency-confusion at install time** — the
  advisory DBs only know about packages they've reviewed. Mitigated
  separately by the secret-scanner gate (forbids credential leaks via
  fake packages) and the pnpm `overrides` / `packageManager` pins
  already in `package.json` / `pnpm-workspace.yaml`.
- **LOW / MODERATE advisories** — the JS lane floor is HIGH because
  npm-registry advisory noise at MEDIUM and below would page
  consumers daily without security value at this template's surface
  area. Rust / Python lanes are stricter (any advisory) because the
  RustSec and PyPA DBs are an order of magnitude lower volume.

Adding the new CI context to `REQUIRED_PR_CONTEXTS` in
`scripts/protect-main.ts` is a **deliberate two-step**: the check must
land green on `main` once before it can be made required, otherwise
auto-merge deadlocks waiting for a report it has never received
([[ADR-0022-merge-gating.md]]). The follow-up PR registers it.

## Why these tools

- **pnpm audit** (built into the workspace package manager already
  pinned in `package.json`). Native integration; no extra install.
  `--audit-level=high --prod` is the severity floor + scope.
- **cargo-audit** (RustSec advisory DB). Single binary install via
  `taiki-e/install-action`. Per-workspace scan because the three Rust
  workspaces have independent `Cargo.lock` files; auditing only the
  root would leave `harness/doc-validator` and `harness/versioning`
  unchecked.
- **pip-audit** (PyPA advisory DB). Run via `uvx` so no global Python
  package install is required; the uv export pipes a resolved
  requirements set so audits run on the actual locked set, not on the
  abstract version specifiers in `pyproject.toml`.

## Alternatives considered

- **`cargo-deny` instead of `cargo-audit`** — `cargo-deny` adds
  license-allowlist enforcement on top of advisories. The license
  surface is already covered by the existing sensors `LG01` license
  ratchet (`harness/sensors/license_scan.mjs`); doubling up would
  blur ownership without adding signal. Re-probe if the LG01 lens is
  ever retired or if we want sourcecode-level licence enforcement
  (e.g. proc-macros) the sensors lens cannot see.
- **`osv-scanner` as a single cross-language tool** — Google's
  cross-ecosystem scanner is attractive in theory but its npm /
  PyPI signal lags behind the ecosystem-native scanners by hours to
  days. Picking ecosystem-native today keeps us closer to upstream
  advisories at the cost of three tools instead of one. Revisit when
  osv-scanner's npm coverage catches `pnpm audit` in latency.
- **`snyk test` / `dependabot security updates`** — both are real
  options; both put the audit DB behind an account / API key /
  proprietary scanner. The template intentionally relies only on
  permissively-licensed tools that ship in a single binary install,
  matching the secret-scanner pattern. A consumer can layer Snyk or
  Dependabot on top of this gate without conflict.
- **LOW/MODERATE floor on JS** — rejected for noise. The npm
  registry's advisory cadence at MEDIUM and below would block
  unrelated PRs while consumers chase transitive-dep updates that
  may not even be exploitable in this surface area. HIGH/CRITICAL
  matches the OWASP severity threshold for non-prod-blocker fixes.

## When to re-probe

- A consumer reports false negatives at HIGH (a real exploit that
  scored MEDIUM in the npm advisory but caused production impact).
  Bump the floor or layer a verified-exploit scanner.
- `osv-scanner` reaches parity with ecosystem-native scanners.
- A fourth lane lands (Go, Ruby, Java …). Add a `runGoLane` etc. to
  `scripts/dep-audit.ts` and document the tool here.
- The npm registry, RustSec, or PyPA advisory DB changes its query
  surface. The orchestrator is tested via injected `spawn`, so the
  shape changes are caught at the unit level before CI.

## Sources

- [pnpm audit docs](https://pnpm.io/cli/audit) — `--audit-level`,
  `--prod`, exit-code semantics.
- [cargo-audit](https://github.com/rustsec/rustsec/tree/main/cargo-audit) — RustSec
  advisory DB scanner; reads `Cargo.lock`.
- [pip-audit](https://github.com/pypa/pip-audit) — PyPA-maintained
  Python advisory scanner.
- [uvx](https://docs.astral.sh/uv/guides/tools/) — one-shot tool
  runs that avoid global Python installs.
- [OSV-Scanner](https://google.github.io/osv-scanner/) — alternative
  cross-ecosystem scanner; re-probe in the next review window.
- [OWASP severity ratings](https://owasp.org/www-community/vulnerabilities/) — HIGH
  / CRITICAL as the standard merge-blocker threshold.
