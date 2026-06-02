// cli.integration.test.ts — integration tests that exercise the actual CLI
// binary as a subprocess (not via library import).
//
// Per CLAUDE.md / Standard §2.5 testing-pyramid: unit tests cover pure helpers
// in tests/main.test.ts; this suite covers the *process boundary* — env-var
// wiring, stdout JSON shape, exit code, wall-clock budget. The smoke-against-
// live-stack tier lives under experiments/<date>--polyglot-telemetry-smoke/.
//
// All tests run with HARNESS_TELEMETRY_DISABLED=1 so we don't need a live OTLP
// collector; we only assert the stdout JSON line shape.

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..');
const MAIN = resolve(APP_ROOT, 'src/main.ts');
const TELEMETRY = resolve(APP_ROOT, 'src/telemetry.ts');

const WALL_CLOCK_BUDGET_MS = 4000;

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Spawn the CLI as a real subprocess and capture stdout/stderr/exitCode.
 * Mirrors `npm start`: `node --import tsx --import ./src/telemetry.ts src/main.ts`.
 */
function runCli(env: Record<string, string> = {}): Promise<CliResult> {
  return new Promise((resolveRun, rejectRun) => {
    const started = Date.now();
    const proc = spawn(
      process.execPath,
      ['--import', 'tsx', '--import', TELEMETRY, MAIN],
      {
        cwd: APP_ROOT,
        env: {
          ...process.env,
          HARNESS_TELEMETRY_DISABLED: '1',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
    proc.on('error', rejectRun);
    proc.on('close', (code) => {
      resolveRun({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs: Date.now() - started,
      });
    });
  });
}

interface HelloLine {
  time: string;
  severity: string;
  service: string;
  traceId: string;
  msg: string;
}

/**
 * Find the first stdout line that parses as the hello-world JSON envelope.
 * Auto-instrumentations can emit unrelated lines on some platforms; we filter
 * for the one with `msg` containing "hello from".
 */
function findHelloLine(stdout: string): HelloLine | null {
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as Partial<HelloLine>;
      if (typeof parsed.msg === 'string' && parsed.msg.includes('hello from')) {
        return parsed as HelloLine;
      }
    } catch {
      // not JSON, skip
    }
  }
  return null;
}

describe('example-typescript CLI (subprocess)', () => {
  it('happy path: exits 0 and emits the hello-world JSON envelope', async () => {
    const { code, stdout, stderr, durationMs } = await runCli();

    expect(code, `stderr was: ${stderr}`).toBe(0);
    expect(durationMs).toBeLessThan(WALL_CLOCK_BUDGET_MS);

    const line = findHelloLine(stdout);
    expect(line, `no hello-world line in stdout: ${stdout}`).not.toBeNull();
    expect(line?.severity).toBe('INFO');
    expect(line?.service).toBe('example-typescript');
    expect(line?.msg).toMatch(/hello from example-typescript/);
    expect(line?.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // `traceId` is present in the JSON line; with HARNESS_TELEMETRY_DISABLED=1
    // the SDK never starts so `getActiveTraceId()` returns '' (no active span).
    // Empty-string traceId is the disabled-telemetry signal.
    expect(line?.traceId).toBe('');
  });

  it('honors OTEL_SERVICE_NAME override', async () => {
    const { code, stdout } = await runCli({ OTEL_SERVICE_NAME: 'custom-svc' });
    expect(code).toBe(0);
    const line = findHelloLine(stdout);
    expect(line).not.toBeNull();
    expect(line?.service).toBe('custom-svc');
  });
});
