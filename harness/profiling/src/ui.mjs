// harness/profiling/src/ui.mjs - frontend UI profile runner
// (bead create-harness-app-z41).
//
// Closes the EXP-11 frontend gap: navigation timing (TTFB, DCL, load),
// Core Web Vitals (LCP, CLS; INP needs real user interaction so it is
// reported only when the page produced events), per-build bundle size,
// and a Chrome DevTools Protocol performance trace.
//
// The CDP trace is the chrome-devtools-deep skill recipe
// (.claude/skills/chrome-devtools-deep/SKILL.md, "performance trace of a
// user flow") wired as a runnable: stay inside Playwright via
// context.newCDPSession, Tracing.start with ReturnAsStream, collect the
// stream with IO.read, persist trace.json for chrome://tracing.
//
// Degrades cleanly: when Playwright (or its Chromium build) is not
// installed the runner emits an `available: false` sentinel and exits 0,
// matching the harness/perf/bench.sh skip pattern.

import { join } from 'node:path';
import { buildVerdict, gateSignals, renderGateReport } from './gate.mjs';
import {
  artifactDirName,
  generateTraceId,
  isScriptEntry,
  makeNodeIo,
  parseArgs,
  runAsEntry,
  walkFiles,
} from './lib.mjs';

export const DEFAULT_ARTIFACT_ROOT = '.harness/artifacts/profile';

const TRACE_CATEGORIES = 'devtools.timeline,disabled-by-default-devtools.timeline';

// Runs in the page. Buffered observers replay entries that fired before
// observe(), so LCP/CLS recorded during navigation are not lost.
const METRICS_SNIPPET = `(() => {
  const nav = performance.getEntriesByType('navigation')[0] ?? null;
  let lcp = null;
  let cls = 0;
  let inp = null;
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        inp = Math.max(inp ?? 0, entry.duration);
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
  } catch {}
  return new Promise((resolve) => setTimeout(() => resolve({
    navigation: nav ? nav.toJSON() : null,
    vitals: { lcp, cls, inp },
  }), 250));
})()`;

async function defaultLoadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

/** Drain a CDP IO stream (Tracing.end ReturnAsStream handle) to a string. */
export async function readCdpStream(cdp, handle) {
  let out = '';
  for (;;) {
    const { data, base64Encoded, eof } = await cdp.send('IO.read', { handle });
    out += base64Encoded ? Buffer.from(data, 'base64').toString('utf8') : data;
    if (eof) {
      break;
    }
  }
  await cdp.send('IO.close', { handle });
  return out;
}

/** Sum raw + gzipped bytes of .js/.css assets under bundleDir. */
export function measureBundle(io, bundleDir) {
  const files = walkFiles(io, bundleDir, /\.(js|mjs|css)$/);
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const file of files) {
    const buf = io.readFileBytes(file);
    rawBytes += buf.length;
    gzipBytes += io.gzipSize(buf);
  }
  return { files: files.length, rawBytes, gzipBytes };
}

/** Drive the browser, capture metrics plus an optional CDP trace. */
export async function captureUiMetrics(pw, url, { trace }) {
  const browser = await pw.chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (trace) {
      await cdp.send('Tracing.start', {
        categories: TRACE_CATEGORIES,
        transferMode: 'ReturnAsStream',
      });
    }
    await page.goto(url, { waitUntil: 'load' });
    const metrics = await page.evaluate(METRICS_SNIPPET);
    let traceJson = null;
    if (trace) {
      const tracingComplete = new Promise((resolve) => {
        cdp.on('Tracing.tracingComplete', (event) => resolve(event));
      });
      await cdp.send('Tracing.end');
      const { stream } = await tracingComplete;
      traceJson = await readCdpStream(cdp, stream);
    }
    return { metrics, traceJson };
  } finally {
    await browser.close();
  }
}

export async function main(
  argv = process.argv.slice(2),
  io = { ...makeNodeIo(), loadPlaywright: defaultLoadPlaywright },
) {
  const { flags, positional } = parseArgs(argv);
  const url = typeof flags.url === 'string' ? flags.url : positional[0];
  if (typeof url !== 'string' || url.length === 0) {
    io.writeErr(
      'usage: profile ui --url=<page url> [--bundle-dir=DIR] [--no-trace] ' +
        '[--baseline=PATH] [--budgets=PATH] [--update-baseline]\n',
    );
    return 64;
  }
  const artifactRoot =
    typeof flags['artifact-root'] === 'string' ? flags['artifact-root'] : DEFAULT_ARTIFACT_ROOT;

  const pw = await io.loadPlaywright();
  if (pw === null) {
    io.write(
      'profile ui: skipped (playwright-not-installed); ' +
        'install playwright + chromium to capture UI profiles\n',
    );
    return 0;
  }

  const capturedAt = io.nowDate();
  const traceId = generateTraceId(io.randomBytes);
  let captured;
  try {
    captured = await captureUiMetrics(pw, url, { trace: flags['no-trace'] !== true });
  } catch (err) {
    io.writeErr(`profile ui: failed to profile ${url} (${err.message})\n`);
    return 2;
  }

  const navigation = captured.metrics?.navigation ?? null;
  const vitals = captured.metrics?.vitals ?? {};
  const signals = {};
  if (navigation) {
    signals['ui.navigation.ttfb'] = { value: navigation.responseStart, unit: 'ms' };
    signals['ui.navigation.domContentLoaded'] = {
      value: navigation.domContentLoadedEventEnd,
      unit: 'ms',
    };
    signals['ui.navigation.loadEventEnd'] = { value: navigation.loadEventEnd, unit: 'ms' };
  }
  if (typeof vitals.lcp === 'number') {
    signals['ui.vitals.lcp'] = { value: vitals.lcp, unit: 'ms' };
  }
  if (typeof vitals.cls === 'number') {
    signals['ui.vitals.cls'] = { value: vitals.cls, unit: null };
  }
  if (typeof vitals.inp === 'number') {
    signals['ui.vitals.inp'] = { value: vitals.inp, unit: 'ms' };
  }

  const dir = join(artifactRoot, artifactDirName(capturedAt, traceId));
  const artifacts = ['navigation-timing.json', 'web-vitals.json', 'verdict.json'];
  io.writeFile(
    join(dir, 'navigation-timing.json'),
    `${JSON.stringify({ url, navigation }, null, 2)}\n`,
  );
  io.writeFile(join(dir, 'web-vitals.json'), `${JSON.stringify({ url, vitals }, null, 2)}\n`);
  if (captured.traceJson !== null) {
    io.writeFile(join(dir, 'trace.json'), captured.traceJson);
    artifacts.push('trace.json');
  }

  if (typeof flags['bundle-dir'] === 'string') {
    if (io.fileExists(flags['bundle-dir'])) {
      const bundle = measureBundle(io, flags['bundle-dir']);
      signals['ui.bundle.gzipBytes'] = { value: bundle.gzipBytes, unit: 'B' };
      io.writeFile(
        join(dir, 'bundle-size.json'),
        `${JSON.stringify({ bundleDir: flags['bundle-dir'], ...bundle }, null, 2)}\n`,
      );
      artifacts.push('bundle-size.json');
    } else {
      io.write(`profile ui: bundle dir ${flags['bundle-dir']} not found; skipping bundle size\n`);
    }
  }

  let outcome;
  try {
    outcome = gateSignals(signals, io, {
      baselinePath: typeof flags.baseline === 'string' ? flags.baseline : undefined,
      budgetsPath: typeof flags.budgets === 'string' ? flags.budgets : undefined,
      updateBaseline: flags['update-baseline'] === true,
    });
  } catch (err) {
    io.writeErr(`profile ui: ${err.message}\n`);
    return 2;
  }

  const verdict = buildVerdict({
    mode: 'ui',
    capturedAt: capturedAt.toISOString(),
    traceId,
    signals,
    evaluation: outcome.evaluation,
    artifacts,
  });
  io.writeFile(join(dir, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);

  for (const message of outcome.messages) {
    io.write(`${message}\n`);
  }
  io.write(renderGateReport(outcome.evaluation));
  io.write(`profile ui: artifacts at ${dir}\n`);
  return outcome.exitCode;
}

/* node:coverage ignore next 3 */
if (isScriptEntry(import.meta.url)) {
  runAsEntry(main);
}
