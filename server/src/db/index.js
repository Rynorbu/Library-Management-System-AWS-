import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { getDbSecret, invalidateDbSecret } from '../services/secrets.js';

// Return COUNT(*) and other int8 values as JS numbers instead of strings
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

const RDS_CA_BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../certs/rds-global-bundle.pem');
const AUTH_FAILED = '28P01'; // PostgreSQL: invalid_password

let pool;
let readPool;
let caBundle;

/**
 * TLS options for PostgreSQL. Amazon RDS certificates are VERIFIED against the bundled
 * RDS CA (certs/rds-global-bundle.pem, from truststore.pki.rds.amazonaws.com), including
 * the host name. DB_SSL=no-verify encrypts without verification (troubleshooting only).
 */
export function sslOptions(mode) {
  if (!mode) return undefined;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  caBundle ??= readFileSync(config.dbSslCa || RDS_CA_BUNDLE, 'utf8');
  return { ca: caBundle, rejectUnauthorized: true };
}

/**
 * Connection settings for the primary, or for a replica when `host` is given.
 * Amazon RDS connections (Secrets Manager or RDS_* vars) always use verified TLS unless
 * DB_SSL=false; a plain DATABASE_URL (local Docker) uses TLS only when DB_SSL is set.
 */
async function resolveConnection({ host } = {}) {
  // 1. AWS Secrets Manager (recommended for production)
  if (config.dbSecretArn) {
    const s = await getDbSecret(config.dbSecretArn); // fail fast at boot if the secret is unreadable
    // RDS-managed secrets contain only username/password, so host/db name may come from env
    return {
      host: host || s.host || process.env.DB_HOST,
      port: Number(s.port || process.env.DB_PORT || 5432),
      user: s.username,
      // pg calls this for every NEW connection. The secret is cached for a few minutes, so a
      // rotated password is picked up without restarting the app (code fix C1).
      password: async () => (await getDbSecret(config.dbSecretArn)).password,
      database: s.dbname || s.database || process.env.DB_NAME || 'library',
      ssl: sslOptions(config.dbSsl ?? true),
    };
  }
  // 2. Explicit connection string
  if (config.databaseUrl) {
    let connectionString = config.databaseUrl;
    if (host) {
      const url = new URL(connectionString);
      url.hostname = host;
      connectionString = url.toString();
    }
    return { connectionString, ssl: sslOptions(config.dbSsl) };
  }
  // 3. Elastic Beanstalk-attached RDS instance
  if (process.env.RDS_HOSTNAME) {
    return {
      host: host || process.env.RDS_HOSTNAME,
      port: Number(process.env.RDS_PORT || 5432),
      user: process.env.RDS_USERNAME,
      password: process.env.RDS_PASSWORD,
      database: process.env.RDS_DB_NAME,
      ssl: sslOptions(config.dbSsl ?? true),
    };
  }
  // 4. Local defaults (docker-compose)
  return { connectionString: 'postgres://library:library@localhost:5433/library', ssl: sslOptions(config.dbSsl) };
}

function createPool(conn) {
  const p = new pg.Pool({ ...conn, max: 10, idleTimeoutMillis: 30_000 });
  p.on('error', (err) => console.error('[db] idle client error', err.message));
  return p;
}

export async function initDb() {
  if (pool) return pool;
  pool = createPool(await resolveConnection());

  if (config.dbReadHost) {
    readPool = createPool(await resolveConnection({ host: config.dbReadHost }));
  } else if (config.databaseReadUrl) {
    readPool = createPool({ connectionString: config.databaseReadUrl, ssl: sslOptions(config.dbSsl) });
  } else {
    readPool = pool;
  }
  return pool;
}

export function getPool() {
  if (!pool) throw new Error('Database not initialised - call initDb() first');
  return pool;
}

export const hasReadReplica = () => Boolean(readPool && readPool !== pool);

/**
 * Run fn; if PostgreSQL rejected the password (the secret was rotated since we cached it),
 * call onAuthFailure() and try exactly once more. Safe for connect() and pool.query():
 * authentication happens before any SQL runs.
 */
export async function retryOnAuthFailure(fn, onAuthFailure) {
  try {
    return await fn();
  } catch (err) {
    if (err?.code !== AUTH_FAILED || !onAuthFailure) throw err;
    console.warn('[db] password rejected - re-reading the secret from Secrets Manager and retrying once');
    await onAuthFailure();
    return fn();
  }
}

const withAuthRetry = (fn) =>
  retryOnAuthFailure(fn, config.dbSecretArn ? () => invalidateDbSecret(config.dbSecretArn) : null);

/** A client from the primary pool. Call client.release() when done. */
export const connect = () => withAuthRetry(() => getPool().connect());

/** Query against the primary (writes and read-after-write). */
export const query = (text, params) => withAuthRetry(() => getPool().query(text, params));

/** Read-only query - goes to the RDS read replica when DB_READ_HOST / DATABASE_READ_URL is set. */
export const readQuery = (text, params) => withAuthRetry(() => (readPool || getPool()).query(text, params));

/** Run fn inside a transaction; rolls back on any thrown error. */
export async function withTransaction(fn) {
  const client = await connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb() {
  if (readPool && readPool !== pool) await readPool.end();
  if (pool) await pool.end();
  pool = readPool = undefined;
}
