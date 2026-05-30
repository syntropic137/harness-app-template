import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import type { HarnessConfig } from './config.js';

interface BuildOpts {
  worktreePath: string;
  infraComposePath: string;
  isoKey?: string;
}

const CONTAINER_PORTS: Record<string, number> = {
  WEB_PORT: 5173,
  API_PORT: 3000,
  API_RUST_PORT: 3000,
  API_PY_PORT: 8000,
  API_CPP_PORT: 3000,
};

interface ComposeService {
  build: { context: string; dockerfile: string };
  ports: string[];
  env_file: string[];
  environment?: Record<string, string>;
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
  volumes: string[];
}

interface PostgresService {
  image: string;
  environment: Record<string, string>;
  ports: string[];
  volumes: string[];
  healthcheck: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
}

export function buildComposeYaml(cfg: HarnessConfig, opts: BuildOpts): string {
  const services: Record<string, ComposeService | PostgresService> = {};
  const envFilePath = opts.isoKey
    ? join(opts.worktreePath, '.harness', `${opts.isoKey}.env`)
    : join(opts.worktreePath, '.harness', 'stack.env');

  for (const [name, svc] of Object.entries(cfg.services)) {
    const containerPort = CONTAINER_PORTS[svc.port] ?? 3000;
    // Resolve service dir (for Dockerfile path and volume mount)
    const serviceDir = resolve(opts.worktreePath, svc.build);
    const service: ComposeService = {
      // Build context must be workspace root so Dockerfile can COPY across workspaces.
      build: {
        context: opts.worktreePath,
        dockerfile: join(serviceDir, 'Dockerfile'),
      },
      ports: [`\${${svc.port}}:${containerPort}`],
      env_file: [envFilePath],
      volumes: [
        `${serviceDir}:/workspace/ws_apps/${name}`,
        `/workspace/ws_apps/${name}/node_modules`,
        // Mount workspace packages so live edits are reflected without rebuild.
        `${join(opts.worktreePath, 'ws_packages')}:/workspace/ws_packages`,
      ],
    };
    // Inject OTEL endpoint for services listed in telemetry.services
    const telemetryEnv: Record<string, string> = cfg.telemetry?.services.includes(name)
      ? { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318' }
      : {};
    service.environment = { ...telemetryEnv, ...(svc.env ?? {}) };
    if (svc.healthcheck) {
      service.healthcheck = {
        test: [
          'CMD-SHELL',
          `wget -qO- http://localhost:${containerPort}${svc.healthcheck} || exit 1`,
        ],
        interval: '5s',
        timeout: '3s',
        retries: 10,
      };
    }
    services[name] = service;
  }

  if (cfg.database?.kind === 'postgres') {
    services['postgres'] = {
      image: 'postgres:16-alpine',
      environment: {
        POSTGRES_USER: 'harness',
        POSTGRES_PASSWORD: 'harness',
        POSTGRES_DB: cfg.database.name,
      },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: docker-compose variable substitution syntax
      ports: ['${PG_PORT}:5432'],
      volumes: ['postgres_data:/var/lib/postgresql/data'],
      healthcheck: {
        test: ['CMD-SHELL', 'pg_isready -U harness'],
        interval: '5s',
        timeout: '3s',
        retries: 10,
      },
    };
  }

  const doc: Record<string, unknown> = {
    include: [opts.infraComposePath],
    services,
  };
  if (cfg.database) doc['volumes'] = { postgres_data: {} };

  return stringify(doc);
}
