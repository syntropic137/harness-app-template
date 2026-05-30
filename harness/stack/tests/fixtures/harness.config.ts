import { defineHarnessConfig } from '../../src/topology/config.js';

export default defineHarnessConfig({
  services: {
    web: { build: './apps/web', port: 'WEB_PORT', healthcheck: '/' },
    api: { build: './apps/api', port: 'API_PORT', healthcheck: '/health' },
  },
  database: { kind: 'postgres', name: 'taskboard' },
  telemetry: { services: ['web', 'api'] },
  bugToggles: ['BUG_COMPLETE_TASK_500'],
});
