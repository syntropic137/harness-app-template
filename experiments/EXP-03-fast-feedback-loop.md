# EXP-03 fast-feedback-loop
# CLAIM: 2026-06-10T02:00:00Z by Codex

## Hypothesis (frozen)
The harness lets an agent apply a backend change and a UI change and observe both outputs quickly with local commands, without manual orchestration.

## Prediction
A one-line backend change plus one-line UI change each complete with a run-time observable signal within 90 seconds total.

## Probe plan
1. Change backend payload in `ws_apps/example-typescript/src/main.ts` and run it once.
2. Change a visible UI string in `ws_apps/docs/app/page.tsx` and run docs build/dev.
3. Measure time-to-first-visible output for both steps.
4. Record whether observation and loop feel mechanical (no extra docs lookup needed).

## Probe output
```text
$ env OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm --filter @example/typescript emit
$ node --import tsx --import ./src/telemetry.ts src/main.ts
{"time":"2026-06-10T01:50:48.169Z","severity":"INFO","service":"example-typescript","traceId":"24a7359a85079c59966b2b930f33d7eb","msg":"hello harness loop probe"}

$ pnpm --filter @harness/docs dev -p 3002
... Next.js server boot ...
$ curl -s http://127.0.0.1:3002 | grep -q 'Fast-feedback-loop probe banner.' && echo FOUND
FOUND
```

## Verdict
PARTIAL

Prediction outcome:
- Backend change was visible immediately in JSON output with one command.
- UI change was visible via local page response.
- End-to-end path needed one correction to command syntax to correctly inject environment variables.

Evidence count:
- N=1, low
