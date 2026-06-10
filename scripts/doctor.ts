import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const required = ['bun', 'pnpm', 'git', 'cargo', 'uv', 'just'];
const provenanceFile = '.harness-provenance.json';
const requiredProvenanceFields = [
  'schemaVersion',
  'mode',
  'template',
  'templateVersion',
  'standardVersion',
  'canonical_repo',
  'canonical_commit',
  'forked_at',
] as const;

const INSTALL_HINTS: Record<string, string> = {
  bun: 'curl -fsSL https://bun.sh/install | bash',
  pnpm: 'npm install -g pnpm  (or: corepack enable && corepack prepare pnpm@latest --activate)',
  git: 'install via your OS package manager (apt install git / brew install git)',
  cargo: 'install Rust via https://rustup.rs',
  uv: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
  just: 'cargo install just  (or: brew install just / apt install just)',
  'docker|podman': 'install Docker Desktop (https://docker.com) or podman (https://podman.io)',
};

export interface DoctorDeps {
  spawn: typeof spawnSync;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  exit: (code: number) => never;
  cwd?: string;
  exists?: (path: string) => boolean;
  readText?: (path: string) => string;
}

export function missingTools(spawn: typeof spawnSync): string[] {
  const missing = required.filter(
    (tool) => spawn(tool, ['--version'], { stdio: 'ignore' }).status !== 0,
  );
  const hasContainer =
    spawn('docker', ['--version'], { stdio: 'ignore' }).status === 0 ||
    spawn('podman', ['--version'], { stdio: 'ignore' }).status === 0;
  if (!hasContainer) {
    missing.push('docker-or-podman');
  }
  return missing;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' ? value : undefined;
}

function parseJsonObject(
  path: string,
  readText: (path: string) => string,
): Record<string, unknown> | string {
  try {
    const parsed: unknown = JSON.parse(readText(path));
    if (!isRecord(parsed)) {
      return `${path} must contain a JSON object`;
    }
    return parsed;
  } catch (error) {
    return `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function provenanceIssues(
  cwd = process.cwd(),
  exists: (path: string) => boolean = existsSync,
  readText: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string[] {
  const issues: string[] = [];
  const path = join(cwd, provenanceFile);
  if (!exists(path)) {
    return [`${provenanceFile} is missing; run just init or restore the scaffold provenance file`];
  }

  const parsed = parseJsonObject(path, readText);
  if (typeof parsed === 'string') {
    return [parsed];
  }

  for (const field of requiredProvenanceFields) {
    if (!stringField(parsed, field)) {
      issues.push(`${provenanceFile} missing string field ${field}`);
    }
  }

  const schemaVersion = stringField(parsed, 'schemaVersion');
  if (schemaVersion && schemaVersion !== '1.0') {
    issues.push(`${provenanceFile} schemaVersion must be 1.0`);
  }

  const mode = stringField(parsed, 'mode');
  if (mode && !['fresh', 'updated'].includes(mode)) {
    issues.push(`${provenanceFile} mode must be fresh or updated`);
  }

  const canonicalCommit = stringField(parsed, 'canonical_commit');
  if (
    canonicalCommit &&
    canonicalCommit !== 'unknown' &&
    !/^[0-9a-f]{7,40}$/i.test(canonicalCommit)
  ) {
    issues.push(`${provenanceFile} canonical_commit must be a git SHA or "unknown"`);
  }

  const forkedAt = stringField(parsed, 'forked_at');
  if (forkedAt && Number.isNaN(Date.parse(forkedAt))) {
    issues.push(`${provenanceFile} forked_at must be an ISO-8601 timestamp`);
  }

  const pulls = parsed['upstream_pulls'];
  if (pulls !== undefined && !Array.isArray(pulls)) {
    issues.push(`${provenanceFile} upstream_pulls must be an array when present`);
  }

  const manifestPath = join(cwd, 'harness.manifest.json');
  if (!exists(manifestPath)) {
    issues.push('harness.manifest.json is missing; cannot cross-check provenance');
    return issues;
  }

  const manifest = parseJsonObject(manifestPath, readText);
  if (typeof manifest === 'string') {
    issues.push(manifest);
    return issues;
  }

  const expected = [
    ['template', stringField(manifest, 'name')],
    ['templateVersion', stringField(manifest, 'version')],
    ['standardVersion', stringField(manifest, 'standard')],
  ] as const;
  for (const [field, manifestValue] of expected) {
    const provenanceValue = stringField(parsed, field);
    if (provenanceValue && manifestValue && provenanceValue !== manifestValue) {
      issues.push(
        `${provenanceFile} ${field} ${provenanceValue} does not match harness.manifest.json ${manifestValue}`,
      );
    }
  }

  return issues;
}

export interface RuntimeCheck {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

export function runtimeChecks(
  cwd = process.cwd(),
  exists: (path: string) => boolean = existsSync,
): RuntimeCheck[] {
  const checks: RuntimeCheck[] = [];
  const nodeModules = join(cwd, 'node_modules');
  if (exists(nodeModules)) {
    checks.push({ name: 'node_modules', ok: true, detail: 'installed' });
  } else {
    checks.push({
      name: 'node_modules',
      ok: false,
      detail: 'missing (root pnpm install has not run)',
      hint: 'just bootstrap',
    });
  }
  return checks;
}

export function toolVersion(spawn: typeof spawnSync, tool: string): string | undefined {
  const result = spawn(tool, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.status !== 0) return undefined;
  const stdout = result.stdout?.toString().trim() ?? '';
  const first = stdout.split('\n')[0]?.trim();
  return first ? first : undefined;
}

export interface ToolCheck {
  name: string;
  ok: boolean;
  version?: string;
  hint?: string;
}

export function toolChecks(spawn: typeof spawnSync): ToolCheck[] {
  const out: ToolCheck[] = [];
  for (const tool of required) {
    const version = toolVersion(spawn, tool);
    out.push({
      name: tool,
      ok: Boolean(version),
      version,
      hint: version ? undefined : INSTALL_HINTS[tool],
    });
  }
  const docker = toolVersion(spawn, 'docker');
  const podman = docker ? undefined : toolVersion(spawn, 'podman');
  const containerOk = Boolean(docker || podman);
  out.push({
    name: 'docker|podman',
    ok: containerOk,
    version: docker || podman,
    hint: containerOk ? undefined : INSTALL_HINTS['docker|podman'],
  });
  return out;
}

interface Sink {
  log: (line: string) => void;
}

function emitRow(sink: Sink, status: string, name: string, detail: string, width: number): void {
  sink.log(`  ${status}  ${name.padEnd(width)}  ${detail}`);
}

function emitHint(sink: Sink, width: number, hint: string): void {
  sink.log(`         ${' '.repeat(width)}  fix: ${hint}`);
}

function reportTools(sink: Sink, tools: ToolCheck[], width: number): number {
  let failed = 0;
  for (const t of tools) {
    if (t.ok) {
      // version is always set when toolChecks marks ok=true, but the field
      // is typed optional so consumers can pass synthetic checks for tests.
      emitRow(sink, '[ OK ]', t.name, t.version ?? 'present', width);
    } else {
      failed++;
      emitRow(sink, '[FAIL]', t.name, 'not found on PATH', width);
      if (t.hint) emitHint(sink, width, t.hint);
    }
  }
  return failed;
}

function reportRuntime(sink: Sink, runtime: RuntimeCheck[], width: number): number {
  let failed = 0;
  for (const r of runtime) {
    if (r.ok) {
      emitRow(sink, '[ OK ]', r.name, r.detail, width);
    } else {
      failed++;
      emitRow(sink, '[FAIL]', r.name, r.detail, width);
      if (r.hint) emitHint(sink, width, r.hint);
    }
  }
  return failed;
}

function reportProvenance(sink: Sink, provenance: string[], width: number): number {
  const [head, ...rest] = provenance;
  if (head === undefined) {
    emitRow(sink, '[ OK ]', 'provenance', 'valid', width);
    return 0;
  }
  emitRow(sink, '[FAIL]', 'provenance', head, width);
  for (const extra of rest) {
    sink.log(`         ${' '.repeat(width)}  ${extra}`);
  }
  return 1;
}

export function printReport(
  tools: ToolCheck[],
  runtime: RuntimeCheck[],
  provenance: string[],
  log: (line: string) => void,
): { passed: number; failed: number; total: number } {
  const sink: Sink = { log };
  const width = Math.max(
    ...tools.map((t) => t.name.length),
    ...runtime.map((r) => r.name.length),
    'provenance'.length,
  );
  sink.log('preflight checks:');
  sink.log('');
  const failed =
    reportTools(sink, tools, width) +
    reportRuntime(sink, runtime, width) +
    reportProvenance(sink, provenance, width);
  sink.log('');
  const total = tools.length + runtime.length + 1;
  return { passed: total - failed, failed, total };
}

export function main(deps: DoctorDeps): void {
  const exists = deps.exists ?? existsSync;
  const readText = deps.readText ?? ((path: string) => readFileSync(path, 'utf8'));
  const tools = toolChecks(deps.spawn);
  const runtime = runtimeChecks(deps.cwd, exists);
  const provenance = provenanceIssues(deps.cwd, exists, readText);
  const { passed, failed, total } = printReport(tools, runtime, provenance, (line) =>
    deps.stdout.log(line),
  );
  if (failed > 0) {
    deps.stderr.error(
      `doctor: ${failed} of ${total} checks failed (${passed} passed). Fix the items above and re-run.`,
    );
    deps.exit(1);
  }
  deps.stdout.log(`doctor: all ${passed} checks passed.`);
}

/* v8 ignore next 9 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main({
    spawn: spawnSync,
    stdout: console,
    stderr: console,
    exit: (code: number): never => process.exit(code),
  });
}
