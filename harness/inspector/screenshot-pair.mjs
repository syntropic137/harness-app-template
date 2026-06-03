#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* v8 ignore next 3 -- CLI-only optional dependency loaded outside unit tests. */
async function loadChromium() {
  return (await import('playwright')).chromium;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = Object.fromEntries(
    argv.map((a) => {
      const [k, ...v] = a.replace(/^--/, '').split('=');
      return [k, v.join('=')];
    }),
  );
  return args;
}

export function detectIsoKey(execFileSyncImpl = execFileSync) {
  try {
    const out = execFileSyncImpl('pnpm', ['--silent', 'harness', 'inspect'], {
      encoding: 'utf8',
    });
    const line = out.split('\n').find((l) => l.startsWith('Iso key:'));
    return line?.split(/\s+/)[2] ?? null;
  } catch {
    return null;
  }
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

  const isoKey = isoKeyArg ?? detectIsoKey(deps.execFileSync);
  if (!isoKey) throw new Error('could not determine iso key; pass --isoKey=<key>');

  const dir = join(deps.cwd(), '.harness/artifacts', isoKey, 'screenshots');
  deps.mkdirSync(dir, { recursive: true });

  /* v8 ignore next 3 -- CLI fallback requires Playwright at runtime. */
  if (!deps.chromium) {
    deps.chromium = await loadChromium();
  }
  const browser = await deps.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url, { waitUntil: 'networkidle' });

  const pngPath = join(dir, `${phase}.png`);
  const jpgPath = join(dir, `${phase}.jpg`);
  await page.screenshot({ path: pngPath, type: 'png', fullPage: false });
  deps.execFileSync('ffmpeg', [
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
    jpgPath,
  ]);

  await browser.close();

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
if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main();
  if (code !== 0) {
    process.exit(code);
  }
}
