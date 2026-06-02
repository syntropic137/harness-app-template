// telemetry.ts - app-local wrapper around the shared harness telemetry package.
// Loaded via --import so instrumentation is registered before main.ts runs.

import {
  buildNodeAutoInstrumentations,
  buildNodeTelemetryConfig,
  initNodeTelemetry,
  NodeSDK,
  type NodeSdkFactory,
  resolveOtlpBase,
  safeShutdown,
  type TelemetrySdk,
} from '@harness/telemetry/node';
import type { Instrumentation } from '@opentelemetry/instrumentation';

export const endpoint: string = resolveOtlpBase({ env: process.env });
export const serviceName: string = process.env['OTEL_SERVICE_NAME'] ?? 'example-typescript';

export type { TelemetrySdk };

export interface BuildSdkDeps {
  service?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  sdkFactory?: NodeSdkFactory | undefined;
  instrumentationsFactory?: (() => Instrumentation[]) | undefined;
}

export function buildSdk({
  service = serviceName,
  env = process.env,
  sdkFactory = NodeSDK,
  instrumentationsFactory = buildNodeAutoInstrumentations,
}: BuildSdkDeps = {}): TelemetrySdk {
  return new sdkFactory(
    buildNodeTelemetryConfig({
      service,
      env,
      instrumentations: instrumentationsFactory(),
    }),
  );
}

export { safeShutdown };

export interface TelemetryHandle {
  started: boolean;
  sdk?: TelemetrySdk | undefined;
  shutdown: () => Promise<void>;
}

export interface SetupTelemetryDeps {
  env?: Record<string, string | undefined> | undefined;
  sdk?: TelemetrySdk | undefined;
  addSignalHandler?: ((signal: NodeJS.Signals, listener: () => void) => void) | undefined;
  shutdownSignals?: NodeJS.Signals[] | undefined;
}

export function setupTelemetry({
  env = process.env,
  sdk,
  addSignalHandler,
  shutdownSignals,
}: SetupTelemetryDeps = {}): TelemetryHandle {
  return initNodeTelemetry({
    service: serviceName,
    env,
    sdk,
    addSignalHandler,
    shutdownSignals,
  });
}

export const telemetry: TelemetryHandle = setupTelemetry();
export const shutdownTelemetry = (): Promise<void> => telemetry.shutdown();
