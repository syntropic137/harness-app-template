import { runInherit } from './lib/git';

runInherit('pnpm', ['turbo', 'run', 'lint', ...process.argv.slice(2)]);
