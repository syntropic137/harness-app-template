# Fail-Closed Fitness Gate (ADR-0028) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sensors fitness gate fail-closed — a required adapter that produces no reading is a HARD FAIL, a non-required missing adapter PASSES but emits a loud, machine-readable warning, and no `null` reading is ever silently skipped.

**Architecture:** Generalize the existing CV01 coverage "hard contract" to every adapter via a four-state reading model evaluated against an environment **profile** declared in `governance.toml`. Each metric gains an `adapter` tag; the active profile declares which adapters are `required`. Default profile is `strict` (all required) so an unconfigured run fails safe.

**Tech Stack:** Node ESM (`harness/sensors/gate.mjs`), `@iarna/toml` (already a dep, used for governance.toml), Vitest tests (`scripts/tests/*.test.ts`, run via `bun run scripts/test.ts`), GitHub Actions.

## Global Constraints

- Implementation lives ONLY in `harness/sensors/` + `harness/.harness/governance.toml` + `.github/workflows/test.yml`. No app/package code changes.
- Tests use Vitest: `import { describe, expect, test } from 'vitest'` and import the gate via `// @ts-expect-error plain ESM` from `../../harness/sensors/gate.mjs`. All IO in-process (no spawn, no disk writes outside stubs) — pass `options` / `io` stubs.
- Run a single test file with: `bun run scripts/test.ts scripts/tests/<file>.test.ts`.
- Do NOT change any metric's `direction`, `default_threshold`, or `value()` logic. This change only governs what happens when a reading is `null`.
- Selection precedence for the active profile: `--profile=<name>` flag › `SENSORS_PROFILE` env › default `strict`. Unknown profile name = hard error (exit 2), never a silent default.
- `advisory`-enforcement dimensions (AC01, AV01) are the **Declared-N/A** state: their `null` readings are expected, never counted as `skipped`, never fail. (This reuses the existing `enforcement: 'advisory'` mechanism instead of adding a new `exempt` flag — see Task 7 note.)
- Commit after every task with a conventional-commit message. The repo's commit-msg hook runs cocogitto; keep messages conventional.

---

### Task 1: Tag every metric with its source `adapter`

**Files:**
- Modify: `harness/sensors/gate.mjs` (the `FITNESS_METRICS` object, starting line ~146; each metric literal)
- Test: `scripts/tests/sensors-adapter-map.test.ts` (create)

**Interfaces:**
- Produces: every metric object in `FITNESS_METRICS` gains a string field `adapter`. New exported constant `KNOWN_ADAPTERS` (a `Set<string>`) and exported helper `metricAdapter(dimensionCode, metricId) -> string | null`.
- Adapter vocabulary (the metric→adapter map): `'sentrux'`, `'apss-topology'`, `'complexity'` (pure-node ts-morph/complexity.mjs fallback, always available), `'cruiser-coupling'` (dependency-cruiser + aggregate, pure-node), `'ubs-security'`, `'license'`, `'deadcode'`, `'hyperfine-perf'`, `'suite-duration'`, `'coverage'`.
- Rule for choosing the adapter: the adapter is *the source whose absence makes the reading `null`*. A metric with a pure-node fallback (e.g. `max-cognitive` reads APSS functions OR `complexity.mjs`) is tagged with the **fallback** adapter that is always present (`'complexity'`), because that is what determines whether it can ever be null. Sentrux-only metrics (`sentrux-god-file-count`, `sentrux-hotspot-count`, `sentrux-complex-fn-count`, and the `sentrux-*` MD01/ST01 entries) are tagged `'sentrux'`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/tests/sensors-adapter-map.test.ts
import { describe, expect, test } from 'vitest';
import {
  FITNESS_METRICS,
  KNOWN_ADAPTERS,
  metricAdapter,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

describe('metric → adapter map', () => {
  test('every metric declares a known adapter', () => {
    for (const [code, metrics] of Object.entries(FITNESS_METRICS as Record<string, any[]>)) {
      for (const m of metrics) {
        expect(typeof m.adapter, `${code}.${m.id} missing adapter`).toBe('string');
        expect(KNOWN_ADAPTERS.has(m.adapter), `${code}.${m.id} adapter '${m.adapter}' not in KNOWN_ADAPTERS`).toBe(true);
      }
    }
  });

  test('metricAdapter resolves a known metric and returns null for unknown', () => {
    expect(metricAdapter('MT01', 'sentrux-god-file-count')).toBe('sentrux');
    expect(metricAdapter('MT01', 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run scripts/test.ts scripts/tests/sensors-adapter-map.test.ts`
Expected: FAIL — `KNOWN_ADAPTERS`/`metricAdapter` undefined, and `m.adapter` is `undefined`.

- [ ] **Step 3: Add `adapter` to every metric + export the helpers**

In `harness/sensors/gate.mjs`, add `adapter: '<name>'` to each metric literal in `FITNESS_METRICS` per the mapping rule above. Then add near the other exports:

```js
export const KNOWN_ADAPTERS = new Set([
  'sentrux',
  'apss-topology',
  'complexity',
  'cruiser-coupling',
  'ubs-security',
  'license',
  'deadcode',
  'hyperfine-perf',
  'suite-duration',
  'coverage',
]);

export function metricAdapter(dimensionCode, metricId) {
  const metric = (FITNESS_METRICS[dimensionCode] ?? []).find((m) => m.id === metricId);
  return metric?.adapter ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run scripts/test.ts scripts/tests/sensors-adapter-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing fitness test to confirm no regression**

Run: `bun run scripts/test.ts scripts/tests/sensors-apss-fitness.test.ts`
Expected: PASS (adding a field must not change existing behavior).

- [ ] **Step 6: Commit**

```bash
git add harness/sensors/gate.mjs scripts/tests/sensors-adapter-map.test.ts
git commit -m "feat(sensors): tag each fitness metric with its source adapter"
```

---

### Task 2: Resolve the active profile from governance.toml + flag/env

**Files:**
- Modify: `harness/sensors/gate.mjs` (add profile parsing/resolution helpers near `parsePolicy`, line ~979)
- Test: `scripts/tests/sensors-profile.test.ts` (create)

**Interfaces:**
- Produces:
  - `parseProfiles(policyRawString) -> Record<string, { required_adapters: string[] }>` — reads `[profiles.<name>]` tables. Returns `{}` when none present.
  - `resolveProfile({ profiles, profileName }) -> { name: string, requiredAdapters: Set<string> }`. `profileName` is the already-selected name (Task 6 does the flag/env precedence). Resolution rules: if `profileName === 'strict'` and no `[profiles.strict]` table exists, default `requiredAdapters` = ALL of `KNOWN_ADAPTERS` (fail-safe). If the named profile is absent AND name !== 'strict', THROW `Error("unknown profile '<name>'")`. Otherwise use the table's `required_adapters`.
- Consumes: `KNOWN_ADAPTERS` from Task 1.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/tests/sensors-profile.test.ts
import { describe, expect, test } from 'vitest';
import {
  parseProfiles,
  resolveProfile,
  KNOWN_ADAPTERS,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

const TOML = `
[profiles.strict]
required_adapters = ["sentrux", "apss-topology", "ubs-security", "hyperfine-perf", "coverage", "deadcode", "cruiser-coupling", "complexity", "suite-duration", "license"]

[profiles.local]
required_adapters = ["deadcode", "cruiser-coupling", "complexity"]
`;

describe('profile resolution', () => {
  test('parses [profiles.*] tables', () => {
    const p = parseProfiles(TOML);
    expect(p.local.required_adapters).toContain('deadcode');
    expect(p.strict.required_adapters).toContain('sentrux');
  });

  test('resolves a named lean profile to its required set', () => {
    const r = resolveProfile({ profiles: parseProfiles(TOML), profileName: 'local' });
    expect(r.name).toBe('local');
    expect(r.requiredAdapters.has('deadcode')).toBe(true);
    expect(r.requiredAdapters.has('sentrux')).toBe(false);
  });

  test('strict with no table defaults to ALL known adapters (fail-safe)', () => {
    const r = resolveProfile({ profiles: {}, profileName: 'strict' });
    expect(r.requiredAdapters.size).toBe(KNOWN_ADAPTERS.size);
  });

  test('unknown profile name throws', () => {
    expect(() => resolveProfile({ profiles: parseProfiles(TOML), profileName: 'bogus' })).toThrow(
      /unknown profile 'bogus'/,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run scripts/test.ts scripts/tests/sensors-profile.test.ts`
Expected: FAIL — `parseProfiles`/`resolveProfile` not exported.

- [ ] **Step 3: Implement the helpers**

In `gate.mjs`, near `parsePolicy` (note the file already imports the TOML parser used by `parsePolicy` — reuse that same `parse` import; do not add a new import):

```js
export function parseProfiles(raw) {
  if (!raw || !raw.trim()) {
    return {};
  }
  let doc;
  try {
    doc = parse(raw); // same TOML parser parsePolicy already uses
  } catch {
    return {};
  }
  const profiles = doc?.profiles ?? {};
  const out = {};
  for (const [name, table] of Object.entries(profiles)) {
    const required = Array.isArray(table?.required_adapters) ? table.required_adapters : [];
    out[name] = { required_adapters: required };
  }
  return out;
}

export function resolveProfile({ profiles, profileName }) {
  const table = profiles?.[profileName];
  if (!table) {
    if (profileName === 'strict') {
      return { name: 'strict', requiredAdapters: new Set(KNOWN_ADAPTERS) };
    }
    throw new Error(`unknown profile '${profileName}'`);
  }
  return { name: profileName, requiredAdapters: new Set(table.required_adapters) };
}
```

> If `parse` is not already the imported binding name in `gate.mjs`, grep for how `parsePolicy` parses TOML (`grep -n "parse(" harness/sensors/gate.mjs`) and reuse that exact binding.

- [ ] **Step 4: Run to verify it passes**

Run: `bun run scripts/test.ts scripts/tests/sensors-profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/sensors/gate.mjs scripts/tests/sensors-profile.test.ts
git commit -m "feat(sensors): resolve active fitness profile from governance.toml"
```

---

### Task 3: Four-state assessment — required-missing FAILs, non-required-missing is a loud SKIP

**Files:**
- Modify: `harness/sensors/gate.mjs` — `assessMetricComparisonState` (line 1311) and `compareFitnessBaseline` (line 1397)
- Test: `scripts/tests/sensors-fail-closed.test.ts` (create)

**Interfaces:**
- Consumes: `metricAdapter` (Task 1), the active profile object `{ name, requiredAdapters }` threaded in via `options.profile` (Task 6 wires the real value; tests pass it directly).
- Produces: `assessMetricComparisonState` returns the existing shape plus three new boolean/string fields: `adapterMissing` (current reading is `null`), `requiredMissing` (adapterMissing AND adapter is required in profile AND dimension is enforced), `skippedAdapter` (adapterMissing AND NOT required AND dimension enforced). `compareFitnessBaseline` returns two new arrays on its result: `skipped` (`{ dimension, metric, adapter, reason, profile }[]`) and `failedMissing` (`{ dimension, metric, adapter, profile }[]`), and `ok` becomes false when `failedMissing` is non-empty.

**Key distinction:** today both "current is null" and "baseline is null" collapse into `missing`. Split them: `currentValue` not a number → **adapter-missing** path (profile logic). `currentValue` is a number but `baselineValue` is null → unchanged "new metric, snapshot" path (NOT a skip, NOT a fail).

- [ ] **Step 1: Write the failing test**

```ts
// scripts/tests/sensors-fail-closed.test.ts
import { describe, expect, test } from 'vitest';
import {
  compareFitnessBaseline,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

// Minimal report: a god-file metric (adapter 'sentrux', enforced MT01) with
// NO current reading, against a baseline that has a number. Returns whatever
// extractApssFitnessBaseline produces; we drive the null by omitting sentrux data.
function reportWithNoSentrux() {
  return {}; // no .sentrux envelope → sentrux metrics read null
}
function baselineWithGodFileFloor() {
  return {
    dimensions: {
      MT01: { metrics: { 'sentrux-god-file-count': { baseline: 0 } } },
    },
  };
}

const strict = { name: 'strict', requiredAdapters: new Set(['sentrux']) };
const lean = { name: 'local', requiredAdapters: new Set(['deadcode']) };

describe('fail-closed four-state', () => {
  test('strict + required adapter missing → FAIL + failedMissing populated', () => {
    const r = compareFitnessBaseline(baselineWithGodFileFloor(), reportWithNoSentrux(), {
      profile: strict,
    });
    expect(r.ok).toBe(false);
    expect(r.failedMissing.some((f: any) => f.adapter === 'sentrux')).toBe(true);
  });

  test('lean + same adapter NOT required → PASS + skipped populated', () => {
    const r = compareFitnessBaseline(baselineWithGodFileFloor(), reportWithNoSentrux(), {
      profile: lean,
    });
    expect(r.ok).toBe(true);
    expect(r.skipped.some((s: any) => s.adapter === 'sentrux')).toBe(true);
    expect(r.failedMissing.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run scripts/test.ts scripts/tests/sensors-fail-closed.test.ts`
Expected: FAIL — `r.failedMissing`/`r.skipped` undefined; `r.ok` still true in the strict case.

- [ ] **Step 3: Extend `assessMetricComparisonState`**

Replace the final `return { ... missing: 1 ... }` block (the `!hasBothValues` fallthrough) so it distinguishes current-null from baseline-null:

```js
  const currentIsNumber = typeof currentValue === 'number';
  const adapterMissing = !currentIsNumber;
  const enforced = code !== 'AC01' && code !== 'AV01'; // advisory dims = Declared-N/A
  const adapter = metricAdapter(code, metricId);
  const required = options?.profile?.requiredAdapters?.has(adapter) ?? false;
  const requiredMissing = adapterMissing && enforced && required;
  const skippedAdapter = adapterMissing && enforced && !required;

  return {
    baselineValue,
    currentValue,
    hardFailCoverage: false,
    failureReason: requiredMissing
      ? `adapter '${adapter}' required by profile '${options?.profile?.name}' produced no reading`
      : null,
    regression: requiredMissing, // required-missing fails like a regression
    adapterMissing,
    requiredMissing,
    skippedAdapter,
    adapter,
    compared: 0,
    evaluated: 0,
    failed: requiredMissing ? 1 : 0,
    warned: 0,
    missing: adapterMissing ? 0 : 1, // baseline-null (new metric) still counts as missing-baseline
    hasBothValues,
  };
```

Add `adapterMissing/requiredMissing/skippedAdapter/adapter` (defaulting to false/null) to the other two return blocks (`hardFailCoverage` and `hasBothValues`) so the shape is consistent.

- [ ] **Step 4: Collect `skipped` / `failedMissing` in `compareFitnessBaseline`**

Inside the metric loop, after computing `state`, add:

```js
      if (state.requiredMissing) {
        failedMissing.push({
          dimension: code,
          metric: metricId,
          adapter: state.adapter,
          profile: options?.profile?.name ?? 'strict',
        });
      } else if (state.skippedAdapter) {
        skipped.push({
          dimension: code,
          metric: metricId,
          adapter: state.adapter,
          reason: 'adapter not required by active profile',
          profile: options?.profile?.name ?? 'strict',
        });
      }
```

Declare `const skipped = []; const failedMissing = [];` at the top of the function, and change the return so `ok` accounts for required-missing and the arrays are exposed:

```js
  return {
    ok: regressions.length === 0 && failedMissing.length === 0,
    regressions,
    advisoryRegressions,
    missingBaselines,
    skipped,
    failedMissing,
    comparedMetrics,
    dimensions: dimensionSummaries,
  };
```

Note: `state.regression` is already pushed into `regressions` only for enforced dimensions; `requiredMissing` sets `regression: true` AND `failed: 1`, so it both lands in `failedMissing` and trips `ok` via the new clause. Ensure it is NOT double-counted into `regressions` (it has no `delta`); guard the existing regression-record push with `if (state.regression && !state.requiredMissing)` so required-missing reports only through `failedMissing`.

- [ ] **Step 5: Run to verify it passes**

Run: `bun run scripts/test.ts scripts/tests/sensors-fail-closed.test.ts`
Expected: PASS both cases.

- [ ] **Step 6: Run the existing fitness suite (no regression)**

Run: `bun run scripts/test.ts scripts/tests/sensors-apss-fitness.test.ts`
Expected: PASS. (Existing tests pass no `options.profile`; `requiredAdapters` is then undefined → `required=false` → nothing newly fails. Confirm this is the observed behavior; if any existing test now fails, it is asserting on the old silent-skip and must be updated to pass an explicit `profile`.)

- [ ] **Step 7: Commit**

```bash
git add harness/sensors/gate.mjs scripts/tests/sensors-fail-closed.test.ts
git commit -m "feat(sensors): four-state reading model — required-missing fails, non-required skips loud"
```

---

### Task 4: Loud output — `DEGRADED` line + JSON `skipped[]`/`failedMissing[]`

**Files:**
- Modify: `harness/sensors/gate.mjs` — `renderReport` (line 1733) and wherever the JSON `--format=json` payload is assembled (search `format === 'json'` in the `gate` function, ~line 2196)
- Test: `scripts/tests/sensors-degraded-output.test.ts` (create)

**Interfaces:**
- Consumes: `comparison.skipped`, `comparison.failedMissing` (Task 3).
- Produces: text output gains, immediately after the VERDICT line, a `DEGRADED:` line when `skipped.length > 0`, and a `MISSING REQUIRED:` line when `failedMissing.length > 0`. JSON output gains top-level `skipped` and `failed_missing` arrays.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/tests/sensors-degraded-output.test.ts
import { describe, expect, test } from 'vitest';
import {
  renderReport,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

function baseComparison(overrides: any) {
  return {
    ok: true,
    regressions: [],
    advisoryRegressions: [],
    summary: { comparedFolders: 0, newFolders: [], removedFolders: [] },
    skipped: [],
    failedMissing: [],
    ...overrides,
  };
}

describe('degraded output contract', () => {
  test('prints a DEGRADED line listing skipped adapters', () => {
    const text = renderReport(
      baseComparison({
        skipped: [
          { dimension: 'MT01', metric: 'sentrux-god-file-count', adapter: 'sentrux', profile: 'local' },
          { dimension: 'MT01', metric: 'max-cognitive', adapter: 'apss-topology', profile: 'local' },
        ],
      }),
    );
    expect(text).toMatch(/DEGRADED: 2 adapter\(s\) skipped/);
    expect(text).toContain('sentrux');
    expect(text).toContain('apss-topology');
  });

  test('prints a MISSING REQUIRED line on hard-fail', () => {
    const text = renderReport(
      baseComparison({
        ok: false,
        failedMissing: [{ dimension: 'MT01', metric: 'sentrux-god-file-count', adapter: 'sentrux', profile: 'strict' }],
      }),
    );
    expect(text).toMatch(/MISSING REQUIRED: 1 adapter\(s\)/);
    expect(text).toContain('sentrux');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run scripts/test.ts scripts/tests/sensors-degraded-output.test.ts`
Expected: FAIL — no DEGRADED/MISSING REQUIRED lines emitted.

- [ ] **Step 3: Emit the loud lines in `renderReport`**

Immediately after the VERDICT push (the `if (comparison.ok) { ... } else { ... }` block at line ~1736), add:

```js
  const failedMissing = comparison.failedMissing ?? [];
  const skipped = comparison.skipped ?? [];
  if (failedMissing.length > 0) {
    const adapters = [...new Set(failedMissing.map((f) => f.adapter))].join(', ');
    lines.push(
      `MISSING REQUIRED: ${failedMissing.length} adapter(s) required by profile ` +
        `'${failedMissing[0].profile}' produced no reading: ${adapters}. ` +
        `Install the tool(s) or select a leaner profile with --profile=local.`,
    );
  }
  if (skipped.length > 0) {
    const adapters = [...new Set(skipped.map((s) => s.adapter))].join(', ');
    lines.push(
      `DEGRADED: ${skipped.length} adapter(s) skipped — not required by profile ` +
        `'${skipped[0].profile}': ${adapters}. These dimensions did NOT run.`,
    );
  }
```

- [ ] **Step 4: Add arrays to the JSON payload**

Find the `format === 'json'` payload object in the `gate` function (search `JSON.stringify` near line 2196) and add `skipped: comparison.skipped ?? []` and `failed_missing: comparison.failedMissing ?? []` to the serialized object.

- [ ] **Step 5: Run to verify it passes**

Run: `bun run scripts/test.ts scripts/tests/sensors-degraded-output.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add harness/sensors/gate.mjs scripts/tests/sensors-degraded-output.test.ts
git commit -m "feat(sensors): loud DEGRADED / MISSING REQUIRED output + JSON skipped arrays"
```

---

### Task 5: Wire `--profile` flag + `SENSORS_PROFILE` env into the gate entrypoint

**Files:**
- Modify: `harness/sensors/gate.mjs` — the `gate` async function arg loop (line ~2000) and the point where it builds `options` for `compareFitnessBaseline`/`compareBaseline`
- Test: `scripts/tests/sensors-profile-cli.test.ts` (create)

**Interfaces:**
- Consumes: `parseProfiles`, `resolveProfile` (Task 2); the gate already reads `policyPath`'s TOML for governance — reuse that file content for `parseProfiles`.
- Produces: the resolved `{ name, requiredAdapters }` is placed on `options.profile` for the comparison call. Precedence: `--profile=<name>` › `io.env.SENSORS_PROFILE` › `'strict'`. Unknown profile → write error to `io.writeErr` and return exit code `2`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/tests/sensors-profile-cli.test.ts
import { describe, expect, test } from 'vitest';
import {
  gate,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

function ioStub(files: Record<string, string>, env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      read: async () => '{}',
      write: (s: string) => out.push(s),
      writeErr: (s: string) => err.push(s),
      readFile: (p: string) => files[p] ?? '',
      writeFile: () => {},
      fileExists: (p: string) => p in files,
      env,
    },
    out,
    err,
  };
}

describe('--profile CLI', () => {
  test('unknown profile exits 2 with a clear error', async () => {
    const { io, err } = ioStub({ 'harness/.harness/governance.toml': '[profiles.local]\nrequired_adapters = []\n' });
    const code = await gate({ argv: ['--profile=bogus', '--readings-from=none'], io });
    expect(code).toBe(2);
    expect(err.join('')).toMatch(/unknown profile 'bogus'/);
  });
});
```

> If `--readings-from=none` is not a supported sentinel, substitute the minimal argv the gate needs to reach profile resolution before doing real work; the assertion is only that an unknown profile short-circuits to exit 2.

- [ ] **Step 2: Run to verify it fails**

Run: `bun run scripts/test.ts scripts/tests/sensors-profile-cli.test.ts`
Expected: FAIL — unknown profile currently ignored, exit code not 2.

- [ ] **Step 3: Parse the flag + resolve the profile early**

In the arg loop, add a branch alongside the others:

```js
    } else if (a.startsWith('--profile=')) {
      profileName = a.slice('--profile='.length);
    } else if (a === '--profile') {
      profileName = argv[i + 1] ?? profileName;
      i += 1;
```

Declare before the loop: `let profileName = io.env?.SENSORS_PROFILE ?? 'strict';`

After the loop (and after `policyPath` is known), resolve the profile, failing closed on unknown:

```js
  let profile;
  try {
    const policyRaw = io.fileExists(policyPath) ? io.readFile(policyPath) : '';
    profile = resolveProfile({ profiles: parseProfiles(policyRaw), profileName });
  } catch (e) {
    io.writeErr(`gate: ${e.message}\n`);
    return 2;
  }
```

Then add `profile` into the `options` object passed to `compareBaseline`/`compareFitnessBaseline` (find where that options object is built and add `profile,`).

- [ ] **Step 4: Run to verify it passes**

Run: `bun run scripts/test.ts scripts/tests/sensors-profile-cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/sensors/gate.mjs scripts/tests/sensors-profile-cli.test.ts
git commit -m "feat(sensors): --profile flag + SENSORS_PROFILE env, default strict, unknown=exit 2"
```

---

### Task 6: Declare `strict` + `local` profiles in governance.toml

**Files:**
- Modify: `harness/.harness/governance.toml`
- Test: `scripts/tests/sensors-governance-profiles.test.ts` (create)

**Note on Declared-N/A:** the ADR proposed an explicit `exempt = true` per metric. This plan instead reuses the existing `enforcement: 'advisory'` dimension mechanism (AC01/AV01) as the Declared-N/A state — Task 3's `enforced` guard already excludes them. No per-metric `exempt` flag is added. If a future enforced-dimension metric needs a standing exemption, add it then; YAGNI for now. (Flag this to the reviewer — it is the one deliberate divergence from the ADR text.)

- [ ] **Step 1: Write the failing test**

```ts
// scripts/tests/sensors-governance-profiles.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  parseProfiles,
  KNOWN_ADAPTERS,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

describe('shipped governance profiles', () => {
  const profiles = parseProfiles(readFileSync('harness/.harness/governance.toml', 'utf8'));

  test('strict requires every known adapter', () => {
    expect(new Set(profiles.strict.required_adapters)).toEqual(new Set(KNOWN_ADAPTERS));
  });

  test('local requires only the zero-dep adapters', () => {
    expect(profiles.local.required_adapters).toEqual(
      expect.arrayContaining(['deadcode', 'cruiser-coupling', 'complexity']),
    );
    expect(profiles.local.required_adapters).not.toContain('sentrux');
    expect(profiles.local.required_adapters).not.toContain('apss-topology');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run scripts/test.ts scripts/tests/sensors-governance-profiles.test.ts`
Expected: FAIL — no `[profiles.*]` tables yet.

- [ ] **Step 3: Add the profiles to `governance.toml`**

Append:

```toml
# ── ADR-0028: fail-closed enforcement profiles ──────────────────────────
# Which adapters MUST produce a reading in a given environment. A required
# adapter that returns null is a HARD FAIL; a non-required one is a loud
# skip (see ADR-0028). Default profile is `strict`; select a leaner one
# with `--profile=local` or SENSORS_PROFILE=local.
[profiles.strict]
required_adapters = ["sentrux", "apss-topology", "complexity", "cruiser-coupling", "ubs-security", "license", "deadcode", "hyperfine-perf", "suite-duration", "coverage"]

[profiles.local]
# Zero-dependency, always-available adapters. The external-tool adapters
# (sentrux, apss-topology, ubs-security, hyperfine-perf, coverage,
# suite-duration, license) are OPTIONAL here → skip-loud, not fail.
required_adapters = ["deadcode", "cruiser-coupling", "complexity"]
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run scripts/test.ts scripts/tests/sensors-governance-profiles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/.harness/governance.toml scripts/tests/sensors-governance-profiles.test.ts
git commit -m "feat(sensors): ship strict + local fitness profiles in governance.toml"
```

---

### Task 7: Pin `--profile=strict` in the CI fitness job

**Files:**
- Modify: `.github/workflows/test.yml` (the `fitness` job, ~line 184; the step that runs the sensors gate)

**Interfaces:** none (CI wiring). Belt-and-suspenders: even though `strict` is the default, pin it explicitly so a future `governance.toml` edit cannot quietly loosen CI.

- [ ] **Step 1: Locate the gate invocation in the fitness job**

Run: `grep -n "sensors" .github/workflows/test.yml | sed -n '1,40p'`
Identify the step that runs `harness/sensors/bin/sensors gate` (or `just sensors gate`).

- [ ] **Step 2: Add the explicit profile flag**

Edit that run line to pass `--profile=strict`, e.g.:

```yaml
      - run: harness/sensors/bin/sensors gate --profile=strict
```

(Match the existing invocation's exact form — if it uses `just sensors gate`, append `-- --profile=strict` per that recipe's arg-forwarding.)

- [ ] **Step 3: Validate the workflow YAML parses**

Run: `node -e "const y=require('js-yaml'); y.load(require('fs').readFileSync('.github/workflows/test.yml','utf8')); console.log('ok')"` (or `yq '.' .github/workflows/test.yml >/dev/null && echo ok`).
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci(sensors): pin fitness gate to --profile=strict (fail-closed in CI)"
```

---

### Task 8: End-to-end verification — strict fails on this clone, local passes loud

**Files:** none (verification task; may add a short note to ADR-0028 if behavior diverged)

- [ ] **Step 1: Run the gate in strict (default) on this checkout**

Run: `bash harness/sensors/bin/sensors gate --profile=strict`
Expected: `VERDICT: FAIL sensors gate` + a `MISSING REQUIRED:` line naming `sentrux`, `apss-topology` (and any other uninstalled adapter), because this clone has no `.apss/bin`/sentrux. Exit code non-zero.

- [ ] **Step 2: Run the gate in local**

Run: `bash harness/sensors/bin/sensors gate --profile=local`
Expected: `VERDICT: PASS sensors gate` + a `DEGRADED:` line listing the same skipped adapters. Exit code 0. This is the proof: the standard still runs locally, but it announces the hole loudly instead of passing hollow.

- [ ] **Step 3: Confirm JSON carries the arrays**

Run: `bash harness/sensors/bin/sensors gate --profile=local --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('skipped',j.skipped.length,'failed_missing',j.failed_missing.length)})"`
Expected: `skipped <N> failed_missing 0`.

- [ ] **Step 4: Run the full sensors test suite**

Run: `bun run scripts/test.ts scripts/tests/`
Expected: all sensors tests PASS, including the five new files.

- [ ] **Step 5: Reconcile ADR if needed + commit any doc delta**

If Task 6's Declared-N/A simplification (advisory-dimension instead of `exempt=true`) or any naming changed, add a one-paragraph "Implementation note" to `docs/adrs/ADR-0028-fail-closed-fitness-profiles.md` recording it. Commit:

```bash
git add docs/adrs/ADR-0028-fail-closed-fitness-profiles.md
git commit -m "docs(adr): ADR-0028 implementation note — advisory-dim reuse for Declared-N/A"
```

---

## Self-Review

**Spec coverage (ADR-0028 → tasks):**
- Four-state taxonomy → Task 3 (measured/required-missing/skipped/declared-N/A).
- Profiles in governance.toml, adapter granularity → Tasks 1 (map), 2 (resolve), 6 (ship).
- Default strict, unknown=error, precedence flag›env›default → Tasks 2 + 5.
- Loud output `skipped[]`/`failed_missing[]` → Task 4.
- CI pins strict → Task 7.
- Declared-N/A preserved → Task 3 `enforced` guard + Task 6 note (advisory dims).
- Test matrix (strict-required-null→FAIL, local-optional-null→PASS+warn, local-required-null→FAIL, measured→evaluate, advisory-null→info, unknown profile→error) → covered across Tasks 3/5/8. **Gap closed:** "local + *required* adapter null → FAIL" is exercised by Task 3's logic (lean profile with a required adapter missing sets `requiredMissing`); add an explicit assertion for it in `sensors-fail-closed.test.ts` Step 1 if not already implied.

**Placeholder scan:** no TBDs; all code shown. The two "if X not present, grep for Y" notes (TOML parser binding in Task 2, `--readings-from=none` sentinel in Task 5) are conditional fallbacks, not placeholders — the primary path is specified.

**Type consistency:** `metricAdapter(code, id)`, `resolveProfile({profiles, profileName}) -> {name, requiredAdapters:Set}`, `options.profile`, and result fields `skipped`/`failedMissing` are used consistently across Tasks 1→8. Output JSON uses snake_case `failed_missing` (Task 4) while the in-memory result uses `failedMissing` (Task 3) — this is intentional (JSON contract vs JS object); both spellings are pinned so they don't drift.
