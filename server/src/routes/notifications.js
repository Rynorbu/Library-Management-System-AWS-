import { Router } from 'express';
import { query } from '../db/index.js';
import { asyncHandler, pageParams } from '../utils/http.js';
import { requireAuth, requireLibrarian } from '../middleware/auth.js';

const router = Router();

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, type, subject, body, status, read_at, created_at, sent_at
         FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [req.user.id],
    );
    res.json({ notifications: rows });
  }),
);

router.post(
  '/me/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
    res.json({ ok: true });
  }),
);

// Librarian: full email log (delivery status from SQS / Lambda / SES)
router.get(
  '/',
  requireLibrarian,
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = pageParams(req.query, 50, 200);
    const params = [limit, offset];
    let where = '';
    if (['queued', 'published', 'sent', 'failed'].includes(req.query.status)) {
      params.push(req.query.status);
      where = `WHERE n.status = $3`;
    }
    const { rows } = await query(
      `SELECT n.id, n.type, n.recipient, n.subject, n.status, n.attempts, n.error, n.created_at, n.sent_at,
              u.name AS user_name, COUNT(*) OVER()::int AS total_count
         FROM notifications n LEFT JOIN users u ON u.id=n.user_id
         ${where}
        ORDER BY n.created_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    const total = rows[0]?.total_count ?? 0;
    res.json({ notifications: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }),
);

export default router;
