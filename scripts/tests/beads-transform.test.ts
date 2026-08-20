// The harness-app-template store that motivated this transform exercises
// NONE of bd's three import blockers: its four issue types are all bd
// built-ins, it holds no tombstones, and its longest description is 5,327
// bytes against a 65,535-byte ceiling. Migrating it therefore proves almost
// nothing about the eleven larger stores that follow — the largest holds
// 2,765 records and is known to carry `docs`/`question` types, tombstones,
// and a 107,962-byte description.
//
// These fixtures are where those paths actually get proven.
import { describe, expect, test } from 'vitest';
import { type MigrateDeps, main } from '../beads-migrate';
import {
  BD_MAX_DESCRIPTION_BYTES,
  type BeadRecord,
  byteLength,
  compareReports,
  dependencyTriples,
  parseJsonl,
  preflight,
  requiredBdConfig,
  serializeJsonl,
  transformForward,
  transformReverse,
} from '../lib/beads-transform';

function record(overrides: Partial<BeadRecord> = {}): BeadRecord {
  return {
    id: 'store-1',
    title: 'A bead',
    description: 'body',
    status: 'open',
    issue_type: 'task',
    priority: 2,
    created_at: '2026-06-02T00:58:03.891506521Z',
    updated_at: '2026-06-02T00:58:03.891506521Z',
    source_repo: 'harness-app-template',
    source_repo_path: '/home/ubuntu/Code/syntropic137/harness-app-template',
    ...overrides,
  };
}

describe('parseJsonl', () => {
  test('skips blank lines and round-trips through serializeJsonl', () => {
    const text = `${JSON.stringify(record())}\n\n${JSON.stringify(record({ id: 'store-2' }))}\n`;
    const records = parseJsonl(text);
    expect(records.map((r) => r.id)).toEqual(['store-1', 'store-2']);
    expect(parseJsonl(serializeJsonl(records))).toEqual(records);
  });

  test('names the 1-based line number of a malformed record', () => {
    const text = `${JSON.stringify(record())}\nnot json\n`;
    expect(() => parseJsonl(text)).toThrow(/line 2 is not valid JSON/);
  });
});

describe('blocker 3: the 65535 ceiling is BYTES, not characters', () => {
  test('40,000 multi-byte characters are 80,000 bytes and are flagged', () => {
    // The trap: this description is well under 65,535 CHARACTERS, so a
    // length check passes it, and then the atomic import rolls back the
    // entire store.
    const description = 'é'.repeat(40_000);
    expect(description.length).toBe(40_000);
    expect(byteLength(description)).toBe(80_000);

    const report = preflight([record({ description })]);
    expect(report.oversizeDescriptions).toEqual([
      { id: 'store-1', bytes: 80_000, characters: 40_000 },
    ]);
  });

  test('the boundary matches the probe: 65535 passes, 65536 fails', () => {
    const at = preflight([record({ description: 'a'.repeat(BD_MAX_DESCRIPTION_BYTES) })]);
    expect(at.oversizeDescriptions).toHaveLength(0);

    const over = preflight([record({ description: 'a'.repeat(BD_MAX_DESCRIPTION_BYTES + 1) })]);
    expect(over.oversizeDescriptions).toHaveLength(1);
  });

  test('forward transform does not silently truncate an oversize description', () => {
    const description = 'a'.repeat(BD_MAX_DESCRIPTION_BYTES + 100);
    const result = transformForward([record({ description })]);
    expect(result.records[0].description).toBe(description);
  });
});

describe('blockers 1 and 2: config the store needs before import', () => {
  test('flags non-built-in types and emits the types.custom command', () => {
    const report = preflight([
      record({ id: 'a', issue_type: 'docs' }),
      record({ id: 'b', issue_type: 'question' }),
      record({ id: 'c', issue_type: 'bug' }),
    ]);
    expect(report.customTypes).toEqual(['docs', 'question']);
    expect(requiredBdConfig(report)).toContain('bd config set types.custom "docs,question"');
  });

  test('maps tombstone status through status.custom', () => {
    const report = preflight([record({ id: 'gone', status: 'tombstone' })]);
    expect(requiredBdConfig(report)).toContain('bd config set status.custom "tombstone:done"');
  });

  test('a custom non-tombstone status is mapped to open in status.custom', () => {
    // br allows statuses bd has never heard of; they need a mapping onto a bd
    // lifecycle state, and anything that is not a deletion maps to open.
    const report = preflight([record({ status: 'triage' })]);
    expect(report.customStatuses).toEqual(['triage']);
    expect(requiredBdConfig(report)).toContain('bd config set status.custom "triage:open"');
  });

  test('a store using only bd built-ins needs no config at all', () => {
    const report = preflight([
      record({ issue_type: 'feature', status: 'closed', closed_at: '2026-06-02T00:00:00Z' }),
      record({ id: 'b', issue_type: 'epic', status: 'in_progress' }),
    ]);
    expect(report.customTypes).toEqual([]);
    expect(report.customStatuses).toEqual([]);
    expect(requiredBdConfig(report)).toEqual([]);
  });
});

describe('tombstones vanish silently — enumerate them before import', () => {
  test('expectedImportCount reconciles the drop rather than hiding it', () => {
    const report = preflight([
      record({ id: 'live-1' }),
      record({ id: 'dead-1', status: 'tombstone' }),
      record({ id: 'dead-2', status: 'tombstone' }),
    ]);
    expect(report.recordCount).toBe(3);
    expect(report.expectedImportCount).toBe(1);
    expect(report.tombstones).toEqual(['dead-1', 'dead-2']);
  });

  test('keeping tombstones warns that bd will swallow them', () => {
    const result = transformForward([record({ id: 'dead', status: 'tombstone' })]);
    expect(result.records).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/skip it silently/);
  });

  test('--drop-tombstones removes them explicitly, with a reason', () => {
    const result = transformForward(
      [record({ id: 'live' }), record({ id: 'dead', status: 'tombstone' })],
      { dropTombstones: true },
    );
    expect(result.records.map((r) => r.id)).toEqual(['live']);
    expect(result.dropped).toEqual([{ id: 'dead', reason: 'tombstone (dropped explicitly)' }]);
  });

  test('verification reconciles the tombstone delta instead of failing on it', () => {
    const before = preflight([record({ id: 'live' }), record({ id: 'dead', status: 'tombstone' })]);
    const after = preflight([record({ id: 'live' })]);
    const countDiff = compareReports(before, after)[0];
    expect(countDiff.ok).toBe(true);
    expect(countDiff.detail).toMatch(/1 tombstone\(s\) expected to drop: dead/);
  });
});

describe('provenance: source_repo is dropped entirely by bd', () => {
  test('preserved into metadata when asked', () => {
    const result = transformForward([record()], { preserveProvenance: true });
    expect(result.records[0].metadata).toEqual({
      source_repo: 'harness-app-template',
      source_repo_path: '/home/ubuntu/Code/syntropic137/harness-app-template',
    });
    expect(result.provenancePreserved).toBe(1);
  });

  test('existing metadata keys survive alongside the provenance keys', () => {
    const result = transformForward([record({ metadata: { team: 'platform' } })], {
      preserveProvenance: true,
    });
    expect(result.records[0].metadata).toEqual({
      team: 'platform',
      source_repo: 'harness-app-template',
      source_repo_path: '/home/ubuntu/Code/syntropic137/harness-app-template',
    });
  });

  test('notes mirror is idempotent so a re-run does not stack duplicates', () => {
    const once = transformForward([record()], {
      preserveProvenance: true,
      provenanceToNotes: true,
    });
    expect(once.records[0].notes).toMatch(/^br-provenance: harness-app-template/);

    const twice = transformForward(once.records, {
      preserveProvenance: true,
      provenanceToNotes: true,
    });
    expect(twice.records[0].notes).toBe(once.records[0].notes);
  });

  test('off by default — the transform does not invent fields unasked', () => {
    const result = transformForward([record()]);
    expect(result.records[0].metadata).toBeUndefined();
    expect(result.provenancePreserved).toBe(0);
  });
});

describe('reverse transform: the rollback path', () => {
  const bdExport: BeadRecord[] = [
    record({
      id: 'store-1',
      comments: [
        {
          id: '3f8c1e2a-0000-4000-8000-000000000001',
          text: 'first',
          created_at: '2026-06-02T01:00:00Z',
        },
        {
          id: '3f8c1e2a-0000-4000-8000-000000000002',
          text: 'second',
          created_at: '2026-06-02T02:00:00Z',
        },
      ],
    }),
  ];

  test('rewrites UUID comment ids to integers — br aborts on the first string id', () => {
    const result = transformReverse(bdExport);
    const ids = result.records[0].comments?.map((c) => c.id);
    expect(ids?.every((id) => Number.isInteger(id))).toBe(true);
    expect(result.remappedComments).toBe(2);
  });

  test('a reference file restores the ORIGINAL integer ids, making the round trip exact', () => {
    const original: BeadRecord[] = [
      record({
        id: 'store-1',
        comments: [
          { id: 41, text: 'first', created_at: '2026-06-02T01:00:00Z' },
          { id: 42, text: 'second', created_at: '2026-06-02T02:00:00Z' },
        ],
      }),
    ];
    const result = transformReverse(bdExport, { reference: original });
    expect(result.records[0].comments?.map((c) => c.id)).toEqual([41, 42]);
    expect(result.restoredFromReference).toBe(2);
    expect(result.warnings).toEqual([]);
  });

  test('unmatched comments get fresh ids and say so, rather than failing quietly', () => {
    const result = transformReverse(bdExport, { reference: [record({ id: 'store-1' })] });
    expect(result.restoredFromReference).toBe(0);
    expect(result.warnings[0]).toMatch(/could not be matched to the reference/);
  });

  test('integer ids are left alone, so the transform is idempotent', () => {
    const once = transformReverse(bdExport);
    const twice = transformReverse(once.records);
    expect(twice.remappedComments).toBe(0);
    expect(twice.records).toEqual(once.records);
  });

  test('full br -> bd -> br round trip preserves edges, labels and comment text', () => {
    const br: BeadRecord[] = [
      record({
        id: 'a',
        labels: ['x', 'y'],
        comments: [{ id: 7, text: 'note', created_at: '2026-06-02T01:00:00Z' }],
        dependencies: [{ issue_id: 'a', depends_on_id: 'b', type: 'blocks' }],
      }),
      record({ id: 'b', labels: ['y'] }),
    ];
    // bd's export, as emitted: comment ids become UUID strings.
    const asBd = br.map((r) =>
      r.comments
        ? { ...r, comments: r.comments.map((c) => ({ ...c, id: `uuid-${c.id}` })) }
        : { ...r },
    );
    const back = transformReverse(asBd, { reference: br }).records;

    expect(dependencyTriples(back)).toEqual(dependencyTriples(br));
    expect(preflight(back).uniqueLabels).toEqual(preflight(br).uniqueLabels);
    expect(back[0].comments).toEqual(br[0].comments);
  });
});

describe('verification compares edges, not just counts', () => {
  const before = preflight([
    record({ id: 'a', dependencies: [{ issue_id: 'a', depends_on_id: 'b', type: 'blocks' }] }),
    record({
      id: 'b',
      dependencies: [{ issue_id: 'b', depends_on_id: 'c', type: 'parent-child' }],
    }),
    record({ id: 'c' }),
  ]);

  test('equal edge counts with different edges still FAIL', () => {
    const after = preflight([
      record({ id: 'a', dependencies: [{ issue_id: 'a', depends_on_id: 'c', type: 'blocks' }] }),
      record({
        id: 'b',
        dependencies: [{ issue_id: 'b', depends_on_id: 'c', type: 'parent-child' }],
      }),
      record({ id: 'c' }),
    ]);
    const diff = compareReports(before, after).find((d) =>
      d.label.startsWith('dependency triples'),
    );
    expect(diff?.before).toBe(2);
    expect(diff?.after).toBe(2);
    expect(diff?.ok).toBe(false);
    expect(diff?.detail).toMatch(/missing: a\tb\tblocks/);
  });

  test('an identical store passes every check', () => {
    expect(compareReports(before, before).every((d) => d.ok)).toBe(true);
  });

  test('a differing label set FAILS even when the assignment count matches', () => {
    const beforeLabels = preflight([record({ id: 'a', labels: ['x'] })]);
    const afterLabels = preflight([record({ id: 'a', labels: ['z'] })]);
    const diff = compareReports(beforeLabels, afterLabels).find((d) => d.label === 'unique labels');
    expect(diff?.ok).toBe(false);
  });
});

describe('loss accounting', () => {
  test('reports sub-second precision that bd truncates irreversibly', () => {
    const report = preflight([record()]);
    expect(report.subSecondTimestamps.created_at).toBe(1);
    expect(report.subSecondTimestamps.updated_at).toBe(1);
  });

  test('lists closed records with no closed_at, which bd fabricates one for', () => {
    const report = preflight([
      record({ id: 'a', status: 'closed' }),
      record({ id: 'b', status: 'closed', closed_at: '2026-06-02T00:00:00Z' }),
    ]);
    expect(report.closedWithoutClosedAt).toEqual(['a']);
  });

  test('counts distinct source_repo values, which reveal cross-repo records', () => {
    const report = preflight([
      record({ id: 'a', source_repo: 'harness-app-template' }),
      record({ id: 'b', source_repo: 'harness-lab' }),
    ]);
    expect(report.sourceRepos).toEqual({ 'harness-app-template': 1, 'harness-lab': 1 });
  });
});

describe('CLI', () => {
  function deps(files: Record<string, string> = {}): MigrateDeps & {
    logs: string[];
    errors: string[];
    written: Record<string, string>;
  } {
    const logs: string[] = [];
    const errors: string[] = [];
    const written: Record<string, string> = {};
    return {
      readFile: (path: string) => {
        if (!(path in files)) throw new Error(`no such fixture: ${path}`);
        return files[path];
      },
      writeFile: (path: string, contents: string) => {
        written[path] = contents;
      },
      stdout: { log: (line: string) => logs.push(line) },
      stderr: { error: (line: string) => errors.push(line) },
      exit: (code: number): never => {
        throw new Error(`exit ${code}`);
      },
      logs,
      errors,
      written,
    };
  }

  test('preflight exits non-zero on an oversize description', () => {
    const d = deps({
      'in.jsonl': serializeJsonl([
        record({ description: 'a'.repeat(BD_MAX_DESCRIPTION_BYTES + 1) }),
      ]),
    });
    expect(() => main(['preflight', 'in.jsonl'], d)).toThrow('exit 1');
    expect(d.errors.join('\n')).toMatch(/atomic — it will roll back all 1 records/);
  });

  test('preflight passes a clean store and reports no required config', () => {
    const d = deps({ 'in.jsonl': serializeJsonl([record()]) });
    main(['preflight', 'in.jsonl'], d);
    expect(d.logs.join('\n')).toMatch(/bd config required: NONE/);
  });

  test('forward writes the transformed file', () => {
    const d = deps({ 'in.jsonl': serializeJsonl([record()]) });
    main(['forward', 'in.jsonl', '-o', 'out.jsonl', '--preserve-provenance'], d);
    const out = parseJsonl(d.written['out.jsonl']);
    expect(out[0].metadata).toMatchObject({ source_repo: 'harness-app-template' });
  });

  test('reverse writes the rolled-back file', () => {
    const d = deps({
      'in.jsonl': serializeJsonl([record({ comments: [{ id: 'uuid-1', text: 't' }] })]),
    });
    main(['reverse', 'in.jsonl', '-o', 'out.jsonl'], d);
    expect(parseJsonl(d.written['out.jsonl'])[0].comments?.[0].id).toBe(1);
  });

  test('verify exits non-zero when the stores do not reconcile', () => {
    const d = deps({
      'before.jsonl': serializeJsonl([record({ id: 'a' }), record({ id: 'b' })]),
      'after.jsonl': serializeJsonl([record({ id: 'a' })]),
    });
    expect(() => main(['verify', 'before.jsonl', 'after.jsonl'], d)).toThrow('exit 1');
    expect(d.errors.join('\n')).toMatch(/did not reconcile/);
  });

  test('verify passes an exact migration', () => {
    const d = deps({
      'before.jsonl': serializeJsonl([record({ id: 'a' })]),
      'after.jsonl': serializeJsonl([record({ id: 'a' })]),
    });
    main(['verify', 'before.jsonl', 'after.jsonl'], d);
    expect(d.logs.every((l) => l.startsWith('[PASS]'))).toBe(true);
  });

  test('an unknown subcommand exits 64 with usage', () => {
    const d = deps();
    expect(() => main(['nope'], d)).toThrow('exit 64');
    expect(d.errors.join('\n')).toMatch(/usage: beads-migrate/);
  });
});

// The template enforces 100% coverage on scripts/. These close the branches the
// behavioural tests above do not reach: the nullish/optional fallbacks on
// partially-populated records (real br exports omit fields freely), and the CLI's
// usage, --json, and warning paths.
describe('optional-field fallbacks on sparse records', () => {
  test('a record with no dependencies, labels, comments or description scans cleanly', () => {
    const report = preflight([{ id: 'bare' }]);
    expect(report.recordCount).toBe(1);
    expect(report.issueTypes).toEqual({ '<none>': 1 });
    expect(report.statuses).toEqual({ '<none>': 1 });
    expect(report.sourceRepos).toEqual({ '<none>': 1 });
    expect(report.dependencyTriples).toEqual([]);
    expect(report.labelAssignments).toBe(0);
    expect(report.commentCount).toBe(0);
    expect(report.oversizeDescriptions).toEqual([]);
  });

  test('a dependency with no issue_id falls back to the owning record id', () => {
    const deps = [{ depends_on_id: 'b', type: 'blocks' }] as unknown as BeadRecord['dependencies'];
    const triples = dependencyTriples([record({ id: 'a', dependencies: deps })]);
    expect(triples).toEqual(['a\tb\tblocks']);
  });

  test('a non-integer comment id is counted, which is how a bd export is recognised', () => {
    const report = preflight([record({ comments: [{ id: 'uuid-1', text: 't' }] })]);
    expect(report.commentCount).toBe(1);
    expect(report.nonIntegerCommentIds).toBe(1);
  });

  test('comments with no created_at or text still key deterministically', () => {
    const bd = [record({ id: 'a', comments: [{ id: 'uuid-1' }] })];
    const reference = [record({ id: 'a', comments: [{ id: 9 }] })];
    expect(transformReverse(bd, { reference }).records[0].comments?.[0].id).toBe(9);
  });

  test('reference records without comments are skipped when indexing', () => {
    const result = transformReverse([record({ id: 'a', comments: [{ id: 'uuid-1' }] })], {
      reference: [record({ id: 'z' })],
    });
    expect(result.restoredFromReference).toBe(0);
  });

  test('a non-integer id in the reference is not indexed', () => {
    const result = transformReverse(
      [record({ id: 'a', comments: [{ id: 'uuid-1', text: 't' }] })],
      {
        reference: [record({ id: 'a', comments: [{ id: 'also-uuid', text: 't' }] })],
      },
    );
    expect(result.restoredFromReference).toBe(0);
    expect(result.records[0].comments?.[0].id).toBe(1);
  });

  test('provenance note omits the path when only source_repo is present', () => {
    const result = transformForward([{ id: 'a', source_repo: 'only-repo' }], {
      preserveProvenance: true,
      provenanceToNotes: true,
    });
    expect(result.records[0].notes).toBe('br-provenance: only-repo');
    expect(result.records[0].metadata).toEqual({ source_repo: 'only-repo' });
  });

  test('provenance survives when only source_repo_path is present', () => {
    const result = transformForward([{ id: 'a', source_repo_path: '/tmp/x' }], {
      preserveProvenance: true,
      provenanceToNotes: true,
    });
    expect(result.records[0].notes).toBe('br-provenance: (/tmp/x)');
  });

  test('a record with no provenance at all is passed through untouched', () => {
    const result = transformForward([{ id: 'a' }], { preserveProvenance: true });
    expect(result.records[0].metadata).toBeUndefined();
    expect(result.provenancePreserved).toBe(0);
  });

  test('non-string notes are replaced rather than concatenated', () => {
    const result = transformForward([record({ notes: undefined })], {
      preserveProvenance: true,
      provenanceToNotes: true,
    });
    expect(result.records[0].notes).toMatch(/^br-provenance: /);
  });

  test('an added edge is reported alongside missing ones', () => {
    const before = preflight([record({ id: 'a' })]);
    const after = preflight([
      record({ id: 'a', dependencies: [{ issue_id: 'a', depends_on_id: 'b', type: 'blocks' }] }),
    ]);
    const diff = compareReports(before, after).find((d) =>
      d.label.startsWith('dependency triples'),
    );
    expect(diff?.ok).toBe(false);
    expect(diff?.detail).toMatch(/missing: none; added: a\tb\tblocks/);
  });
});

// CLI branches the behavioural tests above do not reach: --json output, every
// missing-argument usage path, the --out alias, and the stderr warning paths.
describe('CLI branches', () => {
  function deps(files: Record<string, string> = {}): MigrateDeps & {
    logs: string[];
    errors: string[];
    written: Record<string, string>;
  } {
    const logs: string[] = [];
    const errors: string[] = [];
    const written: Record<string, string> = {};
    return {
      readFile: (path: string) => {
        if (!(path in files)) throw new Error(`no such fixture: ${path}`);
        return files[path];
      },
      writeFile: (path: string, contents: string) => {
        written[path] = contents;
      },
      stdout: { log: (line: string) => logs.push(line) },
      stderr: { error: (line: string) => errors.push(line) },
      exit: (code: number): never => {
        throw new Error(`exit ${code}`);
      },
      logs,
      errors,
      written,
    };
  }

  test('preflight --json emits the machine-readable report', () => {
    const d = deps({ 'in.jsonl': serializeJsonl([record()]) });
    main(['preflight', 'in.jsonl', '--json'], d);
    expect(JSON.parse(d.logs.join('\n')).recordCount).toBe(1);
  });

  test('preflight prints the bd config a store with custom types needs', () => {
    const d = deps({
      'in.jsonl': serializeJsonl([
        record({ issue_type: 'docs' }),
        record({ id: 'b', status: 'tombstone' }),
        record({ id: 'c', status: 'closed' }),
      ]),
    });
    main(['preflight', 'in.jsonl'], d);
    const out = d.logs.join('\n');
    expect(out).toMatch(/bd config set types.custom "docs"/);
    expect(out).toMatch(/bd config set status.custom "tombstone:done"/);
    expect(out).toMatch(/closed with no closed_at .*: c/);
    expect(out).toMatch(/not a recognized config key/);
  });

  test('preflight names each oversize description with its byte count', () => {
    const d = deps({
      'in.jsonl': serializeJsonl([
        record({ id: 'big', description: 'a'.repeat(BD_MAX_DESCRIPTION_BYTES + 5) }),
      ]),
    });
    expect(() => main(['preflight', 'in.jsonl'], d)).toThrow('exit 1');
    expect(d.logs.join('\n')).toMatch(/big: 65540 bytes \(65540 chars\)/);
  });

  test('verify --json emits the diff array', () => {
    const one = serializeJsonl([record()]);
    const d = deps({ 'a.jsonl': one, 'b.jsonl': one });
    main(['verify', 'a.jsonl', 'b.jsonl', '--json'], d);
    expect(Array.isArray(JSON.parse(d.logs.join('\n')))).toBe(true);
  });

  test('forward reports dropped tombstones and warns about kept ones', () => {
    const withTombstone = serializeJsonl([record({ id: 'dead', status: 'tombstone' })]);
    const dropped = deps({ 'in.jsonl': withTombstone });
    main(['forward', 'in.jsonl', '--out', 'out.jsonl', '--drop-tombstones'], dropped);
    expect(dropped.logs.join('\n')).toMatch(/dropped dead: tombstone/);

    const kept = deps({ 'in.jsonl': withTombstone });
    main(['forward', 'in.jsonl', '-o', 'out.jsonl'], kept);
    expect(kept.errors.join('\n')).toMatch(/WARN dead: tombstone kept/);
  });

  test('reverse warns when a comment cannot be matched to the reference', () => {
    const d = deps({
      'in.jsonl': serializeJsonl([record({ comments: [{ id: 'uuid-1', text: 'x' }] })]),
      'ref.jsonl': serializeJsonl([record()]),
    });
    main(['reverse', 'in.jsonl', '-o', 'out.jsonl', '--reference', 'ref.jsonl'], d);
    expect(d.errors.join('\n')).toMatch(/WARN .*could not be matched/);
  });

  test.each([
    ['preflight', []],
    ['forward', []],
    ['forward', ['in.jsonl']],
    ['reverse', []],
    ['reverse', ['in.jsonl']],
    ['verify', []],
    ['verify', ['a.jsonl']],
  ])('%s with missing arguments exits 64 with usage', (sub, args) => {
    const d = deps();
    expect(() => main([sub, ...args], d)).toThrow('exit 64');
    expect(d.errors.join('\n')).toMatch(/usage: beads-migrate/);
  });

  test('no subcommand at all exits 64', () => {
    const d = deps();
    expect(() => main([], d)).toThrow('exit 64');
  });
});

describe('final branch closures', () => {
  test('an existing note without the marker is appended to, not replaced', () => {
    const result = transformForward([record({ notes: 'shipped in f723018' })], {
      preserveProvenance: true,
      provenanceToNotes: true,
    });
    expect(result.records[0].notes).toBe(
      'shipped in f723018\n\nbr-provenance: harness-app-template (/home/ubuntu/Code/syntropic137/harness-app-template)',
    );
  });

  test('simultaneous missing and added edges are both listed and joined', () => {
    const before = preflight([
      record({
        id: 'a',
        dependencies: [
          { issue_id: 'a', depends_on_id: 'b', type: 'blocks' },
          { issue_id: 'a', depends_on_id: 'c', type: 'blocks' },
        ],
      }),
    ]);
    const after = preflight([
      record({
        id: 'a',
        dependencies: [
          { issue_id: 'a', depends_on_id: 'd', type: 'blocks' },
          { issue_id: 'a', depends_on_id: 'e', type: 'blocks' },
        ],
      }),
    ]);
    const diff = compareReports(before, after).find((d) =>
      d.label.startsWith('dependency triples'),
    );
    expect(diff?.ok).toBe(false);
    expect(diff?.detail).toMatch(/missing: a\tb\tblocks \| a\tc\tblocks/);
    expect(diff?.detail).toMatch(/added: a\td\tblocks \| a\te\tblocks/);
  });

  test('an edge lost with none gained reports added as none', () => {
    // The case a real migration failure looks like: edges silently dropped,
    // nothing gained. Distinct from the rewired-edge case above, where both
    // sides are non-empty.
    const before = preflight([
      record({ id: 'a', dependencies: [{ issue_id: 'a', depends_on_id: 'b', type: 'blocks' }] }),
    ]);
    const after = preflight([record({ id: 'a' })]);
    const diff = compareReports(before, after).find((d) =>
      d.label.startsWith('dependency triples'),
    );
    expect(diff?.ok).toBe(false);
    expect(diff?.detail).toBe('missing: a\tb\tblocks; added: none');
  });
});

// Regression tests for the code-review findings on PR #74. Each one failed
// against the pre-fix transform.
describe('review findings', () => {
  test('rollback restores original ids even though bd ROUNDS comment timestamps', () => {
    // The one that mattered: br writes ns precision, bd returns whole seconds
    // rounded UP, so a timestamp-keyed index missed every comment and quietly
    // renumbered them. This store's own comments happen to sit on whole
    // seconds, which is why the live round trip never caught it.
    const br: BeadRecord[] = [
      record({
        id: 'a',
        comments: [
          { id: 7, text: 'first', created_at: '2026-05-30T16:12:19.987654321Z' },
          { id: 9, text: 'second', created_at: '2026-05-30T16:35:13.123456789Z' },
        ],
      }),
    ];
    const fromBd: BeadRecord[] = [
      record({
        id: 'a',
        comments: [
          { id: 'uuid-1', text: 'first', created_at: '2026-05-30T16:12:20Z' },
          { id: 'uuid-2', text: 'second', created_at: '2026-05-30T16:35:13Z' },
        ],
      }),
    ];
    const result = transformReverse(fromBd, { reference: br });
    expect(result.records[0].comments?.map((c) => c.id)).toEqual([7, 9]);
    expect(result.restoredFromReference).toBe(2);
    expect(result.warnings).toEqual([]);
  });

  test('two identical comments on one issue keep distinct ids', () => {
    // Keyed on text alone they collapse to a single map entry and br gets a
    // duplicate i64, which it rejects.
    const br: BeadRecord[] = [
      record({
        id: 'a',
        comments: [
          { id: 4, text: 'same' },
          { id: 5, text: 'same' },
        ],
      }),
    ];
    const fromBd: BeadRecord[] = [
      record({
        id: 'a',
        comments: [
          { id: 'u1', text: 'same' },
          { id: 'u2', text: 'same' },
        ],
      }),
    ];
    expect(
      transformReverse(fromBd, { reference: br }).records[0].comments?.map((c) => c.id),
    ).toEqual([4, 5]);
  });

  test('fresh ids never collide with integer ids already in the input', () => {
    const partiallyReversed: BeadRecord[] = [
      record({
        id: 'a',
        comments: [
          { id: 1, text: 'kept' },
          { id: 'uuid-x', text: 'new' },
        ],
      }),
    ];
    const ids = transformReverse(partiallyReversed).records[0].comments?.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toEqual([1, 1]);
  });

  test('--provenance-to-notes works without --preserve-provenance', () => {
    // They were coupled, so the notes-only flag silently emitted the record
    // unchanged -- and source_repo is unrecoverable once bd drops it.
    const result = transformForward([record()], { provenanceToNotes: true });
    expect(result.records[0].notes).toMatch(/^br-provenance: harness-app-template/);
    expect(result.records[0].metadata).toBeUndefined();
    expect(result.provenancePreserved).toBe(1);
  });

  test('a tombstone issue_type is still reported as needing types.custom', () => {
    // The sentinel is a status; filtering it from the type list too let a
    // `tombstone` type through to an import that rolls the whole file back.
    const report = preflight([record({ issue_type: 'tombstone' })]);
    expect(report.customTypes).toEqual(['tombstone']);
    expect(requiredBdConfig(report)).toContain('bd config set types.custom "tombstone"');
  });

  test('event is a bd built-in and needs no custom-type config', () => {
    expect(preflight([record({ issue_type: 'event' })]).customTypes).toEqual([]);
  });

  test('preflight counts sub-second comment timestamps', () => {
    const report = preflight([
      record({ comments: [{ id: 1, text: 't', created_at: '2026-05-30T16:12:19.98Z' }] }),
    ]);
    expect(report.subSecondTimestamps['comments.created_at']).toBe(1);
  });

  test('verify catches a swapped record id that reconciles on totals', () => {
    const before = preflight([record({ id: 'a' }), record({ id: 'b' })]);
    const after = preflight([record({ id: 'a' }), record({ id: 'c' })]);
    const diff = compareReports(before, after).find((d) => d.label === 'record ids');
    expect(diff?.before).toBe(2);
    expect(diff?.after).toBe(2);
    expect(diff?.ok).toBe(false);
    expect(diff?.detail).toMatch(/missing: b; added: c/);
  });

  test('verify catches a silently rewritten title, status and description', () => {
    const before = preflight([
      record({ id: 'a', title: 'original', status: 'open', description: 'body' }),
    ]);
    const after = preflight([
      record({ id: 'a', title: 'rewritten', status: 'closed', description: 'b' }),
    ]);
    const diffs = compareReports(before, after);
    for (const label of ['titles', 'status / type / priority', 'description byte sizes']) {
      expect(diffs.find((d) => d.label === label)?.ok).toBe(false);
    }
  });

  test('verify flags provenance dropped by bd, and passes when it was preserved', () => {
    const before = preflight([record()]);
    const lost = preflight([{ id: 'store-1', title: 'A bead' }]);
    const dropped = compareReports(before, lost).find((d) => d.label === 'source_repo provenance');
    expect(dropped?.ok).toBe(false);
    expect(dropped?.detail).toMatch(/--preserve-provenance/);

    const preserved = preflight(
      transformForward([record()], { preserveProvenance: true }).records.map((r) => ({
        ...r,
        source_repo: undefined,
        source_repo_path: undefined,
      })),
    );
    expect(
      compareReports(before, preserved).find((d) => d.label === 'source_repo provenance')?.ok,
    ).toBe(true);
  });

  test('a large diff is truncated rather than dumping every id', () => {
    // A migration that loses a whole store should stay readable in a hook's
    // output, so the detail line caps the listing and says it did.
    const before = preflight(Array.from({ length: 12 }, (_, i) => record({ id: `old-${i}` })));
    const after = preflight(Array.from({ length: 12 }, (_, i) => record({ id: `new-${i}` })));
    const diff = compareReports(before, after).find((d) => d.label === 'record ids');
    expect(diff?.ok).toBe(false);
    expect(diff?.detail).toMatch(/\(truncated\)$/);
    expect(diff?.detail?.split('|').length).toBeLessThan(12);
  });

  test('tombstones are not reported as missing records on a clean migration', () => {
    const before = preflight([record({ id: 'live' }), record({ id: 'dead', status: 'tombstone' })]);
    const after = preflight([record({ id: 'live' })]);
    expect(compareReports(before, after).every((d) => d.ok)).toBe(true);
  });
});
