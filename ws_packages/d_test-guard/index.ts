/**
 * Throws immediately if APP_ENV is not "test".
 * Call this as the first line of every mock class constructor.
 */
export function assertTestEnv(): void {
  const env = process.env['APP_ENV'];
  if (env !== 'test') {
    throw new Error(
      `Mock instantiated outside test environment (APP_ENV="${env ?? '<unset>'}"). ` +
        `Mocks may only run when APP_ENV=test.`,
    );
  }
}
