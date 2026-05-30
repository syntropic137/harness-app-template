---
name: "Inspector"
description: "Playwright inspector with spawned ffmpeg for evidence capture"
status: accepted
---

# ADR-0002: Inspector

**Date:** 2026-05-14
**Category:** Slot
**Next review:** 2026-11-14

## Context

The inspector slot must capture screenshot pairs, flow recordings, DOM snapshots, and reviewable visual evidence bundles. Browser-control alternatives do not yet match Playwright trace artifacts.

## Decision

Keep Playwright as the browser automation engine and invoke ffmpeg as a subprocess for video/keyframe post-processing.

## Consequences

The slot keeps best-in-class browser evidence capture at the cost of a Node-based toolchain for inspector workflows. Rust browser backends should only replace it after measured parity on trace-viewer-quality artifacts.

## Details

## Current pick

Keep the reference plugin on **Playwright (Node)** for browser control, with **ffmpeg invoked as a subprocess** (not via Rust bindings) for keyframe-grid and recording post-processing. Matches today's `harness/inspector/`.

## Justification

The inspector slot's contract requires `screenshot-pair`, `record-flow`, and `keyframe-grid` — i.e. screenshots, video, DOM snapshots, and trace-replayable bundles. Playwright 1.60 ships all four as first-class, batteries-included features: trace viewer with DOM snapshots + film-strip screencast, accessibility-tree access, video recording, `routeWebSocket`, and codegen ([Playwright release notes](https://playwright.dev/docs/release-notes), [trace viewer docs](https://playwright.dev/docs/trace-viewer)). None of the Rust candidates ship a comparable trace-viewer artifact today — chromiumoxide and headless_chrome are raw CDP clients, and fantoccini/thirtyfour are WebDriver clients that lose CDP-only features ([chromiumoxide GitHub](https://github.com/mattsse/chromiumoxide), [headless_chrome GitHub](https://github.com/rust-headless-chrome/rust-headless-chrome)). Per CLAUDE.md rule 0, we don't switch off the de-facto winner without measured parity.

The Standard's "Rust-first" rule explicitly marks this slot **Mixed** (§4.2) and names Playwright as the reasonable v0.1 posture. Inspector runs only during evidence capture (not in the inner loop), so the Node runtime cost is amortized.

## Maintenance signal

- Playwright: Microsoft-maintained, monthly cadence; 1.60.0 released 2026-05-11 ([release notes](https://playwright.dev/docs/release-notes)).
- chromiumoxide: active, last release 2026-02-25 ([crates.io](https://crates.io/crates/chromiumoxide)).
- headless_chrome: last release 2025-05-01 — ~12 months stale ([crates.io](https://crates.io/crates/headless_chrome)).
- fantoccini: active, last release 2026-02-03; thirtyfour at v0.36 actively maintained.
- ffmpeg-next: explicitly "maintenance-only" — new APIs require community PRs ([lib.rs](https://lib.rs/crates/ffmpeg-next)).

## License

Playwright: Apache-2.0. ffmpeg binary: LGPL/GPL depending on build. Rust crates surveyed: MIT/Apache-2.0 dual.

## Cross-platform

Playwright bundles per-platform browser binaries for macOS/Linux/Windows; ffmpeg binary available via Homebrew/apt/winget. Spawning ffmpeg avoids the linking and FFmpeg-version-pin pain of `ffmpeg-next`.

## Alternatives considered

- **chromiumoxide** — async CDP, healthy maint, but no trace-viewer equivalent; we'd rebuild Playwright's bundle format ourselves.
- **headless_chrome** — sync API, 12-month gap, weakest signal.
- **fantoccini / thirtyfour** — WebDriver-based; lose CDP-only signals (coverage, fine-grained network mocks) the inspector skill leans on.
- **Puppeteer** — Chrome-only; Playwright is a superset for our use case ([BrowserStack comparison](https://www.browserstack.com/guide/playwright-vs-puppeteer)).
- **`ffmpeg-next` Rust bindings** — maintenance-only mode; subprocess invocation is simpler and equally portable.

## Open issues / when to re-probe

Re-probe if (a) Playwright maintenance signal degrades, (b) a Rust crate ships a trace-viewer-equivalent artifact, or (c) Node runtime becomes a measured cost for the inspector path. Track as a running-experiments probe: "Rust+chromiumoxide inspector backend parity vs Playwright."

## Sources

- [Playwright release notes](https://playwright.dev/docs/release-notes)
- [Playwright trace viewer](https://playwright.dev/docs/trace-viewer)
- [Playwright vs Puppeteer 2026 — BrowserStack](https://www.browserstack.com/guide/playwright-vs-puppeteer)
- [chromiumoxide on GitHub](https://github.com/mattsse/chromiumoxide)
- [rust-headless-chrome on GitHub](https://github.com/rust-headless-chrome/rust-headless-chrome)
- [fantoccini on crates.io](https://crates.io/crates/fantoccini)
- [thirtyfour on GitHub](https://github.com/vrtgs/thirtyfour)
- [ffmpeg-next on lib.rs (maintenance-only notice)](https://lib.rs/crates/ffmpeg-next)
