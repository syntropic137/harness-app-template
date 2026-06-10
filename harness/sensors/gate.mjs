// gate.mjs - upward-ratchet fitness gate for the sensors slot.
//
// Reads a workspace report (the output of aggregate.mjs) and compares each
// folder's Martin metrics + every APSS dimension metric against the
// persisted floor in `harness/sensors/baseline.json`. The gate is a
// monotonic ratchet: quality can improve freely (the floor tightens
// automatically when measured metrics get better) but a regression below
// the floor fails the run. "No broken windows" - once a folder reaches
// instability 0.1, it is not allowed to slide back to 0.4 next week.
//
// Closes bead create-harness-app-n48.4 (P0). Implements ADR-0017's
// Decision (2) consequence - the gate consumes whatever the aggregator
// emits (Node aggregator today, APSS topology later) without depending on
// APSS being ported first. The ratchet shape is recorded in
// docs/adrs/ADR-0020-architectural-fitness-ratchet.md.
//
// Discipline (ratchet, monotonic improvement):
//   - First run: no baseline exists -> write current report as the baseline
//     and exit 0 with a "baseline created" message. The baseline becomes a
//     committed floor.
//   - Subsequent runs: compare each metric against its floor.
//       * IMPROVEMENT (current is direction-aware better than baseline,
//         or baseline was null while current is a real number): the floor
//         AUTO-TIGHTENS to the new value. Baseline file is rewritten with
//         the tightened floor and the run reports what tightened. Exit 0.
//       * NO CHANGE (within EPSILON): no write, no churn, exit 0.
//       * REGRESSION (current is direction-aware worse than baseline,
//         beyond EPSILON): the floor does NOT move; the run prints a
//         per-folder / per-dimension diff and exits non-zero.
//   - Escape hatches:
//       * `--update-baseline`: deliberate, reviewable RELAX. Writes the
//         current report as the new baseline regardless of regression. Use
//         only when an intentional refactor or slot redesign justifies
//         loosening the floor; the resulting baseline.json diff is the
//         audit trail.
//       * `--no-ratchet` (or `RATCHET=off`): run the gate as a pure
//         comparator. Useful for replay / CI dry-run / debug sessions
//         where you do not want the side effect of rewriting the baseline.
//
// Preservation-first: aggregate.mjs and abstractness.mjs are untouched.
// The gate consumes their JSON output without altering it.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import toml from '@iarna/toml';

const EPSILON = 1e-6;
const FITNESS_SCHEMA_VERSION = '1.0.0';
const DEFAULT_POLICY_PATH = 'harness/.harness/governance.toml';
const DEPCRUISER_SENSOR = 'dep-cruiser@17.4.0';
const TEMPLATE_SENSOR = 'harness-sensors@template';

const DIMENSION_ORDER = ['MT01', 'MD01', 'ST01', 'SC01', 'LG01', 'AC01', 'PF01', 'AV01'];

const DIMENSIONS = {
  MT01: {
    name: 'Maintainability',
    promotion_status: 'active',
    enforcement: 'enforced',
    default: 'default-enabled',
  },
  MD01: {
    name: 'Modularity and Coupling',
    promotion_status: 'active',
    enforcement: 'enforced',
    default: 'default-enabled',
  },
  ST01: {
    name: 'Structural Integrity',
    promotion_status: 'active',
    enforcement: 'enforced',
    default: 'default-enabled',
  },
  SC01: {
    name: 'Security',
    promotion_status: 'active',
    enforcement: 'enforced',
    default: 'default-enabled',
  },
  LG01: {
    name: 'Legality',
    promotion_status: 'active',
    enforcement: 'enforced',
    default: 'default-enabled',
  },
  AC01: {
    name: 'Accessibility',
    promotion_status: 'incubating',
    enforcement: 'advisory',
    default: 'opt-in',
  },
  PF01: {
    name: 'Performance',
    promotion_status: 'active',
    enforcement: 'enforced',
    default: 'default-enabled',
  },
  AV01: {
    name: 'Availability',
    promotion_status: 'incubating',
    enforcement: 'advisory',
    default: 'opt-in',
  },
};

const FITNESS_METRICS = {
  MT01: [
    {
      id: 'max-cognitive',
      name: 'Maximum Cognitive Complexity',
      objective:
        'Max function cognitive complexity from APSS functions or the local complexity adapter.',
      source: '.topology/metrics/functions.json or harness/sensors/complexity.mjs',
      direction: 'max',
      default_threshold: 15,
      fail_on_regression: true,
      value: (report) =>
        maxNumber([
          ...apssFunctionValues(report, 'cognitive'),
          ...moduleValues(report, (m) => m.max_cognitive),
          ...folderValues(report, (f) => f.max_cognitive ?? f.apss_max_cognitive),
        ]),
    },
    {
      id: 'max-cyclomatic',
      name: 'Maximum Cyclomatic Complexity',
      objective:
        'Max function cyclomatic complexity from APSS functions or the local complexity adapter.',
      source: '.topology/metrics/functions.json or harness/sensors/complexity.mjs',
      direction: 'max',
      default_threshold: 10,
      fail_on_regression: true,
      value: (report) =>
        maxNumber([
          ...apssFunctionValues(report, 'cyclomatic'),
          ...moduleValues(report, (m) => m.max_cyclomatic),
          ...folderValues(report, (f) => f.max_cyclomatic ?? f.apss_max_cyclomatic),
        ]),
    },
    {
      id: 'max-halstead-volume',
      name: 'Maximum Halstead Volume',
      objective: 'Max APSS Halstead volume per function when APSS emits Halstead metrics.',
      source: '.topology/metrics/functions.json metrics.halstead.volume',
      direction: 'max',
      default_threshold: 1000,
      fail_on_regression: true,
      value: (report) => maxNumber(apssFunctionValues(report, 'halstead_volume')),
    },
  ],
  MD01: [
    {
      id: 'max-fan-out',
      name: 'Maximum Efferent Coupling',
      objective:
        'Max module efferent coupling from APSS coupling or the dependency-cruiser fallback.',
      source: '.topology/metrics/coupling.json or aggregate workspace modules',
      direction: 'max',
      default_threshold: 20,
      fail_on_regression: true,
      value: (report) =>
        maxNumber([
          ...moduleValues(report, (m) => m.apss?.efferent_coupling ?? m.apss?.ce ?? m.Ce),
          ...folderValues(report, (f) => f.apss_efferent_coupling_max),
        ]),
    },
    {
      id: 'max-main-sequence-distance',
      name: 'Maximum Distance from Main Sequence',
      objective: 'Max module distance from the Martin main sequence.',
      source: '.topology/metrics/coupling.json or aggregate workspace modules',
      direction: 'max',
      default_threshold: 0.7,
      fail_on_regression: true,
      value: (report) =>
        maxNumber([
          ...moduleValues(report, (m) => m.apss?.distance_from_main_sequence ?? m.D),
          ...folderValues(report, (f) => f.apss_distance_max ?? f.D),
        ]),
    },
    {
      id: 'instability-out-of-range-count',
      name: 'Instability Outside Healthy Range',
      objective: 'Count modules with instability below 0.1 or above 0.9.',
      source: '.topology/metrics/coupling.json or aggregate workspace modules',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: (report) =>
        moduleValues(report, (m) => m.apss?.instability ?? m.I).filter(
          (v) => typeof v === 'number' && (v < 0.1 || v > 0.9),
        ).length,
    },
  ],
  ST01: [
    {
      id: 'circular-dependency-edges',
      name: 'Circular Dependency Edges',
      objective:
        'Count of dependency edges flagged as circular by dependency-cruiser, scoped to workspace sources (ws_apps + ws_packages). Each cycle of length N contributes N edges. Source: workspace.circular_edges in the aggregate report (bead create-harness-app-2zz.1).',
      source: 'aggregate workspace.circular_edges (dependency-cruiser circular flag)',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: (report) => {
        const v = report?.workspace?.circular_edges;
        return typeof v === 'number' ? v : null;
      },
    },
  ],
  SC01: [
    {
      id: 'critical-finding-count',
      name: 'Critical Security Finding Count',
      objective:
        'Count of critical-severity findings emitted by the Ultimate Bug Scanner (UBS) over template-owned source paths. The bin/sensors wrapper runs ubs --report-json scoped to a stable file list and writes the JSON to a tempfile; the gate reads totals.critical via --security=<path>. Soft-skip yields a null reading; an active scan with zero findings yields baseline 0 and the gate fails on any new critical pattern (bead create-harness-app-2zz.2).',
      source: 'ubs --report-json totals.critical (template-owned source paths)',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: (_report, options) => ubsCriticalCount(options),
    },
  ],
  LG01: [
    {
      id: 'denied-license-count',
      name: 'Denied License Count',
      objective:
        'Count of installed packages whose declared license is missing or outside the OSI-permissive allowlist (MIT, ISC, Apache-2.0, BSD-2/3-Clause, MPL-2.0, CC0-1.0, etc.). Source: harness/sensors/license_scan.mjs walks every node_modules root that exists on disk. The bin/sensors wrapper invokes the scanner and passes --licenses=<path> (bead create-harness-app-2zz.3).',
      source: 'harness/sensors/license_scan.mjs denied_count',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: (_report, options) => licenseDeniedCount(options),
    },
  ],
  AC01: [
    {
      id: 'accessibility-violation-count',
      name: 'Accessibility Violation Count',
      objective:
        "Advisory-by-design: a static template repository ships no rendered frontend to scan with axe-core or pa11y. AC01 stays advisory + opt-in; a consumer fork that ships an actual web frontend writes its own adapter (axe-core / pa11y over the rendered output, scoped to the fork's ws_apps/<frontend> path). Bead create-harness-app-2zz.4 closed with reason advisory-by-design.",
      source: 'advisory-by-design (no rendered frontend in a static template)',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: () => null,
    },
  ],
  PF01: [
    {
      id: 'startup-benchmark-mean',
      name: 'Maximum Startup Benchmark Mean',
      objective:
        'Maximum hyperfine benchmark mean wall-clock from harness/perf/baseline.json. PF01 enforces; a current mean above baseline (beyond EPSILON) trips the gate. In environments without hyperfine the metric reports as no-reading and the dedicated harness/perf gate is the primary enforcer (it owns the tolerance window).',
      source: 'harness/perf/baseline.json benchmarks.[*].mean',
      direction: 'max',
      default_threshold: 5,
      fail_on_regression: true,
      value: (_report, options) => maxNumber(perfBenchmarkMeans(options)),
    },
    {
      id: 'startup-benchmark-count',
      name: 'Startup Benchmark Count',
      objective:
        'Number of benchmarks committed in harness/perf/baseline.json. Floor is the snapshotted count; the gate fails if the count drops (a removed bench is a coverage regression). Floor of zero is acceptable until hyperfine has produced a real measurement.',
      source: 'harness/perf/baseline.json benchmarks',
      direction: 'min',
      default_threshold: 0,
      fail_on_regression: true,
      value: (_report, options) => perfBenchmarkMeans(options).length,
    },
  ],
  AV01: [
    {
      id: 'availability-failure-count',
      name: 'Availability Failure Count',
      objective:
        'Advisory-by-design: a static template repository ships no running service to measure availability against. AV01 stays advisory + opt-in; a consumer fork that ships an actual service writes its own adapter (chaos-engineering hook, SLO breach counter, paired with the observability slot). Bead create-harness-app-2zz.5 closed with reason advisory-by-design.',
      source: 'advisory-by-design (no running service in a static template)',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: () => null,
    },
  ],
};

function moduleValues(report, read) {
  return (report?.workspace?.modules ?? []).map(read).filter((v) => typeof v === 'number');
}

function folderValues(report, read) {
  return (report?.workspace?.folders ?? []).map(read).filter((v) => typeof v === 'number');
}

function apssFunctionValues(report, field) {
  return (report?.workspace?.modules ?? [])
    .flatMap((m) => (Array.isArray(m?.apss?.functions) ? m.apss.functions : []))
    .map((fn) => fn?.[field])
    .filter((v) => typeof v === 'number');
}

function maxNumber(values) {
  const nums = values.filter((v) => typeof v === 'number');
  return nums.length === 0 ? null : Math.max(...nums);
}

/**
 * Read the UBS report the SC01 dimension watches. Accepts either a
 * pre-parsed object on options.security or a filesystem reader pair
 * on options.io pointing at options.securityPath. Returns the
 * critical-finding count (null when no report is available, so the
 * gate degrades to "no reading" rather than a false zero).
 */
function ubsCriticalCount(options) {
  let report = options?.security;
  if (!report && options?.io && options?.securityPath) {
    if (options.io.fileExists?.(options.securityPath)) {
      try {
        report = JSON.parse(options.io.readFile(options.securityPath));
      } catch {
        report = null;
      }
    }
  }
  if (!report) {
    return null;
  }
  const total = report?.totals?.critical;
  if (typeof total === 'number') {
    return total;
  }
  // Some UBS modes omit totals; sum per-scanner critical fields.
  const scanners = Array.isArray(report?.scanners) ? report.scanners : [];
  if (scanners.length === 0) {
    return null;
  }
  return scanners.reduce((acc, s) => acc + (typeof s?.critical === 'number' ? s.critical : 0), 0);
}

/**
 * Read the license-scan report the LG01 dimension watches. Accepts a
 * pre-parsed object on options.licenses or a filesystem reader pair on
 * options.io pointing at options.licensesPath. Returns the denied
 * package count (null when no scan is available, so a missing
 * node_modules tree degrades to "no reading" rather than a false zero).
 */
function licenseDeniedCount(options) {
  let report = options?.licenses;
  if (!report && options?.io && options?.licensesPath) {
    if (options.io.fileExists?.(options.licensesPath)) {
      try {
        report = JSON.parse(options.io.readFile(options.licensesPath));
      } catch {
        report = null;
      }
    }
  }
  if (!report || report.available === false) {
    return null;
  }
  if (typeof report.denied_count === 'number') {
    return report.denied_count;
  }
  if (Array.isArray(report.denied)) {
    return report.denied.length;
  }
  return null;
}

/**
 * Read the perf baseline benchmarks the PF01 dimension watches. Accepts
 * either a pre-parsed object on options.perf or a filesystem reader
 * pair on options.io that points at a path on options.perfPath. Used
 * to wire the existing harness/perf adapter into the APSS fitness gate
 * (bead create-harness-app-2zz).
 */
function perfBenchmarkMeans(options) {
  let perf = options?.perf;
  if (!perf && options?.io && options?.perfPath) {
    if (options.io.fileExists?.(options.perfPath)) {
      try {
        perf = JSON.parse(options.io.readFile(options.perfPath));
      } catch {
        perf = null;
      }
    }
  }
  const benchmarks = perf?.benchmarks ?? {};
  return Object.values(benchmarks)
    .map((b) => (typeof b?.mean === 'number' ? b.mean : null))
    .filter((v) => typeof v === 'number');
}

function numericReading(sensor, metric, scope, value, unit = 'raw') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return { sensor, metric, scope, value, unit };
}

function pushReading(readings, sensor, metric, scope, value, unit = 'raw') {
  const reading = numericReading(sensor, metric, scope, value, unit);
  if (reading) {
    readings.push(reading);
  }
}

function moduleScope(path) {
  return { kind: 'module', path };
}

function projectScope() {
  return { kind: 'project' };
}

function maxFinite(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return nums.length === 0 ? null : Math.max(...nums);
}

export function readingsFromReport(report) {
  const readings = [];
  pushReading(
    readings,
    DEPCRUISER_SENSOR,
    'cycle_count',
    projectScope(),
    report?.workspace?.circular_edges,
    'count',
  );

  const folders = Array.isArray(report?.workspace?.folders) ? report.workspace.folders : [];
  const modules = Array.isArray(report?.workspace?.modules) ? report.workspace.modules : [];
  const distanceValues = [];

  for (const folder of folders) {
    if (typeof folder?.name !== 'string') {
      continue;
    }
    const scope = moduleScope(folder.name);
    pushReading(readings, DEPCRUISER_SENSOR, 'ca', scope, folder.Ca, 'count');
    pushReading(readings, DEPCRUISER_SENSOR, 'ce', scope, folder.Ce, 'count');
    pushReading(readings, DEPCRUISER_SENSOR, 'instability', scope, folder.I, 'ratio');
    pushReading(readings, TEMPLATE_SENSOR, 'abstractness', scope, folder.A, 'ratio');
    pushReading(
      readings,
      TEMPLATE_SENSOR,
      'distance_from_main_sequence',
      scope,
      folder.D,
      'distance',
    );
    pushReading(readings, TEMPLATE_SENSOR, 'max_cognitive', scope, folder.max_cognitive, 'count');
    pushReading(readings, TEMPLATE_SENSOR, 'max_cyclomatic', scope, folder.max_cyclomatic, 'count');
    if (typeof folder.D === 'number') {
      distanceValues.push(folder.D);
    }
  }

  for (const mod of modules) {
    if (typeof mod?.source !== 'string') {
      continue;
    }
    const scope = moduleScope(mod.source);
    pushReading(readings, DEPCRUISER_SENSOR, 'ca', scope, mod.Ca, 'count');
    pushReading(readings, DEPCRUISER_SENSOR, 'ce', scope, mod.Ce, 'count');
    pushReading(readings, DEPCRUISER_SENSOR, 'instability', scope, mod.I, 'ratio');
    pushReading(readings, TEMPLATE_SENSOR, 'abstractness', scope, mod.A, 'ratio');
    pushReading(readings, TEMPLATE_SENSOR, 'distance_from_main_sequence', scope, mod.D, 'distance');
    pushReading(readings, TEMPLATE_SENSOR, 'max_cognitive', scope, mod.max_cognitive, 'count');
    pushReading(readings, TEMPLATE_SENSOR, 'max_cyclomatic', scope, mod.max_cyclomatic, 'count');
    if (typeof mod.D === 'number') {
      distanceValues.push(mod.D);
    }
    pushReading(
      readings,
      'apss-topology',
      'efferent_coupling',
      scope,
      mod.apss?.efferent_coupling ?? mod.apss?.ce,
      'count',
    );
    pushReading(readings, 'apss-topology', 'instability', scope, mod.apss?.instability, 'ratio');
    pushReading(
      readings,
      'apss-topology',
      'distance_from_main_sequence',
      scope,
      mod.apss?.distance_from_main_sequence,
      'distance',
    );
  }

  pushReading(
    readings,
    TEMPLATE_SENSOR,
    'distance_from_main_sequence',
    projectScope(),
    maxFinite(distanceValues),
    'distance',
  );
  return readings;
}

function comparisonOpFromKey(key) {
  if (key.startsWith('min_')) {
    return 'min';
  }
  if (key.startsWith('max_')) {
    return 'max';
  }
  return 'max';
}

function normalizeSeverity(value) {
  return value === 'warn' ? 'warn' : 'error';
}

function normalizeOp(key, value) {
  if (value === 'min' || value === 'max' || value === 'equals') {
    return value;
  }
  return comparisonOpFromKey(key);
}

function thresholdFromPolicyValue(key, value) {
  if (typeof value === 'number') {
    return { value, severity: 'error', op: comparisonOpFromKey(key) };
  }
  if (value && typeof value === 'object' && typeof value.value === 'number') {
    return {
      value: value.value,
      severity: normalizeSeverity(value.severity),
      op: normalizeOp(key, value.op),
    };
  }
  return null;
}

export function parsePolicy(raw) {
  const parsed = toml.parse(raw);
  const constraints = {};
  for (const [key, value] of Object.entries(parsed.constraints ?? {})) {
    const threshold = thresholdFromPolicyValue(key, value);
    if (threshold) {
      constraints[key] = threshold;
    }
  }
  const perSensor = [];
  for (const rule of Array.isArray(parsed.per_sensor) ? parsed.per_sensor : []) {
    if (
      typeof rule?.sensor_prefix !== 'string' ||
      typeof rule?.metric !== 'string' ||
      (typeof rule.max_value !== 'number' && typeof rule.min_value !== 'number')
    ) {
      continue;
    }
    perSensor.push({
      sensor_prefix: rule.sensor_prefix,
      metric: rule.metric,
      scope_kind: typeof rule.scope_kind === 'string' ? rule.scope_kind : 'module',
      max_value: typeof rule.max_value === 'number' ? rule.max_value : null,
      min_value: typeof rule.min_value === 'number' ? rule.min_value : null,
      severity: normalizeSeverity(rule.severity),
    });
  }
  const ignore = [];
  for (const entry of Array.isArray(parsed.ignore) ? parsed.ignore : []) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    ignore.push({
      sensor_prefix: typeof entry.sensor_prefix === 'string' ? entry.sensor_prefix : null,
      metric: typeof entry.metric === 'string' ? entry.metric : null,
      scope_path: typeof entry.scope_path === 'string' ? entry.scope_path : null,
      reason: typeof entry.reason === 'string' ? entry.reason : '',
    });
  }
  const excludePaths = Array.isArray(parsed.exclude?.paths)
    ? parsed.exclude.paths.filter((p) => typeof p === 'string')
    : [];
  return {
    constraints,
    per_sensor: perSensor,
    ignore,
    exclude: { paths: excludePaths },
  };
}

function metricNameForConstraint(key) {
  const stripped = key.replace(/^(max|min)_/, '');
  if (stripped === 'cycles') {
    return 'cycle_count';
  }
  return stripped;
}

function scopeKind(scope) {
  return typeof scope?.kind === 'string' ? scope.kind : null;
}

function scopePath(scope) {
  if (typeof scope?.path === 'string') {
    return scope.path;
  }
  if (typeof scope?.file === 'string') {
    return scope.file;
  }
  return null;
}

function policyExcludeMatches(path, pattern) {
  if (typeof path !== 'string' || typeof pattern !== 'string') {
    return false;
  }
  const normalizedPath = path.replaceAll('\\', '/');
  const normalizedPattern = pattern
    .replaceAll('\\', '/')
    .replace(/^\*\*\//, '')
    .replace(/\/$/, '');
  return normalizedPattern.length > 0 && normalizedPath.includes(normalizedPattern);
}

export function applyPolicyExcludes(readings, policy) {
  const patterns = policy?.exclude?.paths ?? [];
  if (patterns.length === 0) {
    return readings.slice();
  }
  return readings.filter((reading) => {
    const path = scopePath(reading.scope);
    return !patterns.some((pattern) => policyExcludeMatches(path, pattern));
  });
}

function policyReadingIgnored(reading, ignores) {
  for (const ignore of ignores ?? []) {
    const sensorOk =
      ignore.sensor_prefix === null ||
      ignore.sensor_prefix === undefined ||
      reading.sensor.startsWith(ignore.sensor_prefix);
    const metricOk =
      ignore.metric === null || ignore.metric === undefined || reading.metric === ignore.metric;
    const ignorePath = ignore.scope_path;
    const pathOk =
      ignorePath === null || ignorePath === undefined
        ? true
        : (scopePath(reading.scope) ?? '').startsWith(ignorePath);
    if (sensorOk && metricOk && pathOk) {
      return true;
    }
  }
  return false;
}

function violatesPolicy(op, observed, threshold) {
  if (op === 'min') {
    return observed < threshold;
  }
  if (op === 'equals') {
    return Math.abs(observed - threshold) > EPSILON;
  }
  return observed > threshold;
}

function opWord(op) {
  if (op === 'min') {
    return '>=';
  }
  if (op === 'equals') {
    return '==';
  }
  return '<=';
}

function policyViolation(rule, severity, op, threshold, reading) {
  return {
    rule,
    severity,
    message:
      `metric ${reading.metric} = ${reading.value} violates ${opWord(op)} ${threshold} ` +
      `(sensor: ${reading.sensor})`,
    metric: reading.metric,
    scope: reading.scope,
    sensor: reading.sensor,
    observed: reading.value,
    threshold,
    op,
  };
}

export function evaluateGovernancePolicy(readings, policy) {
  const violations = [];
  for (const [key, threshold] of Object.entries(policy?.constraints ?? {})) {
    const metric = metricNameForConstraint(key);
    for (const reading of readings) {
      if (
        scopeKind(reading.scope) !== 'project' ||
        reading.metric !== metric ||
        policyReadingIgnored(reading, policy.ignore)
      ) {
        continue;
      }
      if (violatesPolicy(threshold.op, reading.value, threshold.value)) {
        violations.push(
          policyViolation(key, threshold.severity, threshold.op, threshold.value, reading),
        );
      }
    }
  }

  for (const rule of policy?.per_sensor ?? []) {
    for (const reading of readings) {
      if (
        !reading.sensor.startsWith(rule.sensor_prefix) ||
        reading.metric !== rule.metric ||
        scopeKind(reading.scope) !== rule.scope_kind ||
        policyReadingIgnored(reading, policy.ignore)
      ) {
        continue;
      }
      if (typeof rule.max_value === 'number' && reading.value > rule.max_value) {
        violations.push(
          policyViolation(
            `${rule.sensor_prefix}:${rule.metric}`,
            rule.severity,
            'max',
            rule.max_value,
            reading,
          ),
        );
      }
      if (typeof rule.min_value === 'number' && reading.value < rule.min_value) {
        violations.push(
          policyViolation(
            `${rule.sensor_prefix}:${rule.metric}`,
            rule.severity,
            'min',
            rule.min_value,
            reading,
          ),
        );
      }
    }
  }
  return violations;
}

function policyHasErrorViolations(violations) {
  return violations.some((v) => v.severity === 'error');
}

function worsened(direction, current, baseline) {
  if (typeof current !== 'number' || typeof baseline !== 'number') {
    return false;
  }
  if (direction === 'min') {
    return current < baseline - EPSILON;
  }
  return current > baseline + EPSILON;
}

/**
 * Extract a stable baseline shape from an aggregator report.  Per-folder
 * `I` and `D` only - modules are too granular (renames invalidate the
 * baseline immediately) and `Ca`/`Ce` count are directionally ambiguous
 * (growth raises them legitimately).
 */
export function extractBaselineMetrics(report) {
  const folders = {};
  for (const f of report?.workspace?.folders ?? []) {
    if (typeof f?.name !== 'string') {
      continue;
    }
    folders[f.name] = {
      I: typeof f.I === 'number' ? f.I : null,
      D: typeof f.D === 'number' ? f.D : null,
    };
  }
  return { folders };
}

export function extractApssFitnessBaseline(report, options = {}) {
  const dimensions = {};
  for (const code of DIMENSION_ORDER) {
    const dimension = DIMENSIONS[code];
    const metrics = {};
    for (const metric of FITNESS_METRICS[code] ?? []) {
      const baseline = metric.value(report, options);
      metrics[metric.id] = {
        name: metric.name,
        objective: metric.objective,
        source: metric.source,
        direction: metric.direction,
        default_threshold: metric.default_threshold,
        baseline,
        fail_on_regression: metric.fail_on_regression,
      };
    }
    dimensions[code] = {
      ...dimension,
      metrics,
    };
  }
  return {
    schema_version: FITNESS_SCHEMA_VERSION,
    standard: 'APS-V1-0002',
    generated_by: 'harness/sensors/gate.mjs',
    ...extractBaselineMetrics(report),
    dimensions,
  };
}

/**
 * Compare a current report against a baseline shape.  Returns
 * `{ ok, regressions, summary }`.
 *
 * A regression is any baseline folder whose `I` or `D` is strictly worse
 * (numerically greater) in the current report, beyond `EPSILON`.
 *
 * New folders in the current report (absent from baseline) are NOT
 * regressions - they are new code that has not been measured against a
 * floor yet.  Removed folders (present in baseline, absent in current)
 * are also not regressions; they were refactored away or filtered out.
 */
function compareLegacyBaseline(baseline, currentReport) {
  const current = extractBaselineMetrics(currentReport);
  const regressions = [];
  const baseFolders = baseline?.folders ?? {};
  const curFolders = current.folders;

  let comparedFolders = 0;
  for (const [name, base] of Object.entries(baseFolders)) {
    const cur = curFolders[name];
    if (!cur) {
      continue;
    }
    comparedFolders += 1;
    if (typeof base.I === 'number' && typeof cur.I === 'number' && cur.I > base.I + EPSILON) {
      regressions.push({
        folder: name,
        metric: 'I',
        baseline: base.I,
        current: cur.I,
        delta: cur.I - base.I,
      });
    }
    if (typeof base.D === 'number' && typeof cur.D === 'number' && cur.D > base.D + EPSILON) {
      regressions.push({
        folder: name,
        metric: 'D',
        baseline: base.D,
        current: cur.D,
        delta: cur.D - base.D,
      });
    }
  }

  const newFolders = Object.keys(curFolders).filter((n) => !(n in baseFolders));
  const removedFolders = Object.keys(baseFolders).filter((n) => !(n in curFolders));

  return {
    ok: regressions.length === 0,
    regressions,
    summary: {
      comparedFolders,
      newFolders,
      removedFolders,
    },
  };
}

export function compareFitnessBaseline(baseline, currentReport, options = {}) {
  const current = extractApssFitnessBaseline(currentReport, options);
  const regressions = [];
  const advisoryRegressions = [];
  const missingBaselines = [];
  const dimensionSummaries = {};
  let comparedMetrics = 0;

  for (const code of DIMENSION_ORDER) {
    const dimension = current.dimensions[code];
    const baselineDimension = baseline?.dimensions?.[code];
    const metricSummaries = {};
    let evaluated = 0;
    let failed = 0;
    let warned = 0;
    let missing = 0;

    for (const [metricId, currentMetric] of Object.entries(dimension.metrics ?? {})) {
      const baselineMetric = baselineDimension?.metrics?.[metricId];
      const baselineValue = baselineMetric?.baseline;
      const currentValue = currentMetric.baseline;
      const hasBaseline = typeof baselineValue === 'number';
      const hasCurrent = typeof currentValue === 'number';
      const regression =
        currentMetric.fail_on_regression &&
        hasBaseline &&
        hasCurrent &&
        worsened(currentMetric.direction, currentValue, baselineValue);

      if (hasBaseline && hasCurrent) {
        comparedMetrics += 1;
        evaluated += 1;
      } else {
        missing += 1;
        missingBaselines.push({
          dimension: code,
          metric: metricId,
          baseline: baselineValue,
          current: currentValue,
        });
      }

      const summary = {
        name: currentMetric.name,
        baseline: baselineValue ?? null,
        current: currentValue ?? null,
        direction: currentMetric.direction,
        fail_on_regression: currentMetric.fail_on_regression,
        regression,
      };
      metricSummaries[metricId] = summary;

      if (regression) {
        const delta = currentValue - baselineValue;
        const record = {
          dimension: code,
          metric: metricId,
          metric_name: currentMetric.name,
          baseline: baselineValue,
          current: currentValue,
          delta,
          enforcement: dimension.enforcement,
        };
        if (dimension.enforcement === 'enforced') {
          failed += 1;
          regressions.push(record);
        } else {
          warned += 1;
          advisoryRegressions.push({
            ...record,
            diagnostic: 'INCUBATING_DIMENSION_ERROR_DOWNGRADED',
          });
        }
      }
    }

    dimensionSummaries[code] = {
      name: dimension.name,
      runtime_status: evaluated > 0 ? 'evaluated' : 'skipped',
      promotion_status: dimension.promotion_status,
      enforcement: dimension.enforcement,
      rules_evaluated: evaluated,
      rules_failed: failed,
      rules_warned: warned,
      rules_missing_baseline: missing,
      metrics: metricSummaries,
    };
  }

  return {
    ok: regressions.length === 0,
    regressions,
    advisoryRegressions,
    missingBaselines,
    comparedMetrics,
    dimensions: dimensionSummaries,
  };
}

/**
 * Compare a current report against a baseline shape.  Old baselines with
 * only `folders` keep the n48 I/D behavior. New baselines with
 * `dimensions` also enforce APSS active MT01/MD01 metric regressions.
 */
export function compareBaseline(baseline, currentReport, options = {}) {
  const legacy = compareLegacyBaseline(baseline, currentReport);
  if (!baseline?.dimensions) {
    return legacy;
  }

  const fitness = compareFitnessBaseline(baseline, currentReport, options);
  const regressions = [...legacy.regressions, ...fitness.regressions];
  return {
    ok: legacy.ok && fitness.ok,
    regressions,
    legacyRegressions: legacy.regressions,
    fitness,
    summary: {
      ...legacy.summary,
      fitnessComparedMetrics: fitness.comparedMetrics,
      advisoryRegressions: fitness.advisoryRegressions.length,
      missingBaselines: fitness.missingBaselines.length,
    },
  };
}

/**
 * Direction-aware "is `current` strictly better than `baseline`?" predicate.
 * Mirrors `worsened` but in the opposite direction.
 *   - `max` (smaller-is-better): improved when current < baseline - EPSILON.
 *   - `min` (larger-is-better):  improved when current > baseline + EPSILON.
 *
 * If either value is non-numeric the comparison is undefined and we return
 * false; the caller handles the "baseline was null, current is real" path
 * explicitly via `isNullToReal`.
 */
function improved(direction, current, baseline) {
  if (typeof current !== 'number' || typeof baseline !== 'number') {
    return false;
  }
  if (direction === 'min') {
    return current > baseline + EPSILON;
  }
  return current < baseline - EPSILON;
}

function isNullToReal(baseline, current) {
  return (baseline === null || baseline === undefined) && typeof current === 'number';
}

/**
 * Compute the tightened baseline implied by `currentReport`. The returned
 * `next` value is the new floor; `tightenings` lists exactly what moved and
 * `changed` is true iff any floor value actually shifted (within EPSILON).
 *
 * Ratchet rules:
 *   - Folder I/D: treated as direction='max' (smaller-is-better, per the
 *     Martin metric semantics already enforced by `compareLegacyBaseline`).
 *     A null baseline that meets a real current value is tightened to that
 *     value (improvement from "unmeasured").
 *   - APSS dimension metrics: direction comes from the metric definition in
 *     FITNESS_METRICS. Same null-to-real handling.
 *   - The ratchet only TIGHTENS. It never widens an existing floor on its
 *     own; widening goes through `--update-baseline` as a deliberate,
 *     reviewable act.
 *   - Folders / metrics absent from the current report are left untouched
 *     in the baseline (transient skips must not erode the floor).
 *
 * The returned `next` is a deep copy of `baseline` with the tightened
 * values applied. When `changed` is false the caller can skip writing the
 * file to keep git history clean.
 */
export function ratchetBaseline(baseline, currentReport, options = {}) {
  if (!baseline || typeof baseline !== 'object') {
    return { next: baseline, tightenings: [], changed: false };
  }
  const next = structuredClone(baseline);
  const tightenings = [];
  const current = extractApssFitnessBaseline(currentReport, options);

  const baseFolders = next.folders ?? {};
  next.folders = baseFolders;
  for (const [name, curFolder] of Object.entries(current.folders ?? {})) {
    const existing = baseFolders[name];
    if (!existing) {
      // New folder: take its measured I/D as the initial floor.
      baseFolders[name] = { I: curFolder.I ?? null, D: curFolder.D ?? null };
      if (typeof curFolder.I === 'number' || typeof curFolder.D === 'number') {
        tightenings.push({
          kind: 'folder',
          folder: name,
          metric: 'new-folder',
          previous: null,
          next: { I: curFolder.I ?? null, D: curFolder.D ?? null },
          reason: 'new-folder',
        });
      }
      continue;
    }
    for (const key of ['I', 'D']) {
      const cur = curFolder[key];
      const prev = existing[key];
      if (improved('max', cur, prev) || isNullToReal(prev, cur)) {
        existing[key] = cur;
        tightenings.push({
          kind: 'folder',
          folder: name,
          metric: key,
          previous: prev ?? null,
          next: cur,
          reason: isNullToReal(prev, cur) ? 'null-to-real' : 'tightened',
        });
      }
    }
  }

  if (baseline.dimensions) {
    next.dimensions = next.dimensions ?? {};
    for (const code of DIMENSION_ORDER) {
      const curDim = current.dimensions[code];
      if (!curDim) {
        continue;
      }
      const baseDim = next.dimensions[code] ?? curDim;
      next.dimensions[code] = baseDim;
      baseDim.metrics = baseDim.metrics ?? {};
      for (const [metricId, curMetric] of Object.entries(curDim.metrics ?? {})) {
        const existing = baseDim.metrics[metricId];
        const cur = curMetric.baseline;
        if (!existing) {
          // New metric definition (a freshly-promoted dimension): seed the
          // floor from the current measurement.
          baseDim.metrics[metricId] = { ...curMetric };
          if (typeof cur === 'number') {
            tightenings.push({
              kind: 'dimension',
              dimension: code,
              metric: metricId,
              metricName: curMetric.name,
              direction: curMetric.direction,
              previous: null,
              next: cur,
              reason: 'new-metric',
            });
          }
          continue;
        }
        const prev = existing.baseline;
        if (improved(curMetric.direction, cur, prev) || isNullToReal(prev, cur)) {
          existing.baseline = cur;
          tightenings.push({
            kind: 'dimension',
            dimension: code,
            metric: metricId,
            metricName: curMetric.name,
            direction: curMetric.direction,
            previous: prev ?? null,
            next: cur,
            reason: isNullToReal(prev, cur) ? 'null-to-real' : 'tightened',
          });
        }
      }
    }
  }

  return { next, tightenings, changed: tightenings.length > 0 };
}

function atomicWriteFile(path, content) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const tmp = `${path}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(tmp, content);
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Ignore cleanup failure.
    }
    throw err;
  }
}

export function renderRatchetReport(ratchet, baselinePath) {
  if (!ratchet || !ratchet.changed) {
    return '';
  }
  const lines = [''];
  lines.push(
    `RATCHET: floor tightened (${ratchet.tightenings.length} metric(s) improved); ` +
      `baseline written to ${baselinePath}.`,
  );
  for (const t of ratchet.tightenings) {
    if (t.kind === 'folder') {
      if (t.reason === 'new-folder') {
        lines.push(
          `  + new floor for ${t.folder}: ` +
            `I=${fmt(t.next.I)} D=${fmt(t.next.D)} (first measurement)`,
        );
      } else {
        lines.push(
          `  ${t.folder}  ${t.metric}: ${fmt(t.previous)} -> ${fmt(t.next)} ` +
            `(${t.reason === 'null-to-real' ? 'first measurement' : 'tightened'})`,
        );
      }
    } else {
      lines.push(
        `  ${t.dimension} ${t.metric}: ${fmt(t.previous)} -> ${fmt(t.next)} ` +
          `(${t.reason === 'new-metric' ? 'new metric' : t.reason === 'null-to-real' ? 'first measurement' : 'tightened'})`,
      );
    }
  }
  lines.push(
    'Commit the updated baseline.json alongside this change so future runs ' +
      'enforce the new floor (no broken windows).',
  );
  return `${lines.join('\n')}\n`;
}

function fmt(n) {
  return n === null || n === undefined ? 'n/a' : n.toFixed(3);
}

/** Render a human-readable diff. */
export function renderReport(comparison) {
  const lines = [];
  if (comparison.ok) {
    lines.push('VERDICT: PASS sensors gate');
  } else {
    lines.push('VERDICT: FAIL sensors gate');
  }
  const { comparedFolders, newFolders, removedFolders } = comparison.summary;
  lines.push(
    `compared ${comparedFolders} folder(s); ` +
      `${newFolders.length} new, ${removedFolders.length} removed.`,
  );
  if (newFolders.length > 0) {
    lines.push(`  new (no baseline floor yet): ${newFolders.join(', ')}`);
    lines.push(
      '  new-module flow: if this module is intentional, run ' +
        '`just sensors gate --update-baseline`, review harness/sensors/baseline.json, ' +
        'and commit the baseline with the module.',
    );
  }
  if (removedFolders.length > 0) {
    lines.push(`  removed (refactored or filtered): ${removedFolders.join(', ')}`);
  }
  if (comparison.fitness) {
    const { fitnessComparedMetrics, advisoryRegressions, missingBaselines } = comparison.summary;
    const dimEntries = DIMENSION_ORDER.map((code) => comparison.fitness.dimensions?.[code]).filter(
      Boolean,
    );
    const enforced = dimEntries.filter((d) => d.enforcement === 'enforced');
    const advisory = dimEntries.filter((d) => d.enforcement === 'advisory');
    const enforcedEvaluated = enforced.filter((d) => d.rules_evaluated > 0).length;
    const advisoryEvaluated = advisory.filter((d) => d.rules_evaluated > 0).length;
    lines.push('');
    lines.push(
      `APSS fitness: ${enforcedEvaluated}/${enforced.length} enforced ` +
        `dimensions actively gating; ${advisoryEvaluated}/${advisory.length} ` +
        `advisory dimensions reporting; ${fitnessComparedMetrics} metric(s) compared; ` +
        `${advisoryRegressions} advisory regression(s); ${missingBaselines} missing baseline(s).`,
    );
    for (const code of DIMENSION_ORDER) {
      const d = comparison.fitness.dimensions?.[code];
      if (!d) {
        continue;
      }
      const tag = d.enforcement === 'enforced' ? '[ENFORCED]' : '[advisory]';
      const lane =
        d.rules_evaluated > 0
          ? `evaluated ${d.rules_evaluated}, failed ${d.rules_failed}, warned ${d.rules_warned}`
          : 'no adapter wired';
      lines.push(`  ${tag} ${code} ${d.name}: ${lane}`);
    }
  }
  if (comparison.regressions.length > 0) {
    lines.push('');
    lines.push('regressions:');
    for (const r of comparison.regressions) {
      if (r.folder) {
        lines.push(
          `  ${r.folder}  ${r.metric}: ${fmt(r.baseline)} -> ${fmt(r.current)}  ` +
            `(+${fmt(r.delta)})`,
        );
      } else {
        lines.push(
          `  ${r.dimension} ${r.metric}: ${fmt(r.baseline)} -> ${fmt(r.current)} ` +
            `(+${fmt(r.delta)})`,
        );
      }
    }
    lines.push('');
    lines.push(
      'The ratchet does NOT auto-loosen on regression (no broken windows). ' +
        'Fix the code so the metric returns at or below the floor and re-run ' +
        '`just sensors gate`. If the regression is genuinely intentional ' +
        '(refactor, slot redesign), relax the floor deliberately via ' +
        '`just sensors gate --update-baseline` and commit the resulting ' +
        'harness/sensors/baseline.json as the audit trail.',
    );
  }
  return `${lines.join('\n')}\n`;
}

export function renderPolicyReport({ policyPath, loaded, readings, violations }) {
  if (!loaded) {
    return '';
  }
  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warn');
  const lines = [''];
  lines.push(
    `Governance policy: ${errors.length === 0 ? 'PASS' : 'FAIL'} ${policyPath} ` +
      `(${readings.length} reading(s), ${violations.length} violation(s)).`,
  );
  if (errors.length > 0) {
    lines.push('  errors:');
    for (const violation of errors) {
      lines.push(`    ${violation.rule}: ${violation.message}`);
    }
  }
  if (warnings.length > 0) {
    lines.push('  warnings:');
    for (const violation of warnings) {
      lines.push(`    ${violation.rule}: ${violation.message}`);
    }
  }
  if (errors.length === 0 && warnings.length > 0) {
    lines.push('  exit 0 for governance policy because warnings do not fail the gate.');
  }
  return `${lines.join('\n')}\n`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function emptyReport() {
  return {
    workspace: {
      folders: [],
      modules: [],
      circular_edges: 0,
    },
  };
}

function policyState(policyPath, explicit, io) {
  if (policyPath === 'none') {
    return { loaded: false, policy: parsePolicy(''), policyPath };
  }
  if (!io.fileExists(policyPath)) {
    if (explicit) {
      throw new Error(`policy file not found at ${policyPath}`);
    }
    return { loaded: false, policy: parsePolicy(''), policyPath };
  }
  return {
    loaded: true,
    policy: parsePolicy(io.readFile(policyPath)),
    policyPath,
  };
}

function readingsFromParsedJson(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed?.readings)) {
    return parsed.readings;
  }
  return readingsFromReport(parsed);
}

function loadReadingsFrom(path, io) {
  const raw = io.readFile(path);
  try {
    return readingsFromParsedJson(JSON.parse(raw));
  } catch (err) {
    throw new Error(`readings JSON is invalid: ${err.message}`);
  }
}

function jsonPayload(base, policy) {
  const exitCode = base.exit_code;
  return {
    ...base,
    readings: policy.readings,
    violations: policy.violations,
    policy: {
      path: policy.policyPath,
      loaded: policy.loaded,
    },
    exit_code: exitCode,
  };
}

/**
 * CLI entry.  Defaults: read aggregator JSON from stdin, baseline from
 * `harness/sensors/baseline.json`.  Flags:
 *   --baseline=<path>      override baseline path
 *   --update-baseline      RELAX (escape hatch): write the current report
 *                          as the new baseline regardless of regression.
 *                          The resulting baseline.json diff is the
 *                          deliberate audit trail.
 *   --no-ratchet           Skip the post-pass auto-tighten step. The gate
 *                          still passes/fails the same way; only the
 *                          baseline rewrite-on-improvement side effect is
 *                          suppressed. Useful for replay / dry-run / CI
 *                          jobs that should not produce a git change.
 *                          Equivalent: `--ratchet=off` or env `RATCHET=off`.
 *   --policy=<path>        governance TOML policy. Defaults to
 *                          `harness/.harness/governance.toml`.
 *   --readings-from=<path> replay policy readings from JSON instead of
 *                          deriving them from stdin.
 *   --format=text|json     output text (default) or a CI JSON envelope.
 *   --first-run-mode=...   `snapshot` (default) writes baseline on first
 *                          run and exits 0; `strict` exits non-zero if no
 *                          baseline exists.
 */
export async function main(
  argv = process.argv.slice(2),
  io = {
    read: readStdin,
    write: (s) => process.stdout.write(s),
    writeErr: (s) => process.stderr.write(s),
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, s) => {
      mkdirSync(dirname(p), { recursive: true });
      atomicWriteFile(p, s);
    },
    fileExists: (p) => existsSync(p),
    env: process.env,
  },
) {
  let baselinePath = 'harness/sensors/baseline.json';
  let perfPath = 'harness/perf/baseline.json';
  let securityPath = null;
  let licensesPath = null;
  let policyPath = DEFAULT_POLICY_PATH;
  let explicitPolicy = false;
  let readingsFromPath = null;
  let format = 'text';
  let updateBaseline = false;
  let firstRunMode = 'snapshot';
  let ratchetEnabled = (io.env?.RATCHET ?? '').toLowerCase() !== 'off';
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--baseline=')) {
      baselinePath = a.slice('--baseline='.length);
    } else if (a === '--baseline') {
      baselinePath = argv[i + 1] ?? baselinePath;
      i += 1;
    } else if (a.startsWith('--perf-baseline=')) {
      perfPath = a.slice('--perf-baseline='.length);
    } else if (a.startsWith('--security=')) {
      securityPath = a.slice('--security='.length);
    } else if (a.startsWith('--licenses=')) {
      licensesPath = a.slice('--licenses='.length);
    } else if (a.startsWith('--policy=')) {
      policyPath = a.slice('--policy='.length);
      explicitPolicy = true;
    } else if (a === '--policy') {
      policyPath = argv[i + 1] ?? policyPath;
      explicitPolicy = true;
      i += 1;
    } else if (a.startsWith('--readings-from=')) {
      readingsFromPath = a.slice('--readings-from='.length);
    } else if (a === '--readings-from') {
      readingsFromPath = argv[i + 1] ?? readingsFromPath;
      i += 1;
    } else if (a.startsWith('--format=')) {
      format = a.slice('--format='.length);
    } else if (a === '--format') {
      format = argv[i + 1] ?? format;
      i += 1;
    } else if (a === '--json') {
      format = 'json';
    } else if (a === '--text') {
      format = 'text';
    } else if (a === '--update-baseline') {
      updateBaseline = true;
    } else if (a === '--no-ratchet') {
      ratchetEnabled = false;
    } else if (a === '--ratchet') {
      ratchetEnabled = true;
    } else if (a.startsWith('--ratchet=')) {
      ratchetEnabled = a.slice('--ratchet='.length).toLowerCase() !== 'off';
    } else if (a.startsWith('--first-run-mode=')) {
      firstRunMode = a.slice('--first-run-mode='.length);
    }
  }
  if (format !== 'text' && format !== 'json') {
    io.writeErr(`gate: unsupported --format=${format}; expected text or json\n`);
    return 2;
  }

  const fitnessOptions = { perfPath, securityPath, licensesPath, io };
  let policy;
  try {
    policy = policyState(policyPath, explicitPolicy, io);
  } catch (err) {
    io.writeErr(`gate: failed to load policy (${err.message})\n`);
    return 2;
  }

  let raw;
  try {
    raw = await io.read();
  } catch (err) {
    io.writeErr(`gate: failed to read stdin (${err.message})\n`);
    return 2;
  }
  if (raw.trim().length === 0) {
    if (!readingsFromPath) {
      io.writeErr('gate: empty stdin - pipe aggregator JSON in\n');
      return 2;
    }
  }
  let report;
  if (raw.trim().length === 0) {
    report = emptyReport();
  } else {
    try {
      report = JSON.parse(raw);
    } catch (err) {
      io.writeErr(`gate: stdin is not valid JSON (${err.message})\n`);
      return 2;
    }
  }

  let rawPolicyReadings;
  try {
    rawPolicyReadings = readingsFromPath
      ? loadReadingsFrom(readingsFromPath, io)
      : readingsFromReport(report);
  } catch (err) {
    io.writeErr(`gate: failed to read --readings-from=${readingsFromPath} (${err.message})\n`);
    return 2;
  }
  const policyReadings = policy.loaded
    ? applyPolicyExcludes(rawPolicyReadings, policy.policy)
    : rawPolicyReadings.slice();
  const policyViolations = policy.loaded
    ? evaluateGovernancePolicy(policyReadings, policy.policy)
    : [];
  const policyOk = !policyHasErrorViolations(policyViolations);
  const policyOutput = {
    loaded: policy.loaded,
    policyPath: policy.policyPath,
    readings: policyReadings,
    violations: policyViolations,
  };

  const currentBaseline = extractApssFitnessBaseline(report, fitnessOptions);

  if (updateBaseline) {
    io.writeFile(baselinePath, `${JSON.stringify(currentBaseline, null, 2)}\n`);
    const exitCode = policyOk ? 0 : 1;
    if (format === 'json') {
      io.write(
        `${JSON.stringify(
          jsonPayload(
            { baseline: { path: baselinePath, updated: true }, exit_code: exitCode },
            policyOutput,
          ),
          null,
          2,
        )}\n`,
      );
    } else {
      io.write(`sensors gate: baseline updated at ${baselinePath}\n`);
      io.write(renderPolicyReport(policyOutput));
    }
    return exitCode;
  }

  if (!io.fileExists(baselinePath)) {
    if (firstRunMode === 'strict') {
      io.writeErr(
        `gate: no baseline at ${baselinePath} and --first-run-mode=strict; ` +
          'run with --update-baseline once to create it.\n',
      );
      return 2;
    }
    io.writeFile(baselinePath, `${JSON.stringify(currentBaseline, null, 2)}\n`);
    const exitCode = policyOk ? 0 : 1;
    if (format === 'json') {
      io.write(
        `${JSON.stringify(
          jsonPayload(
            {
              baseline: {
                path: baselinePath,
                created: true,
                folders: Object.keys(currentBaseline.folders).length,
              },
              exit_code: exitCode,
            },
            policyOutput,
          ),
          null,
          2,
        )}\n`,
      );
    } else {
      io.write(
        `sensors gate: baseline created at ${baselinePath} (first run; ` +
          `${Object.keys(currentBaseline.folders).length} folder(s) recorded).\n`,
      );
      io.write(renderPolicyReport(policyOutput));
    }
    return exitCode;
  }

  let baseline;
  try {
    baseline = JSON.parse(io.readFile(baselinePath));
  } catch (err) {
    io.writeErr(`gate: failed to read baseline at ${baselinePath} (${err.message})\n`);
    return 2;
  }

  const comparison = compareBaseline(baseline, report, fitnessOptions);

  // RATCHET: on a passing comparison, auto-tighten the floor wherever the
  // current measurement improved against the baseline. On regression the
  // ratchet does NOT move - the regression is the signal, and the floor
  // stays put until the agent either fixes the code or relaxes the floor
  // deliberately via --update-baseline.
  let ratchet = { next: baseline, tightenings: [], changed: false, applied: false };
  if (ratchetEnabled && comparison.ok) {
    const computed = ratchetBaseline(baseline, report, fitnessOptions);
    ratchet = { ...computed, applied: true };
    if (computed.changed) {
      io.writeFile(baselinePath, `${JSON.stringify(computed.next, null, 2)}\n`);
    }
  }

  const exitCode = comparison.ok && policyOk ? 0 : 1;
  if (format === 'json') {
    io.write(
      `${JSON.stringify(
        jsonPayload(
          {
            baseline: {
              path: baselinePath,
              ok: comparison.ok,
              regressions: comparison.regressions,
              summary: comparison.summary,
            },
            ratchet: {
              enabled: ratchetEnabled,
              applied: ratchet.applied,
              tightened: ratchet.changed,
              tightenings: ratchet.tightenings,
              baseline_written: ratchet.applied && ratchet.changed,
            },
            exit_code: exitCode,
          },
          policyOutput,
        ),
        null,
        2,
      )}\n`,
    );
  } else {
    io.write(renderReport(comparison));
    if (ratchet.applied && ratchet.changed) {
      io.write(renderRatchetReport(ratchet, baselinePath));
    }
    io.write(renderPolicyReport(policyOutput));
  }
  return exitCode;
}

function isScriptEntry() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isScriptEntry()) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`gate: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(1);
    });
}

// `resolve` is part of the public path-handling contract (consumers may
// override `io.readFile` with absolute paths); imported for symmetry with
// `dirname` to satisfy the linter.
void resolve;
