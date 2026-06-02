import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Disable telemetry for all tests so the OTEL SDK isn't started.
process.env['HARNESS_TELEMETRY_DISABLED'] = '1';

const { getActiveTraceId, helloWorld, runCli, isScriptEntry } = await import('../src/main.ts');
const {
  buildSdk,
  endpoint,
  safeShutdown,
  serviceName,
  setupTelemetry,
  shutdownTelemetry,
  telemetry,
} = await import('../src/telemetry.ts');

describe('telemetry.ts', () => {
  it('exports the default endpoint and service name', () => {
    expect(endpoint).toBe('http://localhost:4318');
    expect(serviceName).toBe('example-typescript');
  });

  it('exports a telemetry handle reflecting HARNESS_TELEMETRY_DISABLED', () => {
    expect(telemetry.started).toBe(false);
    expect(typeof telemetry.shutdown).toBe('function');
  });

  it('buildSdk accepts a custom sdkFactory + instrumentations', () => {
    const fakeInstr = () => [];
    class FakeSdk {
      readonly opts: unknown;
      constructor(opts: unknown) {
        this.opts = opts;
      }
      start(): void {}
      shutdown(): Promise<void> {
        return Promise.resolve();
      }
    }
    const sdk = buildSdk({
      service: 'svc-x',
      sdkFactory: FakeSdk,
      instrumentationsFactory: fakeInstr,
    });
    const config = (sdk as FakeSdk).opts as {
      resource?: { attributes?: Record<string, unknown> };
      traceExporter?: unknown;
      metricReaders?: unknown[];
      logRecordProcessors?: unknown[];
      instrumentations?: unknown[];
    };
    expect(config.resource?.attributes?.['service.name']).toBe('svc-x');
    expect(config.traceExporter).toBeDefined();
    expect(config.metricReaders).toHaveLength(1);
    expect(config.logRecordProcessors).toHaveLength(1);
    expect(config.instrumentations).toEqual([]);
  });

  it('setupTelemetry returns no-op shutdown when HARNESS_TELEMETRY_DISABLED=1', async () => {
    const sdk = { start: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined) };
    const h = setupTelemetry({
      env: { HARNESS_TELEMETRY_DISABLED: '1' },
      sdk,
      shutdownSignals: [],
    });
    expect(h.started).toBe(false);
    expect(sdk.start).not.toHaveBeenCalled();
    await h.shutdown(); // does nothing; doesn't throw
    expect(sdk.shutdown).not.toHaveBeenCalled();
  });

  it('setupTelemetry starts SDK when enabled and shutdown awaits sdk.shutdown', async () => {
    const sdk = { start: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined) };
    const h = setupTelemetry({ env: {}, sdk, shutdownSignals: [] });
    expect(h.started).toBe(true);
    expect(sdk.start).toHaveBeenCalledOnce();
    await h.shutdown();
    expect(sdk.shutdown).toHaveBeenCalledOnce();
  });

  it('setupTelemetry shutdown swallows SDK rejection (best-effort)', async () => {
    const sdk = { start: vi.fn(), shutdown: vi.fn().mockRejectedValue(new Error('boom')) };
    const h = setupTelemetry({ env: {}, sdk, shutdownSignals: [] });
    await expect(h.shutdown()).resolves.toBeUndefined();
  });

  it('shutdownTelemetry convenience export resolves', async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });

  it('safeShutdown awaits sdk.shutdown', async () => {
    const sdk = { shutdown: vi.fn().mockResolvedValue(undefined) };
    await safeShutdown(sdk);
    expect(sdk.shutdown).toHaveBeenCalledOnce();
  });

  it('safeShutdown swallows sdk rejection (best-effort)', async () => {
    const sdk = { shutdown: vi.fn().mockRejectedValue(new Error('nope')) };
    await expect(safeShutdown(sdk)).resolves.toBeUndefined();
  });

  it('setupTelemetry signal handler delegates to safeShutdown', () => {
    // The handler is attached via process.on; we verify by intercepting the listener.
    const sdk = { start: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined) };
    const h = setupTelemetry({ env: {}, sdk, addSignalHandler: process.on.bind(process) });
    expect(h.started).toBe(true);
    // Find the most-recently-attached SIGTERM listener and invoke it.
    const listeners = process.listeners('SIGTERM');
    const onSig = listeners[listeners.length - 1];
    if (onSig) onSig('SIGTERM');
    expect(sdk.shutdown).toHaveBeenCalled();
    // Clean up to avoid polluting other tests.
    if (onSig) process.removeListener('SIGTERM', onSig);
  });
});

describe('helloWorld', () => {
  let captured: string[];
  let origWrite: typeof process.stdout.write;
  beforeEach(() => {
    captured = [];
    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => {
      captured.push(s);
      return true;
    }) as typeof process.stdout.write;
  });
  afterEach(() => {
    process.stdout.write = origWrite;
  });

  it('returns a structured message and writes a JSON line', async () => {
    const result = await helloWorld();
    expect(result.service).toBe('example-typescript');
    expect(result.msg).toMatch(/hello from example-typescript/);
    expect(result.severity).toBe('INFO');
    expect(result.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(captured.join('')).toMatch(/hello from example-typescript/);
  });
});

describe('runCli', () => {
  it('returns exit code 0 on happy path', async () => {
    const hello = vi.fn().mockResolvedValue({});
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const writeErr = vi.fn();
    const code = await runCli({ hello, shutdown, writeErr });
    expect(code).toBe(0);
    expect(hello).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(writeErr).not.toHaveBeenCalled();
  });

  it('returns exit code 1 + writes error on failure', async () => {
    const hello = vi.fn().mockRejectedValue(new Error('boom'));
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const writeErr = vi.fn();
    const code = await runCli({ hello, shutdown, writeErr });
    expect(code).toBe(1);
    expect(writeErr).toHaveBeenCalledOnce();
    expect(writeErr.mock.calls[0]?.[0]).toMatch(/error: /);
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('writeErr defaults to process.stderr.write when not injected', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const hello = vi.fn().mockRejectedValue(new Error('msg-only'));
    const shutdown = vi.fn().mockResolvedValue(undefined);
    await runCli({ hello, shutdown });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('falls back to message-only when err.stack is missing', async () => {
    const hello = vi.fn().mockRejectedValue({ message: 'stackless' });
    const writeErr = vi.fn();
    const code = await runCli({ hello, shutdown: vi.fn(), writeErr });
    expect(code).toBe(1);
    expect(writeErr.mock.calls[0]?.[0]).toContain('stackless');
  });

  it('falls back to String(err) when err has neither stack nor message', async () => {
    const hello = vi.fn().mockRejectedValue('plain-string-error');
    const writeErr = vi.fn();
    const code = await runCli({ hello, shutdown: vi.fn(), writeErr });
    expect(code).toBe(1);
    expect(writeErr.mock.calls[0]?.[0]).toContain('plain-string-error');
  });
});

describe('getActiveTraceId', () => {
  it('returns empty string when no active span', () => {
    expect(getActiveTraceId({ getSpan: () => undefined, ctx: () => ({}) as never })).toBe('');
  });
  it('returns the trace id when a span is active', () => {
    const span = { spanContext: () => ({ traceId: 'abc123' }) } as never;
    expect(getActiveTraceId({ getSpan: () => span, ctx: () => ({}) as never })).toBe('abc123');
  });
  it('default args do not throw', () => {
    expect(typeof getActiveTraceId()).toBe('string');
  });
});

describe('isScriptEntry', () => {
  it('returns true when meta.url === file://argv[1]', () => {
    expect(isScriptEntry({ url: 'file:///foo/main.ts' }, ['node', '/foo/main.ts'])).toBe(true);
  });
  it('returns false when meta.url differs from argv[1]', () => {
    expect(isScriptEntry({ url: 'file:///foo/main.ts' }, ['node', '/bar/other.ts'])).toBe(false);
  });
  it('default args do not throw (we are running under vitest, so result is false)', () => {
    expect(typeof isScriptEntry()).toBe('boolean');
  });
});
