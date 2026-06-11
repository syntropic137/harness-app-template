#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHASES, detectIsoKey, isSafePathSegment, isScriptEntry, parseArgs, resolveFfmpeg } from './common.mjs';

/* v8 ignore next 3 -- CLI-only optional dependency loaded outside unit tests. */
async function loadChromium() {
  return (await import('playwright')).chromium;
}

export async function main(
  argv = process.argv.slice(2),
  deps = {
    chromium: null,
    console,
    /* v8 ignore next */
    cwd: () => process.cwd(),
    /* v8 ignore next */
    date: () => new Date(),
    execFileSync,
    /* v8 ignore next */
    ffmpeg: () => resolveFfmpeg(),
    mkdirSync,
    writeFileSync,
  },
) {
  const { url, phase, isoKey: isoKeyArg } = parseArgs(argv);
  if (!url || !phase) {
    deps.console.error(
      'usage: screenshot-pair.mjs --phase=before|after --url=<url> [--isoKey=<key>]',
    );
    return 2;
  }
  if (!PHASES.includes(phase)) {
    deps.console.error(`invalid phase: ${phase}. must be one of: ${PHASES.join(', ')}`);
    return 2;
  }

  const isoKey = isoKeyArg ?? detectIsoKey(deps.execFileSync);
  if (!isoKey) throw new Error('could not determine iso key; pass --isoKey=<key>');
  if (!isSafePathSegment(isoKey)) {
    deps.console.error(
      `invalid iso key: ${isoKey}. must match [A-Za-z0-9][A-Za-z0-9._-]* (no path separators)`,
    );
    return 2;
  }

  const dir = join(deps.cwd(), '.harness/artifacts', isoKey, 'screenshots');
  deps.mkdirSync(dir, { recursive: true });

  /* v8 ignore next 3 -- CLI fallback requires Playwright at runtime. */
  if (!deps.chromium) {
    deps.chromium = await loadChromium();
  }
  const pngPath = join(dir, `${phase}.png`);
  const browser = await deps.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: pngPath, type: 'png', fullPage: false });
  } finally {
    await browser.close();
  }

  // The JPEG copy is an LLM-token optimization, not the evidence itself;
  // a missing or limited ffmpeg (Playwright's bundled build cannot decode
  // PNG) degrades to PNG-only instead of failing the capture.
  let jpgPath = null;
  const ffmpeg = deps.ffmpeg();
  if (ffmpeg) {
    try {
      const candidate = join(dir, `${phase}.jpg`);
      deps.execFileSync(ffmpeg, [
        '-y',
        '-i',
        pngPath,
        '-vf',
        'scale=1280:720',
        '-frames:v',
        '1',
        '-update',
        '1',
        '-q:v',
        '3',
        candidate,
      ]);
      jpgPath = candidate;
    } catch (e) {
      deps.console.error(`JPEG conversion failed (${e.message}); PNG still captured`);
    }
  } else {
    deps.console.error('ffmpeg not found; skipping JPEG copy (PNG still captured)');
  }

  deps.writeFileSync(
    join(dir, `${phase}.meta.json`),
    JSON.stringify(
      {
        phase,
        url,
        isoKey,
        capturedAt: deps.date().toISOString(),
      },
      null,
      2,
    ),
  );

  deps.console.log(JSON.stringify({ phase, png: pngPath, jpg: jpgPath }));
  return 0;
}

/* v8 ignore next 6 */
if (isScriptEntry(import.meta.url)) {
  const code = await main();
  if (code !== 0) {
    process.exit(code);
  }
}
