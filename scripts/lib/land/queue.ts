import { join } from 'node:path';
import {
  acquireLock,
  describeHolder,
  holderIsStale,
  type LockDeps,
  type LockHandle,
  type LockHolder,
  LockTimeout,
  parseHolder,
} from './lock';

/**
 * A fair queue in front of a lock (bead luyfr.1). Polling waiters used to race: whoever polled
 * first after a release took the lease, so a caller that arrived later could jump one that had
 * waited for minutes. Now a waiter takes a numbered ticket; only the lowest live ticket may try to
 * acquire; tickets whose owner is gone are reaped by the lease's own liveness rule (dead pid, or a
 * provably different boot). A caller that will not wait still never jumps a queue.
 *
 * Ticket numbers are a sequence, not a clock: they are allocated one at a time under a short
 * allocation lock (`<dir>/.alloc`, the lease's own lock with its stale-holder reaping) from a
 * persistent high-water mark (`<dir>/.seq-<n>`), so a number is never reused, zero-padded so the lexical order is the numeric order. Two waiters
 * in the same millisecond are ordered by who allocated first, and a wall-clock step backwards
 * cannot put a later arrival ahead.
 */

/** The lock store plus what a queue needs from it: listing a directory, creating one. */
export interface QueueDeps extends LockDeps {
  /** Entry names in `dir` (no paths), or [] when it does not exist. */
  list(dir: string): string[];
  mkdirp(dir: string): void;
}

const POLL_MS = 5000;
/** An unreadable ticket is torn or foreign; it is reaped only once it is this old, like the lock. */
const REAP_UNREADABLE_MS = 30_000;
const SEQ_DIGITS = 15;
/** A ticket name; anything else in the dir (the allocation lock, temp files) is not a ticket. */
const TICKET = /^\d{15}$/;
const ALLOC_POLL_MS = 50;
const MAX_SEQ = 10 ** SEQ_DIGITS - 1;
/** The persistent high-water mark: an empty file named after the last number handed out. */
const SEQ_MARK = /^\.seq-(\d{15})$/;

type Me = Omit<LockHolder, 'bootId' | 'startedAt'>;

export function ticketName(seq: number): string {
  return String(seq).padStart(SEQ_DIGITS, '0');
}

/** Ticket names in queue order. */
function tickets(deps: QueueDeps, dir: string): string[] {
  return deps
    .list(dir)
    .filter((name) => TICKET.test(name))
    .sort();
}

/**
 * Live tickets in queue order, after reaping the dead ones. A ticket removed while the scan runs
 * (its owner finished) is skipped. `mine`, the caller's own ticket, is never judged: this process
 * is alive by definition.
 */
export function liveTickets(deps: QueueDeps, dir: string, mine?: string): string[] {
  const live: string[] = [];
  for (const name of tickets(deps, dir)) {
    if (name === mine) {
      live.push(name);
      continue;
    }
    const path = join(dir, name);
    const text = deps.read(path);
    const age = deps.ageMs(path);
    if (text === null || age === null) continue; // gone since the listing
    const holder = parseHolder(text);
    const dead = holder === null ? age > REAP_UNREADABLE_MS : holderIsStale(holder, deps);
    if (dead) deps.remove(path);
    else live.push(name);
  }
  return live;
}

/** Take the next ticket number: under the allocation lock, highest existing plus one. */
async function takeTicket(
  deps: QueueDeps,
  dir: string,
  me: Me,
  holder: LockHolder,
  maxWaitMs: number,
): Promise<string> {
  const alloc: LockDeps = {
    ...deps,
    lockPath: join(dir, '.alloc'),
    sleep: () => deps.sleep(ALLOC_POLL_MS),
    log: () => undefined,
  };
  const handle = await acquireLock(alloc, me, maxWaitMs);
  try {
    for (let seq = highWater(deps, dir) + 1; ; seq += 1) {
      if (seq > MAX_SEQ) {
        throw new Error(
          `the queue in ${dir} has handed out every ticket number up to ${MAX_SEQ}; ` +
            'remove that directory while nothing is queued to reset it',
        );
      }
      const name = ticketName(seq);
      // Record the high-water mark before the ticket exists, so the number is never handed out
      // again. A failed create means another writer already used it: move past it.
      if (!deps.createExclusive(join(dir, `.seq-${name}`), '')) continue;
      for (const old of seqMarks(deps, dir))
        if (old < seq) deps.remove(join(dir, `.seq-${ticketName(old)}`));
      if (deps.createExclusive(join(dir, name), JSON.stringify(holder))) return name;
    }
  } finally {
    handle.release();
  }
}

/** The high-water marks in `dir` (normally one; two if a bump was interrupted). */
function seqMarks(deps: QueueDeps, dir: string): number[] {
  return deps
    .list(dir)
    .map((name) => SEQ_MARK.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
}

/**
 * The highest ticket number ever handed out in `dir`. Numbers are never reused: a scanner that
 * read a dead ticket and removes it late would otherwise delete a live ticket given the same name.
 * Live tickets count too, so a queue from before the marks existed stays ordered.
 */
function highWater(deps: QueueDeps, dir: string): number {
  return Math.max(0, ...seqMarks(deps, dir), ...tickets(deps, dir).map(Number));
}

/** `ahead` is never empty: callers describe only a queue with someone in it. */
function describeQueue(deps: QueueDeps, dir: string, ahead: string[]): string {
  const first = ahead.slice(0, 1).map((name) => parseHolder(deps.read(join(dir, name))))[0] ?? null;
  const head = first === null ? '' : `; first: ${describeHolder(first, deps.now())}`;
  return `${ahead.length} waiter(s) queued ahead${head}`;
}

/**
 * Wait in `dir`'s queue until it is this caller's turn and `attempt` succeeds (returns non-null),
 * or until `maxWaitMs` passes (`busy` says why). With no wait, a caller with live tickets ahead is
 * refused at once rather than jumping them.
 */
export async function inTurn<T>(
  deps: QueueDeps,
  dir: string,
  me: Me,
  maxWaitMs: number,
  attempt: () => Promise<T | null>,
  busy: (why: string) => LockTimeout,
): Promise<T> {
  if (maxWaitMs <= 0) return withoutWaiting(deps, dir, attempt, busy);
  const deadline = deps.now() + maxWaitMs;
  const name = await enqueue(deps, dir, me, maxWaitMs, busy);
  try {
    for (;;) {
      const live = liveTickets(deps, dir, name);
      const got = live[0] === name ? await attempt() : null;
      if (got !== null) return got;
      if (deps.now() >= deadline) throw busy(whyStillWaiting(deps, dir, live, name));
      await deps.sleep(POLL_MS);
    }
  } finally {
    deps.remove(join(dir, name));
  }
}

/** A caller that will not wait: refused while anyone is queued, else one attempt. */
async function withoutWaiting<T>(
  deps: QueueDeps,
  dir: string,
  attempt: () => Promise<T | null>,
  busy: (why: string) => LockTimeout,
): Promise<T> {
  const ahead = liveTickets(deps, dir);
  if (ahead.length > 0) throw busy(describeQueue(deps, dir, ahead));
  const got = await attempt();
  if (got === null) throw busy('not waiting');
  return got;
}

/** Take this caller's ticket; failing to get the allocation lock in time is "busy". */
async function enqueue(
  deps: QueueDeps,
  dir: string,
  me: Me,
  maxWaitMs: number,
  busy: (why: string) => LockTimeout,
): Promise<string> {
  const holder: LockHolder = {
    ...me,
    bootId: deps.bootId(),
    startedAt: new Date(deps.now()).toISOString(),
  };
  deps.mkdirp(dir);
  try {
    return await takeTicket(deps, dir, me, holder, maxWaitMs);
  } catch (error) {
    if (error instanceof LockTimeout) throw busy('could not take a queue ticket');
    throw error;
  }
}

function whyStillWaiting(deps: QueueDeps, dir: string, live: string[], name: string): string {
  return live[0] === name
    ? 'not waiting any longer'
    : describeQueue(deps, dir, live.slice(0, live.indexOf(name)));
}

/** acquireLock behind a fair queue in `<lockPath>.queue`. */
export function acquireFair(deps: QueueDeps, me: Me, maxWaitMs: number): Promise<LockHandle> {
  const attempt = async (): Promise<LockHandle | null> => {
    try {
      return await acquireLock(deps, me, 0);
    } catch (error) {
      if (error instanceof LockTimeout) return null;
      throw error;
    }
  };
  const busy = (why: string): LockTimeout => {
    const text = deps.read(deps.lockPath);
    const holder = parseHolder(text);
    if (text === null) return new LockTimeout(`landing lock is free but ${why}`);
    const who = holder === null ? 'an unreadable lock file' : describeHolder(holder, deps.now());
    return new LockTimeout(`landing lock is held by ${who}; ${why}`);
  };
  return inTurn(deps, `${deps.lockPath}.queue`, me, maxWaitMs, attempt, busy);
}
