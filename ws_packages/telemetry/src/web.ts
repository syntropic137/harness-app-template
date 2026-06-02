import { metrics, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import type { Env, ResourceOpts } from './resource.js';
import { buildOtlpSignalEndpoints, buildResource } from './resource.js';

export interface WebTelemetryConfigOpts extends ResourceOpts {
  env?: Env | undefined;
  otlpBase?: string | undefined;
  metricExportIntervalMillis?: number | undefined;
  instrumentations?: Instrumentation[] | undefined;
}

export interface WebTelemetryProviders {
  tracerProvider: WebTracerProvider;
  meterProvider: MeterProvider;
  loggerProvider: LoggerProvider;
  instrumentations: Instrumentation[];
}

export interface WebTelemetryInitOpts extends WebTelemetryConfigOpts {
  registerGlobals?: boolean | undefined;
}

type ImportMetaWithEnv = ImportMeta & { env?: Env | undefined };

export function readBrowserEnv(): Env {
  // Vite injects import.meta.env at build time in browser bundles.
  return (import.meta as ImportMetaWithEnv).env ?? {};
}

export function buildWebTelemetryProviders(
  options: WebTelemetryConfigOpts = {},
): WebTelemetryProviders {
  const env = options.env ?? readBrowserEnv();
  const resource = buildResource(options, env);
  const endpoints = buildOtlpSignalEndpoints({ env, base: options.otlpBase });
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: endpoints.metrics }),
        exportIntervalMillis: options.metricExportIntervalMillis ?? 10_000,
      }),
    ],
  });
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(new OTLPLogExporter({ url: endpoints.logs }))],
  });
  const tracerProvider = new WebTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoints.traces }))],
    meterProvider,
  });
  return {
    tracerProvider,
    meterProvider,
    loggerProvider,
    instrumentations:
      options.instrumentations ?? (getWebAutoInstrumentations() as Instrumentation[]),
  };
}

export function initWebTelemetry(options: WebTelemetryInitOpts = {}): WebTelemetryProviders {
  const providers = buildWebTelemetryProviders(options);
  if (options.registerGlobals ?? true) {
    providers.tracerProvider.register();
    metrics.setGlobalMeterProvider(providers.meterProvider);
    logs.setGlobalLoggerProvider(providers.loggerProvider);
    trace.setGlobalTracerProvider(providers.tracerProvider);
    registerInstrumentations({ instrumentations: providers.instrumentations });
  }
  return providers;
}

export const initTelemetry = initWebTelemetry;
