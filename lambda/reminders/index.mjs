/**
 * library-daily-reminders  (Node.js 22 runtime, no dependencies)
 *
 * Trigger: Amazon EventBridge Scheduler, e.g. cron(0 2 * * ? *) = 08:00 Bhutan time.
 *
 * Calls the app's internal endpoint, which (inside a database transaction):
 *   - expires holds that were not collected in time and promotes the next waitlisted student
 *   - queues pickup reminders, due-soon reminders and overdue notices
 * Those emails then flow through SQS -> library-notifier Lambda -> SES.
 *
 * Keeping the business logic in the app means there is a single source of truth
 * and this Lambda needs no database credentials or VPC access.
 *
 * Environment variables:
 *   APP_URL             e.g. https://library.example.com
 *   INTERNAL_API_TOKEN  same value as the Elastic Beanstalk environment
 */
const { APP_URL, INTERNAL_API_TOKEN } = process.env;

export const handler = async () => {
  const res = await fetch(`${APP_URL.replace(/\/$/, '')}/api/internal/jobs/daily`, {
    method: 'POST',
    headers: { 'X-Internal-Token': INTERNAL_API_TOKEN },
    signal: AbortSignal.timeout(25_000),
  });
  const body = await res.text();
  if (!res.ok) {
    // Throwing makes EventBridge retry and marks the invocation as failed in CloudWatch
    throw new Error(`Daily job failed: HTTP ${res.status} ${body}`);
  }
  console.log(JSON.stringify({ level: 'info', event: 'daily_jobs_done', result: JSON.parse(body) }));
  return JSON.parse(body);
};
