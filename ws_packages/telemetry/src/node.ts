import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK, type NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import type { Env, ResourceOpts } from './resource.js';
import {
  buildOtlpSignalEndpoints,
  buildResource,
  resolveOtlpBase,
  resolveServiceName,
} from './resource.js';

export type TelemetrySdk = Pick<NodeSDK, 'start' | 'shutdown'>;
export type NodeSdkFactory = new (config: Partial<NodeSDKConfiguration>) => TelemetrySdk;

export { NodeSDK };

export interface NodeTelemetryConfigOpts extends ResourceOpts {
  env?: Env | undefined;
  otlpBase?: string | undefined;
  metricExportIntervalMillis?: number | undefined;
  instrumentations?: Instrumentation[] | undefined;
}

export interface NodeTelemetryInitOpts extends NodeTelemetryConfigOpts {
  disabled?: boolean | undefined;
  sdk?: TelemetrySdk | undefined;
  sdkFactory?: NodeSdkFactory | undefined;
  addSignalHandler?: ((signal: NodeJS.Signals, listener: () => void) => void) | undefined;
  shutdownSignals?: NodeJS.Signals[] | undefined;
}

export interface NodeTelemetryHandle {
  started: boolean;
  sdk?: TelemetrySdk | undefined;
  shutdown: () => Promise<void>;
}

const DISABLED_NODE_INSTRUMENTATIONS = [
  '@opentelemetry/instrumentation-dns',
  '@opentelemetry/instrumentation-net',
];

export { resolveOtlpBase, resolveServiceName };

function telemetryDisabled(options: NodeTelemetryInitOpts, env: Env): boolean {
  if (options.disabled !== undefined) {
    return options.disabled;
  }
  return env['HARNESS_TELEMETRY_DISABLED'] === '1';
}

function createNodeSdk(options: NodeTelemetryInitOpts): TelemetrySdk {
  if (options.sdk) {
    return options.sdk;
  }
  const SdkFactory = options.sdkFactory ?? NodeSDK;
  return new SdkFactory(buildNodeTelemetryConfig(options));
}

function addProcessSignalHandler(signal: NodeJS.Signals, listener: () => void): void {
  process.on(signal, listener);
}

function registerShutdownHandlers(sdk: TelemetrySdk, options: NodeTelemetryInitOpts): void {
  const addSignalHandler = options.addSignalHandler ?? addProcessSignalHandler;
  for (const signal of options.shutdownSignals ?? ['SIGTERM']) {
    addSignalHandler(signal, () => {
      void safeShutdown(sdk);
    });
  }
}

export function buildNodeAutoInstrumentations(): Instrumentation[] {
  return getNodeAutoInstrumentations(
    Object.fromEntries(DISABLED_NODE_INSTRUMENTATIONS.map((name) => [name, { enabled: false }])),
  ) as Instrumentation[];
}

export function buildNodeTelemetryConfig(
  options: NodeTelemetryConfigOpts = {},
): Partial<NodeSDKConfiguration> {
  const env = options.env ?? process.env;
  const endpoints = buildOtlpSignalEndpoints({ env, base: options.otlpBase });
  return {
    resource: buildResource(options, env),
    traceExporter: new OTLPTraceExporter({ url: endpoints.traces }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: endpoints.metrics }),
        exportIntervalMillis: options.metricExportIntervalMillis ?? 10_000,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor(new OTLPLogExporter({ url: endpoints.logs })),
    ],
    instrumentations: options.instrumentations ?? [buildNodeAutoInstrumentations()],
  };
}

export async function safeShutdown(sdk: Pick<TelemetrySdk, 'shutdown'>): Promise<void> {
  try {
    await sdk.shutdown();
  } catch {
    // Best effort shutdown.
  }
}

export function initNodeTelemetry(options: NodeTelemetryInitOpts = {}): NodeTelemetryHandle {
  const env = options.env ?? process.env;
  if (telemetryDisabled(options, env)) {
    return { started: false, sdk: options.sdk, shutdown: async () => {} };
  }

  const sdk = createNodeSdk(options);
  sdk.start();
  registerShutdownHandlers(sdk, options);

  return {
    started: true,
    sdk,
    shutdown: () => safeShutdown(sdk),
  };
}

export const initTelemetry = initNodeTelemetry;
