#!/usr/bin/env node
// check-tree-depth.mjs
//
// Illustrative fitness function: fails when any direct dependency has more
// than MAX_DEPTH levels of transitives. MAX_DEPTH=1 enforces the
// one-layer-deep heuristic; higher values are acceptable for projects with
// broader dependency budgets.
//
// This file is illustrative, not load-bearing. The output of `npm ls --json`
// is used as the tree source; for pnpm/yarn projects, swap the command.
// Cross-platform by construction (Node stdlib only).
//
// Usage:
//   MAX_DEPTH=1 node check-tree-depth.mjs
// Exit codes:
//   0  every direct dep stays within MAX_DEPTH
//   1  one or more direct deps exceed MAX_DEPTH
//   2  could not run npm ls or parse its output
//
// Useful threshold values:
//   1    strict one-layer-deep stance (only direct deps with no transitives)
//   3    pragmatic mid-range; catches the "100+ transitives" red flag
//   none no fitness function (typical default; reasonable for app code)
//
// See the SLP at ../../SKILL.md (principle 10) and the deep-dive README in
// the parent directory for the rationale.

import { spawnSync } from "node:child_process";

const MAX_DEPTH = Number(process.env.MAX_DEPTH ?? "1");
if (!Number.isFinite(MAX_DEPTH) || MAX_DEPTH < 0) {
  console.error(`error: MAX_DEPTH must be a non-negative integer (got ${process.env.MAX_DEPTH})`);
  process.exit(2);
}

// `npm ls --all --json` may exit non-zero when peer-dep warnings exist; we
// still parse stdout because the JSON tree is what we care about.
const result = spawnSync("npm", ["ls", "--all", "--json"], { encoding: "utf-8" });
if (!result.stdout) {
  console.error("error: could not run `npm ls --all --json`");
  console.error(result.stderr ?? "(no stderr)");
  process.exit(2);
}

let tree;
try {
  tree = JSON.parse(result.stdout);
} catch (err) {
  console.error("error: could not parse `npm ls` output as JSON");
  console.error(`  ${err.message}`);
  process.exit(2);
}

function depth(node) {
  const children = node.dependencies ?? {};
  const names = Object.keys(children);
  if (names.length === 0) return 0;
  let max = 0;
  for (const name of names) {
    const childDepth = 1 + depth(children[name]);
    if (childDepth > max) max = childDepth;
  }
  return max;
}

const directs = tree.dependencies ?? {};
const violations = [];
for (const [name, node] of Object.entries(directs)) {
  const observed = depth(node);
  if (observed > MAX_DEPTH) {
    violations.push({ name, depth: observed });
  }
}

if (violations.length === 0) {
  console.log(`OK: tree depth within budget (MAX_DEPTH=${MAX_DEPTH}).`);
  process.exit(0);
}

console.error(`FAIL: dependency tree depth exceeds MAX_DEPTH=${MAX_DEPTH}`);
console.error("  Direct dependencies with deeper transitive trees:");
for (const v of violations) {
  console.error(`    ${v.name}\tdepth=${v.depth}`);
}
console.error("  Either pick a lighter alternative or raise MAX_DEPTH intentionally.");
process.exit(1);
