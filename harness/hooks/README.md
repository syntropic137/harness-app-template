# harness/hooks

Pre-commit guardrails and test-runner wrappers. Wired via `lefthook.yml`. All cross-platform Node.

| Script | Purpose |
|---|---|
| `check-staged-size.mjs` | Pre-commit guardrail: block large files (default 1MB/file, 5MB total). Bypass: `HARNESS_SIZE_GUARDRAIL_BYPASS=1`. |
| `track-perf.mjs` | Wrap a test command; append `duration_ms,exit,counts` to `metrics/test-performance.csv` |

## Companion dirs

- `harness/stack/` — operates the docker-compose service stack
- `harness/inspector/` — evidence capture (Playwright + ffmpeg)
