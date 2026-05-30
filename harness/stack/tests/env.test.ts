import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { envFilePath, writeEnvFile } from '../src/topology/env.js';

describe('writeEnvFile', () => {
  it('writes KEY=VALUE lines and returns the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-'));
    const path = writeEnvFile(dir, 'abc12345', {
      HARNESS_BRANCH: 'main',
      WEB_PORT: 30000,
      DATABASE_URL: 'postgres://x',
    });
    expect(path).toBe(envFilePath(dir, 'abc12345'));
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('HARNESS_BRANCH=main');
    expect(content).toContain('WEB_PORT=30000');
    expect(content).toContain('DATABASE_URL=postgres://x');
  });
});
