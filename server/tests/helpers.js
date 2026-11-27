/**
 * Shared test helpers. Deliberately imports nothing from src/: the tests set process.env
 * first and then import the app, because src/config.js reads the environment on import.
 *
 * Database: TEST_DATABASE_URL, default = the docker-compose Postgres (npm run db:up).
 * The tests DROP everything in it, so the database name must end in "_test".
 */
import pg from 'pg';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://library:library@localhost:5433/library_test';

function assertTestDatabase(url) {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${name}": TEST_DATABASE_URL must name a database ending in _test`);
  }
  return name;
}

/** Create the test database if needed, then empty it (drop and recreate the public schema). */
export async function resetTestDatabase(url = TEST_DATABASE_URL) {
  const name = assertTestDatabase(url);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const server = new pg.Client({ connectionString: admin.toString() });
  await server.connect();
  try {
    const { rowCount } = await server.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await server.query(`CREATE DATABASE "${name}"`);
  } finally {
    await server.end();
  }

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  } finally {
    await db.end();
  }
}

/** Environment for an app under test, pointing at the test database. */
export function useTestEnvironment(extra = {}) {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: 'test-jwt-secret',
    INTERNAL_API_TOKEN: 'test-internal-token',
    IN_PROCESS_REMINDERS: 'false',
    SQS_QUEUE_URL: '',
    S3_BUCKET: '',
    REDIS_URL: '',
    ...extra,
  });
}

/** Start an Express app on a random port. Returns { url, close }. */
export async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Small JSON client: api(base)('POST', '/api/x', { body, token }) -> { status, body } */
export const client =
  (base) =>
  async (method, path, { body, token, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  };
