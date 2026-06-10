// Dependency / supply-chain audit slot (ADR-0023-dependency-audit.md).
//
// Orchestrates a CVE audit across the three polyglot lanes the template
// scaffolds today (TypeScript via pnpm, Rust via cargo-audit, Python via
// pip-audit). Each lane runs independently; the script exits non-zero if
// ANY lane reports a HIGH/CRITICAL advisory or fails to run.
//
// Lane skipping: if a lane's manifest is absent (e.g. a fork that deleted
// the Python example) the lane is reported as `skip` and not counted as a
// failure. If a lane's TOOLING is absent (no pnpm / no cargo / no uv) the
// lane fails CLOSED — missing tooling means no audit, which means a
// known-vulnerable dep could slip through unobserved. The lefthook
// pre-push lockfile-integrity gate has the opposite posture (soft-skip)
// because it is an inner-loop ergonomics surface, not a security gate.

import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';
import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => SpawnResult;

export interface FsLike {
  exists: (path: string) => boolean;
  mkdirp: (path: string) => void;
  rm: (path: string) => void;
}

export interface DepAuditDeps {
  spawn: SpawnFn;
  fs: FsLike;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  exit: (code: number) => never;
  cwd: string;
  argv?: readonly string[];
}

export type LaneStatus = 'pass' | 'fail' | 'skip';

export interface LaneResult {
  lane: string;
  status: LaneStatus;
  reason: string;
}

// Cargo manifests audited individually. Each slot workspace ships its own
// `[workspace]` block (see Cargo.toml comments) so the root cargo-audit
// invocation only covers ws_apps/example-rust; the slot workspaces need
// their own pass.
export const CARGO_MANIFESTS: readonly string[] = Object.freeze([
  'Cargo.toml',
  'harness/doc-validator/Cargo.toml',
  'harness/versioning/Cargo.toml',
]);

// Python projects audited. uv exports each manifest's locked set to a
// requirements file that pip-audit then scans.
export const PYTHON_PROJECTS: readonly string[] = Object.freeze(['ws_apps/example-python']);

// Severity floor for the pnpm lane. `pnpm audit --audit-level=high` exits
// non-zero only on HIGH or CRITICAL advisories so a stray dev-only LOW does
// not block a release. cargo-audit + pip-audit do not have native severity
// filters; they fail on any advisory, which is fine because the RustSec /
// PyPI advisory dbs are noticeably lower-volume than the npm registry.
export const PNPM_AUDIT_LEVEL = 'high';

interface LaneRunOptions {
  cwd: string;
  spawn: SpawnFn;
  fs: FsLike;
  log: (message: string) => void;
  errLog: (message: string) => void;
}

function runJsLane(opts: LaneRunOptions): LaneResult {
  const { cwd, spawn, fs, log, errLog } = opts;
  if (!fs.exists(join(cwd, 'package.json'))) {
    return { lane: 'js', status: 'skip', reason: 'no package.json at repo root' };
  }
  if (!hasOnPath(spawn, 'pnpm')) {
    errLog('dep-audit[js]: pnpm not on PATH; failing CLOSED (cannot audit).');
    return { lane: 'js', status: 'fail', reason: 'pnpm missing' };
  }
  log(`dep-audit[js]: pnpm audit --audit-level=${PNPM_AUDIT_LEVEL} --prod`);
  const result = spawn('pnpm', ['audit', `--audit-level=${PNPM_AUDIT_LEVEL}`, '--prod'], {
    cwd,
  });
  if (result.stdout) log(result.stdout.trimEnd());
  if (result.stderr) errLog(result.stderr.trimEnd());
  if (result.status === 0) {
    return { lane: 'js', status: 'pass', reason: `no >=${PNPM_AUDIT_LEVEL} advisories` };
  }
  return {
    lane: 'js',
    status: 'fail',
    reason: `pnpm audit exited ${result.status}`,
  };
}

function runRustLane(opts: LaneRunOptions): LaneResult[] {
  const { cwd, spawn, fs, log, errLog } = opts;
  if (!fs.exists(join(cwd, 'Cargo.toml'))) {
    return [{ lane: 'rust', status: 'skip', reason: 'no Cargo.toml at repo root' }];
  }
  if (!hasOnPath(spawn, 'cargo')) {
    errLog('dep-audit[rust]: cargo not on PATH; failing CLOSED.');
    return [{ lane: 'rust', status: 'fail', reason: 'cargo missing' }];
  }
  if (!hasOnPath(spawn, 'cargo-audit')) {
    errLog('dep-audit[rust]: cargo-audit not on PATH; failing CLOSED.');
    return [{ lane: 'rust', status: 'fail', reason: 'cargo-audit missing' }];
  }
  const results: LaneResult[] = [];
  for (const manifest of CARGO_MANIFESTS) {
    if (!fs.exists(join(cwd, manifest))) {
      results.push({
        lane: `rust:${manifest}`,
        status: 'skip',
        reason: 'manifest absent',
      });
      continue;
    }
    log(`dep-audit[rust]: cargo audit --file ${dirname(manifest)}/Cargo.lock`);
    const gen = spawn('cargo', ['generate-lockfile', '--manifest-path', manifest], { cwd });
    if (gen.status !== 0 && gen.status !== null) {
      if (gen.stderr) errLog(gen.stderr.trimEnd());
      results.push({
        lane: `rust:${manifest}`,
        status: 'fail',
        reason: `cargo generate-lockfile exited ${gen.status}`,
      });
      continue;
    }
    const lockfile = join(dirname(manifest), 'Cargo.lock');
    const audit = spawn('cargo', ['audit', '--file', lockfile], { cwd });
    if (audit.stdout) log(audit.stdout.trimEnd());
    if (audit.stderr) errLog(audit.stderr.trimEnd());
    if (audit.status === 0) {
      results.push({
        lane: `rust:${manifest}`,
        status: 'pass',
        reason: 'no advisories',
      });
    } else {
      results.push({
        lane: `rust:${manifest}`,
        status: 'fail',
        reason: `cargo audit exited ${audit.status}`,
      });
    }
  }
  return results;
}

function runPythonLane(opts: LaneRunOptions): LaneResult[] {
  const { cwd, spawn, fs, log, errLog } = opts;
  if (PYTHON_PROJECTS.every((p) => !fs.exists(join(cwd, p, 'pyproject.toml')))) {
    return [{ lane: 'python', status: 'skip', reason: 'no Python projects found' }];
  }
  if (!hasOnPath(spawn, 'uv')) {
    errLog('dep-audit[python]: uv not on PATH; failing CLOSED.');
    return [{ lane: 'python', status: 'fail', reason: 'uv missing' }];
  }
  const results: LaneResult[] = [];
  const stagingDir = join(cwd, '.dep-audit');
  fs.mkdirp(stagingDir);
  try {
    for (const project of PYTHON_PROJECTS) {
      // Defensive iteration-time skip: PYTHON_PROJECTS is a static
      // one-element list today, so the outer .every() catches the
      // absent-project case. This branch fires only when a future
      // consumer adds a second entry and one of them is missing.
      /* v8 ignore start */
      if (!fs.exists(join(cwd, project, 'pyproject.toml'))) {
        results.push({
          lane: `python:${project}`,
          status: 'skip',
          reason: 'manifest absent',
        });
        continue;
      }
      /* v8 ignore stop */
      const reqPath = join(stagingDir, `${project.replace(/[\\/]/g, '_')}-requirements.txt`);
      log(`dep-audit[python]: uv export --project ${project} -> ${reqPath}`);
      // Emit hashes (uv export's default). pip-audit's --disable-pip
      // path requires either hashes OR --no-deps; --no-deps would skip
      // transitive scanning which is the whole point, so we keep hashes.
      // --no-emit-workspace drops the editable workspace members (which
      // have no hashes and would error pip-audit with "does not contain
      // a hash"); we only want to scan third-party deps anyway.
      const exp = spawn(
        'uv',
        [
          'export',
          '--project',
          project,
          '--no-dev',
          '--no-emit-workspace',
          '--format',
          'requirements-txt',
          '-o',
          reqPath,
        ],
        { cwd },
      );
      if (exp.status !== 0) {
        if (exp.stderr) errLog(exp.stderr.trimEnd());
        results.push({
          lane: `python:${project}`,
          status: 'fail',
          reason: `uv export exited ${exp.status}`,
        });
        continue;
      }
      log(`dep-audit[python]: uvx pip-audit -r ${reqPath}`);
      const audit = spawn('uvx', ['pip-audit', '-r', reqPath, '--disable-pip'], { cwd });
      if (audit.stdout) log(audit.stdout.trimEnd());
      if (audit.stderr) errLog(audit.stderr.trimEnd());
      if (audit.status === 0) {
        results.push({
          lane: `python:${project}`,
          status: 'pass',
          reason: 'no advisories',
        });
      } else {
        results.push({
          lane: `python:${project}`,
          status: 'fail',
          reason: `pip-audit exited ${audit.status}`,
        });
      }
    }
  } finally {
    fs.rm(stagingDir);
  }
  return results;
}

function hasOnPath(spawn: SpawnFn, tool: string): boolean {
  const probe = spawn('sh', ['-c', `command -v ${tool}`]);
  return probe.status === 0;
}

export interface DepAuditOptions {
  only?: 'js' | 'rust' | 'python' | null;
}

export function parseArgs(argv: readonly string[]): DepAuditOptions {
  const opts: DepAuditOptions = { only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--only' && i + 1 < argv.length) {
      const value = argv[i + 1];
      if (value === 'js' || value === 'rust' || value === 'python') {
        opts.only = value;
      }
      i += 1;
    }
  }
  return opts;
}

export function runDepAudit(
  deps: Pick<DepAuditDeps, 'spawn' | 'fs' | 'cwd'>,
  options: DepAuditOptions,
  log: (message: string) => void,
  errLog: (message: string) => void,
): LaneResult[] {
  const { spawn, fs, cwd } = deps;
  const ctx: LaneRunOptions = { cwd, spawn, fs, log, errLog };
  const results: LaneResult[] = [];
  const only = options.only;
  if (!only || only === 'js') results.push(runJsLane(ctx));
  if (!only || only === 'rust') results.push(...runRustLane(ctx));
  if (!only || only === 'python') results.push(...runPythonLane(ctx));
  return results;
}

export function summarize(results: readonly LaneResult[]): {
  passed: number;
  failed: number;
  skipped: number;
} {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.status === 'pass') passed += 1;
    else if (r.status === 'fail') failed += 1;
    else skipped += 1;
  }
  return { passed, failed, skipped };
}

export function main(deps: DepAuditDeps): void {
  const argv = deps.argv ?? [];
  const options = parseArgs(argv);
  deps.stdout.log(
    `dep-audit: scanning lanes (${options.only ?? 'js+rust+python'}); CVE floor: HIGH on pnpm, any on cargo+pip`,
  );
  const log = (m: string): void => deps.stdout.log(m);
  const errLog = (m: string): void => deps.stderr.error(m);
  const results = runDepAudit(
    { spawn: deps.spawn, fs: deps.fs, cwd: deps.cwd },
    options,
    log,
    errLog,
  );
  for (const r of results) {
    deps.stdout.log(`dep-audit[${r.lane}]: ${r.status.toUpperCase()} — ${r.reason}`);
  }
  const totals = summarize(results);
  deps.stdout.log(
    `dep-audit: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped`,
  );
  if (totals.failed > 0) {
    deps.exit(1);
    return;
  }
  deps.exit(0);
}

/* v8 ignore start */
function defaultSpawn(
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): SpawnResult {
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: options?.cwd,
    env: options?.env ?? process.env,
  };
  const result: SpawnSyncReturns<string> = nodeSpawnSync(command, [...args], spawnOptions);
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

const defaultFs: FsLike = {
  exists: (p: string): boolean => existsSync(p),
  mkdirp: (p: string): void => {
    mkdirSync(p, { recursive: true });
  },
  rm: (p: string): void => {
    rmSync(p, { recursive: true, force: true });
  },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main({
    spawn: defaultSpawn,
    fs: defaultFs,
    stdout: console,
    stderr: console,
    exit: (code: number): never => process.exit(code),
    cwd: process.cwd(),
    argv: process.argv.slice(2),
  });
}
/* v8 ignore stop */
