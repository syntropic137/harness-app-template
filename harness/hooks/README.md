# harness/hooks

Pre-commit guardrails and test-runner wrappers. Wired via `lefthook.yml`. All cross-platform Node.

| Script | Purpose |
|---|---|
| `check-staged-size.mjs` | Pre-commit guardrail: block large files (default 1MB/file, 5MB total). Bypass: `HARNESS_SIZE_GUARDRAIL_BYPASS=1`. |
| `template-hygiene-gate.mjs` | Pre-commit guardrail: when a staged change touches a hygiene-critical surface (`lefthook.yml`, `justfile`, `harness/hooks/`, `scripts/{init,update,bootstrap}.ts`, `scripts/lib/`), structurally validate the chain (lefthook config, justfile parse, hook-script syntax). Bypass: `HARNESS_HYGIENE_SKIP=1`. Deep fork-readiness stays in `just fork-check`. |
| `track-perf.mjs` | Wrap a test command; append `duration_ms,exit,counts` to `metrics/test-performance.csv` |

Unit tests live in `tests/` (node:test); they run via the glob-gated `hook-tests` pre-commit command whenever a `harness/hooks` script changes, or manually via `node --test 'harness/hooks/tests/*.test.mjs'`.

## Companion dirs

- `harness/stack/` — operates the docker-compose service stack
- `harness/inspector/` — evidence capture (Playwright + ffmpeg)
