import { describe, expect, it, vi } from 'vitest';
import { main as keyframeMain } from '../keyframe-grid.mjs';
import { FLOWS, loadFlowFile, main as recordFlowMain } from '../record-flow.mjs';
import { main as screenshotPairMain } from '../screenshot-pair.mjs';

function fakeConsole() {
  const errors: string[] = [];
  const logs: string[] = [];
  return {
    errors,
    logs,
    console: {
      error: (message: string) => errors.push(message),
      log: (message: string) => logs.push(message),
    },
  };
}

function createScreenshotDeps(options: { ffmpeg?: string | null; gotoRejects?: boolean } = {}) {
  const io = fakeConsole();
  const calls: Array<[string, unknown]> = [];
  const page = {
    goto: vi.fn(async (...args) => {
      calls.push(['goto', args]);
      if (options.gotoRejects) {
        throw new Error('nav failed');
      }
    }),
    screenshot: vi.fn(async (...args) => calls.push(['screenshot', args])),
  };
  const browser = {
    close: vi.fn(async () => calls.push(['browser.close', null])),
    newPage: vi.fn(async (...args) => {
      calls.push(['newPage', args]);
      return page;
    }),
  };
  return {
    calls,
    deps: {
      chromium: { launch: vi.fn(async () => browser) },
      console: io.console,
      cwd: () => '/repo',
      date: () => new Date('2026-06-03T00:00:00.000Z'),
      execFileSync: vi.fn((command: string, args: string[]) => {
        calls.push(['execFileSync', [command, args]]);
        return 'Project\nIso key: detected-iso\n';
      }),
      ffmpeg: () => (options.ffmpeg === undefined ? 'ffmpeg' : options.ffmpeg),
      mkdirSync: vi.fn((...args) => calls.push(['mkdirSync', args])),
      writeFileSync: vi.fn((...args) => calls.push(['writeFileSync', args])),
    },
    io,
  };
}

function createRecordDeps(
  options: {
    completeCount?: number;
    completeRejects?: boolean;
    eventFixtures?: boolean;
    execThrowsOnCall?: number;
    ffmpeg?: string | null;
    gotoRejects?: boolean;
    newContextRejects?: boolean;
    importFlow?: (href: string) => Promise<unknown>;
    screenshotRejects?: boolean;
    videoPath?: string | null;
  } = {},
) {
  const io = fakeConsole();
  const calls: Array<[string, unknown]> = [];
  const completeClick = vi.fn(async () => {
    calls.push(['complete.click', null]);
    if (options.completeRejects) {
      throw new Error('complete failed');
    }
  });
  const completeBtn = {
    count: vi.fn(async () => options.completeCount ?? 1),
    first: vi.fn(() => ({ click: completeClick })),
  };
  const taskRow = {
    locator: vi.fn(() => completeBtn),
  };
  const handlers: Record<string, (value: unknown) => void> = {};
  const page = {
    getByTestId: vi.fn((testId: string) => {
      calls.push(['getByTestId', testId]);
      return {
        click: vi.fn(async () => calls.push(['click', testId])),
        fill: vi.fn(async (value: string) => calls.push(['fill', value])),
      };
    }),
    getByText: vi.fn((text: string) => {
      calls.push(['getByText', text]);
      return {
        waitFor: vi.fn(async () => calls.push(['waitFor', text])),
      };
    }),
    goto: vi.fn(async (...args) => {
      calls.push(['goto', args]);
      if (options.gotoRejects) {
        throw new Error('flow failed');
      }
    }),
    locator: vi.fn(() => ({
      filter: vi.fn(() => taskRow),
    })),
    on: vi.fn((event: string, handler: (value: unknown) => void) => {
      handlers[event] = handler;
      if (options.eventFixtures === false) {
        return;
      }
      if (event === 'console') {
        handler({ text: () => 'console text', type: () => 'warning' });
      }
      if (event === 'pageerror') {
        handler({ message: 'page exploded', stack: 'stack' });
      }
      if (event === 'requestfailed') {
        handler({ failure: () => ({ errorText: 'reset' }), url: () => 'http://app/reset' });
        handler({ failure: () => null, url: () => 'http://app/unknown' });
      }
      if (event === 'response') {
        handler({
          request: () => ({ headers: () => ({ traceparent: 'trace' }), method: () => 'GET' }),
          status: () => 500,
          url: () => 'http://app/error',
        });
        handler({
          request: () => ({ headers: () => ({}), method: () => 'POST' }),
          status: () => 404,
          url: () => 'http://app/missing',
        });
        handler({
          request: () => ({ headers: () => ({}), method: () => 'GET' }),
          status: () => 200,
          url: () => 'http://app/ok',
        });
      }
    }),
    screenshot: vi.fn(async (...args) => {
      calls.push(['screenshot', args]);
      if (options.screenshotRejects) {
        throw new Error('shot failed');
      }
    }),
    video: vi.fn(() =>
      options.videoPath === null
        ? undefined
        : { path: vi.fn(async () => options.videoPath ?? '/tmp/video.webm') },
    ),
    waitForTimeout: vi.fn(async (ms: number) => calls.push(['waitForTimeout', ms])),
  };
  const context = {
    close: vi.fn(async () => calls.push(['context.close', null])),
    newPage: vi.fn(async () => page),
  };
  const browser = {
    close: vi.fn(async () => calls.push(['browser.close', null])),
    newContext: vi.fn(async (...args) => {
      calls.push(['newContext', args]);
      if (options.newContextRejects) {
        throw new Error('context failed');
      }
      return context;
    }),
  };
  let execCalls = 0;
  return {
    calls,
    deps: {
      appendFileSync: vi.fn((...args) => calls.push(['appendFileSync', args])),
      chromium: { launch: vi.fn(async () => browser) },
      console: io.console,
      cwd: () => '/repo',
      execFileSync: vi.fn((command: string, args: string[]) => {
        execCalls += 1;
        calls.push(['execFileSync', [command, args]]);
        if (options.execThrowsOnCall === execCalls) {
          throw new Error('ffmpeg failed');
        }
        return 'Project\nIso key: detected-flow\n';
      }),
      ffmpeg: () => (options.ffmpeg === undefined ? 'ffmpeg' : options.ffmpeg),
      importFlow:
        options.importFlow ??
        (async () => {
          throw new Error('importFlow not stubbed');
        }),
      mkdirSync: vi.fn((...args) => calls.push(['mkdirSync', args])),
      now: () => 1_717_392_000_000,
      renameSync: vi.fn((...args) => calls.push(['renameSync', args])),
      writeFileSync: vi.fn((...args) => calls.push(['writeFileSync', args])),
    },
    io,
    page,
  };
}

describe('keyframe-grid coverage', () => {
  it('returns usage and missing-input errors before spawning ffmpeg', () => {
    const io = fakeConsole();
    expect(
      keyframeMain([], {
        console: io.console,
        existsSync: () => true,
        ffmpeg: () => 'ffmpeg',
        spawnSync: vi.fn(),
      }),
    ).toBe(2);
    expect(
      keyframeMain(['missing.webm', 'out.jpg'], {
        console: io.console,
        existsSync: () => false,
        ffmpeg: () => 'ffmpeg',
        spawnSync: vi.fn(),
      }),
    ).toBe(2);
    expect(io.errors).toEqual([
      'usage: keyframe-grid.mjs <input.webm> <output.jpg>',
      'input not found: missing.webm',
    ]);
  });

  it('returns 127 with install hints when no ffmpeg is resolvable', () => {
    const io = fakeConsole();
    const spawnSync = vi.fn();
    expect(
      keyframeMain(['in.webm', 'out.jpg'], {
        console: io.console,
        existsSync: () => true,
        ffmpeg: () => null,
        spawnSync,
      }),
    ).toBe(127);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(io.errors[0]).toContain('ffmpeg not found');
    expect(io.errors[1]).toContain('HARNESS_FFMPEG');
  });

  it('returns ffmpeg launch failures and process statuses', () => {
    const io = fakeConsole();
    expect(
      keyframeMain(['in.webm', 'out.jpg'], {
        console: io.console,
        existsSync: () => true,
        ffmpeg: () => 'ffmpeg',
        spawnSync: () => ({ error: new Error('ENOENT') }),
      }),
    ).toBe(127);
    expect(
      keyframeMain(['in.webm', 'out.jpg'], {
        console: io.console,
        existsSync: () => true,
        ffmpeg: () => '/custom/ffmpeg',
        spawnSync: vi.fn((bin: string) => {
          expect(bin).toBe('/custom/ffmpeg');
          return { status: 0 };
        }),
      }),
    ).toBe(0);
    expect(
      keyframeMain(['in.webm', 'out.jpg'], {
        console: io.console,
        existsSync: () => true,
        ffmpeg: () => 'ffmpeg',
        spawnSync: () => ({ status: null }),
      }),
    ).toBe(1);
    expect(io.errors).toContain('ffmpeg failed to launch: ENOENT');
  });
});

describe('screenshot-pair coverage', () => {
  it('returns usage errors for missing url or phase', async () => {
    const { deps, io } = createScreenshotDeps();
    await expect(screenshotPairMain(['--url=http://app'], deps)).resolves.toBe(2);
    await expect(screenshotPairMain(['--phase=before'], deps)).resolves.toBe(2);
    expect(io.errors).toEqual([
      'usage: screenshot-pair.mjs --phase=before|after --url=<url> [--isoKey=<key>]',
      'usage: screenshot-pair.mjs --phase=before|after --url=<url> [--isoKey=<key>]',
    ]);
  });

  it('rejects unknown phases and unsafe iso keys before any capture', async () => {
    const badPhase = createScreenshotDeps();
    await expect(
      screenshotPairMain(['--phase=mid', '--url=http://app', '--isoKey=iso-1'], badPhase.deps),
    ).resolves.toBe(2);
    expect(badPhase.io.errors[0]).toContain('invalid phase: mid');

    const badIso = createScreenshotDeps();
    await expect(
      screenshotPairMain(['--phase=before', '--url=http://app', '--isoKey=../../evil'], badIso.deps),
    ).resolves.toBe(2);
    expect(badIso.io.errors[0]).toContain('invalid iso key');
    expect(badIso.calls.some(([name]) => name === 'mkdirSync')).toBe(false);
  });

  it('closes the browser when navigation fails', async () => {
    const { calls, deps } = createScreenshotDeps({ gotoRejects: true });
    await expect(
      screenshotPairMain(['--phase=before', '--url=http://app', '--isoKey=iso-1'], deps),
    ).rejects.toThrow('nav failed');
    expect(calls).toContainEqual(['browser.close', null]);
    expect(calls.some(([name]) => name === 'screenshot')).toBe(false);
  });

  it('captures screenshots with an explicit iso key', async () => {
    const { calls, deps, io } = createScreenshotDeps();
    await expect(
      screenshotPairMain(['--phase=after', '--url=http://app', '--isoKey=iso-1'], deps),
    ).resolves.toBe(0);

    expect(calls).toContainEqual(['browser.close', null]);
    expect(calls.some(([name]) => name === 'writeFileSync')).toBe(true);
    expect(JSON.parse(io.logs[0])).toMatchObject({
      jpg: '/repo/.harness/artifacts/iso-1/screenshots/after.jpg',
      phase: 'after',
      png: '/repo/.harness/artifacts/iso-1/screenshots/after.png',
    });
  });

  it('degrades to PNG-only when the JPEG conversion fails', async () => {
    const { deps, io } = createScreenshotDeps();
    deps.execFileSync = vi.fn(() => {
      throw new Error('limited ffmpeg build');
    });
    await expect(
      screenshotPairMain(['--phase=after', '--url=http://app', '--isoKey=iso-1'], deps),
    ).resolves.toBe(0);

    expect(io.errors[0]).toContain('JPEG conversion failed (limited ffmpeg build)');
    expect(JSON.parse(io.logs[0])).toMatchObject({ jpg: null, phase: 'after' });
  });

  it('degrades to PNG-only when ffmpeg is unavailable', async () => {
    const { calls, deps, io } = createScreenshotDeps({ ffmpeg: null });
    await expect(
      screenshotPairMain(['--phase=after', '--url=http://app', '--isoKey=iso-1'], deps),
    ).resolves.toBe(0);

    expect(calls.some(([name]) => name === 'execFileSync')).toBe(false);
    expect(io.errors[0]).toContain('skipping JPEG copy');
    expect(JSON.parse(io.logs[0])).toMatchObject({ jpg: null, phase: 'after' });
  });

  it('detects iso keys when omitted and throws when detection fails', async () => {
    const detected = createScreenshotDeps();
    detected.deps.execFileSync = vi.fn(() => 'Branch: x\nIso key: detected-iso\n');
    await expect(
      screenshotPairMain(['--phase=before', '--url=http://app'], detected.deps),
    ).resolves.toBe(0);
    expect(detected.io.logs[0]).toContain('detected-iso');

    const failing = createScreenshotDeps();
    failing.deps.execFileSync = vi.fn(() => {
      throw new Error('no inspect');
    });
    await expect(
      screenshotPairMain(['--phase=before', '--url=http://app'], failing.deps),
    ).rejects.toThrow('could not determine iso key');
  });
});

describe('record-flow coverage', () => {
  it('validates command inputs', async () => {
    const { deps, io } = createRecordDeps();
    await expect(recordFlowMain(['--url=http://app', '--phase=before'], deps)).resolves.toBe(2);
    await expect(
      recordFlowMain(
        ['--url=http://app', '--phase=before', '--flow=task-crud', '--evidenceMode=bogus'],
        deps,
      ),
    ).resolves.toBe(2);
    await expect(
      recordFlowMain(['--url=http://app', '--phase=before', '--flow=bogus'], deps),
    ).resolves.toBe(2);
    await expect(
      recordFlowMain(['--url=http://app', '--phase=mid', '--flow=navigate'], deps),
    ).resolves.toBe(2);
    await expect(
      recordFlowMain(
        ['--url=http://app', '--phase=before', '--flow=navigate', '--isoKey=../../evil'],
        deps,
      ),
    ).resolves.toBe(2);
    expect(io.errors).toHaveLength(5);
    expect(io.errors[2]).toContain('navigate');
    expect(io.errors[3]).toContain('invalid phase: mid');
    expect(io.errors[4]).toContain('invalid iso key');
    expect(deps.mkdirSync).not.toHaveBeenCalled();
  });

  it('closes the browser when context creation fails', async () => {
    const { calls, deps } = createRecordDeps({ newContextRejects: true });
    await expect(
      recordFlowMain(
        ['--url=http://app', '--phase=before', '--flow=navigate', '--isoKey=iso-11'],
        deps,
      ),
    ).rejects.toThrow('context failed');
    expect(calls).toContainEqual(['browser.close', null]);
    expect(calls.some(([name]) => name === 'context.close')).toBe(false);
  });

  it('loads scripted flows from a flow file', async () => {
    const flowFn = vi.fn(async () => {});
    const importFlow = vi.fn(async (href: string) => {
      expect(href).toMatch(/^file:\/\/.*custom-flow\.mjs$/);
      return { default: flowFn };
    });
    const { deps, io } = createRecordDeps({ eventFixtures: false, importFlow });
    await expect(
      recordFlowMain(
        [
          '--url=http://app',
          '--phase=before',
          '--flowFile=/flows/custom-flow.mjs',
          '--isoKey=iso-7',
          '--evidenceMode=network',
        ],
        deps,
      ),
    ).resolves.toBe(0);
    expect(flowFn).toHaveBeenCalledWith(expect.anything(), 'http://app');
    expect(JSON.parse(io.logs[0])).toMatchObject({ flow: '/flows/custom-flow.mjs' });
  });

  it('accepts a named flow export and rejects non-function flow files', async () => {
    const named = vi.fn(async () => {});
    await expect(loadFlowFile('/flows/named.mjs', async () => ({ flow: named }))).resolves.toBe(
      named,
    );
    await expect(loadFlowFile('/flows/bad.mjs', async () => ({ default: 42 }))).rejects.toThrow(
      'must default-export',
    );

    const { deps, io } = createRecordDeps({
      importFlow: async () => {
        throw new Error('ENOENT: no such file');
      },
    });
    await expect(
      recordFlowMain(
        ['--url=http://app', '--phase=before', '--flowFile=/flows/missing.mjs', '--isoKey=iso-8'],
        deps,
      ),
    ).resolves.toBe(2);
    expect(io.errors[0]).toContain('could not load flow file');
  });

  it('runs the generic navigate flow', async () => {
    const { calls, deps, io } = createRecordDeps({ eventFixtures: false });
    await expect(
      recordFlowMain(
        [
          '--url=http://app',
          '--phase=before',
          '--flow=navigate',
          '--isoKey=iso-9',
          '--evidenceMode=network',
        ],
        deps,
      ),
    ).resolves.toBe(0);
    expect(calls).toContainEqual(['goto', ['http://app', { waitUntil: 'networkidle' }]]);
    expect(calls).toContainEqual(['waitForTimeout', 1000]);
    expect(JSON.parse(io.logs[0])).toMatchObject({ flow: 'navigate' });
  });

  it('records visual-static evidence without video', async () => {
    const { calls, deps, io } = createRecordDeps({ completeRejects: true });
    await expect(
      recordFlowMain(
        [
          '--url=http://app',
          '--phase=before',
          '--flow=task-crud',
          '--isoKey=iso-1',
          '--evidenceMode=visual-static',
        ],
        deps,
      ),
    ).resolves.toBe(0);

    expect(calls).toContainEqual(['complete.click', null]);
    expect(calls.some(([name]) => name === 'appendFileSync')).toBe(true);
    expect(JSON.parse(io.logs[0])).toMatchObject({
      evidenceMode: 'visual-static',
      keyframeGrid: null,
      phase: 'before',
      webm: null,
    });
  });

  it('records animation evidence with video and keyframe grid', async () => {
    const { calls, deps, io } = createRecordDeps();
    await expect(
      recordFlowMain(
        ['--url=http://app', '--phase=after', '--flow=task-crud', '--evidenceMode=animation'],
        deps,
      ),
    ).resolves.toBe(0);

    expect(calls).toContainEqual([
      'renameSync',
      ['/tmp/video.webm', '/repo/.harness/artifacts/detected-flow/video/flow-after.webm'],
    ]);
    expect(JSON.parse(io.logs[0])).toMatchObject({
      evidenceMode: 'animation',
      keyframeGrid: '/repo/.harness/artifacts/detected-flow/review/keyframe-grid-after.jpg',
      webm: '/repo/.harness/artifacts/detected-flow/video/flow-after.webm',
    });
  });

  it('degrades animation evidence when ffmpeg is unavailable', async () => {
    const { calls, deps, io } = createRecordDeps({ eventFixtures: false, ffmpeg: null });
    await expect(
      recordFlowMain(
        [
          '--url=http://app',
          '--phase=after',
          '--flow=navigate',
          '--isoKey=iso-10',
          '--evidenceMode=animation',
        ],
        deps,
      ),
    ).resolves.toBe(0);

    expect(calls.some(([, args]) => JSON.stringify(args).includes('ffmpeg-missing'))).toBe(true);
    expect(calls.some(([name]) => name === 'renameSync')).toBe(true);
    expect(JSON.parse(io.logs[0])).toMatchObject({
      keyframeGrid: null,
      screenshots: { jpg: null, png: '/repo/.harness/artifacts/iso-10/screenshots/after.png' },
      webm: '/repo/.harness/artifacts/iso-10/video/flow-after.webm',
    });
  });

  it('keeps the captured PNG when only the JPEG conversion fails', async () => {
    const { calls, deps, io } = createRecordDeps({
      eventFixtures: false,
      execThrowsOnCall: 1,
    });
    await expect(
      recordFlowMain(
        [
          '--url=http://app',
          '--phase=before',
          '--flow=navigate',
          '--isoKey=iso-12',
          '--evidenceMode=visual-static',
        ],
        deps,
      ),
    ).resolves.toBe(0);

    expect(calls.some(([, args]) => JSON.stringify(args).includes('jpeg-error'))).toBe(true);
    expect(JSON.parse(io.logs[0])).toMatchObject({
      screenshots: { jpg: null, png: '/repo/.harness/artifacts/iso-12/screenshots/before.png' },
    });
  });

  it('reports flow failures with exit 1 while still capturing evidence', async () => {
    const flowFailure = createRecordDeps({ eventFixtures: false, gotoRejects: true });
    await expect(
      recordFlowMain(
        [
          '--url=http://app',
          '--phase=before',
          '--flow=task-crud',
          '--isoKey=iso-2',
          '--evidenceMode=network',
        ],
        flowFailure.deps,
      ),
    ).resolves.toBe(1);
    expect(flowFailure.calls.some(([, args]) => JSON.stringify(args).includes('flow-error'))).toBe(
      true,
    );
    expect(flowFailure.calls).toContainEqual(['context.close', null]);
    expect(flowFailure.calls).toContainEqual(['browser.close', null]);
    expect(JSON.parse(flowFailure.io.logs[0])).toMatchObject({
      flowError: 'Error: flow failed',
    });

    const shotFailure = createRecordDeps({ screenshotRejects: true });
    await expect(
      recordFlowMain(
        [
          '--url=http://app',
          '--phase=before',
          '--flow=task-crud',
          '--isoKey=iso-3',
          '--evidenceMode=visual-static',
        ],
        shotFailure.deps,
      ),
    ).resolves.toBe(0);
    expect(
      shotFailure.calls.some(([, args]) => JSON.stringify(args).includes('screenshot-error')),
    ).toBe(true);

    const gridFailure = createRecordDeps({ execThrowsOnCall: 2 });
    await expect(
      recordFlowMain(
        [
          '--url=http://app',
          '--phase=before',
          '--flow=task-crud',
          '--isoKey=iso-4',
          '--evidenceMode=animation',
        ],
        gridFailure.deps,
      ),
    ).resolves.toBe(0);
    expect(
      gridFailure.calls.some(([, args]) => JSON.stringify(args).includes('ffmpeg-error')),
    ).toBe(true);
  });

  it('handles absent completion buttons, missing video paths, and missing iso keys', async () => {
    const noComplete = createRecordDeps({ completeCount: 0, eventFixtures: false });
    await expect(
      recordFlowMain(
        [
          '--url=http://app',
          '--phase=before',
          '--flow=task-crud',
          '--isoKey=iso-5',
          '--evidenceMode=network',
        ],
        noComplete.deps,
      ),
    ).resolves.toBe(0);
    expect(noComplete.calls.some(([name]) => name === 'complete.click')).toBe(false);

    const noVideo = createRecordDeps({ eventFixtures: false, videoPath: null });
    await expect(
      recordFlowMain(
        [
          '--url=http://app',
          '--phase=before',
          '--flow=task-crud',
          '--isoKey=iso-6',
          '--evidenceMode=animation',
        ],
        noVideo.deps,
      ),
    ).resolves.toBe(0);
    expect(noVideo.calls.some(([name]) => name === 'renameSync')).toBe(false);

    const noIso = createRecordDeps();
    noIso.deps.execFileSync = vi.fn(() => {
      throw new Error('no inspect');
    });
    await expect(
      recordFlowMain(['--url=http://app', '--phase=before', '--flow=task-crud'], noIso.deps),
    ).rejects.toThrow('could not determine iso key');
  });

  it('exports the built-in flow table with navigate and task-crud', () => {
    expect(Object.keys(FLOWS).sort()).toEqual(['navigate', 'task-crud']);
  });
});
