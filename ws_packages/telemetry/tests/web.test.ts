import { describe, expect, it } from 'vitest';
import { buildWebTelemetryProviders } from '../src/web.js';

describe('web telemetry builders', () => {
  it('builds trace metric and log providers', () => {
    const providers = buildWebTelemetryProviders({
      service: 'web-svc',
      env: { VITE_OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' },
      instrumentations: [],
    });
    expect(providers.tracerProvider).toBeDefined();
    expect(providers.meterProvider).toBeDefined();
    expect(providers.loggerProvider).toBeDefined();
    expect(providers.instrumentations).toEqual([]);
  });
});
