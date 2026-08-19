// br (beads_rust 0.2.11) <-> bd (gastownhall/beads 1.0.4) JSONL transform.
//
// This module is the durable deliverable of the tracker migration: twelve
// beads stores across this machine (~6,000 records) have to move, and the
// per-store cost has to be a script run, not an agent investigation. Every
// function here is pure over parsed JSONL records so the blocker paths can
// be exercised by fixtures — critically, THIS repo's own store exercises
// none of them (no custom types, no tombstones, no oversize descriptions),
// so tests are the only place those paths get proven before the larger
// stores hit them.
//
// The three import blockers, in the order bd fires them:
//   1. issue_type outside bd's built-ins  -> needs `bd config set types.custom`
//   2. status outside bd's built-ins      -> needs `bd config set status.custom`
//   3. description > 65535 BYTES          -> hard Dolt/MySQL TEXT ceiling,
//      not fixable by config. BYTES, not characters: 40,000 'é' is 80,000
//      bytes and fails while looking like it has headroom.
//
// `bd import` is ATOMIC: a single bad record rolls back the whole file and
// leaves the store at count 0, with the real error scrolled off above a
// usage dump. That is why the preflight is a hard gate rather than advice —
// success must never be judged from the tail of bd's output.

/** bd 1.0.4 built-in issue types (`bd create --help`). */
export const BD_BUILTIN_TYPES = ['bug', 'feature', 'task', 'epic', 'chore', 'decision'] as const;

/** bd 1.0.4 built-in statuses (`bd list --status` help text). */
export const BD_BUILTIN_STATUSES = [
  'open',
  'in_progress',
  'blocked',
  'deferred',
  'closed',
] as const;

/**
 * Hard ceiling on `description`, imposed by the Dolt/MySQL TEXT column bd
 * stores it in. Probe-verified against bd 1.0.4: 65535 imports, 65536 fails.
 */
export const BD_MAX_DESCRIPTION_BYTES = 65535;

/**
 * br's own status for a deleted record. bd has no equivalent concept and its
 * importer skips these silently while still reporting success, so they must
 * be enumerated BEFORE import — afterwards there is nothing left to notice.
 */
export const BR_TOMBSTONE_STATUS = 'tombstone';

export interface BeadDependency {
  issue_id: string;
  depends_on_id: string;
  type: string;
  [key: string]: unknown;
}

export interface BeadComment {
  id: number | string;
  text?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface BeadRecord {
  id: string;
  title?: string;
  description?: string | null;
  status?: string;
  issue_type?: string;
  priority?: number;
  labels?: string[];
  dependencies?: BeadDependency[];
  comments?: BeadComment[];
  closed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  source_repo?: string;
  source_repo_path?: string;
  metadata?: Record<string, unknown>;
  notes?: string;
  [key: string]: unknown;
}

/** Parse JSONL, reporting the 1-based line number on a bad line. */
export function parseJsonl(text: string): BeadRecord[] {
  const records: BeadRecord[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    try {
      records.push(JSON.parse(line) as BeadRecord);
    } catch (err) {
      throw new Error(
        `beads-transform: line ${i + 1} is not valid JSON: ${(err as Error).message}`,
      );
    }
  }
  return records;
}

export function serializeJsonl(records: BeadRecord[]): string {
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

/** UTF-8 byte length — the unit bd's column ceiling is measured in. */
export function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export interface OversizeDescription {
  id: string;
  bytes: number;
  characters: number;
}

export interface PreflightReport {
  recordCount: number;
  /** Records bd will actually import: total minus tombstones. */
  expectedImportCount: number;
  issueTypes: Record<string, number>;
  statuses: Record<string, number>;
  /** Types present in the data that bd does not know without config. */
  customTypes: string[];
  /** Statuses present that bd does not know without config, tombstone aside. */
  customStatuses: string[];
  /** Tombstoned ids — dropped silently on import, so enumerate them now. */
  tombstones: string[];
  /** Records that will abort the whole atomic import. */
  oversizeDescriptions: OversizeDescription[];
  dependencyTriples: string[];
  dependencyTypeCounts: Record<string, number>;
  labelAssignments: number;
  uniqueLabels: string[];
  commentCount: number;
  /** Closed records with no closed_at — bd fabricates one for these. */
  closedWithoutClosedAt: string[];
  /** Records whose timestamps carry sub-second precision bd will round away. */
  subSecondTimestamps: Record<string, number>;
  /** Distinct source_repo values — dropped entirely unless preserved. */
  sourceRepos: Record<string, number>;
  /** Non-integer comment ids, i.e. this file is a bd export, not a br one. */
  nonIntegerCommentIds: number;
}

const TIMESTAMP_FIELDS = ['created_at', 'updated_at', 'closed_at'] as const;

function tally(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

/**
 * Canonical `(issue_id, depends_on_id, type)` triple. Dependency edges are
 * the highest-value thing in the store and the easiest to lose without
 * noticing, so verification diffs these sorted strings rather than comparing
 * totals — equal counts prove nothing about which edges they are.
 */
export function dependencyTriples(records: BeadRecord[]): string[] {
  const triples: string[] = [];
  for (const record of records) {
    for (const dep of record.dependencies ?? []) {
      triples.push(`${dep.issue_id ?? record.id}\t${dep.depends_on_id}\t${dep.type}`);
    }
  }
  return triples.sort();
}

/**
 * Mutable tallies threaded through the per-record scanners below. Splitting
 * the scan into one function per concern keeps each one small enough to read
 * at a glance — and keeps this file under the MT01 complexity floor the
 * template ratchets on (see docs/adrs/ADR-0020).
 */
interface ScanState {
  issueTypes: Record<string, number>;
  statuses: Record<string, number>;
  dependencyTypeCounts: Record<string, number>;
  sourceRepos: Record<string, number>;
  subSecondTimestamps: Record<string, number>;
  tombstones: string[];
  oversizeDescriptions: OversizeDescription[];
  closedWithoutClosedAt: string[];
  labels: Set<string>;
  labelAssignments: number;
  commentCount: number;
  nonIntegerCommentIds: number;
}

function emptyScanState(): ScanState {
  const subSecondTimestamps: Record<string, number> = {};
  for (const field of TIMESTAMP_FIELDS) subSecondTimestamps[field] = 0;
  return {
    issueTypes: {},
    statuses: {},
    dependencyTypeCounts: {},
    sourceRepos: {},
    subSecondTimestamps,
    tombstones: [],
    oversizeDescriptions: [],
    closedWithoutClosedAt: [],
    labels: new Set<string>(),
    labelAssignments: 0,
    commentCount: 0,
    nonIntegerCommentIds: 0,
  };
}

function scanClassification(record: BeadRecord, state: ScanState): void {
  tally(state.issueTypes, record.issue_type ?? '<none>');
  tally(state.statuses, record.status ?? '<none>');
  tally(state.sourceRepos, record.source_repo ?? '<none>');
  if (record.status === BR_TOMBSTONE_STATUS) state.tombstones.push(record.id);
}

/** Blocker 3: the ceiling is bytes, so a character count would miss it. */
function scanDescriptionSize(record: BeadRecord, state: ScanState): void {
  const description = record.description ?? '';
  const bytes = byteLength(description);
  if (bytes > BD_MAX_DESCRIPTION_BYTES) {
    state.oversizeDescriptions.push({
      id: record.id,
      bytes,
      characters: description.length,
    });
  }
}

function scanTimestamps(record: BeadRecord, state: ScanState): void {
  if (record.status === 'closed' && !record.closed_at) {
    state.closedWithoutClosedAt.push(record.id);
  }
  for (const field of TIMESTAMP_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.includes('.')) {
      state.subSecondTimestamps[field] += 1;
    }
  }
}

function scanCollections(record: BeadRecord, state: ScanState): void {
  for (const dep of record.dependencies ?? []) tally(state.dependencyTypeCounts, dep.type);
  for (const label of record.labels ?? []) {
    state.labelAssignments += 1;
    state.labels.add(label);
  }
  for (const comment of record.comments ?? []) {
    state.commentCount += 1;
    if (!Number.isInteger(comment.id)) state.nonIntegerCommentIds += 1;
  }
}

function customValues(present: Record<string, number>, builtin: readonly string[]): string[] {
  const known = new Set<string>(builtin);
  return Object.keys(present)
    .filter((v) => v !== '<none>' && v !== BR_TOMBSTONE_STATUS && !known.has(v))
    .sort();
}

export function preflight(records: BeadRecord[]): PreflightReport {
  const state = emptyScanState();

  for (const record of records) {
    scanClassification(record, state);
    scanDescriptionSize(record, state);
    scanTimestamps(record, state);
    scanCollections(record, state);
  }

  return {
    recordCount: records.length,
    expectedImportCount: records.length - state.tombstones.length,
    issueTypes: state.issueTypes,
    statuses: state.statuses,
    customTypes: customValues(state.issueTypes, BD_BUILTIN_TYPES),
    customStatuses: customValues(state.statuses, BD_BUILTIN_STATUSES),
    tombstones: state.tombstones,
    oversizeDescriptions: state.oversizeDescriptions,
    dependencyTriples: dependencyTriples(records),
    dependencyTypeCounts: state.dependencyTypeCounts,
    labelAssignments: state.labelAssignments,
    uniqueLabels: [...state.labels].sort(),
    commentCount: state.commentCount,
    closedWithoutClosedAt: state.closedWithoutClosedAt,
    subSecondTimestamps: state.subSecondTimestamps,
    sourceRepos: state.sourceRepos,
    nonIntegerCommentIds: state.nonIntegerCommentIds,
  };
}

/**
 * The `bd config set` calls this store needs before `bd import` will accept
 * it. Empty array means the store is importable as-is.
 *
 * `bd config set types.custom` prints `Warning: "types.custom" is not a
 * recognized config key` and then applies it anyway — the warning is not a
 * failure, and callers must not treat it as one.
 */
export function requiredBdConfig(report: PreflightReport): string[] {
  const commands: string[] = [];
  if (report.customTypes.length > 0) {
    commands.push(`bd config set types.custom "${report.customTypes.join(',')}"`);
  }
  const statusSpecs = report.customStatuses.map((s) => `${s}:open`);
  if (report.tombstones.length > 0) {
    statusSpecs.unshift(`${BR_TOMBSTONE_STATUS}:done`);
  }
  if (statusSpecs.length > 0) {
    commands.push(`bd config set status.custom "${statusSpecs.join(',')}"`);
  }
  return commands;
}

export interface ForwardOptions {
  /**
   * Copy `source_repo` / `source_repo_path` into `metadata` before bd drops
   * them. bd tags SourceRepo `json:"-"` and has no source_repo_path field at
   * all, so without this the provenance is simply gone. It matters wherever
   * a store holds records that originated in another repo.
   */
  preserveProvenance?: boolean;
  /**
   * Also mirror provenance into `notes`. `metadata` is the clean home, but
   * bd silently drops unknown-shaped fields, so a store that cannot afford
   * to lose provenance can pay a little prose for a guaranteed carrier.
   */
  provenanceToNotes?: boolean;
  /** Drop tombstones explicitly rather than letting bd swallow them. */
  dropTombstones?: boolean;
}

export interface ForwardResult {
  records: BeadRecord[];
  /** Ids removed from the output, with the reason. */
  dropped: Array<{ id: string; reason: string }>;
  warnings: string[];
  provenancePreserved: number;
}

const PROVENANCE_NOTE_PREFIX = 'br-provenance:';

/**
 * br -> bd. Deliberately conservative: it moves provenance out of fields bd
 * discards and can drop tombstones explicitly, but it does not rewrite
 * descriptions. An oversize description is a decision for a human (split,
 * relocate, or truncate), not something a migration script should silently
 * resolve — so it is reported by preflight and left alone here.
 */
/**
 * Copy the two fields bd drops on the floor into `metadata`, which does
 * survive: verified round-tripping through bd 1.0.4 import + export, and
 * rendered by `bd show` as a METADATA block.
 */
function withProvenance(record: BeadRecord, options: ForwardOptions): BeadRecord {
  const metadata: Record<string, unknown> = { ...(record.metadata ?? {}) };
  if (record.source_repo) metadata.source_repo = record.source_repo;
  if (record.source_repo_path) metadata.source_repo_path = record.source_repo_path;

  const next: BeadRecord = { ...record, metadata };
  if (options.provenanceToNotes) next.notes = withProvenanceNote(record);
  return next;
}

/** Idempotent by construction, so re-running the transform cannot stack notes. */
function withProvenanceNote(record: BeadRecord): string {
  const parts = [record.source_repo, record.source_repo_path && `(${record.source_repo_path})`];
  const note = `${PROVENANCE_NOTE_PREFIX} ${parts.filter(Boolean).join(' ')}`.trim();
  const existing = typeof record.notes === 'string' ? record.notes : '';
  if (existing.includes(PROVENANCE_NOTE_PREFIX)) return existing;
  return existing ? `${existing}\n\n${note}` : note;
}

function hasProvenance(record: BeadRecord): boolean {
  return Boolean(record.source_repo || record.source_repo_path);
}

/**
 * br -> bd. Deliberately conservative: it moves provenance out of fields bd
 * discards and can drop tombstones explicitly, but it does not rewrite
 * descriptions. An oversize description is a decision for a human (split,
 * relocate, or truncate), not something a migration script should silently
 * resolve — so it is reported by preflight and left alone here.
 */
export function transformForward(
  records: BeadRecord[],
  options: ForwardOptions = {},
): ForwardResult {
  const dropped: Array<{ id: string; reason: string }> = [];
  const warnings: string[] = [];
  const out: BeadRecord[] = [];
  let provenancePreserved = 0;

  for (const record of records) {
    const isTombstone = record.status === BR_TOMBSTONE_STATUS;

    if (isTombstone && options.dropTombstones) {
      dropped.push({ id: record.id, reason: 'tombstone (dropped explicitly)' });
      continue;
    }
    if (isTombstone) {
      warnings.push(
        `${record.id}: tombstone kept in output; bd's importer will skip it silently unless status.custom maps it`,
      );
    }

    const preserve = Boolean(options.preserveProvenance) && hasProvenance(record);
    if (preserve) provenancePreserved += 1;
    out.push(preserve ? withProvenance(record, options) : { ...record });
  }

  return { records: out, dropped, warnings, provenancePreserved };
}

export interface ReverseOptions {
  /**
   * Original br records, used to restore each comment's ORIGINAL integer id
   * by matching on (issue id, created_at, text). Without this the reverse
   * transform can only assign fresh sequential ids — br will import either
   * way, but only this makes a br -> bd -> br round trip exact.
   */
  reference?: BeadRecord[];
}

export interface ReverseResult {
  records: BeadRecord[];
  /** Comment ids rewritten from bd's UUID strings back to integers. */
  remappedComments: number;
  /** Comments whose original integer id was recovered from the reference. */
  restoredFromReference: number;
  warnings: string[];
}

function commentKey(issueId: string, comment: BeadComment): string {
  return `${issueId} ${comment.created_at ?? ''} ${comment.text ?? ''}`;
}

/**
 * bd -> br. This is the rollback path, and without it the migration is
 * one-way: bd rewrites every comment `id` from br's integer to a UUID
 * string, br's schema requires an i64, and br aborts on the first one it
 * meets. Nothing else in bd's export blocks br — the rest of the drift is
 * additive fields br ignores.
 */
interface ReferenceIndex {
  originalIds: Map<string, number>;
  nextSequentialId: number;
}

/**
 * Index the original br comments by (issue, created_at, text) so the reverse
 * transform can restore each comment's ORIGINAL integer id. bd's export keeps
 * both timestamp and text intact, which is what makes the match reliable.
 */
function indexReference(reference: BeadRecord[] | undefined): ReferenceIndex {
  const originalIds = new Map<string, number>();
  let nextSequentialId = 1;

  for (const record of reference ?? []) {
    for (const comment of record.comments ?? []) {
      if (!Number.isInteger(comment.id)) continue;
      const id = comment.id as number;
      originalIds.set(commentKey(record.id, comment), id);
      nextSequentialId = Math.max(nextSequentialId, id + 1);
    }
  }

  return { originalIds, nextSequentialId };
}

/**
 * bd -> br. This is the rollback path, and without it the migration is
 * one-way: bd rewrites every comment `id` from br's integer to a UUID
 * string, br's schema requires an i64, and br aborts on the first one it
 * meets. Nothing else in bd's export blocks br — the rest of the drift is
 * additive fields br ignores.
 */
export function transformReverse(
  records: BeadRecord[],
  options: ReverseOptions = {},
): ReverseResult {
  const index = indexReference(options.reference);
  const warnings: string[] = [];
  let remappedComments = 0;
  let restoredFromReference = 0;

  const out = records.map((record) => {
    if (!record.comments || record.comments.length === 0) return { ...record };

    const comments = record.comments.map((comment) => {
      if (Number.isInteger(comment.id)) return { ...comment };

      remappedComments += 1;
      const original = index.originalIds.get(commentKey(record.id, comment));
      if (original === undefined) return { ...comment, id: index.nextSequentialId++ };

      restoredFromReference += 1;
      return { ...comment, id: original };
    });

    return { ...record, comments };
  });

  if (remappedComments > restoredFromReference) {
    warnings.push(
      `${remappedComments - restoredFromReference} comment id(s) could not be matched to the reference and were assigned fresh sequential ids; comment text is preserved but the original id is not recoverable from bd's export`,
    );
  }

  return { records: out, remappedComments, restoredFromReference, warnings };
}

export interface VerificationDiff {
  label: string;
  before: number | string;
  after: number | string;
  ok: boolean;
  detail?: string;
}

/**
 * Compare a before/after pair of preflight reports. `expectedLoss` names the
 * records the migration is knowingly giving up (tombstones), so the record
 * count reconciles explicitly instead of being waved through as close enough.
 */
export function compareReports(
  before: PreflightReport,
  after: PreflightReport,
): VerificationDiff[] {
  const diffs: VerificationDiff[] = [];

  diffs.push({
    label: 'record count (before minus tombstones)',
    before: before.expectedImportCount,
    after: after.recordCount,
    ok: before.expectedImportCount === after.recordCount,
    detail:
      before.tombstones.length > 0
        ? `${before.tombstones.length} tombstone(s) expected to drop: ${before.tombstones.join(', ')}`
        : undefined,
  });

  const beforeTriples = before.dependencyTriples;
  const afterTriples = after.dependencyTriples;
  const afterSet = new Set(afterTriples);
  const beforeSet = new Set(beforeTriples);
  const missing = beforeTriples.filter((t) => !afterSet.has(t));
  const added = afterTriples.filter((t) => !beforeSet.has(t));
  diffs.push({
    label: 'dependency triples (issue, depends_on, type)',
    before: beforeTriples.length,
    after: afterTriples.length,
    ok: missing.length === 0 && added.length === 0,
    detail:
      missing.length || added.length
        ? `missing: ${missing.length ? missing.join(' | ') : 'none'}; added: ${added.length ? added.join(' | ') : 'none'}`
        : 'exact triple match',
  });

  diffs.push({
    label: 'label assignments',
    before: before.labelAssignments,
    after: after.labelAssignments,
    ok: before.labelAssignments === after.labelAssignments,
  });

  const beforeLabels = before.uniqueLabels.join(',');
  const afterLabels = after.uniqueLabels.join(',');
  diffs.push({
    label: 'unique labels',
    before: before.uniqueLabels.length,
    after: after.uniqueLabels.length,
    ok: beforeLabels === afterLabels,
    detail: beforeLabels === afterLabels ? 'exact set match' : 'label set differs',
  });

  diffs.push({
    label: 'comments',
    before: before.commentCount,
    after: after.commentCount,
    ok: before.commentCount === after.commentCount,
  });

  return diffs;
}
