import { describe, expect, it } from 'vitest';
import { computeIsolation, detectIsolation } from '../src/runtime/isolation.js';

describe('computeIsolation', () => {
  it('produces deterministic isoKey from worktree + branch', () => {
    const a = computeIsolation({ worktreePath: '/repo/foo', branch: 'main' });
    const b = computeIsolation({ worktreePath: '/repo/foo', branch: 'main' });
    expect(a.isoKey).toBe(b.isoKey);
    expect(a.isoKey).toMatch(/^[0-9a-f]{8}$/);
  });
  it('different worktrees with same branch get different keys', () => {
    const a = computeIsolation({ worktreePath: '/repo/foo', branch: 'main' });
    const b = computeIsolation({ worktreePath: '/repo/bar', branch: 'main' });
    expect(a.isoKey).not.toBe(b.isoKey);
  });
  it('different branches in same worktree get different keys', () => {
    const a = computeIsolation({ worktreePath: '/repo/foo', branch: 'main' });
    const b = computeIsolation({ worktreePath: '/repo/foo', branch: 'feat' });
    expect(a.isoKey).not.toBe(b.isoKey);
  });
  it('slug is filesystem/compose safe', () => {
    const { slug } = computeIsolation({
      worktreePath: '/repo/My App',
      branch: 'feat/Foo Bar',
    });
    expect(slug).toMatch(/^[a-z0-9_-]+$/);
  });
  it('project name combines slug and isoKey', () => {
    const r = computeIsolation({ worktreePath: '/repo/foo', branch: 'main' });
    expect(r.project).toBe(`harness_${r.slug}_${r.isoKey}`);
  });
  it('strips leading/trailing hyphens from slug', () => {
    const { slug } = computeIsolation({
      worktreePath: '/repo/--foo--',
      branch: '--bar--',
    });
    expect(slug.startsWith('-')).toBe(false);
    expect(slug.endsWith('-')).toBe(false);
  });
  it('threads through gitSha when provided', () => {
    const r = computeIsolation({ worktreePath: '/r', branch: 'main' }, 'deadbeef');
    expect(r.gitSha).toBe('deadbeef');
  });
  it('defaults gitSha to null when omitted', () => {
    const r = computeIsolation({ worktreePath: '/r', branch: 'main' });
    expect(r.gitSha).toBeNull();
  });
});

describe('detectIsolation', () => {
  it('detects worktree + branch from the live git repo', () => {
    // The test process runs inside the agentic-harness-lab git repo, so
    // detectIsolation should succeed and return a populated Isolation.
    const iso = detectIsolation();
    expect(iso.worktreePath.length).toBeGreaterThan(0);
    expect(iso.branch.length).toBeGreaterThan(0);
    expect(iso.isoKey).toMatch(/^[0-9a-f]{8}$/);
    expect(iso.project.startsWith('harness_')).toBe(true);
    // gitSha is null only on empty repos; this repo has commits.
    expect(iso.gitSha).toMatch(/^[0-9a-f]{40}$/);
  });
});
