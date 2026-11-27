import { Router } from 'express';
import { z } from 'zod';
import { query, hasReadReplica } from '../db/index.js';
import { asyncHandler, parse, pageParams, HttpError, logActivity } from '../utils/http.js';
import { requireLibrarian } from '../middleware/auth.js';
import { runDailyJobs } from '../services/reservationService.js';
import { withCoverUrls } from '../services/storage.js';
import { cacheMode } from '../services/cache.js';
import { notificationMode, retryPending } from '../services/notificationService.js';
import { config } from '../config.js';

const router = Router();
router.use(requireLibrarian);

// Dashboard / reports
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [totals, popular, categories, daily, activity, emails] = await Promise.all([
      query(`SELECT
        (SELECT COUNT(*) FROM books)::int AS titles,
        (SELECT COALESCE(SUM(total_copies),0) FROM books)::int AS copies,
        (SELECT COALESCE(SUM(available_copies),0) FROM books)::int AS available,
        (SELECT COUNT(*) FROM users WHERE role <> 'librarian')::int AS members,
        (SELECT COUNT(*) FROM reservations WHERE status='reserved')::int AS ready_for_pickup,
        (SELECT COUNT(*) FROM reservations WHERE status='waitlisted')::int AS waitlisted,
        (SELECT COUNT(*) FROM loans WHERE returned_at IS NULL)::int AS active_loans,
        (SELECT COUNT(*) FROM loans WHERE returned_at IS NULL AND due_at < now())::int AS overdue,
        (SELECT COUNT(*) FROM loans WHERE checked_out_at > now() - interval '30 days')::int AS loans_30d,
        (SELECT COUNT(*) FROM reservations WHERE created_at > now() - interval '30 days')::int AS reservations_30d`),
      query(`SELECT b.id, b.title, b.author, b.cover_url, b.cover_key, b.available_copies, b.total_copies,
                    (SELECT COUNT(*) FROM loans l WHERE l.book_id=b.id AND l.checked_out_at > now() - interval '90 days')::int
                  + (SELECT COUNT(*) FROM reservations r WHERE r.book_id=b.id AND r.created_at > now() - interval '90 days')::int AS demand
               FROM books b ORDER BY demand DESC, b.title LIMIT 6`),
      query(`SELECT category AS name, COUNT(*)::int AS titles, SUM(total_copies)::int AS copies
               FROM books GROUP BY category ORDER BY copies DESC LIMIT 8`),
      query(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
                    (SELECT COUNT(*) FROM loans l WHERE l.checked_out_at::date = d::date)::int AS loans,
                    (SELECT COUNT(*) FROM reservations r WHERE r.created_at::date = d::date)::int AS reservations
               FROM generate_series(current_date - interval '13 days', current_date, interval '1 day') d ORDER BY d`),
      query(`SELECT a.id, a.action, a.details, a.created_at, b.title AS book_title, u.name AS user_name, act.name AS actor_name
               FROM activity_log a
               LEFT JOIN books b ON b.id=a.book_id
               LEFT JOIN users u ON u.id=a.user_id
               LEFT JOIN users act ON act.id=a.actor_id
              ORDER BY a.created_at DESC LIMIT 12`),
      query(`SELECT status, COUNT(*)::int AS count FROM notifications GROUP BY status`),
    ]);
    await withCoverUrls(popular.rows);
    res.json({
      totals: totals.rows[0],
      popular: popular.rows,
      categories: categories.rows,
      daily: daily.rows,
      activity: activity.rows,
      emails: Object.fromEntries(emails.rows.map((r) => [r.status, r.count])),
      system: {
        cache: cacheMode(),
        notifications: notificationMode(),
        storage: config.s3Bucket ? 's3' : 'local',
        readReplica: hasReadReplica(),
      },
    });
  }),
);

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = pageParams(req.query, 25, 100);
    const q = String(req.query.q || '').trim();
    const params = [limit, offset];
    const where = [];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.student_id ILIKE $${params.length})`);
    }
    if (['student', 'staff', 'librarian'].includes(req.query.role)) {
      params.push(req.query.role);
      where.push(`u.role = $${params.length}`);
    }
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.role, u.student_id, u.department, u.is_active, u.created_at,
              (SELECT COUNT(*) FROM loans l WHERE l.user_id=u.id AND l.returned_at IS NULL)::int AS active_loans,
              (SELECT COUNT(*) FROM loans l WHERE l.user_id=u.id AND l.returned_at IS NULL AND l.due_at < now())::int AS overdue,
              (SELECT COUNT(*) FROM reservations r WHERE r.user_id=u.id AND r.status IN ('reserved','waitlisted'))::int AS active_reservations,
              COUNT(*) OVER()::int AS total_count
         FROM users u
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY u.created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    );
    const total = rows[0]?.total_count ?? 0;
    res.json({ users: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }),
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const data = parse(
      z.object({ role: z.enum(['student', 'staff', 'librarian']).optional(), is_active: z.boolean().optional() }),
      req.body,
    );
    if (id === req.user.id && (data.role && data.role !== 'librarian' || data.is_active === false)) {
      throw new HttpError(400, "You can't remove your own librarian access");
    }
    const { rows } = await query(
      `UPDATE users SET role=COALESCE($2, role), is_active=COALESCE($3, is_active) WHERE id=$1
       RETURNING id, name, email, role, student_id, department, is_active, created_at`,
      [id, data.role ?? null, data.is_active ?? null],
    );
    if (!rows[0]) throw new HttpError(404, 'User not found');
    await logActivity({ query }, { actorId: req.user.id, action: 'user_updated', userId: id, details: data });
    res.json({ user: rows[0] });
  }),
);

// Manually trigger the daily job (handy for the live demo)
router.post(
  '/jobs/run',
  asyncHandler(async (_req, res) => {
    const result = await runDailyJobs();
    const retried = await retryPending();
    res.json({ ...result, retriedEmails: retried });
  }),
);

export default router;
