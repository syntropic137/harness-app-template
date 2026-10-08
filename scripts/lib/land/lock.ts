export interface LockHolder {
  pid: number;
  /** Identifies one boot of the machine; a different value means the holder died with the old boot. */
  bootId: string;
  startedAt: string;
  repo: string;
  ref: string;
  user: string;
}

/** Everything the lock touches outside itself, injectable for tests. */
export interface LockDeps {
  lockPath: string;
  /** Exclusive create (`wx`). Returns false when the file exists. */
  createExclusive(path: string, contents: string): boolean;
  read(path: string): string | null;
  remove(path: string): void;
  /** Age in ms of a file, or null when absent. */
  ageMs(path: string): number | null;
  pidAlive(pid: number): boolean;
  bootId(): string;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
}

export interface LockHandle {
  release(): void;
}

const POLL_MS = 5000;
const REAP_STALE_MS = 30_000;
const ANNOUNCE_EVERY_MS = 60_000;

export function parseHolder(text: string | null): LockHolder | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as Partial<LockHolder>;
    if (typeof value.pid === 'number' && typeof value.bootId === 'string') {
      return value as LockHolder;
    }
  } catch {
    // A torn or foreign file is treated as an unreadable holder, below.
  }
  return null;
}

/** A holder is stale when its boot is over or its process is gone. */
export function holderIsStale(holder: LockHolder, deps: LockDeps): boolean {
  return holder.bootId !== deps.bootId() || !deps.pidAlive(holder.pid);
}

export function describeHolder(holder: LockHolder, nowMs: number): string {
  const since = new Date(holder.startedAt);
  const minutes = Math.max(0, Math.round((nowMs - since.getTime()) / 60_000));
  return `pid ${holder.pid} (${holder.user}) landing ${holder.ref} in ${holder.repo}, since ${holder.startedAt} (${minutes} min ago)`;
}

/**
 * Remove a stale lock without two waiters both deleting a lock the other just
 * recreated: the removal runs under a reaper file that records its owner, and the
 * holder is re-read and re-judged once the reaper is held. A reaper is taken over
 * only when its owner is provably gone (dead PID or a previous boot), never merely
 * because it is slow, so a paused-but-live reaper cannot be raced.
 * Returns false when another live process is reaping and the caller should wait.
 */
function reapStale(deps: LockDeps, mine: LockHolder): boolean {
  const reaper = `${deps.lockPath}.reap`;
  if (!deps.createExclusive(reaper, JSON.stringify(mine))) {
    const other = parseHolder(deps.read(reaper));
    const orphaned =
      other === null ? Number(deps.ageMs(reaper)) > REAP_STALE_MS : holderIsStale(other, deps);
    if (orphaned) deps.remove(reaper);
    return orphaned;
  }
  try {
    const text = deps.read(deps.lockPath);
    const holder = parseHolder(text);
    if (
      text !== null &&
      (holder === null
        ? Number(deps.ageMs(deps.lockPath)) > REAP_STALE_MS
        : holderIsStale(holder, deps))
    ) {
      deps.log(
        holder === null
          ? 'lock: removing unreadable lock file'
          : `lock: releasing stale lock of ${describeHolder(holder, deps.now())}`,
      );
      deps.remove(deps.lockPath);
    }
  } finally {
    deps.remove(reaper);
  }
  return true;
}

export class LockTimeout extends Error {}

export async function acquireLock(
  deps: LockDeps,
  me: Omit<LockHolder, 'bootId' | 'startedAt'>,
  maxWaitMs: number,
): Promise<LockHandle> {
  const mine: LockHolder = {
    ...me,
    bootId: deps.bootId(),
    startedAt: new Date(deps.now()).toISOString(),
  };
  const deadline = deps.now() + maxWaitMs;
  let lastAnnounce = Number.NEGATIVE_INFINITY;
  for (;;) {
    if (deps.createExclusive(deps.lockPath, JSON.stringify(mine))) {
      return {
        release() {
          const current = parseHolder(deps.read(deps.lockPath));
          if (current?.pid === mine.pid && current.startedAt === mine.startedAt) {
            deps.remove(deps.lockPath);
          }
        },
      };
    }
    const holder = parseHolder(deps.read(deps.lockPath));
    if (holder !== null && holderIsStale(holder, deps)) {
      if (!reapStale(deps, mine)) await deps.sleep(POLL_MS);
      continue;
    }
    if (holder === null) {
      // Unreadable: foreign or torn. Never presume it dead while it is fresh.
      const age = deps.ageMs(deps.lockPath);
      if (age === null || age > REAP_STALE_MS) {
        if (!reapStale(deps, mine)) await deps.sleep(POLL_MS);
        continue;
      }
      if (deps.now() >= deadline) {
        throw new LockTimeout('gave up waiting for an unreadable landing lock file to age out');
      }
      await deps.sleep(POLL_MS);
      continue;
    }
    if (deps.now() >= deadline) {
      throw new LockTimeout(
        `gave up waiting for the landing lock held by ${describeHolder(holder, deps.now())}`,
      );
    }
    if (deps.now() - lastAnnounce >= ANNOUNCE_EVERY_MS) {
      deps.log(`waiting for the landing lock held by ${describeHolder(holder, deps.now())}`);
      lastAnnounce = deps.now();
    }
    await deps.sleep(POLL_MS);
  }
}
