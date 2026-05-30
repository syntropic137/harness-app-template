import { runInherit } from './lib/git';

runInherit('docker', ['compose', '-f', 'harness/observability/compose.harness.yml', ...process.argv.slice(2)]);

