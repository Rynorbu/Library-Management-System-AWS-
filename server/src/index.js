import { config } from './config.js';
import { initDb, closeDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seedIfEmpty } from './db/seed.js';
import { initCache } from './services/cache.js';
import { notificationMode } from './services/notificationService.js';
import { createApp } from './app.js';
import { startJobs } from './jobs.js';

async function main() {
  await initDb();
  await migrate();
  if (config.seedOnStart || !config.isProd) await seedIfEmpty();
  await initCache();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[server] Library API listening on http://localhost:${config.port} (${config.nodeEnv})`);
    console.log(`[server] email delivery mode: ${notificationMode()} | covers: ${config.s3Bucket ? 'S3' : 'local'}`);
  });
  startJobs();

  // Graceful shutdown so Elastic Beanstalk rolling deploys don't drop requests
  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(async () => {
      await closeDb().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
