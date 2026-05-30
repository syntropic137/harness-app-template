# Decision: stack-manager — Rust binary (bollard + portpicker, shell-out to `docker compose`)

**Status:** active · **Date:** 2026-05-14 · **Next review:** 2026-11-14

## Current pick
- **Rust binary** combining [`bollard`](https://crates.io/crates/bollard) **v0.21.0** (released 2026-05-04) for daemon inspection, [`portpicker`](https://crates.io/crates/portpicker) for free-port allocation, and a thin shell-out to the official `docker compose` CLI for `boot`/`stop`/`destroy`.
- Picked over the current TS/Node `harness/stack/` because §4.1 of the Standard explicitly decorates this slot **Rust-first** (single binary, cross-platform, no Node runtime).
- Picked over `testcontainers-rs` because the slot ships a long-lived dev stack driven by a generated `compose.yml`, not ephemeral test fixtures.

## Justification
- `bollard` is the de-facto async Docker client for Rust, with **first-class Podman support and automatic rootless-socket discovery** ([repo](https://github.com/fussybeaver/bollard)) — matches the slot's runtime-agnostic intent.
- Generated compose files are best driven by the upstream `docker compose` binary directly; wrapping it avoids reinventing a compose engine and keeps parity with what users run by hand. `compose-rs`, `rusty-docker-compose`, and `docktopus` are all single-maintainer crates at v0.0.x ([compose-rs](https://crates.io/crates/compose-rs)) — too thin to depend on for a Standard reference plugin.
- `portpicker` is the dominant port-allocation crate (~492k downloads/month, 248 reverse deps per [lib.rs](https://lib.rs/crates/portpicker)) and replaces the ad-hoc Node port logic.
- Single static binary distributable via `cargo install` or release artifacts; eliminates the Node runtime dependency that today's `harness/stack/` pulls in.
- `shiplift` is unmaintained (~2021 last update, [crates.io](https://crates.io/crates/shiplift)); `bollard` absorbed the ecosystem.

## Maintenance signal
- `bollard`: 1,293 commits, v0.21.0 on 2026-05-04, tracks Docker API schema 1.52 ([GitHub](https://github.com/fussybeaver/bollard)). Active.
- `portpicker`: stable, low-churn-by-design, widely depended upon ([docs.rs](https://docs.rs/portpicker)).

## License
- `bollard`: **Apache-2.0** ([repo](https://github.com/fussybeaver/bollard)). `portpicker`: Unlicense/MIT. Both permissive, no copyleft risk.

## Cross-platform
- macOS, Linux: Unix-socket path. Windows: Named Pipes + HTTPS via Rustls feature flag in `bollard` ([docs.rs](https://docs.rs/bollard/latest/bollard/)). All three first-class.

## Alternatives considered
- **Keep TS/Node + `dockerode` v5.0.0** ([npm](https://www.npmjs.com/package/dockerode)) — violates the slot's Rust-first decoration; requires Node runtime in every consumer template.
- **`testcontainers-rs`** ([repo](https://github.com/testcontainers/testcontainers-rs)) — designed for test-scoped lifecycles, not a long-lived dev stack with a stable inspect contract.
- **`shiplift`** — unmaintained since ~2021.
- **`compose-rs` / `rusty-docker-compose` / `docktopus`** — pre-1.0, single-maintainer; shell-out to `docker compose` is lower-risk.

## Open issues / when to re-probe
- Re-probe if `bollard` adds a native compose-spec executor (would let us drop the shell-out).
- Re-probe if Podman Desktop ships a stable non-Docker-API compose runner we'd want to target directly.
- Windows named-pipe path needs an explicit smoke test before the v0.2 cut.

## Sources
- [bollard on crates.io](https://crates.io/crates/bollard)
- [fussybeaver/bollard GitHub](https://github.com/fussybeaver/bollard)
- [bollard 0.21.0 docs](https://docs.rs/bollard/latest/bollard/)
- [portpicker on lib.rs](https://lib.rs/crates/portpicker)
- [shiplift on crates.io (unmaintained)](https://crates.io/crates/shiplift)
- [testcontainers-rs releases](https://github.com/testcontainers/testcontainers-rs/releases)
- [compose-rs](https://crates.io/crates/compose-rs)
- [dockerode npm](https://www.npmjs.com/package/dockerode)
