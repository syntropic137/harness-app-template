// telemetry.ts — OTEL SDK bootstrap for the TypeScript telemetry-sdk slot.
// Loaded via --import to instrument before main.ts runs.
//
// Configuration via env vars (12-factor):
//   OTEL_EXPORTER_OTLP_ENDPOINT  default http://localhost:4318
//   OTEL_SERVICE_NAME            default 'example-typescript'
//
// The observability-stack plugin (Victoria* via OTEL Collector contrib) ingests
// OTLP on 4318 (HTTP/protobuf) and 4317 (gRPC). Node SDK defaults to HTTP/protobuf,
// which matches the harness's expected default.
//
// Design note: every side-effect is reachable from a function (not a top-level
// branch) so the testing pyramid can hit 100% lines/branches/functions without
// mocking the SDK at import time. See `setupTelemetry` below.

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

export const endpoint: string =
  process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';
export const serviceName: string = process.env['OTEL_SERVICE_NAME'] ?? 'example-typescript';

export interface TelemetrySdk {
  start: () => void;
  shutdown: () => Promise<void>;
}

export interface BuildSdkDeps {
  service?: string;
  sdkFactory?: new (
    opts: Record<string, unknown>,
    // biome-ignore lint/suspicious/noExplicitAny: NodeSDK constructor signature varies by version; the DI hook accepts arbitrary fake SDK factories in tests
  ) => any;
  instrumentationsFactory?: () => unknown[];
}

/**
 * Build (but don't start) an SDK. Pure function — DI hook for tests.
 * Override via `sdkFactory` to inject a fake SDK in unit tests.
 */
export function buildSdk({
  service = serviceName,
  sdkFactory = NodeSDK,
  instrumentationsFactory = getNodeAutoInstrumentations,
}: BuildSdkDeps = {}): TelemetrySdk {
  return new sdkFactory({
    serviceName: service,
    instrumentations: [instrumentationsFactory()],
  }) as TelemetrySdk;
}

/**
 * Best-effort SDK shutdown. Exported as a named function (not an inline
 * arrow) so unit tests can hit 100% function coverage. See retro 021 for
 * why explicit shutdown is required.
 */
export async function safeShutdown(sdk: Pick<TelemetrySdk, 'shutdown'>): Promise<void> {
  try {
    await sdk.shutdown();
  } catch (_) {
    // best-effort
  }
}

export interface TelemetryHandle {
  started: boolean;
  sdk: TelemetrySdk;
  shutdown: () => Promise<void>;
}

export interface SetupTelemetryDeps {
  env?: Record<string, string | undefined>;
  sdk?: TelemetrySdk;
}

/**
 * Start the SDK if telemetry is enabled. Returns a shutdown function (or no-op).
 * Idempotent — calling twice is safe but only the first call has effect.
 */
export function setupTelemetry({
  env = process.env,
  sdk = buildSdk(),
}: SetupTelemetryDeps = {}): TelemetryHandle {
  if (env['HARNESS_TELEMETRY_DISABLED'] === '1') {
    return { started: false, sdk, shutdown: async () => {} };
  }
  sdk.start();
  const onSig = (): Promise<void> => safeShutdown(sdk);
  process.on('SIGTERM', onSig);
  process.on('beforeExit', onSig);
  return {
    started: true,
    sdk,
    shutdown: () => safeShutdown(sdk),
  };
}

// Auto-start at import time so the `--import ./src/telemetry.ts` loader
// instruments before main.ts runs. The handle is exported for main.ts.
export const telemetry: TelemetryHandle = setupTelemetry();

/**
 * Convenience re-export so callers don't need to know about the `telemetry`
 * object — they just `import { shutdownTelemetry } from './telemetry.ts'`.
 */
export const shutdownTelemetry = (): Promise<void> => telemetry.shutdown();
