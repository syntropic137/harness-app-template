import { describe, expect, test, vi } from 'vitest';
import { main, missingTools, provenanceIssues } from '../doctor';

function spawnWith(successes: Set<string>) {
  return vi.fn((command: string) => ({ status: successes.has(command) ? 0 : 1 }));
}

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
};

function fakeFs(files: Record<string, string>) {
  return {
    exists: (path: string) => path in files,
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
  };
}

describe('doctor', () => {
  test('passes when required tools and docker are present', () => {
    const spawn = spawnWith(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just', 'docker']));
    expect(missingTools(spawn as never)).toEqual([]);
  });

  test('accepts podman as the container runtime', () => {
    const spawn = spawnWith(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just', 'podman']));
    expect(missingTools(spawn as never)).toEqual([]);
  });

  test('reports missing container runtime when neither docker nor podman is present', () => {
    const spawn = spawnWith(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just']));
    expect(missingTools(spawn as never)).toEqual(['docker-or-podman']);
  });

  test('reports missing tools and exits nonzero', () => {
    const spawn = spawnWith(new Set(['bun', 'git', 'docker']));
    const errors: string[] = [];
    const logs: string[] = [];
    const cwd = '/repo';
    const fs = fakeFs(validFiles(cwd));
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
    expect(errors).toEqual(['missing required tools: pnpm, cargo, uv, just']);
    expect(logs).toEqual([]);
  });

  test('prints success when nothing is missing', () => {
    const logs: string[] = [];
    const cwd = '/repo';
    const fs = fakeFs(validFiles(cwd));
    main({
      spawn: spawnWith(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just', 'docker'])) as never,
      stdout: { log: (message: string) => logs.push(message) },
      stderr: { error: () => undefined },
      exit: (code: number): never => {
        throw new Error(`unexpected exit ${code}`);
      },
      cwd,
      exists: fs.exists,
      readText: fs.readText,
    });
    expect(logs).toEqual(['doctor: required tools present', 'doctor: provenance valid']);
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

  test('reports provenance failures through main', () => {
    const cwd = '/repo';
    const missing = fakeFs({
      [`${cwd}/harness.manifest.json`]: `${JSON.stringify(validManifest)}\n`,
    });
    const errors: string[] = [];
    expect(() =>
      main({
        spawn: spawnWith(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just', 'docker'])) as never,
        stdout: { log: () => undefined },
        stderr: { error: (message: string) => errors.push(message) },
        exit: (code: number): never => {
          throw new Error(`exit ${code}`);
        },
        cwd,
        exists: missing.exists,
        readText: missing.readText,
      }),
    ).toThrow('exit 1');
    expect(errors).toEqual([
      'provenance: .harness-provenance.json is missing; run just init or restore the scaffold provenance file',
    ]);
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
});
