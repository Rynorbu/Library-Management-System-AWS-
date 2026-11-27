/**
 * Code fix C1, end to end: the database password rotates in Secrets Manager while the app
 * is running, and the app keeps working without a restart.
 *
 * A tiny local HTTP server plays Secrets Manager (the real AWS SDK client talks to it via
 * AWS_ENDPOINT_URL_SECRETS_MANAGER). A real PostgreSQL role has its password changed.
 * Needs a server that checks passwords (the Postgres Docker image does; "trust" auth is skipped).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';
import { TEST_DATABASE_URL } from './helpers.js';

const ROLE = 'library_rotation_test';
const secret = { username: ROLE, password: 'first-Password-1' };
let secretReads = 0;

const fakeSecretsManager = http.createServer((req, res) => {
  req.resume().on('end', () => {
    if (req.headers['x-amz-target'] !== 'secretsmanager.GetSecretValue') {
      res.writeHead(400).end('{}');
      return;
    }
    secretReads += 1;
    res.writeHead(200, { 'Content-Type': 'application/x-amz-json-1.1' });
    res.end(JSON.stringify({ Name: 'test', VersionId: `v${secretReads}`, SecretString: JSON.stringify(secret) }));
  });
});

const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
let db; // the app's db module, imported after the environment is set
let skipReason = '';

before(async () => {
  await admin.connect();
  await admin.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await admin.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${secret.password}'`);

  // Does this server check passwords at all?
  const url = new URL(TEST_DATABASE_URL);
  const probe = new pg.Client({ host: url.hostname, port: url.port, database: url.pathname.slice(1), user: ROLE, password: 'wrong' });
  const checked = await probe.connect().then(
    () => false,
    (err) => err.code === '28P01',
  );
  await probe.end().catch(() => {});
  if (!checked) {
    skipReason = 'this PostgreSQL server does not check passwords (trust auth)';
    return;
  }

  await new Promise((resolve) => fakeSecretsManager.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: '',
    DB_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:rds-db-test',
    DB_HOST: url.hostname,
    DB_PORT: url.port || '5432',
    DB_NAME: url.pathname.slice(1),
    DB_READ_HOST: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname, // the "replica"
    DB_SSL: 'false',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_ENDPOINT_URL_SECRETS_MANAGER: `http://127.0.0.1:${fakeSecretsManager.address().port}`,
  });
  db = await import('../src/db/index.js');
  await db.initDb();
});

after(async () => {
  await db?.closeDb().catch(() => {});
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1`, [ROLE]).catch(() => {});
  await admin.query(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {});
  await admin.end();
  if (fakeSecretsManager.listening) await new Promise((resolve) => fakeSecretsManager.close(resolve));
});

/** Close the pools' open connections, as happens when connections recycle after a rotation. */
async function dropOpenConnections() {
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1`, [ROLE]);
  for (let i = 0; i < 50 && db.getPool().idleCount > 0; i++) await new Promise((r) => setTimeout(r, 20));
}

describe('database password rotation (C1)', () => {
  it('connects with the credentials from Secrets Manager (primary and read replica)', async (t) => {
    if (skipReason) return t.skip(skipReason);
    assert.equal((await db.query('SELECT current_user AS u')).rows[0].u, ROLE);
    assert.equal((await db.readQuery('SELECT current_user AS u')).rows[0].u, ROLE);
    assert.equal(db.hasReadReplica(), true);
    assert.equal(secretReads, 1, 'the secret is cached, not read for every connection');
  });

  it('keeps working after the password is rotated, without a restart', async (t) => {
    if (skipReason) return t.skip(skipReason);
    // Rotate: new password in the database AND in Secrets Manager, as RDS rotation does
    secret.password = 'second-Password-2';
    await admin.query(`ALTER ROLE ${ROLE} PASSWORD '${secret.password}'`);
    await dropOpenConnections();

    // The cached (old) password is rejected with 28P01 -> secret re-read -> retried once
    assert.equal((await db.query('SELECT current_user AS u')).rows[0].u, ROLE);
    assert.equal(secretReads, 2, 'the secret was read again exactly once');

    // Transactions and the replica pool get new connections with the new password too
    await db.withTransaction((c) => c.query('SELECT 1'));
    assert.equal((await db.readQuery('SELECT 1 AS ok')).rows[0].ok, 1);
  });
});
