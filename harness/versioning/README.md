# harness/versioning

Conventional-commits gate + changelog generation + release tagging for
the template. Implements [ADR-0011](../../docs/adrs/ADR-0011-versioning.md).

## Run

```sh
just release-check                       # ci-check from latest v* tag → HEAD
just release-check <from-sha> <to-sha>   # explicit range (used by the PR CI step)
just release-plan                        # print next version + generated changelog entries
just release-apply patch|minor|major     # update CHANGELOG, bump manifest, commit, tag
```

## Conventional-commits gate

The Rust CLI lives at `harness/versioning/src/lib.rs`; `bin/versioning`
is the bash shim CI invokes. Two events drive it from
`.github/workflows/versioning.yml`:

| Event | Command run |
|---|---|
| `pull_request` | `just release-check <base.sha> <head.sha>` — explicit range, validates only this PR's commits |
| `push` to `main` | `just release-check` — implicit range, defaults to `<latest v* tag>..HEAD` |

When no `v*` tag exists, the implicit range falls back to **all of
HEAD's history** (per the CLI docstring "or all history when no tag
exists"). On a fresh consumer fork that has not yet cut its first
release, any single non-conventional commit anywhere in history (even
a pre-baseline scaffolding commit) trips the gate and the
`check / Check main release discipline` job stays red on every push.

The fix is to cut a baseline `v*` tag. Once one exists, ci-check only
validates the post-baseline range, which is exactly the contract the
versioning slot is designed around.

## Cutting a baseline tag (consumer fork bootstrap)

Pick a commit you want the gate to enforce from — typically the
current `main` HEAD at the moment you turn the gate on — and annotate
it as `v0.1.0`:

```sh
# from a fresh clone of your fork's default branch
git fetch origin
git tag -a v0.1.0 origin/main -m "Baseline release tag"
git push origin v0.1.0
```

That is the entire bootstrap. The next push to `main` runs ci-check
against `v0.1.0..HEAD` instead of `..HEAD`, the range contains only
your post-baseline conventional commits, and the gate goes green.

The template itself ships with a `v0.1.0` tag at the merge of PR #14
(`fix(versioning): cut v0.1.0 baseline tag …`) for the same reason —
see `CHANGELOG.md`'s `[0.1.0]` entry.

## Cutting subsequent releases

Once the baseline exists, normal releases go through the
`workflow_dispatch` path on `.github/workflows/versioning.yml`:

```sh
gh workflow run versioning --field level=auto    # auto-derive bump from conventional-commit types
gh workflow run versioning --field level=patch
gh workflow run versioning --field level=minor
gh workflow run versioning --field level=major
```

The `release` job runs `just release-apply <level>`, which updates
`CHANGELOG.md`, bumps `harness.manifest.json#version`, commits, tags,
and pushes both the commit and the tag.
