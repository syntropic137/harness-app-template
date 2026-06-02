import type { Attributes } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

export type Env = Record<string, string | undefined>;
export type ResourceAttrs = Attributes;

export interface ResourceOpts {
  service?: string | undefined;
  deploymentEnv?: string | undefined;
  namespace?: string | undefined;
  version?: string | undefined;
  instanceId?: string | undefined;
  attrs?: ResourceAttrs | undefined;
}

export interface SignalEndpointOpts {
  env?: Env | undefined;
  base?: string | undefined;
  defaultPort?: string | undefined;
}

export interface OtlpSignalEndpoints {
  base: string;
  traces: string;
  metrics: string;
  logs: string;
}

const DEFAULT_SERVICE_NAME = 'harness-app';
const DEFAULT_ENVIRONMENT = 'development';
const DEFAULT_OTLP_PORT = '4318';

export function readEnv(env: Env, name: string): string | undefined {
  return env[name] ?? env[`VITE_${name}`];
}

export function resolveServiceName({
  service,
  env = process.env,
}: {
  service?: string | undefined;
  env?: Env | undefined;
} = {}): string {
  return service ?? readEnv(env, 'OTEL_SERVICE_NAME') ?? DEFAULT_SERVICE_NAME;
}

export function resolveDeploymentEnv({
  envName,
  env = process.env,
}: {
  envName?: string | undefined;
  env?: Env | undefined;
} = {}): string {
  return (
    envName ??
    readEnv(env, 'OTEL_RESOURCE_DEPLOYMENT_ENVIRONMENT') ??
    readEnv(env, 'HARNESS_ENV') ??
    readEnv(env, 'NODE_ENV') ??
    DEFAULT_ENVIRONMENT
  );
}

function appendIfSet(attrs: ResourceAttrs, key: string, value: string | undefined): void {
  if (value) {
    attrs[key] = value;
  }
}

export function buildResourceAttrs(
  options: ResourceOpts = {},
  env: Env = process.env,
): ResourceAttrs {
  const attrs: ResourceAttrs = {
    [ATTR_SERVICE_NAME]: resolveServiceName({ service: options.service, env }),
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: resolveDeploymentEnv({
      envName: options.deploymentEnv,
      env,
    }),
    ...options.attrs,
  };

  appendIfSet(
    attrs,
    ATTR_SERVICE_NAMESPACE,
    options.namespace ?? readEnv(env, 'OTEL_SERVICE_NAMESPACE'),
  );
  appendIfSet(attrs, ATTR_SERVICE_VERSION, options.version ?? readEnv(env, 'OTEL_SERVICE_VERSION'));
  appendIfSet(
    attrs,
    'service.instance.id',
    options.instanceId ?? readEnv(env, 'OTEL_SERVICE_INSTANCE_ID'),
  );
  appendIfSet(attrs, 'harness.branch', readEnv(env, 'HARNESS_BRANCH'));
  appendIfSet(attrs, 'harness.iso_key', readEnv(env, 'HARNESS_ISO_KEY'));
  appendIfSet(attrs, 'harness.git_sha', readEnv(env, 'HARNESS_GIT_SHA'));
  appendIfSet(attrs, 'harness.workspace', readEnv(env, 'HARNESS_WORKSPACE'));

  return attrs;
}

export function buildResource(
  options: ResourceOpts = {},
  env: Env = process.env,
): ReturnType<typeof resourceFromAttributes> {
  return resourceFromAttributes(buildResourceAttrs(options, env));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveOtlpBase({
  env = process.env,
  base,
  defaultPort = DEFAULT_OTLP_PORT,
}: SignalEndpointOpts = {}): string {
  const configured = base ?? readEnv(env, 'OTEL_EXPORTER_OTLP_ENDPOINT');
  if (configured) {
    return trimTrailingSlash(configured);
  }
  const port = readEnv(env, 'OTEL_OTLP_PORT') ?? defaultPort;
  return `http://localhost:${port}`;
}

export function buildOtlpSignalEndpoints(options: SignalEndpointOpts = {}): OtlpSignalEndpoints {
  const base = resolveOtlpBase(options);
  return {
    base,
    traces: `${base}/v1/traces`,
    metrics: `${base}/v1/metrics`,
    logs: `${base}/v1/logs`,
  };
}
