// Fixture: named exports (no default). Exercises the `mod.default ?? mod`
// fallback branch in loadConfig where the module IS the config.
export const services = {
  web: { build: './apps/web', port: 'WEB_PORT' as const },
};
export const bugToggles: string[] = [];
