#!/usr/bin/env node
// test-fitness-functions.mjs
//
// Illustrative tests for the fitness-function scripts in this directory.
// Demonstrates that an isolated, standalone fitness function is testable in
// a way an inline markdown bash block is not. Uses Node's built-in test
// runner (zero dependencies, ships with Node 18+).
//
// Run:
//   node --test test-fitness-functions.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const here = new URL(".", import.meta.url).pathname;

function runScript(scriptName, args = [], env = {}) {
  return spawnSync("node", [join(here, scriptName), ...args], {
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
}

test("check-zero-deps: passes when dependencies block is absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "fitness-test-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "ok" }));
    const result = runScript("check-zero-deps.mjs", [join(dir, "package.json")]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /OK: zero runtime dependencies/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-zero-deps: passes when dependencies block is empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "fitness-test-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "ok", dependencies: {} }));
    const result = runScript("check-zero-deps.mjs", [join(dir, "package.json")]);
    assert.equal(result.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-zero-deps: fails when dependencies block is non-empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "fitness-test-"));
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "bad", dependencies: { lodash: "^4" } }),
    );
    const result = runScript("check-zero-deps.mjs", [join(dir, "package.json")]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL/);
    assert.match(result.stderr, /lodash/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-zero-deps: errors with exit 2 on missing file", () => {
  const result = runScript("check-zero-deps.mjs", ["/nonexistent/package.json"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /error/);
});
