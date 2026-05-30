# `harness/stack` — stub for the `stack-manager` slot

> **Status:** stub (bead `agentic-harness-lab-impl-f-harness-7yf`, S1 r3.3 C20).
> The real `stack-manager` plugin (`rust-bollard-portpicker` per
> `harness.manifest.json#slots.stack-manager`) replaces this whole crate.

## Why this exists

The canonical template's dogfoodability promise (S1 r3.3 C13:
`git clone && just bootstrap && just test` succeeds on a fresh clone)
requires every declared slot to have a buildable, invokable placeholder
before the real plugin lands.

This stub provides:

- `Cargo.toml` + `src/{main,lib}.rs` — minimal Rust crate; `cargo check`
  + `cargo test` pass with the workspace's protected lints (`unsafe_code = "forbid"`,
  `unused = "deny"`, `clippy.all = "deny"`).
- `package.json` — six-line Turborepo wrapper (S1 r3.3 C4) so
  `pnpm turbo run build/test/lint` cache the slot.
- `bin` — executable bash shim the `justfile` delegates to via
  `just stack {{args}}`. Prints a one-line `[stub] ...` hint and exits 0.

## Replacing this stub

When the real plugin lands, swap the whole `harness/stack/` directory
with the plugin's source. The slot's contract is documented at
`docs/adr/ADR-0001-stack-manager.md` (per
`harness.manifest.json#slots.stack-manager.decisionAt`).

Concretely the replacement must keep:

- `[package].name = "harness-stack"` so the workspace `members` glob
  (`harness/<slot>`) keeps matching.
- An executable at `harness/stack/bin` so the existing `justfile`
  `just stack {{args}}` recipe doesn't break.
- A `package.json` with `scripts.build/test/lint` so Turborepo keeps
  caching it.

## Observability stack

For the observability-stack slot (OTel collector + Victoria* services),
see [`harness/observability/`](../observability/) (moved here from
`infra/{otel,docker}/` per S1 r3.2 C15 + this bead's commit).
