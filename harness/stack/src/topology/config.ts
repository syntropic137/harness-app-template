import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { PORT_SERVICES } from './ports.js';

const PortNameSchema = z.enum(PORT_SERVICES);

const ServiceSchema = z.object({
  build: z.string(),
  port: PortNameSchema,
  healthcheck: z.string().optional(),
  env: z.record(z.string()).optional(),
});

const ConfigSchema = z.object({
  services: z.record(ServiceSchema),
  database: z
    .object({
      kind: z.literal('postgres'),
      name: z.string(),
      seed: z.string().optional(),
    })
    .optional(),
  telemetry: z.object({ services: z.array(z.string()) }).optional(),
  bugToggles: z.array(z.string()).optional().default([]),
});

export type HarnessConfig = z.infer<typeof ConfigSchema>;

export function defineHarnessConfig(cfg: HarnessConfig): HarnessConfig {
  return ConfigSchema.parse(cfg);
}

export function defaultHarnessConfig(): HarnessConfig {
  return ConfigSchema.parse({ services: {} });
}

export async function loadConfig(path: string): Promise<HarnessConfig> {
  const mod = await import(pathToFileURL(path).href);
  const raw = mod.default ?? mod;
  return ConfigSchema.parse(raw);
}
