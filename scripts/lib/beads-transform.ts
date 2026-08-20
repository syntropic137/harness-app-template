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
export const BD_BUILTIN_TYPES = [
  'bug',
  'feature',
  'task',
  'epic',
  'chore',
  'decision',
  // `bd create --help` documents --type=event with its own --event-* flags.
  // Omitting it makes requiredBdConfig demand a types.custom entry for a type
  // bd already understands.
  'event',
] as const;

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
  /**
   * Distinct provenance values, read from `source_repo` (br) or from
   * `metadata.source_repo` (bd, after --preserve-provenance). Reading only the
   * former would report a successful preserve as a total loss.
   */
  sourceRepos: Record<string, number>;
  /** Non-integer comment ids, i.e. this file is a bd export, not a br one. */
  nonIntegerCommentIds: number;
  /** Sorted record ids, so verification can prove WHICH records survived. */
  ids: string[];
  /** Sorted `id\ttitle` pairs — catches a title rewritten in place. */
  titles: string[];
  /** Sorted `id\tstatus\ttype\tpriority` triples. */
  classifications: string[];
  /** Sorted `id\t<utf8 byte length>` — catches a truncated description. */
  descriptionSizes: string[];
}

const TIMESTAMP_FIELDS = ['created_at', 'updated_at', 'closed_at'] as const;

/** Reported beside TIMESTAMP_FIELDS but read off each comment, not the record. */
const COMMENT_TIMESTAMP_FIELD = 'comments.created_at';

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
  subSecondTimestamps[COMMENT_TIMESTAMP_FIELD] = 0;
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
  // Provenance lives in `source_repo` before the migration and in `metadata`
  // after it. Reading only the former reports a successful --preserve-provenance
  // run as a total loss.
  const metaRepo = (record.metadata as Record<string, unknown> | undefined)?.source_repo;
  const repo = record.source_repo ?? (typeof metaRepo === 'string' ? metaRepo : undefined);
  tally(state.sourceRepos, repo ?? '<none>');
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
    // Comment timestamps round exactly as record ones do. Reported separately
    // so the loss ledger cannot read clean while every comment is about to
    // move by up to a second.
    if (typeof comment.created_at === 'string' && comment.created_at.includes('.')) {
      state.subSecondTimestamps[COMMENT_TIMESTAMP_FIELD] += 1;
    }
  }
}

/**
 * Values present in the data that bd does not know natively.
 *
 * `dropTombstone` exists because the sentinel is a STATUS, never a type. A
 * store carrying `issue_type: "tombstone"` must still be reported as needing
 * `types.custom`, or the atomic import rolls the whole file back to count 0 -
 * the exact failure the preflight exists to catch.
 */
function customValues(
  present: Record<string, number>,
  builtin: readonly string[],
  dropTombstone: boolean,
): string[] {
  const known = new Set<string>(builtin);
  return Object.keys(present)
    .filter((v) => v !== '<none>' && !(dropTombstone && v === BR_TOMBSTONE_STATUS) && !known.has(v))
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
    customTypes: customValues(state.issueTypes, BD_BUILTIN_TYPES, false),
    customStatuses: customValues(state.statuses, BD_BUILTIN_STATUSES, true),
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
    ids: records.map((r) => r.id).sort(),
    titles: records.map((r) => `${r.id}\t${r.title ?? ''}`).sort(),
    classifications: records
      .map((r) => `${r.id}\t${r.status ?? ''}\t${r.issue_type ?? ''}\t${r.priority ?? ''}`)
      .sort(),
    descriptionSizes: records.map((r) => `${r.id}\t${byteLength(r.description ?? '')}`).sort(),
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
  /** Records that had provenance written to at least one surviving carrier. */
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
  const next: BeadRecord = { ...record };

  // The two carriers are independent: metadata is the clean home, notes is the
  // belt-and-braces one for a store that cannot afford to lose provenance if
  // bd ever changes how it treats unknown metadata shapes.
  if (options.preserveProvenance) {
    const metadata: Record<string, unknown> = { ...(record.metadata ?? {}) };
    if (record.source_repo) metadata.source_repo = record.source_repo;
    if (record.source_repo_path) metadata.source_repo_path = record.source_repo_path;
    next.metadata = metadata;
  }
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

    // Either flag alone is enough to act. They were previously coupled, so
    // `--provenance-to-notes` on its own silently emitted the record unchanged
    // - and source_repo is unrecoverable once bd has dropped it.
    const wants = Boolean(options.preserveProvenance) || Boolean(options.provenanceToNotes);
    const preserve = wants && hasProvenance(record);
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

/**
 * Match key pairing a bd comment back to its br original.
 *
 * The timestamp is deliberately NOT part of the key. bd stores comment
 * timestamps at whole-second resolution and ROUNDS to get there, so br's
 * `...:19.987654321Z` comes back as `...:20Z`. Keying on it means every
 * ns-precision comment - which is br's default - misses the index and
 * silently receives a fresh id on rollback. Text plus an occurrence ordinal
 * survives the round trip; the timestamp does not.
 */
function commentKey(issueId: string, comment: BeadComment, ordinal: number): string {
  return [issueId, String(ordinal), comment.text ?? ''].join('\u0000');
}

interface ReferenceIndex {
  originalIds: Map<string, number>;
  /** Every integer id already spoken for, so a fresh one cannot collide. */
  usedIds: Set<number>;
}

/**
 * Index the original br comments so the reverse transform can restore each
 * comment's ORIGINAL integer id.
 *
 * The ordinal in the key also disambiguates two identical comments on the
 * same issue, which would otherwise collapse to one entry and hand both the
 * same id - br requires comment ids to be unique i64s.
 */
function indexReference(reference: BeadRecord[] | undefined): ReferenceIndex {
  const originalIds = new Map<string, number>();
  const usedIds = new Set<number>();

  for (const record of reference ?? []) {
    let ordinal = 0;
    for (const comment of record.comments ?? []) {
      if (!Number.isInteger(comment.id)) continue;
      const id = comment.id as number;
      originalIds.set(commentKey(record.id, comment, ordinal), id);
      usedIds.add(id);
      ordinal += 1;
    }
  }

  return { originalIds, usedIds };
}

/**
 * bd -> br. This is the rollback path, and without it the migration is
 * one-way: bd rewrites every comment `id` from br's integer to a UUID
 * string, br's schema requires an i64, and br aborts on the first one it
 * meets. Nothing else in bd's export blocks br - the rest of the drift is
 * additive fields br ignores.
 */
/** Every integer comment id already present in `records`, which a fresh id must avoid. */
function claimExistingIds(records: BeadRecord[], usedIds: Set<number>): void {
  for (const record of records) {
    for (const comment of record.comments ?? []) {
      if (Number.isInteger(comment.id)) usedIds.add(comment.id as number);
    }
  }
}

/** Allocator for comment ids that no reference or input already claims. */
function makeIdAllocator(usedIds: Set<number>): () => number {
  let candidate = 1;
  return () => {
    while (usedIds.has(candidate)) candidate += 1;
    usedIds.add(candidate);
    return candidate;
  };
}

interface ReverseTally {
  remapped: number;
  restored: number;
}

// Takes the comment list rather than reading it off the record: the caller
// has already established it is non-empty, so a `?? []` fallback here would be
// an unreachable branch.
function reverseComments(
  issueId: string,
  comments: BeadComment[],
  index: ReferenceIndex,
  freshId: () => number,
  tally: ReverseTally,
): BeadComment[] {
  let ordinal = -1;
  return comments.map((comment) => {
    ordinal += 1;
    if (Number.isInteger(comment.id)) return { ...comment };

    tally.remapped += 1;
    const original = index.originalIds.get(commentKey(issueId, comment, ordinal));
    if (original === undefined) return { ...comment, id: freshId() };

    tally.restored += 1;
    return { ...comment, id: original };
  });
}

export function transformReverse(
  records: BeadRecord[],
  options: ReverseOptions = {},
): ReverseResult {
  const index = indexReference(options.reference);
  // Integer ids already in the INPUT are spoken for too: a partially-reversed
  // file carries some, and reusing one hands br a duplicate.
  claimExistingIds(records, index.usedIds);

  const freshId = makeIdAllocator(index.usedIds);
  const tally: ReverseTally = { remapped: 0, restored: 0 };

  const out = records.map((record) =>
    record.comments && record.comments.length > 0
      ? { ...record, comments: reverseComments(record.id, record.comments, index, freshId, tally) }
      : { ...record },
  );

  const warnings =
    tally.remapped > tally.restored
      ? [
          `${tally.remapped - tally.restored} comment id(s) could not be matched to the reference and were assigned fresh sequential ids; comment text is preserved but the original id is not recoverable from bd's export`,
        ]
      : [];

  return {
    records: out,
    remappedComments: tally.remapped,
    restoredFromReference: tally.restored,
    warnings,
  };
}

/** Sorted-list diff helper: what `before` had that `after` lost, and vice versa. */
function setDiff(before: string[], after: string[]): { missing: string[]; added: string[] } {
  const afterSet = new Set(after);
  const beforeSet = new Set(before);
  return {
    missing: before.filter((v) => !afterSet.has(v)),
    added: after.filter((v) => !beforeSet.has(v)),
  };
}

function describe(missing: string[], added: string[]): string {
  const show = (list: string[]) => (list.length ? list.slice(0, 5).join(' | ') : 'none');
  const more = missing.length + added.length > 10 ? ' (truncated)' : '';
  return `missing: ${show(missing)}; added: ${show(added)}${more}`;
}

/** A value-level check: diff two sorted lists and render the result. */
function listCheck(
  label: string,
  before: string[],
  after: string[],
  okDetail: string,
): VerificationDiff {
  const { missing, added } = setDiff(before, after);
  return {
    label,
    before: before.length,
    after: after.length,
    ok: missing.length === 0 && added.length === 0,
    detail: missing.length || added.length ? describe(missing, added) : okDetail,
  };
}

/** A plain scalar check, for the two totals that have no per-record identity. */
function countCheck(label: string, before: number, after: number): VerificationDiff {
  return { label, before, after, ok: before === after };
}

function recordCountCheck(before: PreflightReport, after: PreflightReport): VerificationDiff {
  return {
    label: 'record count (before minus tombstones)',
    before: before.expectedImportCount,
    after: after.recordCount,
    ok: before.expectedImportCount === after.recordCount,
    detail:
      before.tombstones.length > 0
        ? `${before.tombstones.length} tombstone(s) expected to drop: ${before.tombstones.join(', ')}`
        : undefined,
  };
}

/**
 * Provenance is dropped by bd unless the transform preserved it, and it is
 * unrecoverable afterwards — so it gets a check rather than a footnote.
 */
function provenanceCheck(before: PreflightReport, after: PreflightReport): VerificationDiff {
  const named = (r: PreflightReport) =>
    Object.keys(r.sourceRepos)
      .filter((v) => v !== '<none>')
      .sort();
  const b = named(before);
  const a = named(after);
  return {
    label: 'source_repo provenance',
    before: b.length,
    after: a.length,
    ok: b.length === 0 || a.join(',') === b.join(','),
    detail:
      b.length > 0 && a.length === 0
        ? 'dropped by bd — rerun forward with --preserve-provenance (unrecoverable once lost)'
        : undefined,
  };
}

/**
 * Compare a before/after pair of preflight reports.
 *
 * Every check compares actual VALUES, never just counts: a run that dropped
 * one record and gained another reconciles perfectly on totals. Tombstones are
 * the one knowingly-accepted loss, so they are removed from the before-side
 * rather than reported as missing.
 */
export function compareReports(
  before: PreflightReport,
  after: PreflightReport,
): VerificationDiff[] {
  const tombstoned = new Set(before.tombstones);
  const kept = (rows: string[]) => rows.filter((v) => !tombstoned.has(v.split('\t')[0] as string));

  return [
    recordCountCheck(before, after),
    listCheck('record ids', kept(before.ids), after.ids, 'exact id match'),
    listCheck(
      'dependency triples (issue, depends_on, type)',
      kept(before.dependencyTriples),
      after.dependencyTriples,
      'exact triple match',
    ),
    listCheck('titles', kept(before.titles), after.titles, 'exact title match'),
    listCheck(
      'status / type / priority',
      kept(before.classifications),
      after.classifications,
      'exact classification match',
    ),
    listCheck(
      'description byte sizes',
      kept(before.descriptionSizes),
      after.descriptionSizes,
      'every description survived byte-for-byte',
    ),
    countCheck('label assignments', before.labelAssignments, after.labelAssignments),
    listCheck('unique labels', before.uniqueLabels, after.uniqueLabels, 'exact set match'),
    countCheck('comments', before.commentCount, after.commentCount),
    provenanceCheck(before, after),
  ];
}
