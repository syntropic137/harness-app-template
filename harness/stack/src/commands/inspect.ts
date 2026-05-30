import { join } from 'node:path';
import { captureSync, detectIsolation } from '../runtime/index.js';
import { allocatePorts } from '../topology/index.js';

export async function inspect(_args: string[]): Promise<number> {
  const iso = detectIsolation();
  const p = allocatePorts(iso.isoKey);
  const lines = [
    `Branch:           ${iso.branch}`,
    `Iso key:          ${iso.isoKey}`,
    `Project:          ${iso.project}`,
    `Web:              http://localhost:${p.WEB_PORT}`,
    `API:              http://localhost:${p.API_PORT}`,
    `Postgres:         postgres://localhost:${p.PG_PORT}`,
    `VictoriaLogs:     http://localhost:${p.VL_PORT}`,
    `VictoriaMetrics:  http://localhost:${p.VM_PORT}`,
    `VictoriaTraces:   http://localhost:${p.VT_PORT}`,
    `OTEL Collector:   http://localhost:${p.OTEL_OTLP_PORT}`,
  ];
  for (const l of lines) console.log(l);

  try {
    const status = captureSync('docker', [
      'compose',
      '-p',
      iso.project,
      '-f',
      join(iso.worktreePath, '.harness', `${iso.isoKey}.compose.yml`),
      'ps',
      '--format',
      'json',
    ]);
    console.log('Status:');
    console.log(status || '  (no compose file or stack not running)');
  } catch {
    console.log('Status:           (stack not running)');
  }
  return 0;
}

/**
 * Plain `key=value` port dump for shell consumption. Was previously its own
 * file (`commands/ports.ts`); collapsed here per the modularity investigation
 * to reduce near-empty-wrapper edges that Newman's algorithm penalizes.
 */
export async function ports(_args: string[]): Promise<number> {
  const iso = detectIsolation();
  const p = allocatePorts(iso.isoKey);
  for (const [k, v] of Object.entries(p)) console.log(`${k}=${v}`);
  return 0;
}
