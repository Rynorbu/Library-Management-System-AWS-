import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { asyncHandler, parse, pageParams } from '../utils/http.js';
import { requireAuth, requireLibrarian } from '../middleware/auth.js';
import { reserveBook, cancelReservation } from '../services/reservationService.js';
import { withCoverUrls } from '../services/storage.js';

const router = Router();

// Reserve a copy, or join the waitlist if none are free
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bookId } = parse(z.object({ bookId: z.coerce.number().int().positive() }), req.body);
    const result = await reserveBook(req.user.id, bookId);
    res.status(201).json({
      outcome: result.outcome,
      reservation: result.reservation,
      position: result.position ?? null,
      message:
        result.outcome === 'reserved'
          ? `Reserved! Collect "${result.book.title}" from the circulation desk before your pickup deadline.`
          : `All copies are out. You're #${result.position} on the waitlist - we'll email you when it's ready.`,
    });
  }),
);

// The signed-in user's reservations (active + history)
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT r.*, b.title, b.author, b.cover_url, b.cover_key, b.shelf_location,
              CASE WHEN r.status='waitlisted' THEN (
                SELECT COUNT(*) FROM reservations w
                 WHERE w.book_id=r.book_id AND w.status='waitlisted' AND (w.created_at, w.id) <= (r.created_at, r.id)
              )::int END AS position
         FROM reservations r JOIN books b ON b.id=r.book_id
        WHERE r.user_id=$1
        ORDER BY CASE r.status WHEN 'reserved' THEN 0 WHEN 'waitlisted' THEN 1 ELSE 2 END, r.updated_at DESC
        LIMIT 200`,
      [req.user.id],
    );
    await withCoverUrls(rows);
    res.json({ reservations: rows });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await cancelReservation(req.user, parseInt(req.params.id, 10));
    res.json(result);
  }),
);

// Librarian view: ?status=reserved|waitlisted|all&q=
router.get(
  '/',
  requireLibrarian,
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = pageParams(req.query, 50, 200);
    const status = ['reserved', 'waitlisted', 'fulfilled', 'cancelled', 'expired'].includes(req.query.status)
      ? [req.query.status]
      : ['reserved', 'waitlisted'];
    const q = String(req.query.q || '').trim();
    const params = [status, limit, offset];
    let search = '';
    if (q) {
      params.push(`%${q}%`);
      search = `AND (u.name ILIKE $4 OR u.email ILIKE $4 OR u.student_id ILIKE $4 OR b.title ILIKE $4 OR b.isbn ILIKE $4)`;
    }
    const { rows } = await query(
      `SELECT r.*, b.title, b.author, b.cover_url, b.cover_key, b.shelf_location,
              u.name AS user_name, u.email AS user_email, u.student_id,
              CASE WHEN r.status='waitlisted' THEN (
                SELECT COUNT(*) FROM reservations w
                 WHERE w.book_id=r.book_id AND w.status='waitlisted' AND (w.created_at, w.id) <= (r.created_at, r.id)
              )::int END AS position,
              COUNT(*) OVER()::int AS total_count
         FROM reservations r JOIN books b ON b.id=r.book_id JOIN users u ON u.id=r.user_id
        WHERE r.status = ANY($1) ${search}
        ORDER BY CASE WHEN r.status='reserved' THEN r.pickup_deadline END ASC NULLS LAST, b.title, r.created_at
        LIMIT $2 OFFSET $3`,
      params,
    );
    const total = rows[0]?.total_count ?? 0;
    await withCoverUrls(rows);
    res.json({ reservations: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }),
);

export default router;
