# harness/inspector

Evidence-capture utilities the agent invokes during the debug-fix-verify loop. All cross-platform Node.

| Script | Purpose |
|---|---|
| `screenshot-pair.mjs` | Capture before/after PNG + LLM-optimized JPEG |
| `record-flow.mjs` | Record a named user-flow as WebM, extract keyframe grid, write events.jsonl |
| `keyframe-grid.mjs` | ffmpeg wrapper: 3×3 keyframe grid from a WebM |

All scripts auto-discover the iso key via `pnpm harness inspect` unless passed `--isoKey=<key>`.

Output goes to `.harness/artifacts/<iso_key>/` (gitignored).

Requires: `ffmpeg` on PATH (`brew install ffmpeg`).

## Companion dirs

- `harness/stack/` — operates the docker-compose service stack
- `harness/hooks/` — pre-commit + test-runner wrappers (Lefthook-driven)
