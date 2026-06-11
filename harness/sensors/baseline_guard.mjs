import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EPSILON = 1e-6;
export const BASELINE_REFERENCE_DEFAULT_REF = 'origin/main';
export const BASELINE_REFERENCE_DEFAULT_PATH = 'harness/sensors/baseline.json';
export const BASELINE_REFERENCE_DEFAULT = `${BASELINE_REFERENCE_DEFAULT_REF}:${BASELINE_REFERENCE_DEFAULT_PATH}`;
export const BASELINE_RELAXATION_MARKER = 'BASELINE-RELAX-OK';
export const BASELINE_RELAXATION_APPROVAL_KEY = '_baseline_relaxation_approvals';
const RELAXATION_SEGMENT_SEP = '|';
export const FOLDER_METRICS = ['I', 'D'];

function isNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function worsened(direction, current, baseline) {
  if (!isNumber(current) || !isNumber(baseline)) {
    return false;
  }
  if (direction === 'min') {
    return current < baseline - EPSILON;
  }
  return current > baseline + EPSILON;
}

function formatPath(prefix, bucket, metric) {
  return `${prefix}${RELAXATION_SEGMENT_SEP}${bucket}${RELAXATION_SEGMENT_SEP}${metric}`;
}

export function folderRelaxationPath(folder, metric) {
  return formatPath('folders', folder, metric);
}

export function dimensionRelaxationPath(dimension, metric) {
  return formatPath('dimensions', dimension, metric);
}

function hasRelaxationMarker(workingBaseline, path) {
  const approvals =
    typeof workingBaseline?.[BASELINE_RELAXATION_APPROVAL_KEY] === 'object'
      ? workingBaseline[BASELINE_RELAXATION_APPROVAL_KEY]
      : null;
  if (!approvals || typeof approvals[path] !== 'string') {
    return null;
  }
  const note = approvals[path];
  return note.includes(BASELINE_RELAXATION_MARKER) ? note : null;
}

function readNumberFromGenerated(generated, path) {
  if (typeof path !== 'string') {
    return null;
  }
  const [kind, bucket, metric] = path.split(RELAXATION_SEGMENT_SEP);
  if (kind === 'folders') {
    const value = generated?.folders?.[bucket]?.[metric];
    return isNumber(value) ? value : null;
  }
  if (kind === 'dimensions') {
    const value = generated?.dimensions?.[bucket]?.metrics?.[metric]?.baseline;
    return isNumber(value) ? value : null;
  }
  return null;
}

function evaluateCandidate({ kind, path, direction, reference, working, generated, violations }) {
  if (!isNumber(reference)) {
    return;
  }
  if (working === null || working === undefined) {
    violations.push({
      kind,
      path,
      direction,
      reference,
      working: null,
      reason: 'floor-replaced-with-null',
      message: 'baseline replaced with null from a constrained numeric floor',
      severity: 'loosened',
    });
    return;
  }
  if (!isNumber(working)) {
    return;
  }
  if (!worsened(direction, working, reference)) {
    return;
  }
  const note = hasRelaxationMarker(this?.workingBaseline, path);
  if (!note) {
    violations.push({
      kind,
      path,
      direction,
      reference,
      working,
      reason: 'missing-relaxation-marker',
      severity: 'loosened',
      message: 'baseline relaxed without explicit BASELINE-RELAX-OK marker',
    });
    return;
  }
  const current = readNumberFromGenerated(generated, path);
  if (current === null) {
    violations.push({
      kind,
      path,
      direction,
      reference,
      working,
      reason: 'missing-regenerated-baseline-measurement',
      severity: 'loosened',
      message: 'no regenerated measurement to validate this baseline relaxation',
      note,
    });
    return;
  }
  if (Math.abs(current - working) > EPSILON) {
    violations.push({
      kind,
      path,
      direction,
      reference,
      working,
      current,
      reason: 'regenerated-baseline-mismatch',
      severity: 'loosened',
      message: `regenerated baseline mismatch for ${path}`,
      note,
    });
    return;
  }
  return;
}

/**
 * Load a baseline file from a git reference. Supports refs in `--` form
 * `origin/main` and `origin/main:path/to/baseline.json`, plus explicit
 * filesystem references via `file:...` or dot/slash relative and absolute
 * paths.
 */
export function parseReferenceSpec(spec) {
  const raw = String(spec ?? '').trim();
  if (!raw) {
    return {
      kind: 'git',
      ref: BASELINE_REFERENCE_DEFAULT_REF,
      path: BASELINE_REFERENCE_DEFAULT_PATH,
    };
  }
  if (raw === 'none') {
    return { kind: 'none' };
  }
  if (raw.startsWith('file:')) {
    return { kind: 'file', path: raw.slice('file:'.length) };
  }
  if (raw.startsWith('./') || raw.startsWith('../') || raw.startsWith('/') || raw.startsWith('~')) {
    return { kind: 'file', path: raw };
  }
  const idx = raw.indexOf(':');
  if (idx === -1) {
    return { kind: 'git', ref: raw, path: BASELINE_REFERENCE_DEFAULT_PATH };
  }
  return { kind: 'git', ref: raw.slice(0, idx), path: raw.slice(idx + 1) };
}

export function loadReferenceBaseline(
  spec = BASELINE_REFERENCE_DEFAULT,
  io = { readFile: (path) => readFileSync(path, 'utf8') },
  run = spawnSync,
) {
  const parsed = parseReferenceSpec(spec);
  if (parsed.kind === 'none') {
    return null;
  }
  if (parsed.kind === 'file') {
    return JSON.parse(io.readFile(parsed.path));
  }
  const command = `${parsed.ref}:${parsed.path}`;
  const result = run('git', ['show', command], { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`failed to load reference baseline (${result.error.message})`);
  }
  if (result.status !== 0) {
    const err = (result.stderr || '').trim();
    throw new Error(
      `failed to load reference baseline from ${parsed.ref}: ${err || `git show ${command} failed`}`,
    );
  }
  return JSON.parse(result.stdout);
}

export function evaluateBaselineRelaxationGuard({
  workingBaseline,
  referenceBaseline,
  generatedBaseline,
}) {
  const violations = [];
  if (!referenceBaseline || typeof referenceBaseline !== 'object') {
    return {
      ok: false,
      violations: [
        {
          kind: 'reference-baseline-missing',
          path: 'reference',
          reason: 'missing-reference-baseline',
          severity: 'error',
          message: 'no reference baseline available for comparison',
        },
      ],
    };
  }
  if (!workingBaseline || typeof workingBaseline !== 'object') {
    return {
      ok: false,
      violations: [
        {
          kind: 'working-baseline-missing',
          path: 'working',
          reason: 'missing-working-baseline',
          severity: 'error',
          message: 'no working baseline available for comparison',
        },
      ],
    };
  }

  for (const [folderName, referenceFolder] of Object.entries(referenceBaseline.folders ?? {})) {
    const workingFolder = workingBaseline?.folders?.[folderName];
    if (!workingFolder) {
      continue;
    }
    for (const metric of FOLDER_METRICS) {
      evaluateCandidate.call(
        { workingBaseline },
        {
          kind: 'folder',
          path: folderRelaxationPath(folderName, metric),
          direction: 'max',
          reference: referenceFolder?.[metric],
          working: workingFolder?.[metric],
          generated: generatedBaseline,
          violations,
        },
      );
    }
  }

  for (const [dimension, referenceDimension] of Object.entries(
    referenceBaseline.dimensions ?? {},
  )) {
    const referenceMetrics = referenceDimension?.metrics;
    if (!referenceMetrics || typeof referenceMetrics !== 'object') {
      continue;
    }
    for (const [metricId, referenceMetric] of Object.entries(referenceMetrics)) {
      const direction = referenceMetric?.direction;
      const referenceValue = referenceMetric?.baseline;
      const workingMetric = workingBaseline?.dimensions?.[dimension]?.metrics?.[metricId];
      const workingValue = workingMetric?.baseline;
      if (direction !== 'max' && direction !== 'min') {
        if (isNumber(referenceValue)) {
          violations.push({
            kind: 'metric-direction',
            path: dimensionRelaxationPath(dimension, metricId),
            direction,
            reference: referenceValue,
            working: workingValue,
            reason: 'invalid-direction',
            severity: 'error',
            message: `unknown direction ${direction} for ${dimension} ${metricId}`,
          });
        }
        continue;
      }
      evaluateCandidate.call(
        { workingBaseline },
        {
          kind: 'dimension',
          path: dimensionRelaxationPath(dimension, metricId),
          direction,
          reference: referenceValue,
          working: workingValue,
          generated: generatedBaseline,
          violations,
        },
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

export function formatBaselineRelaxationGuard(guard) {
  if (!guard || guard.ok) {
    return '';
  }
  const lines = [''];
  lines.push('BASELINE RELAXATION GUARD: FAIL');
  lines.push('  loosened thresholds are blocked unless explicit regeneration is justified:');
  for (const v of guard.violations) {
    const marker = v.note ?? '';
    const noteText = marker ? ` note=${marker}` : '';
    const extra = v.current !== undefined ? ` current=${v.current}` : '';
    lines.push(`  ${v.path}: ${v.reason} (from ${v.reference}) -> ${v.working}${extra}${noteText}`);
  }
  lines.push(
    '  To make a floor move in the loosening direction, add BASELINE-RELAX-OK and regenerate the baseline.',
  );
  return `${lines.join('\n')}\n`;
}
