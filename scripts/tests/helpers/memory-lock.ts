import type { LockDeps } from '../../lib/land/lock';

export function memoryLock(init: Partial<{ boot: string; alive: Set<number> }> = {}) {
  const files = new Map<string, { text: string; at: number }>();
  const logs: string[] = [];
  const state = {
    clock: Date.parse('2026-10-08T00:00:00Z'),
    boot: init.boot ?? 'boot1',
    alive: init.alive ?? new Set([100]),
  };
  const deps: LockDeps = {
    lockPath: '/l',
    createExclusive: (p, t) => {
      if (files.has(p)) return false;
      files.set(p, { text: t, at: state.clock });
      return true;
    },
    read: (p) => files.get(p)?.text ?? null,
    remove: (p) => void files.delete(p),
    ageMs: (p) => (files.has(p) ? state.clock - (files.get(p)?.at ?? 0) : null),
    pidAlive: (pid) => state.alive.has(pid),
    bootId: () => state.boot,
    now: () => state.clock,
    sleep: async (ms) => {
      state.clock += ms;
    },
    log: (m) => void logs.push(m),
  };
  return { deps, files, logs, state };
}
