import { describe, expect, test, vi } from 'vitest';
import {
  main,
  missingTools,
  printReport,
  profilingIssues,
  provenanceIssues,
  runtimeChecks,
  toolChecks,
  toolVersion,
} from '../doctor';

function spawnWith(versions: Record<string, string>) {
  return vi.fn((command: string) => {
    const version = versions[command];
    if (version === undefined) {
      return { status: 1, stdout: Buffer.from('') };
    }
    return { status: 0, stdout: Buffer.from(`${version}\n`) };
  });
}

function spawnStatusOnly(successes: Set<string>) {
  return vi.fn((command: string) => ({ status: successes.has(command) ? 0 : 1 }));
}

const DEFAULT_VERSIONS: Record<string, string> = {
  bun: 'bun 1.1.34',
  pnpm: '11.5.1',
  git: 'git version 2.43.0',
  cargo: 'cargo 1.83.0',
  uv: 'uv 0.5.10',
  just: 'just 1.51.0',
  docker: 'Docker version 24.0.7',
};

const validProvenance = {
  schemaVersion: '1.0',
  mode: 'fresh',
  template: 'polyglot-monorepo',
  templateVersion: '0.4.0',
  standardVersion: '0.2',
  canonical_repo: 'https://github.com/syntropic137/harness-app-template',
  canonical_commit: '436a6155a7d8e11eac46a94270acfd77533d799a',
  forked_at: '2026-05-30T18:33:00.000Z',
};
const validManifest = {
  name: 'polyglot-monorepo',
  version: '0.4.0',
  standard: '0.2',
  slots: {
    profiling: {
      contract: 'profiling',
      plugin: 'harness-profiling',
      required: false,
      swappable: true,
      interface: { type: 'cli', entrypoint: 'harness/profiling/bin/profile' },
    },
  },
};

function fakeFs(files: Record<string, string>, dirs: string[] = []) {
  const dirSet = new Set(dirs);
  return {
    exists: (path: string) => path in files || dirSet.has(path),
    readText: (path: string) => {
      const value = files[path];
      if (value === undefined) {
        throw new Error(`missing ${path}`);
      }
      return value;
    },
  };
}

function validFiles(cwd: string): Record<string, string> {
  return {
    [`${cwd}/.harness-provenance.json`]: `${JSON.stringify(validProvenance)}\n`,
    [`${cwd}/harness.manifest.json`]: `${JSON.stringify(validManifest)}\n`,
    [`${cwd}/harness/profiling/bin/profile`]: '#!/usr/bin/env bash\n',
    [`${cwd}/harness/profiling/baseline.json`]: '{"signals":{}}\n',
  };
}

describe('doctor', () => {
  test('missingTools passes when required tools and docker are present', () => {
    const spawn = spawnStatusOnly(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just', 'docker']));
    expect(missingTools(spawn as never)).toEqual([]);
  });

  test('missingTools accepts podman as the container runtime', () => {
    const spawn = spawnStatusOnly(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just', 'podman']));
    expect(missingTools(spawn as never)).toEqual([]);
  });

  test('missingTools reports missing container runtime', () => {
    const spawn = spawnStatusOnly(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just']));
    expect(missingTools(spawn as never)).toEqual(['docker-or-podman']);
  });

  test('toolVersion returns the trimmed first line or undefined', () => {
    const spawn = spawnWith({ bun: 'bun 1.1.34\nextra' });
    expect(toolVersion(spawn as never, 'bun')).toBe('bun 1.1.34');
    expect(toolVersion(spawn as never, 'unknown-tool')).toBeUndefined();
  });

  test('toolVersion treats empty stdout as missing version', () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: Buffer.from('   \n') }));
    expect(toolVersion(spawn as never, 'phantom')).toBeUndefined();
  });

  test('toolVersion handles status-0 without stdout payload', () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(toolVersion(spawn as never, 'ghost')).toBeUndefined();
  });

  test('toolChecks records every required tool plus container choice', () => {
    const spawn = spawnWith(DEFAULT_VERSIONS);
    const checks = toolChecks(spawn as never);
    const names = checks.map((c) => c.name);
    expect(names).toEqual(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just', 'docker|podman']);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.find((c) => c.name === 'docker|podman')?.version).toContain('Docker');
  });

  test('toolChecks marks missing tools with an install hint', () => {
    const spawn = spawnWith({ git: 'git version 2.43.0' });
    const checks = toolChecks(spawn as never);
    const bun = checks.find((c) => c.name === 'bun');
    expect(bun?.ok).toBe(false);
    expect(bun?.hint).toContain('bun.sh');
    const container = checks.find((c) => c.name === 'docker|podman');
    expect(container?.ok).toBe(false);
    expect(container?.hint).toContain('Docker');
  });

  test('toolChecks falls back to podman version when docker missing', () => {
    const spawn = spawnWith({
      ...DEFAULT_VERSIONS,
      docker: undefined as unknown as string,
      podman: 'podman 5.0.0',
    });
    const checks = toolChecks(spawn as never);
    const container = checks.find((c) => c.name === 'docker|podman');
    expect(container?.ok).toBe(true);
    expect(container?.version).toContain('podman');
  });

  test('runtimeChecks reports node_modules present when directory exists', () => {
    const cwd = '/repo';
    const fs = fakeFs({}, [`${cwd}/node_modules`]);
    const checks = runtimeChecks(cwd, fs.exists);
    expect(checks).toEqual([{ name: 'node_modules', ok: true, detail: 'installed' }]);
  });

  test('runtimeChecks reports node_modules missing with bootstrap hint', () => {
    const cwd = '/repo';
    const checks = runtimeChecks(cwd, () => false);
    expect(checks[0]).toMatchObject({
      name: 'node_modules',
      ok: false,
      hint: 'just bootstrap',
    });
  });

  test('printReport summarises tool, runtime, and provenance state', () => {
    const tools = toolChecks(spawnWith(DEFAULT_VERSIONS) as never);
    const runtime = runtimeChecks('/repo', () => true);
    const lines: string[] = [];
    const { passed, failed, total } = printReport(tools, runtime, [], (line) => lines.push(line));
    expect(failed).toBe(0);
    expect(passed).toBe(total);
    expect(lines[0]).toBe('preflight checks:');
    expect(lines.some((l) => l.includes('[ OK ]') && l.includes('bun'))).toBe(true);
    expect(lines.some((l) => l.includes('[ OK ]') && l.includes('provenance'))).toBe(true);
  });

  test('printReport surfaces install hints for failed checks', () => {
    const tools = toolChecks(spawnWith({ git: 'git version 2.43.0' }) as never);
    const runtime = runtimeChecks('/repo', () => false);
    const provenance = ['something else broke'];
    const lines: string[] = [];
    const { failed } = printReport(tools, runtime, provenance, (line) => lines.push(line));
    expect(failed).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('fix: ') && l.includes('bun.sh'))).toBe(true);
    expect(lines.some((l) => l.includes('fix: just bootstrap'))).toBe(true);
    expect(lines.some((l) => l.includes('[FAIL]') && l.includes('provenance'))).toBe(true);
  });

  test('printReport renders ok=true tools whose version is undefined as "present"', () => {
    const lines: string[] = [];
    printReport([{ name: 'synthetic', ok: true }], [], [], (line) => lines.push(line));
    expect(lines.some((l) => l.includes('synthetic') && l.includes('present'))).toBe(true);
  });

  test('printReport prints trailing provenance issues as continuation lines', () => {
    const tools = toolChecks(spawnWith(DEFAULT_VERSIONS) as never);
    const runtime = runtimeChecks('/repo', () => true);
    const lines: string[] = [];
    printReport(tools, runtime, ['first issue', 'second issue', 'third issue'], (line) =>
      lines.push(line),
    );
    expect(lines.filter((l) => l.includes('second issue')).length).toBe(1);
    expect(lines.filter((l) => l.includes('third issue')).length).toBe(1);
  });

  test('main exits 1 and prints a failure summary when tools are missing', () => {
    const spawn = spawnWith({ bun: 'bun 1.1.34', git: 'git version 2.43.0', docker: 'Docker 1' });
    const errors: string[] = [];
    const logs: string[] = [];
    const cwd = '/repo';
    const fs = fakeFs(validFiles(cwd), [`${cwd}/node_modules`]);
    expect(() =>
      main({
        spawn: spawn as never,
        stdout: { log: (message: string) => logs.push(message) },
        stderr: { error: (message: string) => errors.push(message) },
        exit: (code: number): never => {
          throw new Error(`exit ${code}`);
        },
        cwd,
        exists: fs.exists,
        readText: fs.readText,
      }),
    ).toThrow('exit 1');
    expect(errors[0]).toMatch(/doctor: \d+ of \d+ checks failed/);
    expect(logs.some((l) => l.includes('[FAIL]') && l.includes('pnpm'))).toBe(true);
    expect(logs.some((l) => l.includes('[ OK ]') && l.includes('node_modules'))).toBe(true);
  });

  test('main prints structured pass output when everything is healthy', () => {
    const logs: string[] = [];
    const cwd = '/repo';
    const fs = fakeFs(validFiles(cwd), [`${cwd}/node_modules`]);
    main({
      spawn: spawnWith(DEFAULT_VERSIONS) as never,
      stdout: { log: (message: string) => logs.push(message) },
      stderr: { error: () => undefined },
      exit: (code: number): never => {
        throw new Error(`unexpected exit ${code}`);
      },
      cwd,
      exists: fs.exists,
      readText: fs.readText,
    });
    expect(logs[0]).toBe('preflight checks:');
    expect(logs[logs.length - 1]).toMatch(/doctor: all \d+ checks passed\./);
    expect(logs.some((l) => l.includes('[ OK ]') && l.includes('provenance'))).toBe(true);
    expect(logs.some((l) => l.includes('[ OK ]') && l.includes('profiling'))).toBe(true);
  });

  test('main uses real filesystem defaults when deps omit exists/readText', () => {
    const logs: string[] = [];
    expect(() =>
      main({
        spawn: spawnWith({}) as never,
        stdout: { log: (message: string) => logs.push(message) },
        stderr: { error: () => undefined },
        exit: (code: number): never => {
          throw new Error(`exit ${code}`);
        },
        cwd: '/nonexistent-doctor-cwd',
      }),
    ).toThrow('exit 1');
    expect(logs.some((l) => l.includes('[FAIL]'))).toBe(true);
  });

  test('main exercises the default readText against the worktree provenance file', () => {
    const logs: string[] = [];
    const errors: string[] = [];
    try {
      main({
        spawn: spawnWith(DEFAULT_VERSIONS) as never,
        stdout: { log: (message: string) => logs.push(message) },
        stderr: { error: (message: string) => errors.push(message) },
        exit: (code: number): never => {
          throw new Error(`exit ${code}`);
        },
        cwd: process.cwd(),
      });
    } catch (e) {
      // Failure is fine; we just want the real fs default-fallbacks to run.
    }
    // Either the provenance line shows OK or the report flagged something
    // - both paths exercise the default existsSync/readFileSync branches.
    expect(logs.some((l) => l.includes('provenance'))).toBe(true);
  });

  test('validates provenance shape and manifest agreement', () => {
    const cwd = '/repo';
    const files = validFiles(cwd);
    const fs = fakeFs(files);
    expect(provenanceIssues(cwd, fs.exists, fs.readText)).toEqual([]);
    expect(provenanceIssues()).toEqual([]);

    const mismatched = fakeFs({
      ...files,
      [`${cwd}/.harness-provenance.json`]: `${JSON.stringify({ ...validProvenance, templateVersion: '0.3.0' })}\n`,
    });
    expect(provenanceIssues(cwd, mismatched.exists, mismatched.readText)).toContain(
      '.harness-provenance.json templateVersion 0.3.0 does not match harness.manifest.json 0.4.0',
    );
  });

  test('reports missing and malformed provenance', () => {
    const cwd = '/repo';
    const missing = fakeFs({
      [`${cwd}/harness.manifest.json`]: `${JSON.stringify(validManifest)}\n`,
    });
    expect(provenanceIssues(cwd, missing.exists, missing.readText)).toEqual([
      '.harness-provenance.json is missing; run just init or restore the scaffold provenance file',
    ]);

    const malformed = fakeFs({
      [`${cwd}/.harness-provenance.json`]:
        '{"schemaVersion":"1.0","mode":"bad","canonical_commit":"not a sha","forked_at":"nope"}',
      [`${cwd}/harness.manifest.json`]: `${JSON.stringify(validManifest)}\n`,
    });
    expect(provenanceIssues(cwd, malformed.exists, malformed.readText)).toEqual([
      '.harness-provenance.json missing string field template',
      '.harness-provenance.json missing string field templateVersion',
      '.harness-provenance.json missing string field standardVersion',
      '.harness-provenance.json missing string field canonical_repo',
      '.harness-provenance.json mode must be fresh or updated',
      '.harness-provenance.json canonical_commit must be a git SHA or "unknown"',
      '.harness-provenance.json forked_at must be an ISO-8601 timestamp',
    ]);
  });

  test('main surfaces provenance failures in the structured report', () => {
    const cwd = '/repo';
    const missing = fakeFs(
      {
        [`${cwd}/harness.manifest.json`]: `${JSON.stringify(validManifest)}\n`,
        [`${cwd}/harness/profiling/bin/profile`]: '#!/usr/bin/env bash\n',
        [`${cwd}/harness/profiling/baseline.json`]: '{"signals":{}}\n',
      },
      [`${cwd}/node_modules`],
    );
    const errors: string[] = [];
    const logs: string[] = [];
    expect(() =>
      main({
        spawn: spawnWith(DEFAULT_VERSIONS) as never,
        stdout: { log: (message: string) => logs.push(message) },
        stderr: { error: (message: string) => errors.push(message) },
        exit: (code: number): never => {
          throw new Error(`exit ${code}`);
        },
        cwd,
        exists: missing.exists,
        readText: missing.readText,
      }),
    ).toThrow('exit 1');
    expect(errors[0]).toMatch(/doctor: 1 of \d+ checks failed/);
    expect(
      logs.some(
        (l) =>
          l.includes('[FAIL]') &&
          l.includes('provenance') &&
          l.includes('.harness-provenance.json is missing'),
      ),
    ).toBe(true);
  });

  test('covers provenance parser edge cases', () => {
    const cwd = '/repo';
    const arrayJson = fakeFs({
      [`${cwd}/.harness-provenance.json`]: '[]',
      [`${cwd}/harness.manifest.json`]: `${JSON.stringify(validManifest)}\n`,
    });
    expect(provenanceIssues(cwd, arrayJson.exists, arrayJson.readText)).toEqual([
      '/repo/.harness-provenance.json must contain a JSON object',
    ]);

    const invalidJson = fakeFs({
      [`${cwd}/.harness-provenance.json`]: '{',
      [`${cwd}/harness.manifest.json`]: `${JSON.stringify(validManifest)}\n`,
    });
    expect(provenanceIssues(cwd, invalidJson.exists, invalidJson.readText)[0]).toContain(
      '/repo/.harness-provenance.json is not valid JSON:',
    );

    expect(
      provenanceIssues(
        cwd,
        (path) => path === `${cwd}/.harness-provenance.json`,
        () => {
          throw 'plain failure';
        },
      ),
    ).toEqual(['/repo/.harness-provenance.json is not valid JSON: plain failure']);

    const missingManifest = fakeFs({
      [`${cwd}/.harness-provenance.json`]: `${JSON.stringify(validProvenance)}\n`,
    });
    expect(provenanceIssues(cwd, missingManifest.exists, missingManifest.readText)).toEqual([
      'harness.manifest.json is missing; cannot cross-check provenance',
    ]);

    const invalidManifest = fakeFs({
      [`${cwd}/.harness-provenance.json`]: `${JSON.stringify(validProvenance)}\n`,
      [`${cwd}/harness.manifest.json`]: '[]',
    });
    expect(provenanceIssues(cwd, invalidManifest.exists, invalidManifest.readText)).toEqual([
      '/repo/harness.manifest.json must contain a JSON object',
    ]);

    const optionalEdgeCases = fakeFs({
      [`${cwd}/.harness-provenance.json`]: `${JSON.stringify({
        ...validProvenance,
        schemaVersion: '2.0',
        mode: 'updated',
        canonical_commit: 'unknown',
        upstream_pulls: {},
      })}\n`,
      [`${cwd}/harness.manifest.json`]: `${JSON.stringify({ name: 'polyglot-monorepo' })}\n`,
    });
    expect(provenanceIssues(cwd, optionalEdgeCases.exists, optionalEdgeCases.readText)).toEqual([
      '.harness-provenance.json schemaVersion must be 1.0',
      '.harness-provenance.json upstream_pulls must be an array when present',
    ]);
  });

  test('profiling probe passes on the valid fixture and uses real defaults safely', () => {
    const cwd = '/repo';
    const fs = fakeFs(validFiles(cwd));
    expect(profilingIssues(cwd, fs.exists, fs.readText)).toEqual([]);
    // Default-arg invocation runs against the actual repo, which has the
    // slot wired; this also covers the default readText/exists paths.
    expect(profilingIssues()).toEqual([]);
  });

  test('profiling probe stays quiet when the manifest is absent, malformed, or the slot is swapped to none', () => {
    const cwd = '/repo';
    const absent = fakeFs({});
    expect(profilingIssues(cwd, absent.exists, absent.readText)).toEqual([]);

    const malformed = fakeFs({ [`${cwd}/harness.manifest.json`]: '{' });
    expect(profilingIssues(cwd, malformed.exists, malformed.readText)).toEqual([]);

    const swappedOff = fakeFs({
      [`${cwd}/harness.manifest.json`]: JSON.stringify({
        ...validManifest,
        slots: { profiling: { ...validManifest.slots.profiling, plugin: 'none' } },
      }),
    });
    expect(profilingIssues(cwd, swappedOff.exists, swappedOff.readText)).toEqual([]);
  });

  test('profiling probe flags a missing slot, entrypoint, or baseline', () => {
    const cwd = '/repo';
    const noSlot = fakeFs({
      [`${cwd}/harness.manifest.json`]: JSON.stringify({ ...validManifest, slots: {} }),
    });
    expect(profilingIssues(cwd, noSlot.exists, noSlot.readText)).toEqual([
      'harness.manifest.json has no profiling slot; restore it or run just update',
    ]);

    const noEntrypoint = fakeFs({
      [`${cwd}/harness.manifest.json`]: JSON.stringify({
        ...validManifest,
        slots: { profiling: { ...validManifest.slots.profiling, interface: { type: 'cli' } } },
      }),
      [`${cwd}/harness/profiling/baseline.json`]: '{"signals":{}}\n',
    });
    expect(profilingIssues(cwd, noEntrypoint.exists, noEntrypoint.readText)).toEqual([
      'profiling slot does not declare interface.entrypoint',
    ]);

    const noInterface = fakeFs({
      [`${cwd}/harness.manifest.json`]: JSON.stringify({
        ...validManifest,
        slots: { profiling: { contract: 'profiling', plugin: 'harness-profiling' } },
      }),
      [`${cwd}/harness/profiling/baseline.json`]: '{"signals":{}}\n',
    });
    expect(profilingIssues(cwd, noInterface.exists, noInterface.readText)).toEqual([
      'profiling slot does not declare interface.entrypoint',
    ]);

    const files = validFiles(cwd);
    delete files[`${cwd}/harness/profiling/bin/profile`];
    delete files[`${cwd}/harness/profiling/baseline.json`];
    const broken = fakeFs(files);
    expect(profilingIssues(cwd, broken.exists, broken.readText)).toEqual([
      'profiling entrypoint harness/profiling/bin/profile is missing',
      'harness/profiling/baseline.json is missing; restore it or re-run a profile with --update-baseline',
    ]);
  });

  test('profiling probe validates the baseline document shape', () => {
    const cwd = '/repo';
    const badJson = fakeFs({
      ...validFiles(cwd),
      [`${cwd}/harness/profiling/baseline.json`]: '{',
    });
    const issues = profilingIssues(cwd, badJson.exists, badJson.readText);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('is not valid JSON');

    const noSignals = fakeFs({
      ...validFiles(cwd),
      [`${cwd}/harness/profiling/baseline.json`]: '{"benchmarks":{}}',
    });
    expect(profilingIssues(cwd, noSignals.exists, noSignals.readText)).toEqual([
      'harness/profiling/baseline.json must contain a signals object',
    ]);
  });

  test('main surfaces profiling failures in the structured report', () => {
    const cwd = '/repo';
    const files = validFiles(cwd);
    delete files[`${cwd}/harness/profiling/baseline.json`];
    const fs = fakeFs(files, [`${cwd}/node_modules`]);
    const errors: string[] = [];
    const logs: string[] = [];
    expect(() =>
      main({
        spawn: spawnWith(DEFAULT_VERSIONS) as never,
        stdout: { log: (message: string) => logs.push(message) },
        stderr: { error: (message: string) => errors.push(message) },
        exit: (code: number): never => {
          throw new Error(`exit ${code}`);
        },
        cwd,
        exists: fs.exists,
        readText: fs.readText,
      }),
    ).toThrow('exit 1');
    expect(errors[0]).toMatch(/doctor: 1 of \d+ checks failed/);
    expect(
      logs.some(
        (l) =>
          l.includes('[FAIL]') &&
          l.includes('profiling') &&
          l.includes('harness/profiling/baseline.json is missing'),
      ),
    ).toBe(true);
  });

  test('printReport renders an OK profiling row when no issues are passed', () => {
    const lines: string[] = [];
    const { failed, total } = printReport(
      toolChecks(spawnWith(DEFAULT_VERSIONS) as never),
      runtimeChecks('/repo', () => true),
      [],
      (line) => lines.push(line),
      [],
    );
    expect(failed).toBe(0);
    expect(total).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('[ OK ]') && l.includes('profiling'))).toBe(true);
  });
});
