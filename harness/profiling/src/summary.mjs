// harness/profiling/src/summary.mjs - terse table over a profile verdict
// (bead create-harness-app-z41).
//
// `profile summary [<artifact dir>]` prints the per-signal verdict table
// for one run. With no argument it picks the newest run directory under
// the artifact root, so `just profile summary` after any runner shows the
// result an agent needs without parsing JSON.

import { join } from 'node:path';
import { renderGateReport } from './gate.mjs';
import { isScriptEntry, makeNodeIo, parseArgs, runAsEntry } from './lib.mjs';

export const DEFAULT_ARTIFACT_ROOT = '.harness/artifacts/profile';

/** Newest run directory under root by the sortable iso-key prefix. */
export function latestRunDir(io, root) {
  if (!io.fileExists(root)) {
    return null;
  }
  const dirs = io
    .listDir(root)
    .filter((name) => io.isDirectory(join(root, name)))
    .sort();
  return dirs.length === 0 ? null : join(root, dirs[dirs.length - 1]);
}

export async function main(argv = process.argv.slice(2), io = makeNodeIo()) {
  const { flags, positional } = parseArgs(argv);
  const root =
    typeof flags['artifact-root'] === 'string' ? flags['artifact-root'] : DEFAULT_ARTIFACT_ROOT;
  const dir = positional[0] ?? latestRunDir(io, root);
  if (dir === null) {
    io.writeErr(`profile summary: no profile runs under ${root}; run just profile first\n`);
    return 2;
  }
  const verdictPath = join(dir, 'verdict.json');
  if (!io.fileExists(verdictPath)) {
    io.writeErr(`profile summary: ${verdictPath} not found\n`);
    return 2;
  }
  let verdict;
  try {
    verdict = JSON.parse(io.readFile(verdictPath));
  } catch (err) {
    io.writeErr(`profile summary: ${verdictPath} is not valid JSON (${err.message})\n`);
    return 2;
  }
  io.write(`profile run: ${dir}\n`);
  io.write(
    `mode: ${verdict.mode}  captured: ${verdict.capturedAt}  trace: ${verdict.traceId ?? 'n/a'}\n`,
  );
  io.write(renderGateReport(verdict.gate));
  if (Array.isArray(verdict.artifacts) && verdict.artifacts.length > 0) {
    io.write(`artifacts: ${verdict.artifacts.join(', ')}\n`);
  }
  return 0;
}

/* node:coverage ignore next 3 */
if (isScriptEntry(import.meta.url)) {
  runAsEntry(main);
}
