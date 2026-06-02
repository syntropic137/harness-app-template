import { describe, expect, it } from 'vitest';
import {
  buildOtlpSignalEndpoints,
  buildResourceAttrs,
  readEnv,
  resolveDeploymentEnv,
  resolveOtlpBase,
  resolveServiceName,
} from '../src/resource.js';

describe('resource builders', () => {
  it('reads Node and Vite style environment keys', () => {
    expect(readEnv({ VITE_HARNESS_BRANCH: 'main' }, 'HARNESS_BRANCH')).toBe('main');
    expect(readEnv({ HARNESS_BRANCH: 'dev' }, 'HARNESS_BRANCH')).toBe('dev');
  });

  it('builds canonical service and harness attributes', () => {
    const attrs = buildResourceAttrs(
      { namespace: 'demo', version: '1.2.3', instanceId: 'abc' },
      {
        OTEL_SERVICE_NAME: 'svc',
        HARNESS_ENV: 'test',
        HARNESS_BRANCH: 'main',
        HARNESS_ISO_KEY: 'iso',
        HARNESS_GIT_SHA: 'sha',
        HARNESS_WORKSPACE: 'workspace',
      },
    );
    expect(attrs['service.name']).toBe('svc');
    expect(attrs['deployment.environment.name']).toBe('test');
    expect(attrs['service.namespace']).toBe('demo');
    expect(attrs['service.version']).toBe('1.2.3');
    expect(attrs['service.instance.id']).toBe('abc');
    expect(attrs['harness.branch']).toBe('main');
    expect(attrs['harness.iso_key']).toBe('iso');
    expect(attrs['harness.git_sha']).toBe('sha');
    expect(attrs['harness.workspace']).toBe('workspace');
  });

  it('lets explicit options override environment defaults', () => {
    const attrs = buildResourceAttrs(
      { service: 'explicit', deploymentEnv: 'prod', attrs: { 'custom.attr': 'ok' } },
      { OTEL_SERVICE_NAME: 'env-svc', NODE_ENV: 'test' },
    );
    expect(attrs['service.name']).toBe('explicit');
    expect(attrs['deployment.environment.name']).toBe('prod');
    expect(attrs['custom.attr']).toBe('ok');
  });

  it('resolves fallback service and environment names', () => {
    expect(resolveServiceName({ env: {} })).toBe('harness-app');
    expect(resolveDeploymentEnv({ env: {} })).toBe('development');
  });

  it('builds OTLP signal endpoints from a base URL', () => {
    expect(resolveOtlpBase({ base: 'http://collector:4318/' })).toBe('http://collector:4318');
    expect(buildOtlpSignalEndpoints({ base: 'http://collector:4318' })).toEqual({
      base: 'http://collector:4318',
      traces: 'http://collector:4318/v1/traces',
      metrics: 'http://collector:4318/v1/metrics',
      logs: 'http://collector:4318/v1/logs',
    });
  });

  it('builds an OTLP base URL from the configured port', () => {
    expect(resolveOtlpBase({ env: { OTEL_OTLP_PORT: '9999' } })).toBe('http://localhost:9999');
  });
});
