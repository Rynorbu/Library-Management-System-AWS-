import 'dotenv/config';

const bool = (v, fallback = false) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

/** DB_SSL: unset -> undefined (default per connection type), "no-verify" -> encrypt without
 *  checking the certificate (troubleshooting only), anything else -> true / false. */
const sslMode = (v) => {
  if (v === undefined || v === '') return undefined;
  if (String(v).toLowerCase() === 'no-verify') return 'no-verify';
  return bool(v);
};

const int = (v, fallback) => (v === undefined || v === '' ? fallback : Number(v));

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

export const config = {
  nodeEnv,
  isProd,
  port: Number(process.env.PORT || 8080),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  corsOrigin: process.env.CORS_ORIGIN || '',
  // Proxies in front of the app: CloudFront -> ALB -> instance = 2, so req.ip is the real
  // client and the login rate limit applies per user, not per CloudFront edge IP.
  trustProxyHops: int(process.env.TRUST_PROXY_HOPS, 2),

  jwtSecret: process.env.JWT_SECRET || (isProd ? '' : 'dev-only-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  internalToken: process.env.INTERNAL_API_TOKEN || (isProd ? '' : 'dev-internal-token'),

  // Database: a Secrets Manager secret, DATABASE_URL, or Elastic Beanstalk RDS_* vars
  databaseUrl: process.env.DATABASE_URL || '',
  dbSecretArn: process.env.DB_SECRET_ARN || '',
  // Read replica: DB_READ_HOST reuses the primary's credentials (and so survives rotation);
  // DATABASE_READ_URL is the older option with the password inside the URL.
  dbReadHost: process.env.DB_READ_HOST || '',
  databaseReadUrl: process.env.DATABASE_READ_URL || '',
  dbSsl: sslMode(process.env.DB_SSL),
  dbSslCa: process.env.DB_SSL_CA || '', // path to a CA bundle; default = bundled RDS CA
  secretCacheTtlMs: int(process.env.SECRET_CACHE_TTL_SECONDS, 300) * 1000,

  // AWS integrations - each one is optional and falls back to a local implementation
  awsRegion: process.env.AWS_REGION || 'us-east-1', // Learner Lab region
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
