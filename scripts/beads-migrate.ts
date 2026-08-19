// Entrypoint for `just beads-migrate <subcommand>`.
// Usage:
//   bun run scripts/beads-migrate.ts preflight <br.jsonl> [--json]
//   bun run scripts/beads-migrate.ts forward   <br.jsonl> -o <out.jsonl> [--preserve-provenance] [--provenance-to-notes] [--drop-tombstones]
//   bun run scripts/beads-migrate.ts reverse   <bd.jsonl> -o <out.jsonl> [--reference <br.jsonl>]
//   bun run scripts/beads-migrate.ts verify    <before.jsonl> <after.jsonl> [--json]
//
// Transform logic lives in scripts/lib/beads-transform.ts so it is pure and
// unit-testable; this file is argv plumbing and reporting only.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  compareReports,
  type PreflightReport,
  parseJsonl,
  preflight,
  requiredBdConfig,
  serializeJsonl,
  transformForward,
  transformReverse,
} from './lib/beads-transform';
import { isMainEntry } from './lib/entrypoint';

export interface MigrateDeps {
  readFile: (path: string) => string;
  writeFile: (path: string, contents: string) => void;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  exit: (code: number) => never;
}

const USAGE = `usage: beads-migrate.ts <preflight|forward|reverse|verify> ...
  preflight <br.jsonl> [--json]
  forward   <br.jsonl> -o <out.jsonl> [--preserve-provenance] [--provenance-to-notes] [--drop-tombstones]
  reverse   <bd.jsonl> -o <out.jsonl> [--reference <br.jsonl>]
  verify    <before.jsonl> <after.jsonl> [--json]`;

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function positionals(argv: string[]): string[] {
  const out: string[] = [];
  const valued = new Set(['-o', '--out', '--reference']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (valued.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    out.push(arg);
  }
  return out;
}

function reportSummary(report: PreflightReport, log: (line: string) => void): void {
  log(`records:                 ${report.recordCount}`);
  log(`expected bd import count:${report.expectedImportCount}`);
  log(`issue types:             ${JSON.stringify(report.issueTypes)}`);
  log(`statuses:                ${JSON.stringify(report.statuses)}`);
  log(
    `dependency edges:        ${report.dependencyTriples.length} ${JSON.stringify(report.dependencyTypeCounts)}`,
  );
  log(
    `labels:                  ${report.labelAssignments} assignments / ${report.uniqueLabels.length} unique`,
  );
  log(`comments:                ${report.commentCount}`);
  log(`source_repo values:      ${JSON.stringify(report.sourceRepos)}`);
  log(
    `sub-second timestamps:   ${JSON.stringify(report.subSecondTimestamps)} (rounded to whole seconds by bd, irreversible)`,
  );
}

function reportBlockers(report: PreflightReport, log: (line: string) => void): void {
  const list = (values: string[]) => (values.length ? values.join(', ') : 'none');
  log('');
  log('BLOCKERS');
  log(`  1. custom issue types:   ${list(report.customTypes)}`);
  log(`  2. custom statuses:      ${list(report.customStatuses)}`);
  log(`     tombstones:           ${list(report.tombstones)}`);
  log(`  3. oversize descriptions:${report.oversizeDescriptions.length ? '' : ' none'}`);
  for (const over of report.oversizeDescriptions) {
    log(
      `       ${over.id}: ${over.bytes} bytes (${over.characters} chars) — exceeds 65535-BYTE ceiling`,
    );
  }
}

function reportLosses(report: PreflightReport, log: (line: string) => void): void {
  const list = (values: string[]) => (values.length ? values.join(', ') : 'none');
  log('');
  log('KNOWN LOSSES');
  log(`  tombstones dropped silently by bd: ${report.tombstones.length}`);
  log(`  closed with no closed_at (bd fabricates one): ${list(report.closedWithoutClosedAt)}`);
  log('  source_repo / source_repo_path dropped unless --preserve-provenance');

  const config = requiredBdConfig(report);
  log('');
  if (config.length === 0) {
    log('bd config required: NONE — importable as-is');
    return;
  }
  log('bd config required BEFORE import:');
  for (const cmd of config) log(`  ${cmd}`);
  log('  (types.custom prints a "not a recognized config key" warning and works anyway)');
}

function runPreflight(argv: string[], deps: MigrateDeps): void {
  const [input] = positionals(argv);
  if (!input) {
    deps.stderr.error(USAGE);
    deps.exit(64);
  }
  const report = preflight(parseJsonl(deps.readFile(input)));

  if (argv.includes('--json')) {
    deps.stdout.log(JSON.stringify(report, null, 2));
  } else {
    const log = (line: string) => deps.stdout.log(line);
    reportSummary(report, log);
    reportBlockers(report, log);
    reportLosses(report, log);
  }

  // Blocker 3 is the only one no config can fix, and bd's import is atomic:
  // one oversize record rolls back the entire file and leaves count 0.
  if (report.oversizeDescriptions.length > 0) {
    deps.stderr.error('');
    deps.stderr.error(
      `FAIL: ${report.oversizeDescriptions.length} description(s) exceed the 65535-byte ceiling. bd import is atomic — it will roll back all ${report.recordCount} records and report count 0. Split or relocate these before importing.`,
    );
    deps.exit(1);
  }
}

function runForward(argv: string[], deps: MigrateDeps): void {
  const [input] = positionals(argv);
  const out = flagValue(argv, '-o') ?? flagValue(argv, '--out');
  if (!input || !out) {
    deps.stderr.error(USAGE);
    deps.exit(64);
  }
  const records = parseJsonl(deps.readFile(input));
  const result = transformForward(records, {
    preserveProvenance: argv.includes('--preserve-provenance'),
    provenanceToNotes: argv.includes('--provenance-to-notes'),
    dropTombstones: argv.includes('--drop-tombstones'),
  });
  deps.writeFile(out as string, serializeJsonl(result.records));
  deps.stdout.log(`forward: ${records.length} in -> ${result.records.length} out (${out})`);
  deps.stdout.log(`  provenance preserved into metadata: ${result.provenancePreserved}`);
  for (const drop of result.dropped) deps.stdout.log(`  dropped ${drop.id}: ${drop.reason}`);
  for (const warning of result.warnings) deps.stderr.error(`  WARN ${warning}`);
}

function runReverse(argv: string[], deps: MigrateDeps): void {
  const [input] = positionals(argv);
  const out = flagValue(argv, '-o') ?? flagValue(argv, '--out');
  const referencePath = flagValue(argv, '--reference');
  if (!input || !out) {
    deps.stderr.error(USAGE);
    deps.exit(64);
  }
  const records = parseJsonl(deps.readFile(input));
  const reference = referencePath ? parseJsonl(deps.readFile(referencePath)) : undefined;
  const result = transformReverse(records, { reference });
  deps.writeFile(out as string, serializeJsonl(result.records));
  deps.stdout.log(`reverse: ${result.records.length} records -> ${out}`);
  deps.stdout.log(`  comment ids rewritten UUID -> int: ${result.remappedComments}`);
  deps.stdout.log(`  original ids restored from reference: ${result.restoredFromReference}`);
  for (const warning of result.warnings) deps.stderr.error(`  WARN ${warning}`);
}

function runVerify(argv: string[], deps: MigrateDeps): void {
  const [beforePath, afterPath] = positionals(argv);
  if (!beforePath || !afterPath) {
    deps.stderr.error(USAGE);
    deps.exit(64);
  }
  const before = preflight(parseJsonl(deps.readFile(beforePath)));
  const after = preflight(parseJsonl(deps.readFile(afterPath)));
  const diffs = compareReports(before, after);

  if (argv.includes('--json')) {
    deps.stdout.log(JSON.stringify(diffs, null, 2));
  } else {
    for (const diff of diffs) {
      const mark = diff.ok ? 'PASS' : 'FAIL';
      deps.stdout.log(
        `[${mark}] ${diff.label}: ${diff.before} -> ${diff.after}${diff.detail ? ` (${diff.detail})` : ''}`,
      );
    }
  }

  if (diffs.some((d) => !d.ok)) {
    deps.stderr.error('');
    deps.stderr.error(
      'FAIL: migration did not reconcile. Do not commit; investigate each FAIL above.',
    );
    deps.exit(1);
  }
}

export function main(argv: string[], deps: MigrateDeps): void {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case 'preflight':
      runPreflight(rest, deps);
      break;
    case 'forward':
      runForward(rest, deps);
      break;
    case 'reverse':
      runReverse(rest, deps);
      break;
    case 'verify':
      runVerify(rest, deps);
      break;
    default:
      deps.stderr.error(USAGE);
      deps.exit(64);
  }
}

/* v8 ignore next 9 */
if (isMainEntry(import.meta.url)) {
  main(process.argv.slice(2), {
    readFile: (path: string) => readFileSync(path, 'utf8'),
    writeFile: (path: string, contents: string) => writeFileSync(path, contents, 'utf8'),
    stdout: console,
    stderr: console,
    exit: (code: number): never => process.exit(code),
  });
}
