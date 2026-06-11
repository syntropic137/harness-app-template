import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveFfmpeg } from '../common.mjs';
import { main as recordFlowMain } from '../record-flow.mjs';
import { main as screenshotPairMain } from '../screenshot-pair.mjs';

// Live integration: a real chromium drives the actual scripts against a
// local page, with every artifact write isolated to a temp dir via the
// injectable cwd. Browser availability is environment-dependent, so the
// suite skips when chromium is not installed UNLESS CI_REQUIRE_BROWSERS=1.
// The `scripts` CI job installs chromium and sets that flag, which makes
// this a fail-closed gate there: a missing browser fails the job instead
// of silently skipping.
const browsersAvailable = existsSync(chromium.executablePath());
const required = process.env.CI_REQUIRE_BROWSERS === '1';
const itLive = browsersAvailable || required ? it : it.skip;

const PAGE_HTML = `<!doctype html>
<html><head><title>inspector integration</title></head>
<body><h1 id="title">integration page</h1></body></html>`;

function collectingConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    console: {
      log: (m: string) => logs.push(m),
      error: (m: string) => errors.push(m),
    },
  };
}

describe('inspector live integration', () => {
  let server: Server;
  let baseUrl: string;
  let workDir: string;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'inspector-itest-'));
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('server did not bind to a port');
    }
    baseUrl = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(workDir, { recursive: true, force: true });
  });

  itLive(
    'screenshot-pair captures a real PNG plus metadata into the temp artifact root',
    async () => {
      const io = collectingConsole();
      const code = await screenshotPairMain(
        ['--phase=before', `--url=${baseUrl}`, '--isoKey=itest'],
        {
          chromium,
          console: io.console,
          cwd: () => workDir,
          date: () => new Date(),
          execFileSync,
          ffmpeg: () => resolveFfmpeg(),
          mkdirSync,
          writeFileSync,
        },
      );
      expect(code).toBe(0);

      const shotDir = join(workDir, '.harness/artifacts', 'itest', 'screenshots');
      expect(existsSync(join(shotDir, 'before.png'))).toBe(true);
      const meta = JSON.parse(readFileSync(join(shotDir, 'before.meta.json'), 'utf8'));
      expect(meta).toMatchObject({ phase: 'before', isoKey: 'itest', url: baseUrl });
      const summary = JSON.parse(io.logs[0]);
      expect(summary.png).toBe(join(shotDir, 'before.png'));
      // resolveFfmpeg() returning a binary does not guarantee JPEG support:
      // the Playwright bundled build decodes WebM but cannot read PNG or
      // write JPEG. Assert the script's own contract instead: either the
      // summary points at a real JPEG, or it degraded loudly to PNG-only.
      if (summary.jpg) {
        expect(existsSync(summary.jpg)).toBe(true);
      } else {
        expect(io.errors.join('\n')).toMatch(/JPEG conversion failed|ffmpeg not found/);
      }
    },
    120_000,
  );

  itLive(
    'record-flow drives the navigate flow and writes the events log',
    async () => {
      const io = collectingConsole();
      const code = await recordFlowMain(
        [
          '--phase=after',
          `--url=${baseUrl}`,
          '--flow=navigate',
          '--isoKey=itest',
          '--evidenceMode=network',
        ],
        {
          appendFileSync,
          chromium,
          console: io.console,
          cwd: () => workDir,
          execFileSync,
          ffmpeg: () => resolveFfmpeg(),
          importFlow: (href: string) => import(href),
          mkdirSync,
          now: () => Date.now(),
          renameSync,
          writeFileSync,
        },
      );
      expect(code).toBe(0);

      const eventsPath = join(workDir, '.harness/artifacts', 'itest', 'video', 'events-after.jsonl');
      expect(existsSync(eventsPath)).toBe(true);
      const summary = JSON.parse(io.logs[0]);
      expect(summary).toMatchObject({ flow: 'navigate', flowError: null, webm: null });
    },
    120_000,
  );

  itLive(
    'record-flow animation mode records a real WebM and extracts the keyframe grid',
    async () => {
      const io = collectingConsole();
      const code = await recordFlowMain(
        [
          '--phase=before',
          `--url=${baseUrl}`,
          '--flow=navigate',
          '--isoKey=itest',
          '--evidenceMode=animation',
        ],
        {
          appendFileSync,
          chromium,
          console: io.console,
          cwd: () => workDir,
          execFileSync,
          ffmpeg: () => resolveFfmpeg(),
          importFlow: (href: string) => import(href),
          mkdirSync,
          now: () => Date.now(),
          renameSync,
          writeFileSync,
        },
      );
      expect(code).toBe(0);

      const summary = JSON.parse(io.logs[0]);
      // The WebM rename path must run for real: recordVideo wrote a temp
      // file and the script moved it to the stable per-phase name.
      expect(summary.webm).toBe(
        join(workDir, '.harness/artifacts', 'itest', 'video', 'flow-before.webm'),
      );
      expect(existsSync(summary.webm)).toBe(true);
      expect(existsSync(summary.screenshots.png)).toBe(true);
      // Grid output needs a JPEG-capable ffmpeg; with only the Playwright
      // bundled build the script degrades and logs why.
      if (summary.keyframeGrid) {
        expect(existsSync(summary.keyframeGrid)).toBe(true);
      } else {
        expect(readFileSync(summary.events, 'utf8')).toMatch(
          /ffmpeg-missing|ffmpeg-error|jpeg-error/,
        );
      }
    },
    120_000,
  );
});
