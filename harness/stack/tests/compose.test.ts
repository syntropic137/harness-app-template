import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildComposeYaml } from '../src/topology/compose.js';
import type { HarnessConfig } from '../src/topology/config.js';

const cfg: HarnessConfig = {
  services: {
    web: { build: './apps/web', port: 'WEB_PORT', healthcheck: '/' },
    api: {
      build: './apps/api',
      port: 'API_PORT',
      healthcheck: '/health',
      env: {
        DATABASE_URL: 'postgres://harness:harness@postgres:5432/taskboard',
      },
    },
  },
  database: { kind: 'postgres', name: 'taskboard' },
  telemetry: { services: ['web', 'api'] },
  bugToggles: [],
};

describe('buildComposeYaml', () => {
  it('includes consumer services, postgres, and harness-fixed services', () => {
    const yaml = buildComposeYaml(cfg, {
      worktreePath: '/repo/foo',
      infraComposePath: '/repo/foo/harness/observability/compose.harness.yml',
    });
    const doc = parse(yaml);
    expect(doc.services.web).toBeDefined();
    expect(doc.services.api).toBeDefined();
    expect(doc.services.postgres).toBeDefined();
    expect(doc.include).toEqual(['/repo/foo/harness/observability/compose.harness.yml']);
  });
  it('uses isoKey-suffixed env file when isoKey is provided', () => {
    const yaml = buildComposeYaml(cfg, {
      worktreePath: '/repo/foo',
      infraComposePath: '/repo/foo/harness/observability/compose.harness.yml',
      isoKey: 'abc12345',
    });
    const doc = parse(yaml);
    expect(doc.services.web.env_file).toContain('/repo/foo/.harness/abc12345.env');
  });
  it('omits OTEL endpoint for services not listed in telemetry.services', () => {
    const cfgNoTel: HarnessConfig = {
      services: { web: { build: './apps/web', port: 'WEB_PORT' } },
      bugToggles: [],
    };
    const yaml = buildComposeYaml(cfgNoTel, {
      worktreePath: '/r',
      infraComposePath: '/r/c.yml',
    });
    const doc = parse(yaml);
    expect(doc.services.web.environment?.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });
  it('falls back to containerPort 3000 for port names not in CONTAINER_PORTS', () => {
    const cfgUnknownPort: HarnessConfig = {
      // VL_PORT is a valid PortName but has no entry in CONTAINER_PORTS,
      // so the fallback `?? 3000` should kick in.
      services: { logs: { build: './apps/logs', port: 'VL_PORT' } },
      bugToggles: [],
    };
    const yaml = buildComposeYaml(cfgUnknownPort, {
      worktreePath: '/r',
      infraComposePath: '/r/c.yml',
    });
    const doc = parse(yaml);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: docker-compose var
    expect(doc.services.logs.ports[0]).toBe('${VL_PORT}:3000');
  });
  it('omits healthcheck block when service has no healthcheck path', () => {
    const cfgNoHc: HarnessConfig = {
      services: { web: { build: './apps/web', port: 'WEB_PORT' } },
      bugToggles: [],
    };
    const yaml = buildComposeYaml(cfgNoHc, {
      worktreePath: '/r',
      infraComposePath: '/r/c.yml',
    });
    const doc = parse(yaml);
    expect(doc.services.web.healthcheck).toBeUndefined();
  });
  it('omits postgres + volumes block when database is not configured', () => {
    const cfgNoDb: HarnessConfig = {
      services: { web: { build: './apps/web', port: 'WEB_PORT' } },
      bugToggles: [],
    };
    const yaml = buildComposeYaml(cfgNoDb, {
      worktreePath: '/r',
      infraComposePath: '/r/c.yml',
    });
    const doc = parse(yaml);
    expect(doc.services.postgres).toBeUndefined();
    expect(doc.volumes).toBeUndefined();
  });
  it('maps consumer port symbol to host:container binding', () => {
    const yaml = buildComposeYaml(cfg, {
      worktreePath: '/repo/foo',
      infraComposePath: '/repo/foo/harness/observability/compose.harness.yml',
    });
    const doc = parse(yaml);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: docker-compose variable substitution
    expect(doc.services.web.ports[0]).toBe('${WEB_PORT}:5173');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: docker-compose variable substitution
    expect(doc.services.api.ports[0]).toBe('${API_PORT}:3000');
  });
});
