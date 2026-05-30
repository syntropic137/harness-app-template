#!/usr/bin/env node
// Build a standalone harness binary via `bun build --compile`.
// Usage: node scripts/build-binary.mjs [--target=<bun-target>] [--outfile=<path>]
// Default target: native (host platform). Pass --target=bun-linux-x64 for cross-compile.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stackRoot = resolve(__dirname, '..');
const repoRoot = resolve(stackRoot, '..', '..');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const target = getArg('target', '');
const outfile = resolve(repoRoot, getArg('outfile', './dist-binary/harness'));
const entry = resolve(stackRoot, 'bin/harness.ts');

mkdirSync(dirname(outfile), { recursive: true });

const bunArgs = ['build', '--compile', entry, '--outfile', outfile];
if (target) bunArgs.push(`--target=${target}`);

console.log(`[build-binary] bun ${bunArgs.join(' ')}`);
const t0 = Date.now();
const res = spawnSync('bun', bunArgs, { stdio: 'inherit', cwd: repoRoot });
const wallMs = Date.now() - t0;

if (res.status !== 0) {
  console.error(`[build-binary] FAILED (exit ${res.status}) in ${wallMs}ms`);
  process.exit(res.status ?? 1);
}

if (!existsSync(outfile)) {
  console.error(`[build-binary] no artifact at ${outfile}`);
  process.exit(1);
}

const size = statSync(outfile).size;
const sha = createHash('sha256').update(readFileSync(outfile)).digest('hex');
const mb = (size / (1024 * 1024)).toFixed(2);

console.log(`[build-binary] OK`);
console.log(`  target:   ${target || 'native'}`);
console.log(`  outfile:  ${outfile}`);
console.log(`  size:     ${size} bytes (${mb} MB)`);
console.log(`  sha256:   ${sha}`);
console.log(`  wallMs:   ${wallMs}`);
console.log(`  wallSec:  ${(wallMs / 1000).toFixed(2)}`);
