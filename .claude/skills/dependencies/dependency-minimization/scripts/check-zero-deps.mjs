#!/usr/bin/env node
// check-zero-deps.mjs
//
// Illustrative fitness function: fails when package.json grows a runtime
// "dependencies" block. devDependencies are allowed (build/test tooling does
// not ship to users).
//
// This file is illustrative, not load-bearing. Copy and adapt to fit your
// project layout. The pattern is what matters: a stated minimization rule
// becomes a CI fitness function so the rule cannot decay one PR at a time.
//
// Cross-platform by construction (Node stdlib only). Eats its own dogfood:
// this script depends on nothing outside Node, matching the rule it enforces.
//
// Usage:
//   node check-zero-deps.mjs [path/to/package.json]
// Exit codes:
//   0  zero runtime dependencies (rule satisfied)
//   1  one or more runtime dependencies present (rule violated)
//   2  package.json could not be read or parsed
//
// See the SLP at ../../SKILL.md (principle 10) and the deep-dive README in
// the parent directory for the rationale.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.argv[2] ?? "package.json");

let pkg;
try {
  pkg = JSON.parse(readFileSync(target, "utf-8"));
} catch (err) {
  console.error(`error: could not read or parse ${target}`);
  console.error(`  ${err.message}`);
  process.exit(2);
}

const deps = pkg.dependencies ?? {};
const names = Object.keys(deps);

if (names.length === 0) {
  console.log("OK: zero runtime dependencies.");
  process.exit(0);
}

console.error("FAIL: this package commits to zero runtime dependencies.");
console.error(`  Found ${names.length} entr${names.length === 1 ? "y" : "ies"} in ${target} -> dependencies:`);
for (const name of names) {
  console.error(`    ${name}`);
}
console.error("  If a runtime dependency is genuinely required, raise it in");
console.error("  the PR description and propose lifting the zero-dep constraint.");
process.exit(1);
