# Security

> **Status:** active standard, v0.1 (2026-05-29). This file is the
> template's **security standard** — what this repo commits to do to
> protect the supply chain, the agent's working environment, and the
> humans who fork from here. Some controls are **wired today** (lefthook
> hooks, Gitleaks, UBS); some are **standard** (lockfile review,
> signed commits,
> signed releases, transitive audit gates per language) and will trip
> their CI gate once enabled. Each control labels its state so you can
> read this once and know what's enforced versus aspirational.
>
> **Modelled on** [UBS `docs/security.md`](https://github.com/Dicklesworthstone/ultimate_bug_scanner/blob/main/docs/security.md):
> threat model → controls → verification → key handling → reporting. The
> UBS document targets a binary distributable; this template is a
> forkable Git repo, so the supply-chain primitives are adapted (Git
> history + template review + consumer-owned lockfile integrity + transitive audit
> instead of signed binary tarballs).

## Scope

This document covers:

- The **template repository itself** (what lab maintainers do to keep the
  upstream tree trustworthy).
- The **sync path** lab → canonical CHA repo → forked consumer projects.
- The **forked consumer's** day-to-day surface — the gates that run on
  every commit, the policies that govern dependency churn, the
  reporting path when something goes wrong.

It does **not** cover:

- Your application's runtime security posture (you own that; some of the
  controls here help, but no template can replace a real threat model
  for *your* product).
- The security of services your stack talks to (databases, identity
  providers, third-party APIs). Threat-model those separately.
- Operational secrets management beyond "don't commit them" (use the
  secret store appropriate to your deploy target).

## Threat model

The threats this template defends against, in rough order of likelihood:

- **Compromised transitive dependency.** A package deep in your `pnpm`
  / `cargo` / `uv` / `go.mod` graph is taken over and an update ships
  malicious code. **Hardened by:** consumer-owned lockfiles + pinned deps
  where practical + transitive audit gates (§Controls 1, 2, 3).
- **Secrets leaked into the repository.** Keys, tokens, or credentials
  committed by accident (human or agent). **Hardened by:** Gitleaks
  pre-commit + CI scan (§Controls 5); lefthook diff-scope (§Controls 8).
- **Poisoned upstream sync.** A malicious or compromised lab → CHA
  sync PR introduces a backdoor that fan-outs to every consumer fork
  on their next `just update`. **Hardened by:** PR-based commit sync
  with CODEOWNERS review (ADR `docs/adrs/ADR-0015-cha-sync-source-of-truth.md`),
  signed commits on lab maintainers' end (§Controls 6), and signed-tag
  verification on the consumer's side (§Verification).
- **Malicious AI-generated code.** An agent (Claude / Codex / Gemini)
  is prompt-injected, hallucinates an insecure pattern, or is convinced
  to disable a gate. **Hardened by:** UBS bug scanning (§Controls 7),
  fitness sensors (`harness-sensors gate`), `running-experiments` skill
  enforcing hypothesis-first changes, and the *protected-config sentinel*
  pattern (CLAUDE.md rule + the testing-pyramid threshold comments) that
  marks load-bearing config so agents flag adjustments rather than make
  them silently.
- **Tampered release artifacts.** When this template eventually ships a
  CLI scaffolder or compiled `harness-*` binaries, a release artifact
  could be MITM'd or the GitHub asset could be overwritten. **Hardened
  by:** signed releases via Sigstore/Cosign keyless (§Controls 6,
  §Verification) — **standard, not wired today** because v0.4.0 ships
  only the forkable template, not binaries.
- **Compromised CI runner.** A GitHub Actions runner is owned and
  injects code into a build. **Hardened by:** immutable-digest action
  pinning (§Controls 2), least-privilege workflow tokens, and the
  `harness-sensors gate` self-check that runs against the harness's own
  code on every commit (CLAUDE.md "Eat our own dogfood" principle).
- **Compromised signing keys** (when signed releases land). **Hardened
  by:** Sigstore keyless identities + Rekor transparency log instead of
  long-lived signing keys (§Key handling).

## Controls

Eight controls form the security standard. Each names the slot or tool
that implements it, the state today, and the decision-doc anchor.

### 1. Lockfile policy

**State: standard; consumer-owned.** This template intentionally does **not**
commit lockfiles. Under the standalone / Option-2 model, fork consumers own
their dependency graph and generate lockfiles after `just init` / bootstrap:

- TypeScript / Node — `pnpm-lock.yaml` (ignored by the template).
- Rust — `Cargo.lock` (ignored by the template).
- Python — `uv.lock` (ignored by the template).
- Go — `go.sum` (ignored by the template).

Consumer projects SHOULD commit and review their own lockfiles once they have
chosen their application dependencies. The template's `.gitignore` keeps
canonical-template lockfiles out of the distributable seed so one consumer's
resolved graph is not presented as the upstream contract for every fork.

**Rationale:** A forkable template is not the application dependency owner.
Lockfile integrity is still important, but it belongs to the consumer repo
after initialization. Review lockfile bumps in the fork where the actual
dependency graph exists.

### 2. Pinned / immutable dependencies

**State: standard.** The template keeps its seed dependencies intentionally
minimal; consumer projects SHOULD pin production dependencies when the real
application graph appears:

- `package.json` entries pinned (e.g. `"vitest": "3.2.4"` not `"^3.2.4"`).
- `Cargo.toml` entries pinned (`tokio = "=1.42.0"` not `tokio = "1"`).
- `pyproject.toml` entries pinned via `==` in `requires` (or constraint
  files referenced from `tool.uv.sources`).
- GitHub Actions pinned by **commit SHA**, not tag (`uses: actions/checkout@a1b2c3d4...`
  not `@v5`). Mutable-tag overwrite is a real attack class.

**Rationale:** A tag and a broad semver range both mean "trust whatever the
upstream pushes next." Pinning to an immutable reference or a reviewed
consumer-owned lockfile means an attacker has to compromise a *specific*
artifact, and diff review catches the bump.

### 3. Transitive-dependency audit gates

**State: wired for pnpm; standard for the rest.** Per-ecosystem
audit-gate matrix:

| Ecosystem | Tool | Wiring | Block threshold |
|---|---|---|---|
| pnpm | `pnpm audit --audit-level=moderate` | CI (`.github/workflows/test.yml`) | moderate+ |
| Cargo | `cargo audit` ([RustSec advisory DB](https://rustsec.org/)) | **standard** (wire as a `just audit-rust` recipe, gate in CI before v0.4.0 ships consumer apps) | any unyielded advisory |
| uv / pip | `uv pip audit` or `pip-audit` ([PyPA tool](https://pypi.org/project/pip-audit/)) | **standard** | any advisory |
| Go | `govulncheck` ([Go's official tool](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck)) | **standard** (wire when first Go sub-repo lands) | any KNOWN advisory affecting an imported function |

The pre-push hook runs the audit gate locally (fast path: only re-runs
when the lockfile changed since the last successful run).

**Rationale:** Pinning a known-good version (§Controls 2) doesn't help
once a vulnerability is *disclosed* for that version. The audit gates
are the second layer: lockfile freezes the supply chain in place, audit
gates trip when something in that frozen graph is later found to be
malicious or vulnerable.

### 4. SAST (Static Application Security Testing)

**State: standard.** Per-language SAST runs in CI on the diff (fast
path) and on the full tree (nightly):

- TypeScript / JavaScript — [Semgrep](https://semgrep.dev/) with the
  `p/typescript`, `p/javascript`, and `p/owasp-top-ten` rulepacks.
- Python — Semgrep `p/python` + `p/django` (or framework-equivalent).
- Rust — `cargo clippy --all-targets -- -D warnings` is the baseline;
  `cargo deny check` for license + advisory enforcement at the audit
  layer (overlaps with §Controls 3).
- Go — `go vet ./...` baseline; `staticcheck` and `govulncheck` for
  deeper coverage.

The hooks slot (`docs/adrs/ADR-0003-hooks.md`) runs the diff-scope
variant in pre-push; the full tree runs in scheduled CI to avoid
slowing the commit loop.

**Rationale:** SAST catches a class of patterns lockfile + audit gates
can't see (e.g. an unsafe deserialization in *your own* code). The
template ships the rulepacks pinned to specific versions so the gate
is reproducible.

### 5. Secret scanning

**State: wired and fail-closed.** [Gitleaks v8](https://github.com/gitleaks/gitleaks)
runs in two places, both of which abort with an install hint rather
than soft-skipping when the scanner is missing:

- **Pre-commit hook** (`lefthook.yml` → `gitleaks protect --staged
  --redact --no-banner`) — blocks the commit if a staged file matches
  a credential pattern. Sub-second on a typical diff (measured: 1.06 s
  wall, 399 ms scan on an 8.4 KB staged set; see PR #22).
- **CI workspace-qa + fork-check jobs** (`.github/workflows/test.yml`)
  — install gitleaks via `taiki-e/install-action` and run the full
  `gitleaks detect` pass inside `pnpm qa` (`scripts/qa.ts`). Catches
  anything that slipped past pre-commit (e.g. a contributor with
  hooks uninstalled).

Both surfaces are **fail-closed**: a missing `gitleaks` binary exits
the gate with status 1 and a printed install hint, not a silent skip.
This is a deliberate departure from the soft-skip pattern other slots
follow (biome, ruff, hyperfine), because a missing secret scanner
means *no scan happened*, which is the exact failure mode a security
gate exists to prevent. Gitleaks is a single 6 MB Go binary, so the
install cost stays within bootstrap.

Contract is covered by `scripts/tests/secret-scan.test.ts`, which
proves end-to-end that:

1. a planted fake AWS access-key in a staged file is detected, and
2. a clean staged tree passes, and
3. both the lefthook hook body and the `scripts/qa.ts` shell program
   exit 1 with the install hint when `gitleaks` is stripped from
   `PATH` (i.e. the silent-soft-skip regression is caught
   mechanically, not by code review).

Rationale + tool pick: see `docs/adrs/ADR-0009-secret-scanner.md`.

**Allow-listing.** The project's `.gitleaksignore` file holds
documented exceptions (e.g. test fixtures with intentionally-fake
keys). Every entry MUST be reviewed; an entry with no explanatory
comment is a CI failure.

**Rationale:** Secrets in commits are the highest-frequency
self-inflicted breach. Detecting at commit time costs ~1 second;
detecting after a public push costs a key rotation + a postmortem.

### 6. Signed commits and releases

**State: standard for commits; standard-future for releases.**

- **Commits.** Lab maintainers' commits to the lab repo MUST be signed
  with either a hardware-backed SSH key (`git config gpg.format ssh`)
  or [gitsign](https://github.com/sigstore/gitsign) keyless. The lab's
  CODEOWNERS-gated sync PR is what reaches CHA; the signing requirement
  is enforced via GitHub's "Require signed commits" branch protection
  on `main` of both repos.
- **Releases.** When this template eventually ships compiled binaries
  (the future `create-harness-app` CLI in its separate repo, plus the
  `harness-sensors` / `harness-doc-validator` Rust crates), they MUST
  be:
  - Built in a hermetic CI environment (`actions/checkout@<sha>`,
    no external curls).
  - Signed via **Sigstore Cosign keyless** (GitHub Actions OIDC →
    Fulcio short-lived cert → Rekor transparency log entry).
  - Published with an attached **SLSA provenance** attestation and an
    **SPDX SBOM** so downstream verifiers can re-validate the supply
    chain end-to-end.
  - Reference-pinned by **immutable digest**, never by mutable tag.

See §Verification for what consumers do with these.

**Rationale:** Long-lived signing keys are the single highest-blast-radius
asset in any release pipeline. Keyless signing via OIDC + transparency log
removes the key from the equation — the signing identity is short-lived
and every signature is publicly auditable via Rekor.

### 7. UBS bug scanning

**State: wired.** The [Ultimate Bug Scanner](https://github.com/Dicklesworthstone/ultimate_bug_scanner)
runs in two places:

- **Pre-commit** (`lefthook.yml` → `ubs --staged --fail-on-warning`) —
  scans only the staged files; sub-second.
- **CI** (`.github/workflows/test.yml` → `ubs --ci --fail-on-warning .`) —
  full-tree scan.

UBS's category set (null safety, XSS / injection, async/await,
memory leaks, type narrowing, division-by-zero, resource leaks) covers
a class of bugs that orthogonally complement SAST and audit gates.
**For AI-written code specifically**, UBS catches patterns an agent
might generate that pass the type-checker but fail at runtime (the
`/data?.foo` vs `if (data) { data.foo }` family).

CLAUDE.md's UBS quick-reference (lab + scaffolded template) is the
contributor-facing rule: `ubs <changed-files>` before every commit;
fix root causes, not symptoms.

**Rationale:** Agents introduce a bug-class that orthogonal tools
miss. UBS's pattern set is large enough to be a meaningful third leg
of the gate triangle (SAST + audit + UBS).

### 8. Pre-commit and pre-push hook gates

**State: wired (lefthook chosen as the `hooks` slot plugin per
`docs/adrs/ADR-0003-hooks.md`).**

Lefthook drives the diff-scoped fast path so the commit loop stays
sub-second:

| Stage | Speed | What runs |
|---|---|---|
| **pre-commit** | sub-second | Biome format + lint on `{staged_files}`; Gitleaks staged-scan; UBS `--staged --fail-on-warning`; the global attribution `prepare-commit-msg` hook coexists via `core.hooksPath` |
| **pre-push** | a few seconds | Type-check and affected tests through Turbo's diff filter; UBS `--diff`; base ref selected from `harness.hookBaseRemote` / `harness.hookBaseRef`, then `harness.upstreamRef`, then `origin/main` fallback |

The concrete hook files are [`lefthook.yml`](./lefthook.yml) and
[`.claude/settings.json`](./.claude/settings.json). Lefthook writes UBS
findings to `.beads/ubs-findings.jsonl` via `--beads-jsonl`; the Claude
`PostToolUse` file-write hook runs
[`.claude/hooks/ubs-diff.sh`](./.claude/hooks/ubs-diff.sh), also
diff-scoped, so agent edits get a fast local bug scan before commit.
`scripts/init.ts` installs lefthook with `pnpm exec lefthook install --force`,
unsets any local `core.hooksPath`, and writes a local
`.git/hooks/prepare-commit-msg` wrapper that calls the operator's global
attribution hook when one is configured.

CI is the third tier: it re-runs everything plus the full-tree scans
(Gitleaks, SAST nightly, transitive audit).

Per the operator's diff-scope mandate: hooks NEVER run a full-repo
sweep per commit. The `--staged` / `{staged_files}` / `--diff`
selectors are non-negotiable. The `harness-sensors gate` self-check
runs in CI, not pre-commit, because it touches the whole tree.

**Rationale:** Slow hooks get bypassed (`git commit --no-verify`).
Fast hooks get respected and become a real control. Sub-second
pre-commit is the design target, not an aspiration.

## Verification

These steps tell a forking consumer that what they got is what the
canonical-template repo intended to ship.

### Verify the fork's origin

The canonical template is a **standalone** repo
(`syntropic137/harness-app-template`) — there is no live lab upstream
that flows changes in. Provenance is git-native and lives in
`.harness-provenance.json`, written once by `scripts/init.ts` at
`just init` time. See `docs/adrs/ADR-0015-cha-sync-source-of-truth.md`.

1. **Confirm the canonical commit.** After forking ("Use this template"
   or `git clone`), check:
   ```
   cat .harness-provenance.json
   ```
   You'll see fields including `canonical_repo`, `canonical_commit`
   (40-char SHA), and `forked_at` (ISO-8601). Cross-reference
   `canonical_commit` against the canonical repo:
   `<canonical_repo>/commit/<canonical_commit>`. Anything that
   disagrees with the committed file under git history is a tampered
   provenance — re-fork from a known-good upstream.

2. **Verify CODEOWNERS-gated merges.** Changes to the canonical repo
   land via PR, gated by `.github/CODEOWNERS`. The merge commit on
   `syntropic137/harness-app-template` should be signed by a CODEOWNERS-
   listed identity. GitHub's UI shows "Verified" for signed commits.

### Verify a release (future, when binaries ship)

When the future `create-harness-app` CLI and the `harness-*` Rust
binaries ship signed releases, the verification recipe (modelled on
UBS's) will be:

```sh
# Image / binary digest from the release notes (immutable):
DIGEST="ghcr.io/syntropic137/<artifact>@sha256:..."

# Verify the Cosign keyless signature:
cosign verify "$DIGEST" \
  --certificate-identity-regexp='https://github.com/syntropic137/.*' \
  --certificate-oidc-issuer='https://token.actions.githubusercontent.com'

# Verify the SBOM and SLSA provenance attestations:
cosign verify-attestation --type spdx "$DIGEST"
cosign verify-attestation --type https://slsa.dev/provenance/v1 "$DIGEST"
```

This is the same pattern as UBS uses for its containers and installer
artifacts; we deliberately mirror it so consumers who already verify
UBS releases don't have to learn a new ritual.

### Verify the gates run

```sh
just doctor        # validates every wired control's prerequisite tool is on PATH
lefthook run pre-commit --all-files  # forces a full local hook sweep
pnpm audit --audit-level=moderate    # transitive audit, JS side
ubs --ci --fail-on-warning .         # full UBS scan
```

If `just doctor` reports a missing tool, install it before relying on
the gates — silently-skipping gates are a worse posture than no gates
at all.

## Key handling

### Today: signed commits via SSH or gitsign

Maintainers configure either:

- **SSH key signing** (`git config --global gpg.format ssh` +
  hardware-backed key). Easiest to set up; tied to the contributor's
  identity. Suitable for individual maintainer commits.
- **[gitsign](https://github.com/sigstore/gitsign) keyless.** Uses the
  contributor's GitHub OIDC identity → Fulcio short-lived cert → Rekor.
  No long-lived key on disk. Suitable for CI bot identities too.

The lab's CODEOWNERS-gated `main` branch enforces "Require signed
commits" via GitHub branch protection.

### Future: release signing

The `create-harness-app` CLI's separate future repo and the
`harness-*` Rust binaries will sign via **Cosign keyless** (no
contributor-held private keys; CI's OIDC identity does the signing,
Rekor records the signature for public audit). This eliminates the
"compromised signing keys" threat by removing the keys: the signing
identity is short-lived and the transparency log makes any signature
discoverable.

### What we deliberately don't do

- **No long-lived release-signing keys.** Cosign keyless replaces
  minisign/PGP for new artifacts. The lab's lockfile commits + the
  sync-PR review process protect the template itself.
- **No bundled credentials in any artifact.** `.env.example` files
  ship; `.env` files are `.gitignore`d; secret-scanning enforces the
  rule.
- **No GitHub Actions tokens with write-all permissions.** Workflows
  declare least-privilege `permissions:` blocks at the workflow or
  job level.

## Reporting a security issue

If you find a vulnerability in this template — or in the lab repo, or
in a scaffolded artifact you got from a fork — please:

1. **Open a private GitHub Security Advisory** on the affected repo
   (Tools → Security → Advisories → "Report a vulnerability"). This is
   the preferred channel; GitHub's advisory workflow lets us collaborate
   on a fix before public disclosure.
2. **Or email the maintainers** if the issue is severe enough that a
   public advisory page would itself be a disclosure risk. The
   maintainer contact is published in the canonical CHA repo's
   `SECURITY.md` once that repo is split out; until then, route through
   the lab repo's maintainer (the operator owns the lab).

In your report, include:

- The affected repo + commit SHA (or release tag + binary digest, when
  releases ship).
- The verification output you saw vs the output the doc says you
  should have seen.
- Repro steps if applicable.
- Any context about *how* you discovered it (the harness's UBS / fitness
  sensors are themselves a security control — if one of them fired and
  you're reporting the finding, say so; we'll route the report differently).

We will acknowledge within **72 hours** and provide a status update within
**7 days**. Disclosure timelines follow [coordinated vulnerability disclosure](https://github.com/CERTCC/CERT-Guide-to-CVD)
norms — 90 days from acknowledgement is the default, shorter for
actively-exploited issues.

## References

- [UBS — `docs/security.md`](https://github.com/Dicklesworthstone/ultimate_bug_scanner/blob/main/docs/security.md) — the structural model this doc adapts.
- [Sigstore — Cosign](https://docs.sigstore.dev/cosign/) — keyless artifact signing.
- [Sigstore — gitsign](https://github.com/sigstore/gitsign) — keyless commit signing.
- [RustSec Advisory Database](https://rustsec.org/) — Rust transitive vulnerability source for `cargo audit`.
- [PyPA — pip-audit](https://pypi.org/project/pip-audit/) — Python audit tool.
- [Go — govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck) — Go vulnerability scanner.
- [Semgrep rules](https://semgrep.dev/explore) — SAST rule packs.
- [Gitleaks](https://github.com/gitleaks/gitleaks) — secret-scanner pick. See also `docs/adrs/ADR-0009-secret-scanner.md`.
- [Lefthook](https://github.com/evilmartians/lefthook) — hooks slot plugin. See also `docs/adrs/ADR-0003-hooks.md`.
- [Ultimate Bug Scanner](https://github.com/Dicklesworthstone/ultimate_bug_scanner) — UBS, the AI-coding-bug detector.
- [SLSA — Supply-chain Levels for Software Artifacts](https://slsa.dev/) — the framework `cosign verify-attestation --type slsa-provenance` checks against.
- [CERT/CC Guide to Coordinated Vulnerability Disclosure](https://github.com/CERTCC/CERT-Guide-to-CVD) — disclosure norms this doc references.

## Maintenance

This standard is reviewed every **six months** (next: 2026-11-29) or
when any of these conditions trip:

- A new CVE class affects one of the wired tools.
- A wired tool reaches end-of-maintenance (signal: > 6 months no
  release, or a maintenance advisory from upstream).
- A control's "standard" state is wired into CI (transition the row
  from `state: standard` → `state: wired` and bump the doc version).
- An incident response reveals a control that *should* have caught the
  threat — add it, with the incident retro linked.

Changes to this file land via the standard sync PR (per ADR
`docs/adrs/ADR-0015-cha-sync-source-of-truth.md`) — never patched
into the canonical CHA repo directly. The upstream-adapt rule applies.
