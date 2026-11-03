import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query, readQuery, withTransaction } from '../db/index.js';
import { asyncHandler, parse, pageParams, HttpError, logActivity } from '../utils/http.js';
import { optionalAuth, requireLibrarian } from '../middleware/auth.js';
import { cached, invalidateCatalog } from '../services/cache.js';
import { saveCover, withCoverUrls } from '../services/storage.js';
import { updateBook } from '../services/reservationService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const SORTS = {
  title: 'lower(b.title) ASC',
  newest: 'b.created_at DESC',
  popular: 'popularity DESC, lower(b.title) ASC',
  available: 'b.available_copies DESC, lower(b.title) ASC',
};

// GET /api/books?q=&category=&available=true&sort=title&page=1&limit=12
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pageParams(req.query, 12, 100);
    const q = String(req.query.q || '').trim().slice(0, 100);
    const category = String(req.query.category || '').trim();
    const availableOnly = req.query.available === 'true';
    const sort = SORTS[req.query.sort] ? req.query.sort : 'title';

    const cacheKey = `list:${q}:${category}:${availableOnly}:${sort}:${page}:${limit}`;
    const result = await cached(cacheKey, 60, async () => {
      const where = [];
      const params = [];
      if (q) {
        params.push(`%${q}%`);
        const p = `$${params.length}`;
        where.push(`(b.title ILIKE ${p} OR b.author ILIKE ${p} OR b.isbn ILIKE ${p} OR b.category ILIKE ${p})`);
      }
      if (category) {
        params.push(category);
        where.push(`b.category = $${params.length}`);
      }
      if (availableOnly) where.push('b.available_copies > 0');
      params.push(limit, offset);

      const { rows } = await readQuery(
        `SELECT b.*,
                (SELECT COUNT(*) FROM reservations r WHERE r.book_id=b.id AND r.status='waitlisted')::int AS waitlist_count,
                (SELECT COUNT(*) FROM loans l WHERE l.book_id=b.id AND l.checked_out_at > now() - interval '180 days')::int AS popularity,
                COUNT(*) OVER()::int AS total_count
           FROM books b
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY ${SORTS[sort]}
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const total = rows[0]?.total_count ?? 0;
      rows.forEach((r) => delete r.total_count);
      return { books: rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
    });

    await withCoverUrls(result.books);
    res.json(result);
  }),
);

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await cached('categories', 300, async () => {
      const { rows } = await readQuery(
        'SELECT category AS name, COUNT(*)::int AS count FROM books GROUP BY category ORDER BY category',
      );
      return rows;
    });
    res.json({ categories });
  }),
);

// Auto-fill a new book from Open Library by ISBN
router.get(
  '/lookup/:isbn',
  requireLibrarian,
  asyncHandler(async (req, res) => {
    const isbn = req.params.isbn.replace(/[^0-9Xx]/g, '');
    if (isbn.length !== 10 && isbn.length !== 13) throw new HttpError(400, 'ISBN must have 10 or 13 digits');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'CST-Library-Reservation-System/1.0' },
      });
      const data = (await r.json())[`ISBN:${isbn}`];
      if (!data) throw new HttpError(404, 'No book found for that ISBN on Open Library');
      const year = parseInt(String(data.publish_date || '').match(/\d{4}/)?.[0], 10);
      res.json({
        isbn,
        title: data.title + (data.subtitle ? `: ${data.subtitle}` : ''),
        author: (data.authors || []).map((a) => a.name).join(', '),
        publisher: data.publishers?.[0]?.name || '',
        published_year: Number.isFinite(year) ? year : null,
        cover_url: data.cover?.large || data.cover?.medium || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
        description: typeof data.notes === 'string' ? data.notes : data.notes?.value || '',
        category: data.subjects?.[0]?.name || '',
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, 'Could not reach Open Library - please enter the details manually');
    } finally {
      clearTimeout(t);
    }
  }),
);

router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) throw new HttpError(404, 'Book not found');
    const { rows } = await query(
      `SELECT b.*,
              (SELECT COUNT(*) FROM reservations r WHERE r.book_id=b.id AND r.status='waitlisted')::int AS waitlist_count,
              (SELECT COUNT(*) FROM reservations r WHERE r.book_id=b.id AND r.status='reserved')::int AS held_count,
              (SELECT COUNT(*) FROM loans l WHERE l.book_id=b.id AND l.returned_at IS NULL)::int AS on_loan_count,
              (SELECT MIN(l.due_at) FROM loans l WHERE l.book_id=b.id AND l.returned_at IS NULL) AS next_due_at
         FROM books b WHERE b.id=$1`,
      [id],
    );
    const book = rows[0];
    if (!book) throw new HttpError(404, 'Book not found');
    await withCoverUrls(book);

    let mine = null;
    if (req.user) {
      const r = await query(
        `SELECT r.id, r.status, r.pickup_deadline, r.created_at,
                CASE WHEN r.status='waitlisted' THEN (
                  SELECT COUNT(*) FROM reservations w
                   WHERE w.book_id=r.book_id AND w.status='waitlisted' AND (w.created_at, w.id) <= (r.created_at, r.id)
                )::int END AS position
           FROM reservations r
          WHERE r.user_id=$1 AND r.book_id=$2 AND r.status IN ('reserved','waitlisted')`,
        [req.user.id, id],
      );
      const l = await query(
        'SELECT id, due_at, renewals FROM loans WHERE user_id=$1 AND book_id=$2 AND returned_at IS NULL',
        [req.user.id, id],
      );
      mine = { reservation: r.rows[0] || null, loan: l.rows[0] || null };
    }

    const related = await readQuery(
      `SELECT id, title, author, cover_url, cover_key, available_copies, total_copies
         FROM books WHERE category=$1 AND id<>$2 ORDER BY random() LIMIT 4`,
      [book.category, id],
    );
    await withCoverUrls(related.rows);
    res.json({ book, mine, related: related.rows });
  }),
);

// ---------------------------------------------------------------- librarian only -----

const nullableStr = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const bookSchema = z.object({
  isbn: nullableStr(20),
  title: z.string().trim().min(1, 'Title is required').max(300),
  author: z.string().trim().min(1, 'Author is required').max(300),
  publisher: nullableStr(200),
  published_year: z.coerce.number().int().min(1000).max(2100).nullable().optional().or(z.literal('').transform(() => null)),
  category: z.string().trim().min(1).max(80).default('General'),
  description: nullableStr(5000),
  cover_url: nullableStr(1000),
  shelf_location: nullableStr(60),
  total_copies: z.coerce.number().int().min(0).max(1000).default(1),
});

router.post(
  '/',
  requireLibrarian,
  asyncHandler(async (req, res) => {
    const b = parse(bookSchema, req.body);
    const book = await withTransaction(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO books (isbn, title, author, publisher, published_year, category, description, cover_url, shelf_location, total_copies, available_copies)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
        [b.isbn ?? null, b.title, b.author, b.publisher ?? null, b.published_year ?? null, b.category, b.description ?? null, b.cover_url ?? null, b.shelf_location ?? null, b.total_copies],
      );
      await logActivity(db, { actorId: req.user.id, action: 'book_added', bookId: rows[0].id });
      return rows[0];
    });
    await invalidateCatalog();
    res.status(201).json({ book: await withCoverUrls(book) });
  }),
);

router.put(
  '/:id',
  requireLibrarian,
  asyncHandler(async (req, res) => {
    const fields = parse(bookSchema.partial(), req.body);
    const book = await updateBook(parseInt(req.params.id, 10), fields, req.user.id);
    res.json({ book: await withCoverUrls(book) });
  }),
);

router.post(
  '/:id/cover',
  requireLibrarian,
  upload.single('cover'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Attach an image in the "cover" field');
    const key = await saveCover(req.file);
    const book = await updateBook(parseInt(req.params.id, 10), { cover_key: key }, req.user.id);
    res.json({ book: await withCoverUrls(book) });
  }),
);

router.delete(
  '/:id',
  requireLibrarian,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await withTransaction(async (db) => {
      const { rows } = await db.query('SELECT title FROM books WHERE id=$1 FOR UPDATE', [id]);
      if (!rows[0]) throw new HttpError(404, 'Book not found');
      const { rows: active } = await db.query(
        `SELECT (SELECT COUNT(*) FROM loans WHERE book_id=$1 AND returned_at IS NULL)::int AS loans,
                (SELECT COUNT(*) FROM reservations WHERE book_id=$1 AND status IN ('reserved','waitlisted'))::int AS reservations`,
        [id],
      );
      if (active[0].loans || active[0].reservations) {
        throw new HttpError(
          409,
          `Cannot delete: ${active[0].loans} active loan(s) and ${active[0].reservations} active reservation(s). Resolve them first.`,
        );
      }
      await logActivity(db, { actorId: req.user.id, action: 'book_deleted', details: { title: rows[0].title } });
      await db.query('DELETE FROM books WHERE id=$1', [id]);
    });
    await invalidateCatalog();
    res.status(204).end();
  }),
);

export default router;
