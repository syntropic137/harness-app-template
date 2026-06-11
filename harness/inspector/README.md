# harness/inspector

Browser-only evidence capture for the debug-fix-verify loop, built on
Playwright (per ADR-0002) with ffmpeg as a subprocess. All cross-platform
Node; everything dispatches through `just inspector <command>`.

| Command | Purpose |
|---|---|
| `screenshot-pair` | Capture a before/after PNG (plus an LLM-optimized JPEG copy) of a URL |
| `record-flow` | Drive a scripted user flow, recording WebM video, a keyframe grid, and `events.jsonl` (console, page errors, failed requests, 4xx/5xx responses) |
| `keyframe-grid` | ffmpeg wrapper: 3x3 keyframe grid (1 fps sample) from a WebM |

## Quick start

```sh
just inspector screenshot-pair --phase=before --url=http://localhost:3000/
# ...apply the fix...
just inspector screenshot-pair --phase=after  --url=http://localhost:3000/

just inspector record-flow --phase=after --url=http://localhost:3000/ \
  --flow=navigate --evidenceMode=animation

just inspector keyframe-grid .harness/artifacts/<iso>/video/flow-after.webm grid.jpg
```

Output goes to `.harness/artifacts/<iso_key>/` (gitignored). The iso key is
auto-discovered from the stack-manager slot (`harness/stack/bin/stack
inspect`); pass `--isoKey=<key>` to override or when the stack tooling is
not installed.

## Flows

`record-flow` runs one flow per invocation:

- `--flow=navigate`: built-in generic flow; loads the URL, waits for network
  idle, then one second for animations. Works against any page.
- `--flow=task-crud`: built-in example of an app-specific flow (create and
  complete a task via `data-testid` locators).
- `--flowFile=<path>`: your own scripted flow. An ES module whose default
  export (or named `flow` export) is `async (page, baseUrl) => void`, where
  `page` is a Playwright Page:

```js
// flows/login.mjs
export default async function flow(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill('demo@example.com');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Dashboard').waitFor();
}
```

`--evidenceMode` controls which artifacts are produced (taxonomy in
`.claude/skills/before-after-evidence/SKILL.md`): `network`,
`visual-interaction`, `visual-static`, `animation`, or `all` (default).

## Exit codes and input validation

- `0`: capture succeeded.
- `1`: the flow itself threw (`record-flow` only). Evidence captured up to
  the failure is still written and the summary JSON carries a `flowError`
  field, but callers gating on the exit code see the failure.
- `2`: usage or validation error. `--phase` must be exactly `before` or
  `after`, and the iso key (passed or detected) must match
  `[A-Za-z0-9][A-Za-z0-9._-]*` so it cannot escape the
  `.harness/artifacts/` root.

## Testing

Unit tests mock Playwright and hold the protected 100 percent coverage
thresholds. `tests/integration.test.ts` additionally drives the real
scripts with a real chromium against a locally served page, writing
artifacts to a temp dir; it skips when browsers are not installed unless
`CI_REQUIRE_BROWSERS=1` (the `scripts` CI job installs chromium and sets
the flag, so the live path is fail-closed there).

## Requirements

- **Playwright** is a dependency of this package; `pnpm install` at the repo
  root provides it. Browsers install separately:
  `pnpm exec playwright install chromium`.
- **ffmpeg** resolution order: `HARNESS_FFMPEG` env var, system PATH
  (`brew install ffmpeg` / `apt install ffmpeg`), then the ffmpeg bundle from
  the Playwright browser cache. Note the bundled build is minimal: it can
  decode WebM but cannot decode PNG or encode JPEG, so with only the bundle
  available the JPEG/grid steps degrade gracefully (PNG and WebM evidence is
  still captured and the skip is logged to `events.jsonl`).

## Companion dirs

- `harness/stack/` operates the docker-compose service stack and owns the
  per-worktree iso key
- `harness/hooks/` pre-commit + test-runner wrappers (Lefthook-driven)
