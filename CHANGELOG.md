# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The versioning slot enforces conventional commits, generated changelog entries,
and `vMAJOR.MINOR.PATCH` release tags. See `docs/adrs/ADR-0011-versioning.md`
for the pick rationale.

## [Unreleased]

- (Add your first changelog entry here.)

## [0.1.0] - 2026-06-10

### Baseline

- Baseline tag for `harness-versioning` ci-check. Before this tag the
  `check / Check main release discipline` gate scanned the entire
  117-commit pre-baseline history on every push to `main` and tripped
  on a handful of non-conventional commits from early scaffolding (one
  `Revert "..."` + four `experiments: ...` WIP commits). With v0.1.0
  in place, ci-check validates only `v0.1.0..HEAD`, which is all
  conventional, and the gate is functional again.
- `v0.1.0` is a baseline marker only — it points at the merge of
  PR #13 (`fix(sensors): revert non-reproducible folder floor for
  example-typescript/src`), which was the `main` HEAD at the moment
  the baseline was cut. It is not a published release; the canonical
  template version pointer remains `harness.manifest.json#version`.
- Forks: re-cut your own baseline tag at the commit you want the gate
  to enforce from. See `harness/versioning/README.md` for the
  one-liner.
