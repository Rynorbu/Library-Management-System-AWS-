import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { asyncHandler, parse, pageParams } from '../utils/http.js';
import { requireAuth, requireLibrarian } from '../middleware/auth.js';
import { checkout, returnLoan, renewLoan } from '../services/reservationService.js';
import { withCoverUrls } from '../services/storage.js';
import { config } from '../config.js';

const router = Router();

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT l.*, b.title, b.author, b.cover_url, b.cover_key,
              (SELECT COUNT(*) FROM reservations r WHERE r.book_id=l.book_id AND r.status='waitlisted')::int AS waitlist_count
         FROM loans l JOIN books b ON b.id=l.book_id
        WHERE l.user_id=$1
        ORDER BY (l.returned_at IS NULL) DESC, COALESCE(l.returned_at, l.due_at) DESC
        LIMIT 200`,
      [req.user.id],
    );
    await withCoverUrls(rows);
    res.json({ loans: rows, maxRenewals: config.maxRenewals });
  }),
);

router.post(
  '/:id/renew',
  requireAuth,
  asyncHandler(async (req, res) => {
    const loan = await renewLoan(req.user.id, parseInt(req.params.id, 10));
    res.json({ loan, message: 'Loan renewed' });
  }),
);

// Librarian: ?status=active|overdue|returned&q=
router.get(
  '/',
  requireLibrarian,
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = pageParams(req.query, 50, 200);
    const filters = {
      active: 'l.returned_at IS NULL',
      overdue: 'l.returned_at IS NULL AND l.due_at < now()',
      returned: 'l.returned_at IS NOT NULL',
    };
    const status = filters[req.query.status] ? req.query.status : 'active';
    const params = [limit, offset];
    let search = '';
    const q = String(req.query.q || '').trim();
    if (q) {
      params.push(`%${q}%`);
      search = `AND (u.name ILIKE $3 OR u.email ILIKE $3 OR u.student_id ILIKE $3 OR b.title ILIKE $3 OR b.isbn ILIKE $3)`;
    }
    const { rows } = await query(
      `SELECT l.*, b.title, b.author, b.cover_url, b.cover_key, b.shelf_location,
              u.name AS user_name, u.email AS user_email, u.student_id,
              COUNT(*) OVER()::int AS total_count
         FROM loans l JOIN books b ON b.id=l.book_id JOIN users u ON u.id=l.user_id
        WHERE ${filters[status]} ${search}
        ORDER BY ${status === 'returned' ? 'l.returned_at DESC' : 'l.due_at ASC'}
        LIMIT $1 OFFSET $2`,
      params,
    );
    const total = rows[0]?.total_count ?? 0;
    await withCoverUrls(rows);
    res.json({ loans: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }),
);

const checkoutSchema = z
  .object({
    reservationId: z.coerce.number().int().positive().optional(),
    userId: z.coerce.number().int().positive().optional(),
    bookId: z.coerce.number().int().positive().optional(),
  })
  .refine((d) => d.reservationId || (d.userId && d.bookId), 'Provide a reservationId, or both userId and bookId');

router.post(
  '/checkout',
  requireLibrarian,
  asyncHandler(async (req, res) => {
    const data = parse(checkoutSchema, req.body);
    const { loan, book, user } = await checkout(data, req.user.id);
    res.status(201).json({ loan, message: `"${book.title}" checked out to ${user.name}` });
  }),
);

router.post(
  '/:id/return',
  requireLibrarian,
  asyncHandler(async (req, res) => {
    const { book, promoted } = await returnLoan(parseInt(req.params.id, 10), req.user.id);
    res.json({
      promoted,
      message: promoted.length
        ? `"${book.title}" returned. Now held for ${promoted[0].name} (next on the waitlist) - they've been emailed.`
        : `"${book.title}" returned and back on the shelf.`,
    });
  }),
);

export default router;
