// Tests for the deterministic dead-code adapter wired through
// harness/sensors/gate.mjs as the 3rd composition lens after
// dep-cruiser/ts-morph and sentrux. Mirrors sentrux.test.mjs in shape:
// same stubIo + same end-to-end main() drive, because the gate-side
// contract is identical (envelope-on-disk, soft-skip on available=false,
// direction=max ratchet under MT01).
//
// The contract under test (ADR-0024-dead-code-ratchet.md):
//   - The detector reads source files only — no node_modules, no
//     network — so the same input produces the same count on every
//     environment. That property is regression-tested below with an
//     in-memory filesystem stub.
//   - Metrics flow in through the --deadcode=<path> CLI flag; the
//     gate's unused-export-count metric reads `total_unused`.
//   - The ratchet tightens on improvement (smaller-is-better; direction=max).
//   - Regressions fail the gate WITHOUT moving the floor.
//   - When the adapter envelope reports `available: false`, the metric
//     degrades to "no reading" rather than a false zero.
//
// Adapter-level tests exercise findExports, countReferences,
// isFrameworkConvention, walkSourceTree, listExportSources, and
// runDeadcodeScan with an in-memory FS so a determinism regression
// fails on a fast unit run rather than only at CI gate time.
//
// Run via: node --test harness/sensors/tests/deadcode.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countReferences,
  findExports,
  isFrameworkConvention,
  listExportSources,
  listReferenceCorpus,
  runDeadcodeScan,
  walkSourceTree,
} from '../deadcode_scan.mjs';
import { compareBaseline, extractApssFitnessBaseline, main, ratchetBaseline } from '../gate.mjs';

function emptyReport() {
  return {
    workspace: { folders: [], modules: [], circular_edges: 0 },
  };
}

function envelope(metrics) {
  return {
    tool: 'deadcode-grep',
    available: true,
    version: '1.0.0',
    scanned_workspaces: ['ws_apps/example-typescript', 'ws_packages/telemetry'],
    metrics,
  };
}

function baselineWithDeadcode(metrics) {
  return extractApssFitnessBaseline(emptyReport(), { deadcode: envelope(metrics) });
}

function stubIo({ stdin = '{}', files = {} } = {}) {
  const stdout = [];
  const stderr = [];
  const writes = [];
  const written = { ...files };
  return {
    io: {
      read: async () => stdin,
      write: (s) => stdout.push(s),
      writeErr: (s) => stderr.push(s),
      readFile: (p) => {
        if (!(p in written)) {
          throw new Error(`stub: no such file ${p}`);
        }
        return written[p];
      },
      writeFile: (p, s) => {
        written[p] = s;
        writes.push({ path: p, content: s });
      },
      fileExists: (p) => p in written,
      env: {},
    },
    writes,
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

// In-memory filesystem fixture used by the adapter-level tests. The
// fixture is deliberately small (one workspace package with three
// source files plus one test file) so the expected unused-export count
// is hand-derivable.
function inMemoryFs(layout) {
  // layout: { '/r/path/to/file.ts': 'contents', '/r/ws_apps': null  }
  const dirs = new Set();
  for (const path of Object.keys(layout)) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      dirs.add(segments.slice(0, i).join('/') || '/');
    }
  }
  return {
    existsSync: (p) => p in layout || dirs.has(p),
    readdirSync: (p) => {
      const out = new Set();
      const prefix = `${p}/`;
      for (const key of Object.keys(layout)) {
        if (key.startsWith(prefix)) {
          const tail = key.slice(prefix.length);
          out.add(tail.includes('/') ? tail.slice(0, tail.indexOf('/')) : tail);
        }
      }
      for (const d of dirs) {
        if (d.startsWith(prefix)) {
          const tail = d.slice(prefix.length);
          out.add(tail.includes('/') ? tail.slice(0, tail.indexOf('/')) : tail);
        }
      }
      return [...out];
    },
    statSync: (p) => {
      if (p in layout) {
        return { isDirectory: () => false };
      }
      if (dirs.has(p)) {
        return { isDirectory: () => true };
      }
      throw new Error(`stub: ENOENT ${p}`);
    },
    readFileSync: (p) => {
      if (p in layout) {
        return layout[p];
      }
      throw new Error(`stub: ENOENT ${p}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter unit tests
// ---------------------------------------------------------------------------

test('findExports captures named const / function / class / interface / type / enum / let / var', () => {
  const src = [
    'export const x = 1;',
    'export function foo() {}',
    'export async function bar() {}',
    'export class Baz {}',
    'export interface Qux {}',
    'export type Quux = number;',
    'export enum Color { Red }',
    'export let mutable = 0;',
    'export var legacy = "y";',
    'const internal = 2;', // not exported
    'export default 42;', // intentionally not captured
    'export { renamed } from "./other";', // re-export, not captured
  ].join('\n');
  const names = findExports(src).map((e) => e.name);
  assert.deepEqual(names, ['x', 'foo', 'bar', 'Baz', 'Qux', 'Quux', 'Color', 'mutable', 'legacy']);
});

test('findExports records 1-indexed line numbers', () => {
  const src = 'line1\nexport const target = 1;\nline3\n';
  const out = findExports(src);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'target');
  assert.equal(out[0].line, 2);
});

test('countReferences uses whole-word matches', () => {
  // `_` is a word char so foo_bar is one token; `.` and `,` and `;` are
  // non-word so they are word boundaries. `foo` matches: foo (1),
  // foo. (2), foo, (3), foo; (4). `bar` matches every `.bar` form too
  // (the `.` is a non-word boundary), so foo.bar contributes a `bar`
  // hit. Tokens like `foobar` and `foo_bar` do not match `foo` or
  // `bar` because both sides need to be word boundaries.
  const text = 'foo foobar foo_bar foo.bar foo, foo;';
  assert.equal(countReferences('foo', text), 4);
  assert.equal(countReferences('bar', text), 1); // only from foo.bar
  assert.equal(countReferences('foobar', text), 1);
  assert.equal(countReferences('missing', text), 0);
});

test('isFrameworkConvention filters Next.js / fumadocs file conventions', () => {
  assert.equal(isFrameworkConvention('ws_apps/docs/mdx-components.tsx'), true);
  assert.equal(isFrameworkConvention('ws_apps/docs/source.config.ts'), true);
  assert.equal(isFrameworkConvention('ws_apps/docs/app/layout.tsx'), true);
  assert.equal(isFrameworkConvention('ws_apps/docs/app/docs/[[...slug]]/page.tsx'), true);
  assert.equal(isFrameworkConvention('ws_packages/telemetry/src/index.ts'), false);
  assert.equal(isFrameworkConvention('ws_apps/example-typescript/src/main.ts'), false);
});

test('walkSourceTree skips node_modules, .next, target, dist, and dotfiles', () => {
  const fs = inMemoryFs({
    '/r/src/a.ts': '',
    '/r/src/b.tsx': '',
    '/r/src/nested/c.ts': '',
    '/r/src/node_modules/dep/index.ts': '',
    '/r/src/.next/cache/x.ts': '',
    '/r/src/target/bin.ts': '',
    '/r/src/dist/out.ts': '',
    '/r/src/README.md': '',
  });
  const files = walkSourceTree('/r/src', fs);
  assert.deepEqual(files, ['/r/src/a.ts', '/r/src/b.tsx', '/r/src/nested/c.ts']);
});

test('walkSourceTree returns sorted output for determinism', () => {
  const fs = inMemoryFs({
    '/r/z.ts': '',
    '/r/a.ts': '',
    '/r/m.ts': '',
  });
  const files = walkSourceTree('/r', fs);
  assert.deepEqual(files, ['/r/a.ts', '/r/m.ts', '/r/z.ts']);
});

test('listExportSources scopes to ws_apps/<pkg>/src and ws_packages/<pkg>/src only', () => {
  const fs = inMemoryFs({
    '/r/ws_apps/a/package.json': '{}',
    '/r/ws_apps/a/src/main.ts': 'export const a = 1;',
    '/r/ws_apps/a/tests/main.test.ts': 'import {a} from "../src/main";',
    '/r/ws_apps/a/vitest.config.ts': 'export default {};',
    '/r/ws_packages/b/package.json': '{}',
    '/r/ws_packages/b/src/index.ts': 'export const b = 2;',
  });
  const sources = listExportSources('/r', ['ws_apps/a', 'ws_packages/b'], fs);
  assert.deepEqual(sources, ['/r/ws_apps/a/src/main.ts', '/r/ws_packages/b/src/index.ts']);
});

test('listReferenceCorpus includes tests and configs (referrer side)', () => {
  const fs = inMemoryFs({
    '/r/ws_apps/a/src/main.ts': '',
    '/r/ws_apps/a/tests/main.test.ts': '',
    '/r/ws_apps/a/vitest.config.ts': '',
    '/r/ws_packages/b/src/index.ts': '',
    '/r/ws_packages/b/tests/index.test.ts': '',
  });
  const corpus = listReferenceCorpus('/r', ['ws_apps', 'ws_packages'], fs);
  assert.ok(corpus.includes('/r/ws_apps/a/tests/main.test.ts'));
  assert.ok(corpus.includes('/r/ws_apps/a/vitest.config.ts'));
  assert.ok(corpus.includes('/r/ws_packages/b/tests/index.test.ts'));
});

test('runDeadcodeScan: zero unused when every export has at least one external referrer', () => {
  const fs = inMemoryFs({
    '/r/ws_packages/a/package.json': '{}',
    '/r/ws_packages/a/src/lib.ts': 'export const used = 1;\nexport function alsoUsed() {}',
    '/r/ws_packages/a/tests/lib.test.ts':
      'import {used, alsoUsed} from "../src/lib";\nconsole.log(used);\nalsoUsed();',
  });
  const env = runDeadcodeScan({ workspaceRoot: '/r', fs });
  assert.equal(env.available, true);
  assert.equal(env.metrics.total_unused, 0);
});

test('runDeadcodeScan: counts every export with no external referrer', () => {
  const fs = inMemoryFs({
    '/r/ws_packages/a/package.json': '{}',
    '/r/ws_packages/a/src/lib.ts':
      'export const orphan = 1;\nexport function alsoOrphan() {}\nexport const used = 2;',
    '/r/ws_packages/a/tests/lib.test.ts': 'import {used} from "../src/lib";\nconsole.log(used);',
  });
  const env = runDeadcodeScan({ workspaceRoot: '/r', fs });
  assert.equal(env.available, true);
  assert.equal(env.metrics.total_unused, 2);
  assert.equal(env.metrics.unused_exports, 2);
  assert.equal(env.metrics.unused_files, 0);
  assert.equal(env.metrics.unused_types, 0);
});

test('runDeadcodeScan: deterministic across repeated runs over the same in-memory FS', () => {
  const fs = inMemoryFs({
    '/r/ws_packages/a/package.json': '{}',
    '/r/ws_packages/a/src/lib.ts':
      'export const x = 1;\nexport const y = 2;\nexport const used = 3;',
    '/r/ws_packages/a/tests/lib.test.ts': 'import {used} from "../src/lib"; console.log(used);',
  });
  const a = runDeadcodeScan({ workspaceRoot: '/r', fs });
  const b = runDeadcodeScan({ workspaceRoot: '/r', fs });
  const c = runDeadcodeScan({ workspaceRoot: '/r', fs });
  assert.equal(a.metrics.total_unused, b.metrics.total_unused);
  assert.equal(b.metrics.total_unused, c.metrics.total_unused);
});

test('runDeadcodeScan: framework-convention files do not contribute to the source list', () => {
  const fs = inMemoryFs({
    '/r/ws_apps/docs/package.json': '{}',
    '/r/ws_apps/docs/src/mdx-components.tsx': 'export function useMDXComponents() {}',
    '/r/ws_apps/docs/src/app/layout.tsx': 'export default function Layout() {}',
    '/r/ws_apps/docs/src/regular.ts': 'export const orphan = 1;',
  });
  // useMDXComponents and Layout are intentionally not counted even
  // though they have no external referrer; regular.ts:orphan is.
  const env = runDeadcodeScan({ workspaceRoot: '/r', fs });
  assert.equal(env.metrics.total_unused, 1);
});

test('runDeadcodeScan: unavailable when no workspace package exists', () => {
  const fs = inMemoryFs({ '/r/README.md': '' });
  const env = runDeadcodeScan({ workspaceRoot: '/r', fs });
  assert.equal(env.available, false);
  assert.match(env.reason, /no ws_apps/);
  assert.deepEqual(env.scanned_workspaces, []);
});

// ---------------------------------------------------------------------------
// Gate integration: ratchet + regression
// ---------------------------------------------------------------------------

test('deadcode: unused-export-count tightens (direction=max) on improvement', () => {
  const baseline = baselineWithDeadcode({ total_unused: 5 });
  const { tightenings, changed, next } = ratchetBaseline(baseline, emptyReport(), {
    deadcode: envelope({ total_unused: 1 }),
  });
  assert.equal(changed, true);
  assert.equal(next.dimensions.MT01.metrics['unused-export-count'].baseline, 1);
  const t = tightenings.find((x) => x.metric === 'unused-export-count');
  assert.ok(t, 'expected tightening entry for unused-export-count');
  assert.equal(t.previous, 5);
  assert.equal(t.next, 1);
});

test('deadcode: regression is flagged without moving the floor', () => {
  const baseline = baselineWithDeadcode({ total_unused: 0 });
  const cmp = compareBaseline(baseline, emptyReport(), {
    deadcode: envelope({ total_unused: 3 }),
  });
  assert.equal(cmp.ok, false);
  assert.ok(
    cmp.regressions.some((r) => r.dimension === 'MT01' && r.metric === 'unused-export-count'),
    'expected MT01 unused-export-count regression to be flagged',
  );
});

test('deadcode: absent envelope (available=false) degrades to no-reading, not a false zero', () => {
  const baseline = baselineWithDeadcode({ total_unused: 3 });
  const cmp = compareBaseline(baseline, emptyReport(), {
    deadcode: { tool: 'deadcode-grep', available: false, reason: 'no workspace' },
  });
  // No regression — when the adapter is unavailable the metric reads as null
  // so worsened() returns false. Same shape as the SC01/LG01/sentrux
  // no-reading contract for missing scanners.
  assert.equal(cmp.ok, true);
});

test('deadcode: main() with --deadcode flag tightens baseline.json on improvement', async () => {
  const seedEnvelope = envelope({ total_unused: 4 });
  const baselineJson = `${JSON.stringify(
    extractApssFitnessBaseline(emptyReport(), { deadcode: seedEnvelope }),
    null,
    2,
  )}\n`;
  const currentEnvelope = envelope({ total_unused: 0 });
  const deadcodeJson = `${JSON.stringify(currentEnvelope, null, 2)}\n`;

  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/deadcode.json': deadcodeJson,
    },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--deadcode=/tmp/deadcode.json',
    ],
    io,
  );

  assert.equal(code, 0, 'deadcode improvement should exit 0');
  assert.equal(writes.length, 1, 'expected one baseline write for the tightened floor');
  const written = JSON.parse(writes[0].content);
  assert.equal(written.dimensions.MT01.metrics['unused-export-count'].baseline, 0);
  assert.match(stdout(), /VERDICT: PASS sensors gate/);
  assert.match(stdout(), /RATCHET: floor tightened/);
});

test('deadcode: main() with --deadcode flag — regression fails and leaves floor untouched', async () => {
  const seedEnvelope = envelope({ total_unused: 0 });
  const baselineJson = `${JSON.stringify(
    extractApssFitnessBaseline(emptyReport(), { deadcode: seedEnvelope }),
    null,
    2,
  )}\n`;
  const worseEnvelope = envelope({ total_unused: 2 });
  const deadcodeJson = `${JSON.stringify(worseEnvelope, null, 2)}\n`;

  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/deadcode.json': deadcodeJson,
    },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--deadcode=/tmp/deadcode.json',
    ],
    io,
  );

  assert.equal(code, 1, 'deadcode regression should exit non-zero');
  assert.equal(writes.length, 0, 'regression must not rewrite baseline');
  assert.match(stdout(), /VERDICT: FAIL sensors gate/);
  assert.match(stdout(), /unused-export-count/);
});
