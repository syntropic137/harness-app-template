import { describe, expect, test } from 'vitest';
import {
  acquireLock,
  describeHolder,
  holderIsStale,
  type LockHolder,
  LockTimeout,
  parseHolder,
} from '../lib/land/lock';
import { memoryLock } from './helpers/memory-lock';

const me = { pid: 200, repo: '/r', ref: 'feat', user: 'u' };
const holderJson = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    pid: 100,
    bootId: 'boot1',
    startedAt: '2026-10-07T23:50:00.000Z',
    repo: '/other',
    ref: 'x',
    user: 'v',
    ...o,
  });

describe('landing lock', () => {
  test('acquire, release, and release only your own lock', async () => {
    const m = memoryLock();
    const h = await acquireLock(m.deps, me, 1000);
    expect(parseHolder(m.files.get('/l')?.text ?? null)?.pid).toBe(200);
    h.release();
    expect(m.files.has('/l')).toBe(false);
    const h2 = await acquireLock(m.deps, me, 1000);
    m.files.set('/l', { text: holderJson(), at: 0 });
    h2.release();
    expect(m.files.has('/l')).toBe(true);
    m.files.delete('/l');
    h2.release();
  });

  test('queues behind a live holder, announces who and since when, then proceeds', async () => {
    const m = memoryLock();
    m.files.set('/l', { text: holderJson(), at: 0 });
    let polls = 0;
    const sleep = m.deps.sleep;
    m.deps.sleep = async (ms) => {
      await sleep(ms);
      polls += 1;
      if (polls === 30) m.files.delete('/l');
    };
    await acquireLock(m.deps, me, 3_600_000);
    expect(m.logs[0]).toMatch(
      /pid 100 \(v\) landing x in \/other, since 2026-10-07T23:50:00.000Z \(10 min ago\)/,
    );
    // announces at most once a minute while polling every 5s
    expect(m.logs.filter((l) => l.startsWith('waiting'))).toHaveLength(3);
  });

  test('times out behind a live holder', async () => {
    const m = memoryLock();
    m.files.set('/l', { text: holderJson(), at: 0 });
    await expect(acquireLock(m.deps, me, 10_000)).rejects.toThrow(LockTimeout);
  });

  test('a dead PID releases the lock', async () => {
    const m = memoryLock({ alive: new Set() });
    m.files.set('/l', { text: holderJson(), at: 0 });
    await acquireLock(m.deps, me, 1000);
    expect(m.logs[0]).toMatch(/releasing stale lock of pid 100/);
    expect(parseHolder(m.files.get('/l')?.text ?? null)?.pid).toBe(200);
  });

  test('a reboot releases the lock even if the PID number is alive again', async () => {
    const m = memoryLock({ boot: 'boot2', alive: new Set([100]) });
    const holder = parseHolder(holderJson());
    expect(holderIsStale(holder as LockHolder, m.deps)).toBe(true);
    m.files.set('/l', { text: holderJson(), at: 0 });
    await acquireLock(m.deps, me, 1000);
    expect(parseHolder(m.files.get('/l')?.text ?? null)?.bootId).toBe('boot2');
  });

  test('an unreadable lock file is removed', async () => {
    const m = memoryLock();
    m.files.set('/l', { text: '{torn', at: 0 });
    await acquireLock(m.deps, me, 1000);
    expect(m.logs[0]).toMatch(/unreadable/);
  });

  test('a fresh unreadable lock file is waited on, not reaped; an old one is', async () => {
    const m = memoryLock();
    m.files.set('/l', { text: '', at: m.state.clock });
    await expect(acquireLock(m.deps, me, 10_000)).rejects.toThrow();
    expect(m.files.get('/l')?.text).toBe('');
    // ages out
    const m2 = memoryLock();
    m2.files.set('/l', { text: '', at: m2.state.clock });
    let n = 0;
    const real = m2.deps.sleep;
    m2.deps.sleep = async (ms) => {
      n += 1;
      await real(ms + 10_000);
    };
    await acquireLock(m2.deps, me, 1_000_000);
    expect(n).toBeGreaterThan(0);
    expect(parseHolder(m2.files.get('/l')?.text ?? null)?.pid).toBe(200);
  });

  test('a lock file that vanishes while unreadable is simply taken', async () => {
    const m = memoryLock();
    m.files.set('/l', { text: '{', at: m.state.clock });
    const real = m.deps.read;
    m.deps.read = (p) => {
      const v = real(p);
      if (p === '/l') m.files.delete('/l');
      return v;
    };
    await acquireLock(m.deps, me, 1000);
    expect(m.files.has('/l')).toBe(true);
  });

  test('a live reaper is waited for, never taken over because it is slow', async () => {
    const m = memoryLock({ alive: new Set([100, 300]) });
    m.files.set('/l', { text: holderJson({ pid: 999 }), at: 0 }); // stale holder (pid 999 dead)
    m.files.set('/l.reap', { text: holderJson({ pid: 300 }), at: 0 }); // live reaper, ancient file
    let polls = 0;
    const sleep = m.deps.sleep;
    m.deps.sleep = async (ms) => {
      await sleep(ms);
      polls += 1;
      if (polls === 3) {
        m.files.delete('/l.reap');
        m.files.delete('/l');
      }
    };
    await acquireLock(m.deps, me, 1_000_000);
    expect(polls).toBeGreaterThanOrEqual(3);
    expect(parseHolder(m.files.get('/l')?.text ?? null)?.pid).toBe(200);
  });

  test('an old unreadable lock behind a live reaper also waits', async () => {
    const m = memoryLock({ alive: new Set([300]) });
    m.files.set('/l', { text: '{', at: 0 });
    m.files.set('/l.reap', { text: holderJson({ pid: 300 }), at: 0 });
    const sleep = m.deps.sleep;
    let polls = 0;
    m.deps.sleep = async (ms) => {
      await sleep(ms);
      polls += 1;
      if (polls === 2) m.files.delete('/l.reap');
    };
    await acquireLock(m.deps, me, 1_000_000);
    expect(polls).toBeGreaterThanOrEqual(2);
  });

  test('a dead reaper is taken over, and so is an old unreadable reaper file', async () => {
    const m = memoryLock({ alive: new Set() });
    m.files.set('/l', { text: holderJson(), at: 0 });
    m.files.set('/l.reap', { text: holderJson({ pid: 300 }), at: 0 });
    await acquireLock(m.deps, me, 1_000_000);
    expect(parseHolder(m.files.get('/l')?.text ?? null)?.pid).toBe(200);
    expect(m.files.has('/l.reap')).toBe(false);
    const m2 = memoryLock({ alive: new Set() });
    m2.files.set('/l', { text: holderJson(), at: 0 });
    m2.files.set('/l.reap', { text: '{', at: 0 });
    await acquireLock(m2.deps, me, 1_000_000);
    expect(m2.files.has('/l.reap')).toBe(false);
  });

  test('a lock that became live again before the reap is not removed', async () => {
    const m = memoryLock({ alive: new Set([100]) });
    // First read says stale (dead pid), reaper re-read says live.
    let call = 0;
    m.files.set('/l', { text: holderJson(), at: 0 });
    const alive = m.deps.pidAlive;
    m.deps.pidAlive = (pid) => {
      call += 1;
      return call === 1 ? false : alive(pid);
    };
    m.deps.sleep = async () => {
      m.files.delete('/l');
    };
    await acquireLock(m.deps, me, 100_000);
    expect(m.logs.some((l) => l.includes('releasing stale'))).toBe(false);
  });

  test('describeHolder never goes negative', () => {
    expect(
      describeHolder(
        parseHolder(holderJson({ startedAt: '2030-01-01T00:00:00Z' })) as LockHolder,
        0,
      ),
    ).toMatch(/0 min ago/);
    expect(parseHolder(null)).toBeNull();
    expect(parseHolder('{"pid":"x"}')).toBeNull();
  });
});
