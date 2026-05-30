import { defineConfig } from 'vitest/config';

// ── HARNESS-ENGINEERING PROTECTED CONFIG ───────────────────────────────────
// DO NOT ADJUST THESE THRESHOLDS. The inspector slot is the agent's main
// evidence-capture surface (screenshot-pair, record-flow, keyframe-grid);
// a coverage drop here means agents lose their ability to verify fixes.
// Per Standard §2.5 testing-pyramid contract: refactor production code if
// a line is hard to cover, do not lower the threshold.
//
// PROTECTED: 100% all four dimensions. Per user directive — 100, not 90.
// ───────────────────────────────────────────────────────────────────────────
const COVERAGE_THRESHOLDS = {
  lines: 100,
  functions: 100,
  statements: 100,
  branches: 100,
} as const;

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,mts,mjs}'],
    coverage: {
      provider: 'v8',
      include: ['**/*.mjs'],
      exclude: ['tests/**', 'node_modules/**', 'coverage/**', '*.config.*'],
      reporter: ['text', 'text-summary'],
      thresholds: COVERAGE_THRESHOLDS,
    },
  },
});
