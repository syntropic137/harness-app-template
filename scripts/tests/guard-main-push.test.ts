import { describe, expect, test } from 'vitest';
import {
  changedFilesArgs,
  evaluatePush,
  LAND_GATE_ENV,
  METADATA_SAFE,
  PROTECTED_REF,
  type PushRefLine,
  parsePushStdin,
  runGuard,
  ZERO_SHA,
} from '../guard-main-push';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function mainPush(overrides: Partial<PushRefLine> = {}): PushRefLine {
  return {
    localRef: 'refs/heads/feature',
    localSha: SHA_B,
    remoteRef: PROTECTED_REF,
    remoteSha: SHA_A,
    ...overrides,
  };
}

const SAFE = [/^\.beads\//, /^docs\/journal\//, /^docs\/overnight-decisions-notepad\.md$/];
const CODE = () => ['src/lib.rs'];

describe('parsePushStdin', () => {
  test('parses one ref line per push', () => {
    const input = `refs/heads/x ${SHA_B} refs/heads/main ${SHA_A}\n`;
    expect(parsePushStdin(input)).toEqual([
      { localRef: 'refs/heads/x', localSha: SHA_B, remoteRef: 'refs/heads/main', remoteSha: SHA_A },
    ]);
  });

  test('ignores blank and malformed lines', () => {
    const input = `\n  \nnot enough fields\n${['a', SHA_A, 'b', SHA_B].join(' ')}\n`;
    expect(parsePushStdin(input)).toHaveLength(1);
  });
});

describe('evaluatePush', () => {
  test('allows a push that does not target main', () => {
    const refs = [mainPush({ remoteRef: 'refs/heads/feature' })];
    expect(evaluatePush(refs, { landGateSha: undefined, changedFiles: CODE }).ok).toBe(true);
  });

  test('allows a main push whose EXACT commit was validated by just land', () => {
    // The marker equals the pushed local SHA -> gated.
    expect(evaluatePush([mainPush()], { landGateSha: SHA_B, changedFiles: CODE }).ok).toBe(true);
  });

  test('rejects a forged/ambient marker value (=1) on a code push', () => {
    const result = evaluatePush([mainPush()], { landGateSha: '1', changedFiles: CODE });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('just land');
  });

  test('rejects a marker bound to a DIFFERENT (stale) commit', () => {
    expect(evaluatePush([mainPush()], { landGateSha: SHA_A, changedFiles: CODE }).ok).toBe(false);
  });

  test('rejects an ungated code push to main', () => {
    const result = evaluatePush([mainPush()], { landGateSha: undefined, changedFiles: CODE });
    expect(result.ok).toBe(false);
  });

  test('allows an ungated operational-log push (beads/journal/notepad)', () => {
    const changed = () => [
      '.beads/issues.jsonl',
      'docs/journal/2026-07-19.md',
      'docs/overnight-decisions-notepad.md',
    ];
    expect(
      evaluatePush([mainPush()], {
        landGateSha: undefined,
        changedFiles: changed,
        metadataSafe: SAFE,
      }).ok,
    ).toBe(true);
    // Nothing is exempt unless the consumer's config says so.
    expect(METADATA_SAFE).toEqual([]);
    expect(evaluatePush([mainPush()], { landGateSha: undefined, changedFiles: changed }).ok).toBe(
      false,
    );
  });

  test('protects the configured ref, not just main', () => {
    const refs = [mainPush({ remoteRef: 'refs/heads/trunk' })];
    expect(evaluatePush(refs, { landGateSha: undefined, changedFiles: CODE }).ok).toBe(true);
    expect(
      evaluatePush(refs, {
        landGateSha: undefined,
        changedFiles: CODE,
        protectedRef: 'refs/heads/trunk',
      }).ok,
    ).toBe(false);
  });

  test('rejects render-consumed docs (docs/shots) as NOT metadata', () => {
    const changed = () => ['docs/shots/bridge.svg'];
    expect(
      evaluatePush([mainPush()], {
        landGateSha: undefined,
        changedFiles: changed,
        metadataSafe: SAFE,
      }).ok,
    ).toBe(false);
  });

  test('rejects an arbitrary top-level .md (not on the narrow allowlist)', () => {
    expect(
      evaluatePush([mainPush()], { landGateSha: undefined, changedFiles: () => ['README.md'] }).ok,
    ).toBe(false);
  });

  test('allows a main push with no net file changes', () => {
    expect(evaluatePush([mainPush()], { landGateSha: undefined, changedFiles: () => [] }).ok).toBe(
      true,
    );
  });

  test('rejects a force-push that reverts/deletes a code file on main', () => {
    // A non-fast-forward push of an older/divergent commit lists the files it
    // deletes or reverts (git diff endpoint-to-endpoint), so it is NOT empty and
    // must be gated -- it cannot slip through as "no changes".
    const changed = () => ['src/lib.rs'];
    expect(evaluatePush([mainPush()], { landGateSha: undefined, changedFiles: changed }).ok).toBe(
      false,
    );
  });

  test('rejects when operational-log and code are mixed', () => {
    const changed = () => ['.beads/issues.jsonl', 'src/lib.rs'];
    expect(
      evaluatePush([mainPush()], {
        landGateSha: undefined,
        changedFiles: changed,
        metadataSafe: SAFE,
      }).ok,
    ).toBe(false);
  });

  test('refuses to delete main even when gated', () => {
    const result = evaluatePush([mainPush({ localSha: ZERO_SHA })], {
      landGateSha: ZERO_SHA,
      changedFiles: () => [],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('delete main');
  });

  test('requires the gate for a brand-new remote main (undiffable)', () => {
    const result = evaluatePush([mainPush({ remoteSha: ZERO_SHA })], {
      landGateSha: undefined,
      changedFiles: () => {
        throw new Error('should not diff against a zero remote sha');
      },
    });
    expect(result.ok).toBe(false);
  });

  test('a gated new-main push is still allowed without diffing', () => {
    expect(
      evaluatePush([mainPush({ remoteSha: ZERO_SHA })], {
        landGateSha: SHA_B,
        changedFiles: () => [],
      }).ok,
    ).toBe(true);
  });
});

describe('changedFilesArgs', () => {
  test('uses explicit tree-to-tree endpoints, not the `..` range form', () => {
    const args = changedFilesArgs(SHA_A, SHA_B);
    expect(args).toEqual(['diff', '--name-only', SHA_A, SHA_B]);
    expect(args.join(' ')).not.toContain('..');
  });
});

describe('runGuard', () => {
  const stdin = `refs/heads/feature ${SHA_B} refs/heads/main ${SHA_A}\n`;

  test('exit 0 when the marker matches the pushed SHA', () => {
    const errors: string[] = [];
    const code = runGuard({
      stdin,
      env: { [LAND_GATE_ENV]: SHA_B },
      changedFiles: CODE,
      stderr: { error: (m: string) => errors.push(m) },
    });
    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
  });

  test('exit 1 on a forged (=1) marker over a code push', () => {
    const errors: string[] = [];
    const code = runGuard({
      stdin,
      env: { [LAND_GATE_ENV]: '1' },
      changedFiles: CODE,
      stderr: { error: (m: string) => errors.push(m) },
    });
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('just land');
  });

  test('honours a configured marker env, ref and safe paths', () => {
    const lines = `refs/heads/x ${SHA_B} refs/heads/trunk ${SHA_A}\n`;
    const base = {
      stdin: lines,
      changedFiles: () => ['.beads/a'],
      stderr: { error: () => undefined },
      protectedRef: 'refs/heads/trunk',
    };
    expect(
      runGuard({ ...base, env: { MY_GATE: SHA_B }, markerEnv: 'MY_GATE', changedFiles: CODE }),
    ).toBe(0);
    expect(
      runGuard({
        ...base,
        env: { [LAND_GATE_ENV]: SHA_B },
        markerEnv: 'MY_GATE',
        changedFiles: CODE,
      }),
    ).toBe(1);
    expect(runGuard({ ...base, env: {}, metadataSafe: SAFE })).toBe(0);
  });

  test('FAILS CLOSED (exit 1) when stdin has no parseable refs', () => {
    const errors: string[] = [];
    const code = runGuard({
      stdin: '',
      env: {},
      changedFiles: CODE,
      stderr: { error: (m: string) => errors.push(m) },
    });
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('failing closed');
  });
});
