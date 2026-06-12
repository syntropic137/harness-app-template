// Proves the secret-scan gate is a real safety net, not a soft-skip.
//
// Three behaviours we contract on (ADR-0009-secret-scanner.md):
//   1. A planted fake AWS access key in a STAGED file is detected
//      (`gitleaks protect --staged` exits non-zero).
//   2. A staged-but-clean tree passes (`gitleaks protect --staged` exits 0).
//   3. The lefthook + qa wrappers both fail CLOSED when gitleaks is
//      missing (PATH-stripped invocation aborts with the install hint,
//      never silently exit 0).
//
// (1) and (2) are skipped — not soft-passed — when gitleaks is absent
// from the test host, so the suite still runs on a fresh clone before
// `just bootstrap`; (3) is the contract that catches the soft-skip
// regression and therefore runs unconditionally.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url).pathname;

function gitleaksOnPath(): boolean {
  const result = spawnSync('sh', ['-c', 'command -v gitleaks']);
  return result.status === 0;
}

// Gitleaks fires on this AWS access-key shape (rule: aws-access-token).
// The canonical AWS doc fixture (`AKIA...EXAMPLE`) is on gitleaks's
// built-in allowlist and would NOT trip the gate, so we synthesize a
// non-allowlisted random-looking key. The pieces are assembled at
// runtime so the literal 20-char access-key pattern never appears in
// source — otherwise the project's own `gitleaks detect` pass in
// `pnpm qa` would flag this test file.
const FAKE_AWS_KEY = ['AKIA', '3WZXQ7Y', 'UMT', 'B4NXCV'].join('');
const FAKE_AWS_SECRET = ['jXqL5pT/', 'aBcDeFgHiJkLmNoPqRs', 'TuVwXyZ1234567'].join('');

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'secret-scan-test-'));
  // Belt-and-suspenders isolation. An earlier version of this helper
  // used `git -C root ...` and just `cwd: root`, both of which leaked
  // test secrets into the *project's own* index under heavy parallel
  // lefthook load — exactly the failure mode this gate exists to
  // prevent (see PR #22). Three layers now keep git pinned:
  //   1. `git init -q -b main <root>` takes the path positionally, so
  //      .git creation does not depend on cwd or any GIT_* env.
  //   2. Subsequent git invocations pass an env where every GIT_*
  //      from the parent process is scrubbed and only this repo's
  //      GIT_DIR / GIT_WORK_TREE are set.
  //   3. We also pin `cwd: root` and skip the global `core.hooksPath`
  //      so the project's lefthook never fires inside the temp repo.
  execFileSync('git', ['init', '-q', '-b', 'main', root], { env: cleanEnv() });
  runGit(root, ['config', 'core.hooksPath', '/dev/null']);
  runGit(root, ['config', 'user.email', 'test@test']);
  runGit(root, ['config', 'user.name', 'test']);
  runGit(root, ['commit', '--allow-empty', '-m', 'init', '-q']);
  return root;
}

function runGit(root: string, args: string[]): void {
  execFileSync('git', args, {
    cwd: root,
    env: { ...cleanEnv(), GIT_DIR: join(root, '.git'), GIT_WORK_TREE: root },
  });
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && k !== 'GITLEAKS_CONFIG') env[k] = v;
  }
  return env;
}

describe('staged-file secret scan (ADR-0009)', () => {
  it.skipIf(!gitleaksOnPath())('detects a planted AWS key in staged files', () => {
    const repo = makeTempRepo();
    try {
      writeFileSync(
        join(repo, 'planted.env'),
        `AWS_ACCESS_KEY_ID=${FAKE_AWS_KEY}\nAWS_SECRET_ACCESS_KEY=${FAKE_AWS_SECRET}\n`,
      );
      runGit(repo, ['add', join(repo, 'planted.env')]);
      const result = spawnSync('gitleaks', ['protect', '--staged', '--redact', '--no-banner'], {
        cwd: repo,
        env: { ...cleanEnv(), GIT_DIR: join(repo, '.git'), GIT_WORK_TREE: repo },
        encoding: 'utf8',
      });
      expect(result.status, `gitleaks output:\n${result.stdout}\n${result.stderr}`).not.toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it.skipIf(!gitleaksOnPath())('passes when staged content has no secrets', () => {
    const repo = makeTempRepo();
    try {
      writeFileSync(join(repo, 'README.md'), '# nothing scary here\n');
      runGit(repo, ['add', join(repo, 'README.md')]);
      // Non-redact mode so an unexpected finding surfaces the offending
      // content in the assertion message instead of `<redacted>`.
      const result = spawnSync('gitleaks', ['protect', '--staged', '--no-banner'], {
        cwd: repo,
        env: { ...cleanEnv(), GIT_DIR: join(repo, '.git'), GIT_WORK_TREE: repo },
        encoding: 'utf8',
      });
      expect(
        result.status,
        `gitleaks exit=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('secret-scan gate enforces (no silent soft-skip)', () => {
  // The lefthook hook body and the qa wrapper share the same fail-closed
  // shape: exit 1 + install hint when gitleaks is absent. We extract each
  // shell program from its source and execute it under a stripped PATH.

  it('lefthook pre-commit secret-scan exits 1 and emits the install hint', () => {
    const lefthook = readFileSync(join(ROOT, 'lefthook.yml'), 'utf8');
    const program = extractLefthookSecretScanProgram(lefthook);

    const result = spawnSync('/bin/sh', ['-eu', '-c', program], {
      env: { PATH: '/nonexistent' },
      encoding: 'utf8',
    });

    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(1);
    expect(result.stderr).toContain('gitleaks is required');
    expect(result.stderr).toContain('ADR-0009-secret-scanner.md');
    expect(result.stderr).not.toMatch(/skipping/i);
  });

  it('scripts/qa.ts secret-scan exits 1 and emits the install hint', async () => {
    const qaModule = await import('../qa');
    const program =
      (qaModule as { SECRET_SCAN_SCRIPT?: string }).SECRET_SCAN_SCRIPT ??
      extractQaSecretScanProgram(readFileSync(join(ROOT, 'scripts/qa.ts'), 'utf8'));

    const result = spawnSync('/bin/sh', ['-eu', '-c', program], {
      env: { PATH: '/nonexistent' },
      encoding: 'utf8',
    });

    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(1);
    expect(result.stderr).toContain('gitleaks is required');
    expect(result.stderr).toContain('ADR-0009-secret-scanner.md');
    expect(result.stderr).not.toMatch(/skipping/i);
  });
});

function extractLefthookSecretScanProgram(yaml: string): string {
  // The hook body is the inline shell between sh -eu -c ' and the
  // matching closing quote on the line `        '` directly below
  // `gitleaks protect --staged`. We capture by anchoring on the
  // sentinel install URL (immutable to the gate's contract) and the
  // gitleaks invocation line.
  const start = yaml.indexOf('    secret-scan:');
  if (start < 0) throw new Error('secret-scan hook not found in lefthook.yml');
  const tail = yaml.slice(start);
  const begin = tail.indexOf("sh -eu -c '");
  const end = tail.indexOf("\n        '\n", begin);
  if (begin < 0 || end < 0) throw new Error('could not extract secret-scan shell body');
  return tail.slice(begin + "sh -eu -c '".length, end);
}

function extractQaSecretScanProgram(source: string): string {
  const m = source.match(/SECRET_SCAN_SCRIPT = `([\s\S]*?)`\.trim\(\)/);
  if (!m) throw new Error('SECRET_SCAN_SCRIPT not found in scripts/qa.ts');
  // Source has backslash-escaped newlines (\\n) for inside the printf
  // strings; the template literal preserves them as `\n` after one
  // round of JS string parsing, which is what the runtime shell sees.
  return m[1].trim();
}
