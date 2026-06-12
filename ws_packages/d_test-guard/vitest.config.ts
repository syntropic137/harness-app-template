import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { APP_ENV: 'test' },
    include: ['index.test.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      reporter: ['text'],
      include: ['index.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
