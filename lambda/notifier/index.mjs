/**
 * library-notifier  (Node.js 20 runtime, no dependencies - AWS SDK v3 is built in)
 *
 * Trigger: Amazon SQS queue "library-notifications" (batch size 10,
 *          ReportBatchItemFailures enabled, redrive to "library-notifications-dlq"
 *          after maxReceiveCount = 3).
 *
 * For each message: send the email through Amazon SES, then report the result back
 * to the app so it appears in the librarian's email log. Failed messages are returned
 * as batchItemFailures so SQS retries only those; after 3 failures they land in the DLQ.
 *
 * Environment variables:
 *   SES_FROM_EMAIL      verified sender, e.g. library@cst.edu.bt
 *   APP_URL             e.g. https://library.example.com  (optional, for status callback)
 *   INTERNAL_API_TOKEN  same value as the Elastic Beanstalk environment
 */
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({});
const { SES_FROM_EMAIL, APP_URL, INTERNAL_API_TOKEN } = process.env;

async function reportStatus(id, status, error) {
  if (!APP_URL || !INTERNAL_API_TOKEN || !id) return;
  try {
    await fetch(`${APP_URL.replace(/\/$/, '')}/api/internal/notifications/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': INTERNAL_API_TOKEN },
      body: JSON.stringify({ status, ...(error ? { error: String(error).slice(0, 500) } : {}) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn(`status callback failed for #${id}:`, err.message);
  }
}

export const handler = async (event) => {
  const batchItemFailures = [];

  for (const record of event.Records) {
    let msg;
    try {
      msg = JSON.parse(record.body);
    } catch {
      console.error('Discarding malformed message', record.messageId);
      continue; // poison message - do not retry
    }

    try {
      const res = await ses.send(
        new SendEmailCommand({
          Source: SES_FROM_EMAIL,
          Destination: { ToAddresses: [msg.to] },
          Message: {
            Subject: { Data: msg.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: msg.text, Charset: 'UTF-8' },
              Html: { Data: msg.html || msg.text, Charset: 'UTF-8' },
            },
          },
          Tags: [{ Name: 'type', Value: String(msg.type || 'unknown').replace(/[^A-Za-z0-9_-]/g, '') }],
        }),
      );
      console.log(JSON.stringify({ level: 'info', event: 'email_sent', notificationId: msg.notificationId, type: msg.type, sesMessageId: res.MessageId }));
      await reportStatus(msg.notificationId, 'sent');
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', event: 'email_failed', notificationId: msg.notificationId, error: err.message }));
      const receiveCount = Number(record.attributes?.ApproximateReceiveCount || 1);
      if (receiveCount >= 3) await reportStatus(msg.notificationId, 'failed', err.message);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
