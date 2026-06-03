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
import { existsSync } from 'node:fs';

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
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
