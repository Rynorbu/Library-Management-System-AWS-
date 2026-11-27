import { config } from '../config.js';
import { query } from '../db/index.js';
import { renderEmail } from './emailTemplates.js';

/**
 * Notification pipeline (transactional outbox):
 *
 *   1. queueNotification() inserts a row inside the SAME transaction as the
 *      reservation change, so an email can never be lost or sent for a rolled-back change.
 *   2. After COMMIT, dispatch() publishes each row to Amazon SQS (status -> 'published').
 *      The request returns immediately; it never waits for email delivery.
 *   3. The notifier Lambda reads SQS, sends via Amazon SES (retries + DLQ), and reports
 *      back to /api/internal/notifications/:id/status (status -> 'sent' | 'failed').
 *   4. retryPending() re-publishes any rows still 'queued' (e.g. SQS was briefly unreachable).
 *
 * Exactly-once publishing with several instances: a row is "leased" through claimed_at.
 * The instance that inserts a row holds the lease while it publishes. The sweeper on
 * every instance claims rows atomically (FOR UPDATE SKIP LOCKED), and only rows whose
 * lease is free or older than CLAIM_LEASE, so two instances never publish the same row.
 *
 * Without SQS_QUEUE_URL (local development) emails are "delivered" to the console,
 * or sent straight through SES when SES_DIRECT=true.
 */

const MAX_ATTEMPTS = 5;
const CLAIM_LEASE = '5 minutes'; // a crashed instance's rows are retried after this
let sqs;
let ses;

async function sqsClient() {
  if (!sqs) {
    const { SQSClient, SendMessageCommand } = await import('@aws-sdk/client-sqs');
    sqs = { client: new SQSClient({ region: config.awsRegion }), SendMessageCommand };
  }
  return sqs;
}

async function sesClient() {
  if (!ses) {
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
    ses = { client: new SESClient({ region: config.awsRegion }), SendEmailCommand };
  }
  return ses;
}

/** Insert an outbox row. `db` must be the transaction client. */
export async function queueNotification(db, { user, type, data = {} }) {
  const { subject, text, html } = renderEmail(type, { ...data, user });
  // claimed_at = now(): this instance publishes the row right after COMMIT, so the
  // sweepers on other instances leave it alone unless that publish fails.
  const { rows } = await db.query(
    `INSERT INTO notifications (user_id, type, recipient, subject, body, html, claimed_at)
     VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING *`,
    [user.id, type, user.email, subject, text, html],
  );
  return rows[0];
}

async function publishOne(n) {
  if (config.sqsQueueUrl) {
    const { client, SendMessageCommand } = await sqsClient();
    await client.send(
      new SendMessageCommand({
        QueueUrl: config.sqsQueueUrl,
        MessageBody: JSON.stringify({
          notificationId: n.id,
          type: n.type,
          to: n.recipient,
          subject: n.subject,
          text: n.body,
          html: n.html,
        }),
        MessageAttributes: { type: { DataType: 'String', StringValue: n.type } },
      }),
    );
    await query(`UPDATE notifications SET status='published', attempts=attempts+1, error=NULL WHERE id=$1`, [n.id]);
    return;
  }

  if (config.sesDirect && config.sesFromEmail) {
    const { client, SendEmailCommand } = await sesClient();
    await client.send(
      new SendEmailCommand({
        Source: config.sesFromEmail,
        Destination: { ToAddresses: [n.recipient] },
        Message: {
          Subject: { Data: n.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: n.body, Charset: 'UTF-8' }, Html: { Data: n.html || n.body, Charset: 'UTF-8' } },
        },
      }),
    );
  } else {
    console.log(`\n[email] to=${n.recipient} | ${n.subject}\n${n.body.split('\n').map((l) => '        ' + l).join('\n')}`);
  }
  await query(`UPDATE notifications SET status='sent', sent_at=now(), attempts=attempts+1, error=NULL WHERE id=$1`, [n.id]);
}

/** Publish committed outbox rows. Never throws - failures stay 'queued' and are retried. */
export async function dispatch(notifications) {
  for (const n of notifications.filter(Boolean)) {
    try {
      await publishOne(n);
    } catch (err) {
      console.error(`[notify] publish failed for #${n.id}:`, err.message);
      // Release the lease so the next sweep (on any instance) retries it
      await query(
        `UPDATE notifications
            SET attempts = attempts + 1, error = $2, claimed_at = NULL,
                status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE status END
          WHERE id = $1`,
        [n.id, String(err.message).slice(0, 500), MAX_ATTEMPTS],
      ).catch(() => {});
    }
  }
}

/** Fire-and-forget helper used by route handlers after COMMIT. */
export function dispatchInBackground(notifications) {
  if (!notifications?.length) return;
  setImmediate(() => dispatch(notifications).catch((e) => console.error('[notify]', e)));
}

/**
 * Re-publish rows stuck in 'queued' (outbox sweeper). Runs every minute on EVERY instance.
 * The claim is one atomic UPDATE: rows another instance is claiming right now are skipped
 * (SKIP LOCKED), and rows it has just claimed no longer match (claimed_at is recent),
 * so each row is published by one instance only (code fix C2: no duplicate emails).
 */
export async function retryPending() {
  const { rows } = await query(
    `UPDATE notifications SET claimed_at = now()
      WHERE id IN (
        SELECT id FROM notifications
         WHERE status = 'queued' AND attempts < $1
           AND created_at < now() - interval '30 seconds'
           AND (claimed_at IS NULL OR claimed_at < now() - $2::interval)
         ORDER BY created_at
         LIMIT 50
         FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [MAX_ATTEMPTS, CLAIM_LEASE],
  );
  rows.sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  if (rows.length) await dispatch(rows);
  return rows.length;
}

export async function markDelivery(id, status, error) {
  const { rowCount } = await query(
    `UPDATE notifications SET status=$2, error=$3, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END WHERE id=$1`,
    [id, status, error || null],
  );
  return rowCount > 0;
}

export function notificationMode() {
  if (config.sqsQueueUrl) return 'sqs';
  if (config.sesDirect && config.sesFromEmail) return 'ses-direct';
  return 'console';
}
