import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  adapterManifest,
  adapterSkipped,
  detectWorkspacePackages,
  optionalAdapterEnvelope,
  parseSkipTier,
  precheckAdapter,
  qualifyReadings,
  qualifyScopePath,
  // @ts-expect-error - plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/adapters.mjs';

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cha-sensors-adapters-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('sensors adapter seam', () => {
  test('parseSkipTier accepts comma-separated and repeated values', () => {
    expect([...parseSkipTier(['dep-cruiser, sentrux', 'grimp-instability'])]).toEqual([
      'dep-cruiser',
      'sentrux',
      'grimp-instability',
    ]);
  });

  test('adapterSkipped uses exact, base, and version-prefix semantics', () => {
    const skips = parseSkipTier(['sentrux', 'dep-cruiser@17.4.0']);
    expect(adapterSkipped('sentrux@optional', skips)).toBe(true);
    expect(adapterSkipped('dep-cruiser@17.4.0', skips)).toBe(true);
    expect(adapterSkipped('ts-morph-complexity', skips)).toBe(false);
  });

  test('detectWorkspacePackages finds template and common monorepo package roots', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'ws_apps', 'web'), { recursive: true });
    mkdirSync(join(root, 'packages', 'py-lib'), { recursive: true });
    writeFileSync(join(root, 'ws_apps', 'web', 'package.json'), '{"name":"web"}\n');
    writeFileSync(
      join(root, 'packages', 'py-lib', 'pyproject.toml'),
      '[project]\nname = "py-lib"\n',
    );

    const packages = detectWorkspacePackages(root);

    expect(packages.map((pkg: { name: string }) => pkg.name)).toEqual(['py-lib', 'web']);
    expect(packages.every((pkg: { path: string }) => pkg.path.startsWith(root))).toBe(true);
  });

  test('precheckAdapter reports missing dependencies and skipped adapters', () => {
    const root = tempRoot();
    const adapter = {
      name: 'dep-cruiser',
      sensor: 'dep-cruiser@17.4.0',
      command: 'npx',
      fanout: true,
      shape: 'js',
    };
    const missing = precheckAdapter(adapter, {
      root,
      commandExists: () => false,
    });
    expect(missing).toMatchObject({
      adapter: 'dep-cruiser',
      applicability: 'missing_dep',
    });

    const skipped = precheckAdapter(adapter, {
      root,
      skipTier: parseSkipTier('dep-cruiser'),
      commandExists: () => true,
    });
    expect(skipped).toMatchObject({
      adapter: 'dep-cruiser',
      applicability: 'skipped',
    });
  });

  test('adapterManifest reports fanout packages for applicable JS adapters', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'ws_apps', 'web'), { recursive: true });
    writeFileSync(join(root, 'ws_apps', 'web', 'package.json'), '{"name":"web"}\n');

    const manifest = adapterManifest(root, new Set(), { commandExists: () => true });
    const depCruiser = manifest.adapters.find(
      (adapter: { adapter: string }) => adapter.adapter === 'dep-cruiser',
    );

    expect(depCruiser).toMatchObject({
      applicability: 'applicable',
      packages: [{ name: 'web' }],
    });
  });

  test('qualifyScopePath and qualifyReadings preserve workspace-relative paths', () => {
    expect(qualifyScopePath('ws_apps/web', 'src/main.ts')).toBe('ws_apps/web/src/main.ts');
    expect(qualifyScopePath('ws_apps/web', 'web/src/main.ts')).toBe('ws_apps/web/src/main.ts');
    expect(
      qualifyReadings(
        [
          { metric: 'i', scope: { kind: 'module', path: 'src/main.ts' }, value: 1 },
          { metric: 'fn', scope: { kind: 'function', file: 'src/main.ts', name: 'run' }, value: 1 },
        ],
        'ws_apps/web',
      ),
    ).toEqual([
      { metric: 'i', scope: { kind: 'module', path: 'ws_apps/web/src/main.ts' }, value: 1 },
      {
        metric: 'fn',
        scope: { kind: 'function', file: 'ws_apps/web/src/main.ts', name: 'run' },
        value: 1,
      },
    ]);
  });

  test('optional adapter envelope soft-skips absent sentrux', () => {
    const root = tempRoot();
    const envelope = optionalAdapterEnvelope('sentrux', root, new Set(), {
      commandExists: () => false,
    });
    expect(envelope).toMatchObject({
      tool: 'sentrux',
      available: false,
      applicability: 'missing_dep',
      readings: [],
    });
  });
});
