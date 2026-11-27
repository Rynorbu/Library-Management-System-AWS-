import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initDb, connect, closeDb } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_LOCK_ID = 727_001;

/**
 * Applies schema.sql. Guarded by a Postgres advisory lock so that several
 * Elastic Beanstalk instances booting at once don't race each other.
 */
export async function migrate() {
  const sql = await readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(sql);
    console.log('[db] schema is up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

// Allow `npm run migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  initDb()
    .then(migrate)
    .then(closeDb)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
