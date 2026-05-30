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

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: keyframe-grid.mjs <input.webm> <output.jpg>');
  process.exit(2);
}
if (!existsSync(input)) {
  console.error(`input not found: ${input}`);
  process.exit(2);
}

const ffmpeg = spawnSync(
  'ffmpeg',
  ['-y', '-i', input, '-vf', 'fps=1,scale=640:360,tile=3x3', '-frames:v', '1', '-q:v', '4', output],
  { stdio: 'inherit' },
);

if (ffmpeg.error) {
  console.error(`ffmpeg failed to launch: ${ffmpeg.error.message}`);
  console.error('Install ffmpeg via `brew install ffmpeg` or your package manager.');
  process.exit(127);
}
process.exit(ffmpeg.status ?? 1);
