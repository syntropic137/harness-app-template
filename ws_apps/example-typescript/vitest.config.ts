import { defineConfig } from 'vitest/config';

// ── HARNESS-ENGINEERING PROTECTED CONFIG ───────────────────────────────────
// DO NOT ADJUST THESE VALUES. They encode the testing-pyramid contract from
// `docs/standard/v0.1.md` for the telemetry-sdk slot's reference example.
//
// Unit coverage is set higher than the (smaller) Rust/Python defaults because
// this example is the smallest in the polyglot set — a couple of pure
// functions plus an entry point. 100% on a 60-line surface is trivial and
// worth enforcing. If you find a line you cannot cover, refactor the
// production code (e.g. extract a pure helper, hoist i/o), do not lower
// the threshold.
//
// Integration / end-to-end coverage is the running-experiments smoke probe
// path; it lives under `experiments/<date>--polyglot-telemetry-smoke/` and
// is verified manually against a booted observability stack. See
// retrospective 021 for the bug class that only end-to-end testing catches.
// ───────────────────────────────────────────────────────────────────────────
const UNIT_COVERAGE_THRESHOLDS = {
  lines: 100,
  functions: 100,
  statements: 100,
  branches: 100, // PROTECTED: 100% all four dimensions. Per user directive.
} as const;

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      thresholds: UNIT_COVERAGE_THRESHOLDS,
    },
  },
});
