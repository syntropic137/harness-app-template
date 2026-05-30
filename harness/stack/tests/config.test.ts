import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/topology/config.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('loadConfig', () => {
  it('loads and validates a config file', async () => {
    const cfg = await loadConfig(resolve(here, 'fixtures/harness.config.ts'));
    expect(cfg.services['web']!.port).toBe('WEB_PORT');
    expect(cfg.database?.kind).toBe('postgres');
    expect(cfg.bugToggles).toContain('BUG_COMPLETE_TASK_500');
  });
  it('throws on missing config file', async () => {
    await expect(loadConfig(resolve(here, 'fixtures/does-not-exist.ts'))).rejects.toThrow();
  });
  it('falls back to the module namespace when no default export is present', async () => {
    const cfg = await loadConfig(resolve(here, 'fixtures/harness.config.named.ts'));
    expect(cfg.services['web']!.port).toBe('WEB_PORT');
  });
});
