import pg from 'pg';
import { config } from '../config.js';
import { getDbSecret } from '../services/secrets.js';

// Return COUNT(*) and other int8 values as JS numbers instead of strings
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

let pool;
let readPool;

async function resolveConnection() {
  const ssl = config.dbSsl ? { rejectUnauthorized: false } : undefined;

  // 1. AWS Secrets Manager (recommended for production)
  if (config.dbSecretArn) {
    const s = await getDbSecret(config.dbSecretArn);
    // RDS-managed secrets contain only username/password, so host/db name may come from env
    return {
      host: s.host || process.env.DB_HOST,
      port: Number(s.port || process.env.DB_PORT || 5432),
      user: s.username,
      password: s.password,
      database: s.dbname || s.database || process.env.DB_NAME || 'library',
      ssl: ssl ?? { rejectUnauthorized: false },
    };
  }
  // 2. Explicit connection string
  if (config.databaseUrl) return { connectionString: config.databaseUrl, ssl };

  // 3. Elastic Beanstalk-attached RDS instance
  if (process.env.RDS_HOSTNAME) {
    return {
      host: process.env.RDS_HOSTNAME,
      port: Number(process.env.RDS_PORT || 5432),
      user: process.env.RDS_USERNAME,
      password: process.env.RDS_PASSWORD,
      database: process.env.RDS_DB_NAME,
      ssl: ssl ?? { rejectUnauthorized: false },
    };
  }
  // 4. Local defaults (docker-compose)
  return { connectionString: 'postgres://library:library@localhost:5433/library', ssl };
}

export async function initDb() {
  if (pool) return pool;
  const conn = await resolveConnection();
  pool = new pg.Pool({ ...conn, max: 10, idleTimeoutMillis: 30_000 });
  pool.on('error', (err) => console.error('[db] idle client error', err.message));

  readPool = config.databaseReadUrl
    ? new pg.Pool({
        connectionString: config.databaseReadUrl,
        ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
        max: 10,
      })
    : pool;
  return pool;
}

export function getPool() {
  if (!pool) throw new Error('Database not initialised - call initDb() first');
  return pool;
}

/** Query against the primary (writes and read-after-write). */
export const query = (text, params) => getPool().query(text, params);

/** Read-only query - goes to the RDS read replica when DATABASE_READ_URL is set. */
export const readQuery = (text, params) => (readPool || getPool()).query(text, params);

/** Run fn inside a transaction; rolls back on any thrown error. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
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
