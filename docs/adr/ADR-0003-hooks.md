---
name: "Hooks"
description: "Use lefthook for fast polyglot Git hooks"
status: accepted
---

# ADR-0003: Hooks

**Date:** 2026-05-14
**Category:** Slot
**Next review:** 2026-11-14

## Context

The template needs fast, diff-scoped Git hooks that work across TypeScript, Rust, Python, and Go without forcing every consumer into one language runtime.

## Decision

Use lefthook with staged-file filtering, parallel command execution, and a language-agnostic `lefthook.yml`.

## Consequences

Contributors get a single hook runner with per-language skip behavior. Hook commands must remain fast and scoped; if lefthook maintenance stalls or a Rust-native polyglot runner reaches parity, re-evaluate.

## Details

## Current pick

**lefthook** (evilmartians/lefthook), latest v2.1.6 (April 2026) — single Go binary, language-agnostic config in `lefthook.yml`, parallel command execution, native staged-file filtering via `{staged_files}` + `glob`/`exclude` selectors.

## Justification

Lefthook is the only candidate that satisfies every v0.1 slot constraint without compromise:

- **Polyglot-first (slot rule):** distributed as a dependency-free Go binary; does not require Node, Python, or Ruby on contributor machines, so a Rust-only or Python-only consumer of the Standard isn't forced to install an alien runtime ([lefthook.dev][1], [pkgpulse][2]).
- **Skip-when-not-staged (explicit slot contract requirement):** `glob:` patterns cause a command to be skipped entirely if no staged files match, and `{staged_files}` is the canonical placeholder for per-language commands ([lefthook exclude docs][3], [d4b.dev][4]). Cleanest per-language-skip story of any candidate.
- **`run --all` <10s promotion criterion:** parallel execution is first-class (`parallel: true`), which is the published differentiator vs husky+lint-staged (sequential per-file) and pre-commit (Python startup + sequential by default) ([johal.in benchmark][5], [edopedia][6]).
- **Monorepo fit:** the `root:` option scopes commands to a subtree and only fires when staged files live in that subtree ([pkgpulse][2]) — matches our `ws_apps/` + `ws_packages/` layout.

The Rust-first principle for harness tooling applies to **our glue** (wrapper binary in `harness/hooks/`), not the engine itself. No Rust-native candidate clears the bar: cargo-husky/husky-rs/rhusky/rusty-hook are all Rust-project-scoped (assume `Cargo.toml`, hooks installed via `cargo build`), which fails polyglot-first ([husky-rs][7], [rhusky][8]).

## Maintenance signal

Active. Lefthook v2.1.6 shipped ~April 2026; release cadence is monthly with dependency bumps and bugfixes ([releases][9]). Evil Martians is the maintainer org.

## License

MIT.

## Cross-platform

macOS, Linux, Windows — single static binary, prebuilt for all three. Distributable via brew, mise, npm wrapper, or direct download.

## Alternatives considered

- **husky 9** — Node-required, sequential, splits config across `.husky/*` shell scripts + `package.json` lint-staged config; ergonomically inferior and fails polyglot-first ([pkgpulse][2], [edopedia][6]).
- **pre-commit.com** — strong ecosystem but Python-required, slower (interpreter startup + sequential default) ([0xdc.me][10]).
- **simple-git-hooks** — Snyk reports maintenance status **Inactive** ([snyk][11]); fails the "research-backed re-confirmation" bar.
- **husky-rs / rusty-hook / cargo-husky / rhusky** — Rust-project-scoped, install via cargo build hooks, fail polyglot-first ([husky-rs][7]).

## Open issues / when to re-probe

- Re-probe at v0.2 if a Rust-native polyglot hook engine emerges with feature parity (parallel + staged-file globs + language-agnostic config).
- Re-probe if lefthook's release cadence stalls >6 months or evilmartians archives the repo.
- Open: confirm `just hooks run --all` <10s on a populated template — pending the promotion experiment.

## Sources

[1]: https://lefthook.dev/ "What is Lefthook? — lefthook.dev"
[2]: https://www.pkgpulse.com/guides/husky-vs-lefthook-vs-lint-staged-git-hooks-nodejs-2026 "husky vs lefthook vs lint-staged 2026 — PkgPulse"
[3]: https://lefthook.dev/configuration/exclude.html "exclude — Lefthook docs"
[4]: https://www.d4b.dev/blog/2026-02-18-using-lefthook-to-manage-git-hooks-across-a-team "Using Lefthook to Manage Git Hooks Across a Team — d4b"
[5]: https://johal.in/comparison-husky-90-vs-lefthook-16-git-hook/ "Husky 9 vs Lefthook 1.6: Git Hook Benchmarks for Monorepos"
[6]: https://www.edopedia.com/blog/lefthook-vs-husky/ "Lefthook vs Husky: Which Git Hooks Tool is Better? 2026"
[7]: https://github.com/pplmx/husky-rs "husky-rs — pplmx/husky-rs"
[8]: https://github.com/dataroadinc/rhusky "rhusky — dataroadinc/rhusky"
[9]: https://github.com/evilmartians/lefthook/releases "Releases — evilmartians/lefthook"
[10]: https://0xdc.me/blog/git-hooks-management-with-pre-commit-and-lefthook/ "Git hooks management with pre-commit and lefthook — 0xDC"
[11]: https://security.snyk.io/package/npm/simple-git-hooks "simple-git-hooks — Snyk"
