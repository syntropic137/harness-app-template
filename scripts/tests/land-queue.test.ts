import { describe, expect, test } from 'vitest';
import type { LockHandle } from '../lib/land/lock';
// subprocess-timeout: exempt - drives the queue against the in-memory lock store; nothing is spawned
import { LockTimeout } from '../lib/land/lock';
import { acquireFair, inTurn, liveTickets, type QueueDeps, ticketName } from '../lib/land/queue';
import { memoryLock } from './helpers/memory-lock';

const me = (pid: number) => ({ pid, repo: 'r', ref: `ref-${pid}`, user: 'u' });

/** A live holder of the lease (pid 1 is alive). */
function hold(lock: ReturnType<typeof memoryLock>): () => void {
  lock.files.set(lock.deps.lockPath, {
    text: JSON.stringify({ ...me(1), bootId: 'boot1', startedAt: '2026-10-08T00:00:00Z' }),
    at: lock.state.clock,
  });
  return () => lock.files.delete(lock.deps.lockPath);
}

/** acquireFair, noting in `order` when this caller got the lease. */
async function acquireAndNote(deps: QueueDeps, pid: number, order: number[]): Promise<LockHandle> {
  const handle = await acquireFair(deps, me(pid), 600_000);
  order.push(pid);
  return handle;
}

describe('fair queue in front of the landing lease (bead luyfr.1)', () => {
  test('a later caller cannot take a freed lease while an earlier waiter is between polls', async () => {
    const lock = memoryLock({ alive: new Set([1, 100, 101]) });
    const release = hold(lock);
    let openA = (): void => undefined;
    const parkedA = new Promise<void>((resolve) => {
      openA = resolve;
    });
    let aSleeping = false;
    // A waits first and is parked in its poll sleep when the lease frees up.
    const depsA = {
      ...lock.deps,
      sleep: async () => {
        aSleeping = true;
        await parkedA;
      },
    };
    const order: number[] = [];
    const a = acquireAndNote(depsA, 100, order);
    while (!aSleeping) await Promise.resolve();
    release();
    // B arrives after the release and polls many times while A sleeps: it must not take the lease.
    const b = acquireAndNote(lock.deps, 101, order);
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
    expect(order).toEqual([]);
    openA();
    (await a).release();
    (await b).release();
    expect(order).toEqual([100, 101]);
  });

  test('a later caller cannot jump an earlier waiter', async () => {
    const lock = memoryLock({ alive: new Set([1, 100, 101]) });
    const release = hold(lock);
    const order: number[] = [];
    // A starts waiting first, B later; the lease frees up while both wait.
    const a = acquireAndNote(lock.deps, 100, order);
    await Promise.resolve();
    const b = acquireAndNote(lock.deps, 101, order);
    await Promise.resolve();
    release();
    const handleA = await a;
    expect(order).toEqual([100]); // B is still queued behind A
    handleA.release();
    (await b).release();
    expect(order).toEqual([100, 101]);
    expect(lock.deps.list('/l.queue')).toEqual(['.seq-000000000000002']); // tickets cleaned up; the mark stays
  });

  test('a caller that will not wait is refused while anyone is queued, even if the lease is free', async () => {
    const lock = memoryLock({ alive: new Set([1, 100, 101]) });
    const release = hold(lock);
    const waiting = acquireFair(lock.deps, me(100), 600_000);
    await Promise.resolve();
    release();
    // The lease is free right now, but pid 100 queued first.
    await expect(acquireFair(lock.deps, me(101), 0)).rejects.toThrow(
      /landing lock is free but 1 waiter\(s\) queued ahead; first: pid 100/,
    );
    (await waiting).release();
    (await acquireFair(lock.deps, me(101), 0)).release(); // queue empty: takes it at once
  });

  test("dead waiters' tickets are reaped by the lease's liveness rule, so they never block", async () => {
    const lock = memoryLock({ alive: new Set([101]) });
    // pid 100 queued and died; an unreadable ticket is reaped once old.
    lock.deps.createExclusive(
      '/l.queue/000000000000001',
      JSON.stringify({ ...me(100), bootId: 'boot1', startedAt: 'x' }),
    );
    lock.deps.createExclusive('/l.queue/000000000000002', 'torn');
    expect(liveTickets(lock.deps, '/l.queue')).toEqual(['000000000000002']); // fresh torn file stays
    lock.state.clock += 31_000;
    expect(liveTickets(lock.deps, '/l.queue')).toEqual([]);
    (await acquireFair(lock.deps, me(101), 0)).release();
  });

  test('a waiter that never gets its turn gives up at the deadline and leaves no ticket', async () => {
    const lock = memoryLock({ alive: new Set([1, 100]) });
    hold(lock);
    await expect(acquireFair(lock.deps, me(100), 12_000)).rejects.toThrow(
      /landing lock is held by pid 1 .*not waiting any longer/,
    );
    expect(lock.deps.list('/l.queue')).toEqual(['.seq-000000000000001']); // no ticket, no .alloc
  });

  const busy = (why: string) => new LockTimeout(why);
  const holderOf = (pid: number) => JSON.stringify({ ...me(pid), bootId: 'boot1', startedAt: 'x' });

  test('two waiters in the same millisecond are served first come, first served', async () => {
    // The higher pid arrives first: ordering must not fall back to a pid tiebreak.
    const lock = memoryLock({ alive: new Set([100, 200]) });
    const t = lock.state.clock;
    const frozen = { ...lock.deps, now: () => t, sleep: async () => undefined }; // time stands still
    const order: string[] = [];
    let firstTries = 0;
    const first = inTurn(
      frozen,
      '/q',
      me(200),
      60_000,
      async () => {
        firstTries += 1;
        if (firstTries === 1) return null; // the lease is busy once, so both end up queued
        order.push('first');
        return 'first';
      },
      busy,
    );
    const second = inTurn(
      frozen,
      '/q',
      me(100),
      60_000,
      async () => {
        order.push('second');
        return 'second';
      },
      busy,
    );
    expect(await first).toBe('first');
    expect(await second).toBe('second');
    expect(order).toEqual(['first', 'second']);
    expect(firstTries).toBe(2);
  });

  /** The ticket a waiter holds, read while it waits behind others (it gives up after one poll). */
  async function ticketOf(deps: ReturnType<typeof memoryLock>['deps'], pid: number) {
    let mine = '';
    const watching = {
      ...deps,
      sleep: async (ms: number) => {
        mine = liveTickets(deps, '/q').at(-1) ?? '';
        await deps.sleep(ms);
      },
    };
    await expect(inTurn(watching, '/q', me(pid), 1, async () => null, busy)).rejects.toThrow();
    return mine;
  }

  test('ticket numbers order numerically past 9, and a clock stepping back cannot jump the queue', async () => {
    const lock = memoryLock({ alive: new Set([1, 100, 101]) });
    for (let n = 1; n <= 9; n += 1) lock.deps.createExclusive(`/q/${ticketName(n)}`, holderOf(1));
    expect(await ticketOf(lock.deps, 100)).toBe('000000000000010'); // after ...09, not after ...01
    lock.deps.createExclusive('/q/000000000000010', holderOf(100)); // that waiter is still queued
    lock.state.clock -= 3_600_000; // the wall clock steps back an hour
    expect(await ticketOf(lock.deps, 101)).toBe('000000000000011'); // still behind every earlier one
    expect(liveTickets(lock.deps, '/q').at(-1)).toBe('000000000000010');
  });

  test('a ticket that vanishes mid-scan is skipped, never read as a live waiter or an error', () => {
    const lock = memoryLock({ alive: new Set([100]) });
    const holderText = JSON.stringify({ ...me(100), bootId: 'boot1', startedAt: 'x' });
    lock.deps.createExclusive('/q/000000000000001', holderText);
    lock.deps.createExclusive('/q/000000000000002', holderText);
    // The listing still names ticket 1, but its owner removes it before the scan reads it.
    const racing = {
      ...lock.deps,
      list: (dir: string) => {
        const names = lock.deps.list(dir);
        lock.deps.remove('/q/000000000000001');
        return names;
      },
    };
    expect(liveTickets(racing, '/q')).toEqual(['000000000000002']);
  });

  test('temp files and the allocation lock in the queue dir are not tickets', () => {
    const lock = memoryLock({ alive: new Set([100]) });
    const holderText = JSON.stringify({ ...me(100), bootId: 'boot1', startedAt: 'x' });
    lock.deps.createExclusive('/q/000000000000003', holderText);
    lock.deps.createExclusive('/q/000000000000001.100.1760000000000.tmp', holderText);
    lock.deps.createExclusive('/q/.alloc', holderText);
    lock.deps.createExclusive('/q/.alloc.reap', holderText);
    lock.deps.createExclusive('/q/.seq-000000000000003', '');
    expect(liveTickets(lock.deps, '/q')).toEqual(['000000000000003']);
  });

  test('a late reap of a dead ticket cannot delete a live ticket: numbers are never reused', async () => {
    const lock = memoryLock({ alive: new Set([101]) });
    const deadText = holderOf(100); // pid 100 is dead
    // Ticket 1 was allocated (so its mark exists) to a waiter that then died.
    lock.deps.createExclusive('/q/.seq-000000000000001', '');
    lock.deps.createExclusive('/q/000000000000001', deadText);
    // Scanner A lists the queue and reads ticket 1 (dead), then stalls before removing it.
    const listedByA = lock.deps.list('/q');
    const scannerA = { ...lock.deps, list: () => listedByA, read: () => deadText, ageMs: () => 0 };
    // Scanner B reaps ticket 1 first.
    expect(liveTickets(lock.deps, '/q')).toEqual([]);
    // A new waiter allocates; while it is queued, A wakes up and removes what it judged dead.
    let mine = '';
    let survived = false;
    const got = await inTurn(
      lock.deps,
      '/q',
      me(101),
      60_000,
      async () => {
        mine = liveTickets(lock.deps, '/q')[0] ?? '';
        liveTickets(scannerA, '/q');
        survived = lock.deps.list('/q').includes(mine);
        return 'ok';
      },
      busy,
    );
    expect(got).toBe('ok');
    expect(mine).toBe('000000000000002'); // not the reaped number 1
    expect(survived).toBe(true);
  });

  test('a queue that has used every ticket number refuses loudly and releases the allocation lock', async () => {
    const lock = memoryLock({ alive: new Set([100]) });
    lock.deps.createExclusive('/q/.seq-999999999999999', '');
    await expect(inTurn(lock.deps, '/q', me(100), 60_000, async () => 'x', busy)).rejects.toThrow(
      /handed out every ticket number up to 999999999999999/,
    );
    expect(lock.deps.list('/q')).toEqual(['.seq-999999999999999']); // no .alloc left behind
  });

  test('the high-water mark survives the queue emptying, and only the newest mark is kept', async () => {
    const lock = memoryLock({ alive: new Set([100]) });
    for (let i = 0; i < 3; i += 1) {
      expect(await inTurn(lock.deps, '/q', me(100), 60_000, async () => 'x', busy)).toBe('x');
    }
    expect(lock.deps.list('/q')).toEqual(['.seq-000000000000003']);
  });

  test('a number another writer took without the allocation lock is skipped, mark or ticket', async () => {
    const lock = memoryLock({ alive: new Set([7, 100]) });
    // A writer that ignores .alloc takes mark 1 and ticket 2 just before this caller does.
    const racing = {
      ...lock.deps,
      createExclusive: (path: string, text: string) => {
        if (path === '/q/.seq-000000000000001' || path === '/q/000000000000002') {
          lock.deps.createExclusive(path, path.includes('.seq') ? '' : holderOf(7));
        }
        return lock.deps.createExclusive(path, text);
      },
    };
    expect(await ticketOf(racing, 100)).toBe('000000000000003'); // queued behind the writer's 2
  });

  test('the allocation lock held by a live process past the deadline gives up with a reason', async () => {
    const lock = memoryLock({ alive: new Set([1, 100]) });
    lock.deps.createExclusive(
      '/q/.alloc',
      JSON.stringify({ ...me(1), bootId: 'boot1', startedAt: 'x' }),
    );
    await expect(inTurn(lock.deps, '/q', me(100), 1000, async () => 'x', busy)).rejects.toThrow(
      /could not take a queue ticket/,
    );
  });

  test('a lease error that is not "busy" is raised, and a free queue with a held lease refuses', async () => {
    const lock = memoryLock({ alive: new Set([1, 100]) });
    const broken = {
      ...lock.deps,
      createExclusive: (path: string, text: string) => {
        if (path === lock.deps.lockPath) throw new Error('EACCES: lock dir not writable');
        return lock.deps.createExclusive(path, text);
      },
    };
    await expect(acquireFair(broken, me(100), 0)).rejects.toThrow(/EACCES/);
    hold(lock);
    await expect(acquireFair(lock.deps, me(100), 0)).rejects.toThrow(
      /^landing lock is held by pid 1 .*; not waiting$/,
    );
  });

  test('a ticket whose file is gone between read and stat is skipped', () => {
    const lock = memoryLock({ alive: new Set([100]) });
    lock.deps.createExclusive('/q/000000000000001', holderOf(100));
    expect(liveTickets({ ...lock.deps, ageMs: () => null }, '/q')).toEqual([]);
  });

  test('refusals name an unreadable lock file or first waiter plainly', async () => {
    const lock = memoryLock({ alive: new Set([100, 101]) });
    lock.files.set(lock.deps.lockPath, { text: 'torn', at: lock.state.clock });
    lock.deps.createExclusive('/l.queue/000000000000001', 'torn');
    await expect(acquireFair(lock.deps, me(101), 0)).rejects.toThrow(
      /^landing lock is held by an unreadable lock file; 1 waiter\(s\) queued ahead$/,
    );
  });
});
