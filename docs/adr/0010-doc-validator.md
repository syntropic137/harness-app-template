# Decision: doc-validator — custom Rust crate at harness/doc-validator/

**Status:** active · **Date:** 2026-05-16 · **Next review:** 2026-11-16

## Current pick

- **Custom Rust crate** at `harness/doc-validator/`
- **License:** lab-internal (MIT-equivalent posture)
- **Binary size target:** ≤1 MB single binary
- **Scope:** internal cross-refs only — relative paths + intra-file anchors in `.md` files. External URL validation is **out of scope** (different cost shape; if needed later, file a separate proposal).

## Justification

- **Narrow scope = trivial maintenance.** Walking `.md` files + matching `]\(<path>\)` + checking the path exists is ~150 LoC. Easier to maintain than a third-party tool.
- **Zero language-runtime dep.** Mirrors the Gitleaks reasoning: single binary, no Python/Node/Go ecosystem tax.
- **Fast (target <2s for full lab scan).** Lychee is fast too but is another binary to install + an extra step in `just bootstrap`.
- **Tight integration with the harness slot architecture.** Same `[lints]` block as `harness/sensors/`, same precedent as `harness/downstream-crawler/`.
- **The lab is already a multi-binary Rust toolchain** — adding one more is marginal cost.

## Maintenance signal

- Internal — change cadence is whatever the lab dictates.
- Test coverage budget: 100% lines/branches/statements/functions on the lib surface (PROTECTED, per Standard §2.5).

## License

- Internal to the lab; permissive.

## Cross-platform

- macOS / Linux first-class. Windows: best-effort (path-separator handling already covered by `Path::join` semantics).

## Alternatives considered

- **lychee** (Rust, Apache-2.0, 2.0+ MB binary, async, full external-URL handling) — overkill for our scope; adds an install step. Pick this if external URL validation becomes load-bearing.
- **markdown-link-check** (Node) — adds an npm runtime + Node version pin. Rejected for the same dep-bloat reason that drove Gitleaks-over-detect-secrets.
- **mlc** (Rust, smaller than lychee) — similar story to lychee; not worth the install step for our internal-only scope.

## When to re-probe

- External URL validation becomes load-bearing (e.g., the docs ship to the public web and dead external links become a real cost).
- The custom crate's scope creeps past ~400 LoC — at that point, switch to lychee + maintain a thin wrapper.
- A markdown parser-edge case bites us repeatedly; switch to a tree-sitter-md or pulldown-cmark backed implementation (still in-crate, just a different scanner).

## Sources

- [lychee on GitHub](https://github.com/lycheeverse/lychee) (for the alternative pick if scope changes)
- This decision doc + the in-crate README at `harness/doc-validator/README.md`
