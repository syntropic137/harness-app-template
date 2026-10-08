import type { LandConfig } from './config';

/** Paths whose change can alter how landing itself behaves. Never configurable away. */
export const ALWAYS_FULL_GLOBS: readonly string[] = [
  'land.config.json',
  'lefthook.yml',
  'scripts/land.ts',
  'scripts/lib/land/**',
];

const REGEX_SPECIALS = /[.+^${}()|[\]\\]/g;

/** Glob to RegExp. `**` crosses directories, `*` and `?` do not. */
/** Translate the glob token at `i`; returns the regex source and how many characters it consumed. */
function translateToken(glob: string, i: number): [source: string, consumed: number] {
  const ch = glob.charAt(i);
  if (ch === '*' && glob.charAt(i + 1) === '*') {
    return glob.charAt(i + 2) === '/' ? ['(?:.*/)?', 3] : ['.*', 2];
  }
  if (ch === '*') return ['[^/]*', 1];
  if (ch === '?') return ['[^/]', 1];
  return [ch.replace(REGEX_SPECIALS, '\\$&'), 1];
}

export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; ) {
    const [source, consumed] = translateToken(glob, i);
    out += source;
    i += consumed;
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

export interface Classification {
  /** True when the diff must run every gate (unknown path, full-scope path, no readable diff). */
  full: boolean;
  scopes: string[];
  /** Why `full` is set, for the printed plan. Empty when it is not. */
  reasons: string[];
}

/**
 * Map changed files to scopes. When unsure, run everything: `null` (diff could
 * not be read), an empty list, a path in the full set, or a path that no scope
 * claims all select the full suite.
 */
export function classify(files: readonly string[] | null, config: LandConfig): Classification {
  if (files === null) {
    return { full: true, scopes: [], reasons: ['changed files could not be read'] };
  }
  if (files.length === 0) {
    return { full: true, scopes: [], reasons: ['empty file list'] };
  }
  const fullGlobs = [...ALWAYS_FULL_GLOBS, ...config.full];
  const scopes = new Set<string>();
  const reasons: string[] = [];
  for (const file of files) {
    if (matchesAny(file, fullGlobs)) {
      reasons.push(`${file} is in the full scope`);
      continue;
    }
    const hits = Object.entries(config.scopes)
      .filter(([, globs]) => matchesAny(file, globs))
      .map(([name]) => name);
    if (hits.length === 0) {
      reasons.push(`${file} is not mapped to any scope`);
    }
    for (const hit of hits) {
      scopes.add(hit);
    }
  }
  return { full: reasons.length > 0, scopes: [...scopes].sort(), reasons };
}

export function gateApplies(when: readonly string[] | undefined, c: Classification): boolean {
  if (c.full || when === undefined) {
    return true;
  }
  return when.some((scope) => c.scopes.includes(scope));
}
