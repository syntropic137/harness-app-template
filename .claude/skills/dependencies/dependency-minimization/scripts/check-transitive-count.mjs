#!/usr/bin/env node
// check-transitive-count.mjs
//
// Illustrative fitness function: fails when the total number of resolved
// packages exceeds MAX_PACKAGES. Useful for libraries where the failure mode
// is a slowly-creeping count rather than tree depth.
//
// This file is illustrative, not load-bearing. The output of `npm ls --json`
// is used as the tree source; for pnpm/yarn projects, swap the command.
// Cross-platform by construction (Node stdlib only).
//
// Usage:
//   MAX_PACKAGES=50 node check-transitive-count.mjs
// Exit codes:
//   0  count is within budget
//   1  count exceeds MAX_PACKAGES
//   2  could not run npm ls or parse its output
//
// The budget is a ratchet, not a freeze: it is set at a level the project is
// comfortable with and raised intentionally as scope grows. The point is to
// make every increase a deliberate decision, not to keep the number constant
// forever.
//
// See the SLP at ../../SKILL.md (principle 10) and the deep-dive README in
// the parent directory for the rationale.

import { spawnSync } from "node:child_process";

const MAX_PACKAGES = Number(process.env.MAX_PACKAGES ?? "50");
if (!Number.isFinite(MAX_PACKAGES) || MAX_PACKAGES < 0) {
  console.error(`error: MAX_PACKAGES must be a non-negative integer (got ${process.env.MAX_PACKAGES})`);
  process.exit(2);
}

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

// Count every node that has a "version" field, excluding the root.
function countResolved(node, isRoot = true) {
  let count = isRoot ? 0 : node.version ? 1 : 0;
  const children = node.dependencies ?? {};
  for (const child of Object.values(children)) {
    count += countResolved(child, false);
  }
  return count;
}

const count = countResolved(tree);

if (count <= MAX_PACKAGES) {
  console.log(`OK: ${count} packages, within budget of ${MAX_PACKAGES}.`);
  process.exit(0);
}

console.error(`FAIL: total resolved package count ${count} exceeds budget ${MAX_PACKAGES}`);
console.error("  Run `npm ls --all` to see the full tree.");
console.error("  Either justify the new count and raise the budget in this script,");
console.error("  or reduce dependencies to fit within the existing budget.");
process.exit(1);
