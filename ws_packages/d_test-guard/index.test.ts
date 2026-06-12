import { afterEach, describe, expect, it } from 'vitest';
import { assertTestEnv } from './index.ts';

describe('assertTestEnv', () => {
  const originalAppEnv = process.env['APP_ENV'];

  afterEach(() => {
    if (originalAppEnv === undefined) {
      delete process.env['APP_ENV'];
    } else {
      process.env['APP_ENV'] = originalAppEnv;
    }
  });

  it('does not throw when APP_ENV is "test"', () => {
    process.env['APP_ENV'] = 'test';
    expect(() => assertTestEnv()).not.toThrow();
  });

  it('throws when APP_ENV is "production"', () => {
    process.env['APP_ENV'] = 'production';
    expect(() => assertTestEnv()).toThrow('Mock instantiated outside test environment');
  });

  it('throws when APP_ENV is unset', () => {
    delete process.env['APP_ENV'];
    expect(() => assertTestEnv()).toThrow('Mock instantiated outside test environment');
  });

  it('error message includes the actual APP_ENV value', () => {
    process.env['APP_ENV'] = 'staging';
    expect(() => assertTestEnv()).toThrow('APP_ENV="staging"');
  });

  it('error message notes unset APP_ENV', () => {
    delete process.env['APP_ENV'];
    expect(() => assertTestEnv()).toThrow('APP_ENV="<unset>"');
  });
});
