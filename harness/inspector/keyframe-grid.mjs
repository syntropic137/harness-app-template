#!/usr/bin/env node
// keyframe-grid — emit a 3×3 keyframe grid (1 fps sample) from a webm/mp4.
//
// Cross-platform Node port of the original keyframe-grid.sh.
// Requires `ffmpeg` on PATH (same as the shell version).
//
// Usage: node keyframe-grid.mjs <input.webm> <output.jpg>
//
// Used by the agent-side debugging skills to reduce a recording into a
// single tileable image (~5,000 tokens vs ~50,000 for full webm).

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Canonicalize both sides of the entrypoint check so the script runs
// when invoked through a path containing spaces (Bun/Node URL-encode
// the space as %20 in import.meta.url but leave process.argv[1] raw)
// or a symlinked checkout. See scripts/lib/entrypoint.ts.
/* v8 ignore start -- entrypoint guard; covered by scripts/tests/entrypoint.test.ts via the TS helper sibling. */
function isScriptEntry() {
  const argv = process.argv[1];
  if (!argv) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv);
  } catch {
    return false;
  }
}
/* v8 ignore stop */

export function main(argv = process.argv.slice(2), deps = { console, existsSync, spawnSync }) {
  const [input, output] = argv;
  if (!input || !output) {
    deps.console.error('usage: keyframe-grid.mjs <input.webm> <output.jpg>');
    return 2;
  }
  if (!deps.existsSync(input)) {
    deps.console.error(`input not found: ${input}`);
    return 2;
  }

  const ffmpeg = deps.spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      input,
      '-vf',
      'fps=1,scale=640:360,tile=3x3',
      '-frames:v',
      '1',
      '-q:v',
      '4',
      output,
    ],
    { stdio: 'inherit' },
  );

  if (ffmpeg.error) {
    deps.console.error(`ffmpeg failed to launch: ${ffmpeg.error.message}`);
    deps.console.error('Install ffmpeg via `brew install ffmpeg` or your package manager.');
    return 127;
  }
  return ffmpeg.status ?? 1;
}

/* v8 ignore next 4 */
if (isScriptEntry()) {
  process.exit(main());
}
