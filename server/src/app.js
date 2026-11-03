import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { query } from './db/index.js';
import { UPLOAD_DIR } from './services/storage.js';
import { cacheMode } from './services/cache.js';
import { notFound, errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import bookRoutes from './routes/books.js';
import reservationRoutes from './routes/reservations.js';
import loanRoutes from './routes/loans.js';
import notificationRoutes from './routes/notifications.js';
import adminRoutes from './routes/admin.js';
import internalRoutes from './routes/internal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public'); // built React app (copied in at deploy time)

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind the Application Load Balancer
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          scriptSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()) }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(config.isProd ? 'combined' : 'dev', { skip: (req) => req.path === '/api/health' }));

  // ALB / Elastic Beanstalk health check
  app.get('/api/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok', db: 'up', cache: cacheMode(), uptime: Math.round(process.uptime()), time: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ status: 'degraded', db: 'down', error: err.message });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/books', bookRoutes);
  app.use('/api/reservations', reservationRoutes);
  app.use('/api/loans', loanRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/internal', internalRoutes);
  app.use('/api', notFound);

  // Locally-stored covers (S3 is used instead when S3_BUCKET is set)
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));

  // Serve the React single-page app
  if (existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));
    app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets'), { maxAge: '1y', immutable: true }));
    app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  } else {
    app.get('/', (_req, res) =>
      res.type('text').send('Library API is running. Start the React dev server in /client (npm run dev) and open http://localhost:5173'),
    );
  }

  app.use(errorHandler);
  return app;
}
