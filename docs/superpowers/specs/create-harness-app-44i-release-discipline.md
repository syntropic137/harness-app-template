# create-harness-app-44i Release Discipline

## Status

Draft for swarm review.

## Context

The template already has a `harness/versioning` slot and `cog.toml`, but the slot only checks that a detected manifest version appears in `CHANGELOG.md`. Bead `create-harness-app-44i` needs a complete release discipline that ties version calculation, changelog generation, and Git tags together, with the same checks available locally and in GitHub Actions.

## Design

- Use Git tags with the `vMAJOR.MINOR.PATCH` shape as the project release version source.
- Parse conventional commits in the versioning slot, compatible with cocogitto style commit headers.
- Compute the next release level from commits since the latest release tag:
  - breaking change marker or `BREAKING CHANGE:` footer: major
  - `feat`: minor
  - `fix`, `perf`, `refactor`, `docs`, `build`, `ci`, `test`, `chore`, `plan`, `proposal`, `experiments`, `retrospective`: patch when the commit is changelog eligible
- Generate Keep a Changelog style entries from conventional commits and require at least one changelog eligible commit for a PR or release.
- On release, update `CHANGELOG.md`, create a release commit, and create an annotated `vX.Y.Z` tag.
- Keep the implementation under `harness/versioning`; do not touch sensors or stack.

## Local Interface

- `just release-check [from] [to]`: verify conventional commits and generated changelog coverage.
- `just release-plan [from] [to]`: print the computed next version and changelog entries.
- `just release-dry-run [level]`: show the release plan without changing files.
- `just release-apply [level]`: update changelog, commit, and tag.

## CI Interface

- Pull requests run the versioning tests and `release-check` over the PR commit range.
- Pushes to `main` run the same checks since the latest release tag.
- Manual `workflow_dispatch` with a release level runs `release-apply` and pushes the release commit and tag.

## Review Ask

Please check whether tag based versioning and generated changelog enforcement are acceptable for this template, and whether the just recipe names fit the current task runner style.
