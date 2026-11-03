import { config } from './config.js';
import { expireHolds, runDailyJobs } from './services/reservationService.js';
import { retryPending } from './services/notificationService.js';

/**
 * Lightweight in-process schedulers. All of them are safe to run on every
 * Elastic Beanstalk instance simultaneously (row locks + SKIP LOCKED).
 */
export function startJobs() {
  const every = (ms, name, fn) => {
    const tick = async () => {
      try {
        const r = await fn();
        if (r && (typeof r === 'number' ? r > 0 : Object.values(r).some((v) => v > 0))) console.log(`[jobs] ${name}:`, r);
      } catch (err) {
        console.error(`[jobs] ${name} failed:`, err.message);
      }
    };
    setTimeout(tick, 5_000).unref();
    setInterval(tick, ms).unref();
  };

  every(60_000, 'outbox retry', retryPending);
  every(5 * 60_000, 'expire holds', expireHolds);
  // In AWS the daily run comes from EventBridge Scheduler -> Lambda -> /api/internal/jobs/daily
  if (config.inProcessReminders) every(60 * 60_000, 'daily reminders', runDailyJobs);
}
