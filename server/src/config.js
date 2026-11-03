import 'dotenv/config';

const bool = (v, fallback = false) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

export const config = {
  nodeEnv,
  isProd,
  port: Number(process.env.PORT || 8080),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  corsOrigin: process.env.CORS_ORIGIN || '',

  jwtSecret: process.env.JWT_SECRET || (isProd ? '' : 'dev-only-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  internalToken: process.env.INTERNAL_API_TOKEN || (isProd ? '' : 'dev-internal-token'),

  // Database: DATABASE_URL, or Elastic Beanstalk RDS_* vars, or a Secrets Manager secret
  databaseUrl: process.env.DATABASE_URL || '',
  databaseReadUrl: process.env.DATABASE_READ_URL || '',
  dbSecretArn: process.env.DB_SECRET_ARN || '',
  dbSsl: bool(process.env.DB_SSL, false),

  // AWS integrations - each one is optional and falls back to a local implementation
  awsRegion: process.env.AWS_REGION || 'ap-south-1',
  sqsQueueUrl: process.env.SQS_QUEUE_URL || '',
  sesFromEmail: process.env.SES_FROM_EMAIL || '',
  sesDirect: bool(process.env.SES_DIRECT, false),
  s3Bucket: process.env.S3_BUCKET || '',
  redisUrl: process.env.REDIS_URL || '',

  // Library rules
  pickupWindowHours: Number(process.env.PICKUP_WINDOW_HOURS || 48),
  loanPeriodDays: Number(process.env.LOAN_PERIOD_DAYS || 14),
  maxActiveReservations: Number(process.env.MAX_ACTIVE_RESERVATIONS || 5),
  maxRenewals: Number(process.env.MAX_RENEWALS || 1),
  timezone: process.env.LIBRARY_TIMEZONE || 'Asia/Thimphu',

  // Background jobs inside the web process. In AWS, daily reminders come from EventBridge + Lambda.
  inProcessReminders: bool(process.env.IN_PROCESS_REMINDERS, !isProd),
  seedOnStart: bool(process.env.SEED_ON_START, false),
};

if (isProd && !config.jwtSecret) {
  throw new Error('JWT_SECRET must be set in production');
}
