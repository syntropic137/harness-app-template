import { runInherit } from './lib/git';

runInherit('bun', ['--version']);
runInherit('pnpm', ['install']);
runInherit('cargo', ['check']);
runInherit('uv', ['sync']);

