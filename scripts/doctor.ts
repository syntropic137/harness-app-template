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

export function main(deps: DoctorDeps): void {
  const missing = missingTools(deps.spawn);
  const provenance = provenanceIssues(deps.cwd, deps.exists, deps.readText);
  if (missing.length > 0) {
    deps.stderr.error(`missing required tools: ${missing.join(', ')}`);
  }
  for (const issue of provenance) {
    deps.stderr.error(`provenance: ${issue}`);
  }
  if (missing.length > 0 || provenance.length > 0) {
    deps.exit(1);
  }
  deps.stdout.log('doctor: required tools present');
  deps.stdout.log('doctor: provenance valid');
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
