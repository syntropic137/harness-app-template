import { runInherit } from './lib/git';

runInherit('pnpm', ['turbo', 'run', 'test', ...process.argv.slice(2)]);
runInherit('pnpm', ['exec', 'vitest', 'run', 'scripts/tests']);
