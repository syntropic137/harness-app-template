// main.ts — minimal hello-world that emits one trace + one log line.
//
// Run with:   pnpm --filter @example/typescript start
//
// Then query via the observability-queries skill:
//   curl http://localhost:9428/select/logsql/query -d 'query=service:example-typescript'
//   curl http://localhost:9428/select/tempo/api/search?service=example-typescript
//
// Design note: every code path is reachable from `helloWorld` or `runCli` so
// unit tests can hit 100% lines/branches/functions without spawning a
// subprocess. The script-entry block delegates to `runCli`.

import { type Context, context, type Span, trace } from '@opentelemetry/api';
import { serviceName, shutdownTelemetry } from './telemetry.ts';

const tracer = trace.getTracer(serviceName, '0.1.0');

export interface HelloMessage {
  time: string;
  severity: 'INFO';
  service: string;
  traceId: string;
  msg: string;
}

export interface GetActiveTraceIdDeps {
  getSpan?: (c: Context) => Span | undefined;
  ctx?: () => Context;
}

/**
 * Returns the active trace ID or empty string when no span is active.
 * Extracted as a named function so unit tests can cover both branches
 * of the optional chain without mocking the OTEL global state.
 */
export function getActiveTraceId({
  getSpan = (c: Context) => trace.getSpan(c),
  ctx = () => context.active(),
}: GetActiveTraceIdDeps = {}): string {
  const span = getSpan(ctx());
  return span ? span.spanContext().traceId : '';
}

export async function helloWorld(): Promise<HelloMessage> {
  return tracer.startActiveSpan('hello-world', async (span) => {
    span.setAttribute('greeting', 'hi from the harness');
    // Spans in 2026 OTEL also accept events; we emit a Pino-shaped log line on
    // stdout that the OTEL Collector's filelog receiver can scrape.
    const msg: HelloMessage = {
      time: new Date().toISOString(),
      severity: 'INFO',
      service: serviceName,
      traceId: getActiveTraceId(),
      msg: 'hello from example-typescript',
    };
    process.stdout.write(`${JSON.stringify(msg)}\n`);
    span.end();
    return msg;
  });
}

export interface RunCliDeps {
  hello?: () => Promise<HelloMessage>;
  shutdown?: () => Promise<void>;
  writeErr?: (s: string) => void;
}

/**
 * CLI runner — testable. Returns the exit code; the script-entry block
 * passes that to `process.exit()`.
 */
export async function runCli({
  hello = helloWorld,
  shutdown = shutdownTelemetry,
  writeErr = (s: string): void => {
    process.stderr.write(s);
  },
}: RunCliDeps = {}): Promise<number> {
  try {
    await hello();
    // BatchSpanProcessor needs an explicit flush — `process.exit()` skips
    // `beforeExit`. Without this, the span never reaches the collector.
    await shutdown();
    return 0;
  } catch (err) {
    const e = err as { stack?: string; message?: string };
    writeErr(`error: ${e.stack ?? e.message ?? String(err)}\n`);
    await shutdown();
    return 1;
  }
}

/**
 * True when this module is being executed as a script (vs imported).
 * Exported so the test suite can verify the predicate logic without
 * actually invoking process.exit.
 */
export function isScriptEntry(
  meta: { url: string } = import.meta,
  argv: string[] = process.argv,
): boolean {
  return meta.url === `file://${argv[1]}`;
}

/* c8 ignore start — Reason: these 3 lines fire only when the module is run
   as a script (not when imported by tests). `isScriptEntry()` itself IS
   unit-tested above; this block only wires it up. Excluding this from
   coverage is the standard pattern for ESM module-as-script entrypoints.
   Integration tests in tests/integration/ cover the live behavior. */
if (isScriptEntry()) {
  runCli().then((code) => process.exit(code));
}
/* c8 ignore stop */
