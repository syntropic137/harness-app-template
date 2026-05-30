# Decision: secret-scanner — Gitleaks

**Status:** active · **Date:** 2026-05-16 · **Next review:** 2026-11-16

> The slot is `secret-scanner`. Today's pick is Gitleaks. This doc captures
> the rationale so a future swap (or a confirmation-on-review) lands as
> evidence, not opinion.

## Current pick

- **Gitleaks v8.24.2** (last release date per [github.com/gitleaks/releases](https://github.com/gitleaks/gitleaks/releases))
- **License:** MIT (permissive; ships freely in the template)
- **Binary size:** 6.41 MB single Go binary ([Kali Linux pkg info](https://www.kali.org/tools/gitleaks/))
- **Install:** `brew install gitleaks` on macOS, `taiki-e/install-action@v2` in GitHub Actions, `apt`/`yum` on Linux. No language-runtime dep.

## Justification

- **Zero language-runtime dep** — same install model as `just`, `lefthook`, `sentrux`. Does NOT propagate as an npm/pip/cargo dep into scaffolded projects.
- **MIT license** — clean for shipping in a template. TruffleHog's AGPL-3.0 is a copyleft + network-service-clause blocker.
- **Millisecond-class pre-commit** — regex-based, no API verification calls. Doesn't slow the inner loop.
- **700+ credential patterns** maintained by an active community ([release cadence](https://github.com/gitleaks/gitleaks/releases)).
- **Industry pattern** — comparison articles converge on "Gitleaks pre-commit + TruffleHog in CI" if both are needed; we adopt the Gitleaks-only path now and revisit if AGPL clears or if we need verified-secret semantics later.

## Maintenance signal

- Regular releases (multiple in 2026 to date per the GitHub releases page).
- Active community / issues; bug fixes + rule updates ship continuously.

## License

- MIT — permissive; redistribute freely.

## Cross-platform

- macOS / Linux / Windows: all first-class (single binary per platform).

## Alternatives considered

- **TruffleHog** — AGPL-3.0 blocker for template distribution; slower pre-commit due to verification API calls. Still appropriate for **CI-only** if we later add a deeper sweep stage. See [docs.trufflesecurity.com 2026](https://docs.trufflesecurity.com/2026-march).
- **detect-secrets** (Yelp, Apache-2.0) — strong, baseline-file workflow good for legacy repos. But Python-runtime dep; loses Gitleaks's zero-runtime-dep property. Pick this if we ever need precision-over-recall enterprise semantics ([NomadX comparison 2026](https://devsecops.ae/secrets-scanners-comparison-2026/)).
- **Custom Rust scanner** — considered. Rejected because recreating 700+ maintained credential patterns badly is a security regression, not a dep-reduction win. The maintenance burden of a bespoke regex-set outweighs the install-footprint saving. We use Gitleaks for breadth; if we ever need a niche detector Gitleaks doesn't have, a custom adapter can wrap it under the same slot contract.

## When to re-probe

- TruffleHog relicenses away from AGPL.
- A credential-class lands in the wild that Gitleaks doesn't pattern-match (file a hypothesis-first probe).
- A measured perf regression makes Gitleaks slower than the 1s promotion criterion.
- A future maintainer-subcommand workflow needs verified-secret semantics (Gitleaks's regex-only mode doesn't validate that a detected pattern is a live credential; TruffleHog does). At that point a CI-only deeper sweep is the right second layer.

## Sources

- [Gitleaks releases](https://github.com/gitleaks/gitleaks/releases) (v8.24.2 + earlier 2026 versions)
- [Gitleaks binary size — Kali Linux package](https://www.kali.org/tools/gitleaks/)
- [detect-secrets vs Gitleaks vs TruffleHog 2026 — NomadX](https://devsecops.ae/secrets-scanners-comparison-2026/)
- [Gitleaks vs TruffleHog 2026 benchmarks — AppSecSanta](https://appsecsanta.com/sast-tools/gitleaks-vs-trufflehog)
- [TruffleHog 2026 docs](https://docs.trufflesecurity.com/2026-march) (license + verification)
- [Pre-commit hooks for secret detection — Rafter](https://rafter.so/blog/secrets/pre-commit-hooks-secret-detection)
