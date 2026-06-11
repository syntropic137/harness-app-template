#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PHASES, detectIsoKey, isSafePathSegment, isScriptEntry, parseArgs, resolveFfmpeg } from './common.mjs';

/* v8 ignore next 3 -- CLI-only optional dependency loaded outside unit tests. */
async function loadChromium() {
  return (await import('playwright')).chromium;
}

// Evidence-mode taxonomy from EXP-3 + EXP-7:
//   network          → events.jsonl only (server-trace.txt separately via capture-server-trace.mjs)
//   visual-interaction → events.jsonl only (Playwright's visibility check is the signal)
//   visual-static    → events.jsonl + screenshot pair
//   animation        → events.jsonl + screenshot pair + keyframe grid + webm
//   all              → everything (default; backwards-compat for existing call sites)
//
// See docs/retrospectives/003-evidence-sufficiency.md and 009-visual-bug-e2e.md
// for the empirical basis. Per-bug-class artifacts in
// .claude/skills/before-after-evidence/SKILL.md.
export const EVIDENCE_MODES = {
  network: { video: false, screenshots: false, keyframeGrid: false },
  'visual-interaction': { video: false, screenshots: false, keyframeGrid: false },
  'visual-static': { video: false, screenshots: true, keyframeGrid: false },
  animation: { video: true, screenshots: true, keyframeGrid: true },
  all: { video: true, screenshots: true, keyframeGrid: true },
};

export const FLOWS = {
  // Generic flow that works against any URL: load the page, let the network
  // settle, give animations a beat. The zero-config entry point for a fresh
  // template fork with no app-specific testids yet.
  navigate: async (page, baseUrl) => {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
  },
  // Example app-specific flow (CRUD against the lab's task demo). Forks with
  // their own UI should pass --flowFile instead of growing this table.
  'task-crud': async (page, baseUrl) => {
    // Unique per-run title prevents strict-mode locator collisions across reruns.
    const title = `record-flow-${Date.now()}`;
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByTestId('new-task-input').fill(title);
    await page.getByTestId('create-task').click();
    await page.getByText(title).waitFor();
    const taskRow = page.locator('[data-testid^="task-"]').filter({ hasText: title });
    const completeBtn = taskRow.locator('[data-testid^="complete-task-"]');
    if (await completeBtn.count()) {
      await completeBtn
        .first()
        .click()
        .catch(() => {
          /* ignore intentional 500s */
        });
    }
    await page.waitForTimeout(1500);
  },
};

// A flow file is an ES module whose default export (or named `flow` export)
// is `async (page, baseUrl) => void`. Lets consumers script app-specific
// flows without editing the inspector slot.
export async function loadFlowFile(flowFile, importImpl) {
  const mod = await importImpl(pathToFileURL(flowFile).href);
  const fn = mod.default ?? mod.flow;
  if (typeof fn !== 'function') {
    throw new Error(`flow file ${flowFile} must default-export an async (page, baseUrl) function`);
  }
  return fn;
}

export async function main(
  argv = process.argv.slice(2),
  deps = {
    appendFileSync,
    chromium: null,
    console,
    /* v8 ignore next */
    cwd: () => process.cwd(),
    execFileSync,
    /* v8 ignore next */
    ffmpeg: () => resolveFfmpeg(),
    /* v8 ignore next */
    importFlow: (href) => import(href),
    mkdirSync,
    /* v8 ignore next */
    now: () => Date.now(),
    renameSync,
    writeFileSync,
  },
) {
  const { url, phase, flow, flowFile, isoKey: isoKeyArg, evidenceMode = 'all' } = parseArgs(argv);
  if (!url || !phase || (!flow && !flowFile)) {
    deps.console.error(
      'usage: record-flow.mjs --phase=before|after --url=<url> (--flow=<name> | --flowFile=<path>) [--isoKey=<key>] [--evidenceMode=network|visual-interaction|visual-static|animation|all]',
    );
    return 2;
  }
  if (!PHASES.includes(phase)) {
    deps.console.error(`invalid phase: ${phase}. must be one of: ${PHASES.join(', ')}`);
    return 2;
  }
  const mode = EVIDENCE_MODES[evidenceMode];
  if (!mode) {
    deps.console.error(
      `unknown evidence mode: ${evidenceMode}. known: ${Object.keys(EVIDENCE_MODES).join(', ')}`,
    );
    return 2;
  }
  let flowFn;
  let flowLabel;
  if (flowFile) {
    flowLabel = flowFile;
    try {
      flowFn = await loadFlowFile(flowFile, deps.importFlow);
    } catch (e) {
      deps.console.error(`could not load flow file: ${e.message}`);
      return 2;
    }
  } else {
    flowLabel = flow;
    flowFn = FLOWS[flow];
    if (!flowFn) {
      deps.console.error(`unknown flow: ${flow}. known: ${Object.keys(FLOWS).join(', ')}`);
      return 2;
    }
  }
  const isoKey = isoKeyArg ?? detectIsoKey(deps.execFileSync);
  if (!isoKey) throw new Error('could not determine iso key; pass --isoKey=<key>');
  if (!isSafePathSegment(isoKey)) {
    deps.console.error(
      `invalid iso key: ${isoKey}. must match [A-Za-z0-9][A-Za-z0-9._-]* (no path separators)`,
    );
    return 2;
  }

  const videoDir = join(deps.cwd(), '.harness/artifacts', isoKey, 'video');
  const reviewDir = join(deps.cwd(), '.harness/artifacts', isoKey, 'review');
  const shotDir = join(deps.cwd(), '.harness/artifacts', isoKey, 'screenshots');
  deps.mkdirSync(videoDir, { recursive: true });
  deps.mkdirSync(reviewDir, { recursive: true });
  if (mode.screenshots) deps.mkdirSync(shotDir, { recursive: true });

  const ffmpeg = mode.screenshots || mode.keyframeGrid ? deps.ffmpeg() : null;

  /* v8 ignore next 3 -- CLI fallback requires Playwright at runtime. */
  if (!deps.chromium) {
    deps.chromium = await loadChromium();
  }
  const eventsPath = join(videoDir, `events-${phase}.jsonl`);
  deps.writeFileSync(eventsPath, '');
  const writeEvent = (e) =>
    deps.appendFileSync(eventsPath, `${JSON.stringify({ t: deps.now(), ...e })}\n`);

  const browser = await deps.chromium.launch();
  let context = null;
  let flowError = null;
  let screenshotPaths = null;
  let tempVideoPath = null;
  try {
    const contextOpts = {
      viewport: { width: 1280, height: 720 },
    };
    if (mode.video) {
      contextOpts.recordVideo = { dir: videoDir, size: { width: 1280, height: 720 } };
    }
    context = await browser.newContext(contextOpts);
    const page = await context.newPage();

    page.on('console', (m) => writeEvent({ type: 'console', level: m.type(), text: m.text() }));
    page.on('pageerror', (e) => writeEvent({ type: 'pageerror', text: e.message, stack: e.stack }));
    page.on('requestfailed', (r) =>
      writeEvent({
        type: 'requestfailed',
        url: r.url(),
        error: r.failure()?.errorText,
      }),
    );
    page.on('response', (r) => {
      if (r.status() >= 400) {
        writeEvent({
          type: 'response',
          url: r.url(),
          status: r.status(),
          method: r.request().method(),
          traceparent: r.request().headers().traceparent ?? null,
        });
      }
    });

    if ((mode.screenshots || mode.keyframeGrid) && !ffmpeg) {
      writeEvent({ type: 'ffmpeg-missing', text: 'ffmpeg not found; JPEG/grid steps skipped' });
    }

    // A failing flow still produces the evidence captured so far (that
    // failure evidence is often the point), but the exit code must not
    // report success: callers gate on it.
    try {
      await flowFn(page, url);
    } catch (e) {
      flowError = String(e);
      writeEvent({ type: 'flow-error', text: flowError });
    }

    // Optional still-screenshot pair after the flow for visual-static and
    // animation modes. PNG capture and JPEG conversion fail independently:
    // a broken or limited ffmpeg must not erase the truthfully captured PNG
    // from the summary.
    if (mode.screenshots) {
      const png = join(shotDir, `${phase}.png`);
      try {
        await page.screenshot({ path: png, type: 'png', fullPage: false });
        screenshotPaths = { png, jpg: null };
      } catch (e) {
        writeEvent({ type: 'screenshot-error', text: String(e) });
      }
      if (screenshotPaths && ffmpeg) {
        const jpg = join(shotDir, `${phase}.jpg`);
        try {
          deps.execFileSync(ffmpeg, [
            '-y',
            '-i',
            png,
            '-vf',
            'scale=1280:720',
            '-frames:v',
            '1',
            '-update',
            '1',
            '-q:v',
            '3',
            jpg,
          ]);
          screenshotPaths.jpg = jpg;
        } catch (e) {
          writeEvent({ type: 'jpeg-error', text: String(e) });
        }
      }
    }

    tempVideoPath = mode.video ? await page.video()?.path() : null;
  } finally {
    if (context) await context.close();
    await browser.close();
  }

  const webmPath = mode.video ? join(videoDir, `flow-${phase}.webm`) : null;
  let gridPath = null;
  if (tempVideoPath && webmPath) {
    deps.renameSync(tempVideoPath, webmPath);
    if (mode.keyframeGrid && ffmpeg) {
      gridPath = join(reviewDir, `keyframe-grid-${phase}.jpg`);
      try {
        deps.execFileSync(ffmpeg, [
          '-y',
          '-i',
          webmPath,
          '-vf',
          'fps=1,scale=640:360,tile=3x3',
          '-frames:v',
          '1',
          '-update',
          '1',
          '-q:v',
          '4',
          gridPath,
        ]);
      } catch (e) {
        gridPath = null;
        writeEvent({ type: 'ffmpeg-error', text: String(e) });
      }
    }
  }

  deps.console.log(
    JSON.stringify({
      phase,
      flow: flowLabel,
      evidenceMode,
      flowError,
      events: eventsPath,
      webm: webmPath,
      keyframeGrid: gridPath,
      screenshots: screenshotPaths,
    }),
  );
  return flowError ? 1 : 0;
}

/* v8 ignore next 6 */
if (isScriptEntry(import.meta.url)) {
  const code = await main();
  if (code !== 0) {
    process.exit(code);
  }
}
