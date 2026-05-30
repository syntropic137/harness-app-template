#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...v] = a.replace(/^--/, '').split('=');
      return [k, v.join('=')];
    }),
  );
  if (!args.url || !args.phase) {
    console.error('usage: screenshot-pair.mjs --phase=before|after --url=<url> [--isoKey=<key>]');
    process.exit(2);
  }
  return args;
}

function detectIsoKey() {
  try {
    const out = execFileSync('pnpm', ['--silent', 'harness', 'inspect'], {
      encoding: 'utf8',
    });
    const line = out.split('\n').find((l) => l.startsWith('Iso key:'));
    return line?.split(/\s+/)[2] ?? null;
  } catch {
    return null;
  }
}

const { url, phase, isoKey: isoKeyArg } = parseArgs();
const isoKey = isoKeyArg ?? detectIsoKey();
if (!isoKey) throw new Error('could not determine iso key; pass --isoKey=<key>');

const dir = join(process.cwd(), '.harness/artifacts', isoKey, 'screenshots');
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: 'networkidle' });

const pngPath = join(dir, `${phase}.png`);
const jpgPath = join(dir, `${phase}.jpg`);
await page.screenshot({ path: pngPath, type: 'png', fullPage: false });
execFileSync('ffmpeg', [
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

writeFileSync(
  join(dir, `${phase}.meta.json`),
  JSON.stringify(
    {
      phase,
      url,
      isoKey,
      capturedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

console.log(JSON.stringify({ phase, png: pngPath, jpg: jpgPath }));
