import { runInherit } from './lib/git';

runInherit('pnpm', ['turbo', 'run', 'build', ...process.argv.slice(2)]);
