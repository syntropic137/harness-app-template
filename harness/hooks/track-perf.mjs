#!/usr/bin/env node
// track-perf — wrap a test/build command, capture wall-clock + exit code,
// append a row to metrics/test-performance.csv.
//
// Usage:
//   node harness/hooks/track-perf.mjs \
//     --suite=vitest-workspace --language=ts --phase=test \
//     -- pnpm -r test
//
// One row per invocation. Append-only file. .gitattributes sets
// `merge=union` on the CSV so branch merges accumulate rows rather
// than conflict.
//
// Hypothesis + measurement: experiments/2026-05-14--test-perf-csv--time-series/

import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv) {
  const out = { flags: {}, cmd: [] };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') {
      out.cmd = argv.slice(i + 1);
      break;
    }
    if (a.startsWith('--')) {
      const [k, ...v] = a.replace(/^--/, '').split('=');
      out.flags[k] = v.join('=') || 'true';
    }
    i++;
  }
  return out;
}

function capture(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const { flags, cmd } = parseArgs(process.argv.slice(2));
if (cmd.length === 0 || !flags.suite || !flags.language || !flags.phase) {
  console.error(
    'usage: track-perf.mjs --suite=<name> --language=<ts|rust|python|cpp> --phase=<test|coverage|lint|build> -- <cmd> [args...]',
  );
  process.exit(2);
}

const csvPath = join(process.cwd(), 'metrics', 'test-performance.csv');
mkdirSync(join(process.cwd(), 'metrics'), { recursive: true });
if (!existsSync(csvPath)) {
  writeFileSync(
    csvPath,
    'ts,commit_sha,branch,suite,language,phase,duration_ms,test_count,pass_count,exit_code\n',
  );
}

const startedAt = new Date();
const startNs = process.hrtime.bigint();

const child = spawn(cmd[0], cmd.slice(1), { stdio: ['inherit', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (b) => {
  process.stdout.write(b);
  stdout += b.toString();
});
child.stderr.on('data', (b) => {
  process.stderr.write(b);
  stderr += b.toString();
});

child.on('exit', (code, signal) => {
  const durationMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
  const exitCode = code ?? (signal ? 130 : 1);

  // Heuristic counts from common runner output. Each runner's machine-readable
  // mode would be cleaner; this is the v0 — captures what's easy + leaves room
  // to swap in JSON reporters later.
  const combined = `${stdout}\n${stderr}`;
  let testCount = 0;
  let passCount = 0;

  // vitest: "Tests  25 passed (25)" or "Tests  25 passed | 1 skipped (26)"
  const vitestMatch = combined.match(/Tests\s+(\d+)\s+passed.*\((\d+)\)/);
  if (vitestMatch) {
    passCount = Number.parseInt(vitestMatch[1], 10);
    testCount = Number.parseInt(vitestMatch[2], 10);
  }

  // cargo test: "test result: ok. N passed; M failed; ..."
  if (testCount === 0) {
    const cargoMatch = combined.match(/test result:.*?(\d+)\s+passed;\s+(\d+)\s+failed/);
    if (cargoMatch) {
      passCount = Number.parseInt(cargoMatch[1], 10);
      testCount = passCount + Number.parseInt(cargoMatch[2], 10);
    }
  }

  // pytest: "===== N passed in X.XXs ====="  or  "N passed, M failed"
  if (testCount === 0) {
    const pytestPassFail = combined.match(/(\d+)\s+passed.*?(\d+)\s+failed/);
    const pytestPassOnly = combined.match(/(\d+)\s+passed\s+in/);
    if (pytestPassFail) {
      passCount = Number.parseInt(pytestPassFail[1], 10);
      testCount = passCount + Number.parseInt(pytestPassFail[2], 10);
    } else if (pytestPassOnly) {
      passCount = Number.parseInt(pytestPassOnly[1], 10);
      testCount = passCount;
    }
  }

  const sha = capture('git', ['rev-parse', '--short', 'HEAD']) || 'unknown';
  const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';

  const row = `${[
    startedAt.toISOString(),
    sha,
    branch,
    flags.suite,
    flags.language,
    flags.phase,
    durationMs,
    testCount,
    passCount,
    exitCode,
  ].join(',')}\n`;
  appendFileSync(csvPath, row);

  console.error(
    `[track-perf] ${flags.suite}/${flags.language}/${flags.phase}: ${durationMs}ms, tests=${testCount} pass=${passCount} exit=${exitCode} → ${csvPath}`,
  );
  process.exit(exitCode);
});
