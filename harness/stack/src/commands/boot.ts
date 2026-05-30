import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectIsolation, run } from '../runtime/index.js';
import {
  allocatePorts,
  buildComposeYaml,
  defaultHarnessConfig,
  loadConfig,
  writeEnvFile,
} from '../topology/index.js';

function parseArgs(args: string[]): { bugToggles: string[] } {
  const bugToggles: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bug' && args[i + 1]) {
      bugToggles.push(args[++i]!);
    }
  }
  return { bugToggles };
}

export async function boot(args: string[]): Promise<number> {
  const { bugToggles } = parseArgs(args);
  const iso = detectIsolation();
  const ports = allocatePorts(iso.isoKey);
  const configPath = join(iso.worktreePath, 'harness.config.ts');
  const cfg = existsSync(configPath) ? await loadConfig(configPath) : defaultHarnessConfig();

  const envVars: Record<string, string | number> = {
    HARNESS_BRANCH: iso.branch,
    HARNESS_ISO_KEY: iso.isoKey,
    HARNESS_GIT_SHA: iso.gitSha ?? 'unknown',
    HARNESS_PROJECT: iso.project,
    DATABASE_URL: `postgres://harness:harness@postgres:5432/${cfg.database?.name ?? 'app'}`,
    ...ports,
  };
  for (const toggle of bugToggles) envVars[toggle] = 'true';

  writeEnvFile(iso.worktreePath, iso.isoKey, envVars);

  const composeYaml = buildComposeYaml(cfg, {
    worktreePath: iso.worktreePath,
    infraComposePath: join(iso.worktreePath, 'harness/observability/compose.harness.yml'),
    isoKey: iso.isoKey,
  });
  const composeDir = join(iso.worktreePath, '.harness');
  mkdirSync(composeDir, { recursive: true });
  const composePath = join(composeDir, `${iso.isoKey}.compose.yml`);
  writeFileSync(composePath, composeYaml, 'utf8');

  const artifactsDir = join(iso.worktreePath, '.harness', 'artifacts', iso.isoKey);
  mkdirSync(join(artifactsDir, 'screenshots'), { recursive: true });
  mkdirSync(join(artifactsDir, 'video'), { recursive: true });
  mkdirSync(join(artifactsDir, 'review'), { recursive: true });

  console.log(`Booting ${iso.project} (branch=${iso.branch}, iso=${iso.isoKey})`);
  return run(
    'docker',
    [
      'compose',
      '-p',
      iso.project,
      '-f',
      composePath,
      '--env-file',
      join(iso.worktreePath, '.harness', `${iso.isoKey}.env`),
      'up',
      '-d',
      '--build',
    ],
    { cwd: iso.worktreePath },
  );
}
