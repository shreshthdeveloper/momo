/**
 * Test environment, set before anything reads it.
 *
 * This has to be its own module. ESM hoists every `import` above the module
 * body, so assigning `process.env.NODE_ENV` at the top of helpers.js runs
 * AFTER `src/config/env.js` has already been evaluated and captured the old
 * values. The symptom is quiet and nasty: the suite connects to the
 * development database and wipes it, rate limits stay on, and failures look
 * like product bugs.
 *
 * Importing this file first — before any src/ import — is what makes the
 * ordering explicit. `npm test` also sets NODE_ENV as a second line of defence.
 */
process.env.NODE_ENV = 'test';
process.env.ENABLE_JOBS = 'false';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
process.env.MONGO_URL_TEST =
  process.env.MONGO_URL_TEST ?? 'mongodb://127.0.0.1:27017/mimo_test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-not-used-anywhere-real';
process.env.SMS_PROVIDER = 'console';
process.env.STORAGE_DRIVER = 'local';

/**
 * A last-ditch guard. If the resolved test database is not obviously a test
 * database, refuse to run — `resetDb()` deletes every collection, and doing
 * that to a developer's working data once is once too many.
 */
const target = process.env.MONGO_URL_TEST;
if (!/test/i.test(target)) {
  throw new Error(
    `Refusing to run tests against "${target}" — the database name must contain "test". ` +
      `The suite truncates every collection between tests.`,
  );
}

export const TEST_MONGO_URL = target;
