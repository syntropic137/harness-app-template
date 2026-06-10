# Friction log

- [tooling-bug] EXP-01: APSS doc gate fails on clean clone with "Composed binary not found at .apss/bin/apss", suggesting an extra bootstrap/install step is required before doc-validator --apss can run.
- [tooling-bug] EXP-02: Fresh stack boot attempt fails without `just bootstrap`; missing `node_modules/.bin/tsx` blocks first `just stack boot`.
- [tooling-bug] EXP-02: `loki`/logs query returned empty response during one end-to-end run even after successful trace emission and query of `VT_PORT`; app log ingestion path may need a delay or query form adjustment.
- [workflow-friction] EXP-03: Inconsistent first command form for env+time invocation (`/usr/bin/time -f` with inline env var) caused one failed run before successful backend verification.
- [tooling-bug] EXP-04: Inspector UI automation stack missing `playwright`, causing `just inspector screenshot-pair` to fail.
- [tooling-bug] EXP-05: LokI log-sql endpoint returned no rows during trace emission probes; only traces endpoint delivered structured service data.
