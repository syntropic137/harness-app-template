import { describe, expect, it, vi } from 'vitest';
import { buildNodeTelemetryConfig, initNodeTelemetry, safeShutdown } from '../src/node.js';

describe('node telemetry builders', () => {
  it('builds traces metrics and logs config', () => {
    const config = buildNodeTelemetryConfig({
      service: 'node-svc',
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' },
      instrumentations: [],
    });
    expect(config.resource?.attributes['service.name']).toBe('node-svc');
    expect(config.traceExporter).toBeDefined();
    expect(config.metricReaders).toHaveLength(1);
    expect(config.logRecordProcessors).toHaveLength(1);
    expect(config.instrumentations).toEqual([]);
  });

  it('does not start when telemetry is disabled', async () => {
    const sdk = { start: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined) };
    const handle = initNodeTelemetry({ env: { HARNESS_TELEMETRY_DISABLED: '1' }, sdk });
    expect(handle.started).toBe(false);
    expect(sdk.start).not.toHaveBeenCalled();
    await handle.shutdown();
    expect(sdk.shutdown).not.toHaveBeenCalled();
  });

  it('starts and registers shutdown signal handlers when enabled', async () => {
    const sdk = { start: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined) };
    const addSignalHandler = vi.fn();
    const handle = initNodeTelemetry({
      env: {},
      sdk,
      addSignalHandler,
      shutdownSignals: ['SIGTERM', 'SIGINT'],
    });
    expect(handle.started).toBe(true);
    expect(sdk.start).toHaveBeenCalledOnce();
    expect(addSignalHandler).toHaveBeenCalledTimes(2);
    await handle.shutdown();
    expect(sdk.shutdown).toHaveBeenCalledOnce();
  });

  it('can build an SDK through an injected factory', () => {
    const start = vi.fn();
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const SdkFactory = vi.fn().mockImplementation(() => ({ start, shutdown }));
    const handle = initNodeTelemetry({
      env: {},
      sdkFactory: SdkFactory,
      instrumentations: [],
      shutdownSignals: [],
    });
    expect(handle.started).toBe(true);
    expect(SdkFactory).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });

  it('safeShutdown swallows shutdown failures', async () => {
    await expect(
      safeShutdown({ shutdown: vi.fn().mockRejectedValue(new Error('boom')) }),
    ).resolves.toBeUndefined();
  });
});
