# Sensors, Coverage, and Baselines

This page defines the fork-readiness policy for app coverage and the sensors gate.

## Per-App Unit Coverage

Every `ws_apps/*` member that uses Vitest must opt in to the template per-app coverage policy:

```ts
const PER_APP_UNIT_COVERAGE_THRESHOLDS = {
  lines: 100,
  functions: 100,
  statements: 100,
  branches: 100,
} as const;
```

The app Vitest config must set `coverage.all = true` and `coverage.include = ['src/**/*.ts']` so new source files are counted even before a test imports them. This prevents a new module from silently escaping the 100 percent bar.

Integration and live-stack smoke tests are separate from unit coverage. They prove process and network boundaries, but they do not replace the per-app unit threshold.

When adding a new Vitest app:

1. Copy the threshold object into the app's `vitest.config.ts`.
2. Set `coverage.all = true`.
3. Scope `coverage.include` to the app's source files.
4. Keep the policy rationale here, not in a long config comment.

## Sensors Gate Verdict

`just sensors gate` compares the current architecture and APSS readings against `harness/sensors/baseline.json`.

The first line of the gate report is the verdict:

```text
VERDICT: PASS sensors gate
```

or:

```text
VERDICT: FAIL sensors gate
```

The verdict line is intentionally first so it stays visible even when adapter output, banners, or APSS dimension details are noisy.

## New Module Baseline Flow

Adding a new `ws_apps/*` or `ws_packages/*` module can introduce new folders or APSS readings that have no committed baseline yet. That is not automatically a failure, but it means the new module has not become part of the regression floor.

Use this flow when the new module is intentional:

```sh
just sensors gate
just sensors gate --update-baseline
git diff -- harness/sensors/baseline.json
```

Review the baseline diff before committing it. The diff should show only readings that belong to the intentional new or refactored module. Commit `harness/sensors/baseline.json` in the same change as the module so future runs can detect regressions.

Do not run `--update-baseline` to hide an unexplained regression. Fix the code or document the design change first, then update the baseline deliberately.
