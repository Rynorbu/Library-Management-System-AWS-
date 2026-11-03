import { config } from '../config.js';
import { withTransaction, query } from '../db/index.js';
import { HttpError, logActivity } from '../utils/http.js';
import { queueNotification, dispatchInBackground } from './notificationService.js';
import { invalidateCatalog } from './cache.js';

/*
 * Concurrency model
 * -----------------
 * Every operation that changes a book's availability starts a transaction and takes a
 * row lock on the book with SELECT ... FOR UPDATE. Lock order is always
 * book -> reservation/loan, so operations on the same book are serialised and
 * cannot deadlock. If two students click "Reserve" on the last copy at the same
 * moment, the second one waits for the first to commit, then sees 0 copies and
 * joins the waitlist instead.
 *
 * Invariant: books.available_copies = total_copies - (active loans) - (reservations in 'reserved')
 */

const hoursFromNow = (h) => new Date(Date.now() + h * 3600_000);
const daysFrom = (base, d) => new Date(new Date(base).getTime() + d * 86400_000);

async function lockBook(db, bookId) {
  const { rows } = await db.query('SELECT * FROM books WHERE id = $1 FOR UPDATE', [bookId]);
  if (!rows[0]) throw new HttpError(404, 'Book not found');
  return rows[0];
}

async function getUser(db, userId) {
  const { rows } = await db.query('SELECT id, name, email, role, is_active FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw new HttpError(404, 'User not found');
  if (!rows[0].is_active) throw new HttpError(403, 'This account is deactivated');
  return rows[0];
}

/**
 * Hand any free copies to the front of the waitlist (FIFO). The book row must already
 * be locked and `book.available_copies` must reflect the copies now free.
 * Persists the final available_copies.
 */
async function allocateFreeCopies(db, book, outbox) {
  let available = book.available_copies;
  const promoted = [];
  while (available > 0) {
    const { rows } = await db.query(
      `SELECT r.id, r.user_id, u.name, u.email
         FROM reservations r JOIN users u ON u.id = r.user_id
        WHERE r.book_id = $1 AND r.status = 'waitlisted' AND u.is_active
        ORDER BY r.created_at, r.id
        LIMIT 1
        FOR UPDATE OF r`,
      [book.id],
    );
    const next = rows[0];
    if (!next) break;
    const deadline = hoursFromNow(config.pickupWindowHours);
    await db.query(
      `UPDATE reservations SET status='reserved', reserved_at=now(), pickup_deadline=$2, updated_at=now() WHERE id=$1`,
      [next.id, deadline],
    );
    available -= 1;
    promoted.push({ reservationId: next.id, userId: next.user_id, name: next.name });
    outbox.push(
      await queueNotification(db, {
        user: { id: next.user_id, name: next.name, email: next.email },
        type: 'book_available',
        data: { book, deadline },
      }),
    );
    await logActivity(db, { actorId: null, action: 'waitlist_promoted', bookId: book.id, userId: next.user_id });
  }
  await db.query('UPDATE books SET available_copies=$2, updated_at=now() WHERE id=$1', [book.id, available]);
  book.available_copies = available;
  return promoted;
}

async function waitlistPosition(db, reservationId, bookId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS pos FROM reservations
      WHERE book_id = $1 AND status = 'waitlisted'
        AND (created_at, id) <= (SELECT created_at, id FROM reservations WHERE id = $2)`,
    [bookId, reservationId],
  );
  return rows[0].pos;
}

/** Runs fn in a transaction, then publishes queued emails and invalidates the cache. */
async function run(fn) {
  const outbox = [];
  const result = await withTransaction((db) => fn(db, outbox));
  dispatchInBackground(outbox);
  await invalidateCatalog();
  return result;
}

// ---------------------------------------------------------------------------------------

export function reserveBook(userId, bookId) {
  return run(async (db, outbox) => {
    const user = await getUser(db, userId);
    const book = await lockBook(db, bookId);

    const { rows: existing } = await db.query(
      `SELECT status FROM reservations WHERE user_id=$1 AND book_id=$2 AND status IN ('reserved','waitlisted')`,
      [userId, bookId],
    );
    if (existing[0]) {
      throw new HttpError(
        409,
        existing[0].status === 'reserved' ? 'A copy of this book is already held for you' : 'You are already on the waitlist for this book',
      );
    }
    const { rowCount: onLoan } = await db.query(
      'SELECT 1 FROM loans WHERE user_id=$1 AND book_id=$2 AND returned_at IS NULL',
      [userId, bookId],
    );
    if (onLoan) throw new HttpError(409, 'You already have this book on loan');

    const { rows: cnt } = await db.query(
      `SELECT COUNT(*)::int AS n FROM reservations WHERE user_id=$1 AND status IN ('reserved','waitlisted')`,
      [userId],
    );
    if (cnt[0].n >= config.maxActiveReservations) {
      throw new HttpError(422, `You can have at most ${config.maxActiveReservations} active reservations`);
    }
    if (book.total_copies === 0) throw new HttpError(422, 'This title has no circulating copies');

    if (book.available_copies > 0) {
      const deadline = hoursFromNow(config.pickupWindowHours);
      const { rows } = await db.query(
        `INSERT INTO reservations (user_id, book_id, status, reserved_at, pickup_deadline, created_at)
         VALUES ($1, $2, 'reserved', now(), $3, clock_timestamp()) RETURNING *`,
        [userId, bookId, deadline],
      );
      await db.query('UPDATE books SET available_copies = available_copies - 1, updated_at=now() WHERE id=$1', [bookId]);
      outbox.push(await queueNotification(db, { user, type: 'reservation_confirmed', data: { book, deadline } }));
      await logActivity(db, { actorId: userId, action: 'reserved', bookId, userId });
      return { outcome: 'reserved', reservation: rows[0], book: { ...book, available_copies: book.available_copies - 1 } };
    }

    // clock_timestamp() (not now(), which is the transaction START time) so queue order
    // matches the order in which requests acquired the book lock - true first-come, first-served.
    const { rows } = await db.query(
      `INSERT INTO reservations (user_id, book_id, status, created_at) VALUES ($1, $2, 'waitlisted', clock_timestamp()) RETURNING *`,
      [userId, bookId],
    );
    const position = await waitlistPosition(db, rows[0].id, bookId);
    outbox.push(await queueNotification(db, { user, type: 'waitlist_joined', data: { book, position } }));
    await logActivity(db, { actorId: userId, action: 'waitlisted', bookId, userId, details: { position } });
    return { outcome: 'waitlisted', reservation: rows[0], position, book };
  });
}

export function cancelReservation(actor, reservationId) {
  return run(async (db, outbox) => {
    const { rows: pre } = await db.query('SELECT book_id FROM reservations WHERE id=$1', [reservationId]);
    if (!pre[0]) throw new HttpError(404, 'Reservation not found');
    const book = await lockBook(db, pre[0].book_id);

    const { rows } = await db.query(
      `SELECT r.*, u.name, u.email FROM reservations r JOIN users u ON u.id=r.user_id WHERE r.id=$1 FOR UPDATE OF r`,
      [reservationId],
    );
    const r = rows[0];
    const isLibrarian = actor.role === 'librarian';
    if (r.user_id !== actor.id && !isLibrarian) throw new HttpError(403, 'You cannot cancel this reservation');
    if (!['reserved', 'waitlisted'].includes(r.status)) throw new HttpError(409, `Reservation is already ${r.status}`);

    await db.query(`UPDATE reservations SET status='cancelled', updated_at=now() WHERE id=$1`, [r.id]);
    let promoted = [];
    if (r.status === 'reserved') {
      book.available_copies += 1;
      promoted = await allocateFreeCopies(db, book, outbox);
    }
    outbox.push(
      await queueNotification(db, {
        user: { id: r.user_id, name: r.name, email: r.email },
        type: 'reservation_cancelled',
        data: { book, byLibrarian: isLibrarian && r.user_id !== actor.id },
      }),
    );
    await logActivity(db, { actorId: actor.id, action: 'reservation_cancelled', bookId: book.id, userId: r.user_id });
    return { cancelled: r.id, promoted };
  });
}

/**
 * Librarian check-out. Either from a held reservation ({ reservationId })
 * or a walk-in loan ({ userId, bookId }).
 */
export function checkout({ reservationId, userId, bookId }, librarianId) {
  return run(async (db, outbox) => {
    let reservation = null;
    if (reservationId) {
      const { rows: pre } = await db.query('SELECT book_id, user_id FROM reservations WHERE id=$1', [reservationId]);
      if (!pre[0]) throw new HttpError(404, 'Reservation not found');
      bookId = pre[0].book_id;
      userId = pre[0].user_id;
    }
    if (!userId || !bookId) throw new HttpError(400, 'Provide a reservationId, or a userId and bookId');

    const book = await lockBook(db, bookId);
    const user = await getUser(db, userId);

    const { rowCount: onLoan } = await db.query(
      'SELECT 1 FROM loans WHERE user_id=$1 AND book_id=$2 AND returned_at IS NULL',
      [userId, bookId],
    );
    if (onLoan) throw new HttpError(409, `${user.name} already has this book on loan`);

    // Does the borrower have an active reservation for this book?
    const { rows: res } = await db.query(
      `SELECT * FROM reservations WHERE user_id=$1 AND book_id=$2 AND status IN ('reserved','waitlisted') FOR UPDATE`,
      [userId, bookId],
    );
    reservation = res[0] || null;

    if (reservation?.status === 'reserved') {
      // Copy was already set aside - availability does not change.
    } else {
      if (reservationId) throw new HttpError(409, 'This reservation is still on the waitlist - no copy is held yet');
      if (book.available_copies < 1) {
        throw new HttpError(409, 'No copies available: every copy is on loan or held for another reservation');
      }
      await db.query('UPDATE books SET available_copies = available_copies - 1, updated_at=now() WHERE id=$1', [bookId]);
    }
    if (reservation) {
      await db.query(`UPDATE reservations SET status='fulfilled', updated_at=now() WHERE id=$1`, [reservation.id]);
    }

    const dueAt = daysFrom(Date.now(), config.loanPeriodDays);
    const { rows } = await db.query(
      `INSERT INTO loans (user_id, book_id, reservation_id, due_at, checked_out_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, bookId, reservation?.id ?? null, dueAt, librarianId],
    );
    outbox.push(await queueNotification(db, { user, type: 'checked_out', data: { book, dueAt } }));
    await logActivity(db, { actorId: librarianId, action: 'checked_out', bookId, userId });
    return { loan: rows[0], book, user };
  });
}

/** Librarian check-in. Frees the copy and promotes the first waitlisted student. */
export function returnLoan(loanId, librarianId) {
  return run(async (db, outbox) => {
    const { rows: pre } = await db.query('SELECT book_id FROM loans WHERE id=$1', [loanId]);
    if (!pre[0]) throw new HttpError(404, 'Loan not found');
    const book = await lockBook(db, pre[0].book_id);

    const { rows } = await db.query(
      `SELECT l.*, u.name, u.email FROM loans l JOIN users u ON u.id=l.user_id WHERE l.id=$1 FOR UPDATE OF l`,
      [loanId],
    );
    const loan = rows[0];
    if (loan.returned_at) throw new HttpError(409, 'This loan has already been returned');

    await db.query('UPDATE loans SET returned_at=now(), checked_in_by=$2 WHERE id=$1', [loanId, librarianId]);
    outbox.push(
      await queueNotification(db, { user: { id: loan.user_id, name: loan.name, email: loan.email }, type: 'returned', data: { book } }),
    );
    await logActivity(db, {
      actorId: librarianId,
      action: 'returned',
      bookId: book.id,
      userId: loan.user_id,
      details: { overdue: new Date(loan.due_at) < new Date() },
    });

    book.available_copies += 1;
    const promoted = await allocateFreeCopies(db, book, outbox);
    return { loanId, book, promoted };
  });
}

export function renewLoan(userId, loanId) {
  return run(async (db, outbox) => {
    const { rows: pre } = await db.query('SELECT book_id FROM loans WHERE id=$1', [loanId]);
    if (!pre[0]) throw new HttpError(404, 'Loan not found');
    const book = await lockBook(db, pre[0].book_id);
    const { rows } = await db.query(
      `SELECT l.*, u.name, u.email FROM loans l JOIN users u ON u.id=l.user_id WHERE l.id=$1 FOR UPDATE OF l`,
      [loanId],
    );
    const loan = rows[0];
    if (loan.user_id !== userId) throw new HttpError(403, 'This is not your loan');
    if (loan.returned_at) throw new HttpError(409, 'This loan has already been returned');
    if (new Date(loan.due_at) < new Date()) throw new HttpError(409, 'Overdue loans cannot be renewed - please return the book');
    if (loan.renewals >= config.maxRenewals) throw new HttpError(409, `Loans can be renewed at most ${config.maxRenewals} time(s)`);

    const { rows: w } = await db.query(
      `SELECT COUNT(*)::int AS n FROM reservations WHERE book_id=$1 AND status='waitlisted'`,
      [book.id],
    );
    if (w[0].n > 0) throw new HttpError(409, 'Other students are waiting for this book, so it cannot be renewed');

    const dueAt = daysFrom(loan.due_at, config.loanPeriodDays);
    const { rows: updated } = await db.query(
      'UPDATE loans SET due_at=$2, renewals=renewals+1, reminder_sent_at=NULL WHERE id=$1 RETURNING *',
      [loanId, dueAt],
    );
    outbox.push(await queueNotification(db, { user: { id: userId, name: loan.name, email: loan.email }, type: 'renewed', data: { book, dueAt } }));
    await logActivity(db, { actorId: userId, action: 'renewed', bookId: book.id, userId });
    return updated[0];
  });
}

const BOOK_FIELDS = ['isbn', 'title', 'author', 'publisher', 'published_year', 'category', 'description', 'cover_url', 'cover_key', 'shelf_location'];

/**
 * Librarian edit. Changing total_copies keeps the availability invariant, and any
 * extra copies go straight to students on the waitlist.
 */
export function updateBook(bookId, fields, actorId) {
  return run(async (db, outbox) => {
    const book = await lockBook(db, bookId);
    const sets = [];
    const values = [bookId];
    for (const f of BOOK_FIELDS) {
      if (fields[f] !== undefined) {
        values.push(fields[f]);
        sets.push(`${f} = $${values.length}`);
        book[f] = fields[f];
      }
    }
    if (sets.length) {
      await db.query(`UPDATE books SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
    }

    if (fields.total_copies !== undefined && fields.total_copies !== book.total_copies) {
      const outstanding = book.total_copies - book.available_copies; // on loan + held
      if (fields.total_copies < outstanding) {
        throw new HttpError(422, `${outstanding} copies are on loan or held, so total copies cannot be less than ${outstanding}`);
      }
      // Lower available first so the CHECK (available <= total) holds at every step
      await db.query('UPDATE books SET available_copies = 0 WHERE id = $1', [bookId]);
      await db.query('UPDATE books SET total_copies = $2 WHERE id = $1', [bookId, fields.total_copies]);
      book.total_copies = fields.total_copies;
      book.available_copies = fields.total_copies - outstanding;
      await allocateFreeCopies(db, book, outbox);
    }
    await logActivity(db, { actorId, action: 'book_updated', bookId });
    const { rows } = await db.query('SELECT * FROM books WHERE id = $1', [bookId]);
    return rows[0];
  });
}

// ----------------------------------------------------------------- scheduled jobs ------

/** Expire uncollected holds and pass the copy on. Safe to run on many instances at once. */
export async function expireHolds() {
  const { rows } = await query(
    `SELECT id, book_id FROM reservations WHERE status='reserved' AND pickup_deadline < now() ORDER BY pickup_deadline LIMIT 200`,
  );
  let expired = 0;
  for (const { id, book_id } of rows) {
    try {
      const did = await run(async (db, outbox) => {
        const book = await lockBook(db, book_id);
        const { rows: r } = await db.query(
          `SELECT r.*, u.name, u.email FROM reservations r JOIN users u ON u.id=r.user_id
            WHERE r.id=$1 AND r.status='reserved' AND r.pickup_deadline < now() FOR UPDATE OF r SKIP LOCKED`,
          [id],
        );
        if (!r[0]) return false;
        await db.query(`UPDATE reservations SET status='expired', updated_at=now() WHERE id=$1`, [id]);
        outbox.push(
          await queueNotification(db, { user: { id: r[0].user_id, name: r[0].name, email: r[0].email }, type: 'reservation_expired', data: { book } }),
        );
        await logActivity(db, { actorId: null, action: 'hold_expired', bookId: book.id, userId: r[0].user_id });
        book.available_copies += 1;
        await allocateFreeCopies(db, book, outbox);
        return true;
      });
      if (did) expired += 1;
    } catch (err) {
      console.error(`[jobs] failed to expire reservation ${id}:`, err.message);
    }
  }
  return expired;
}

/**
 * Daily reminders - triggered by EventBridge Scheduler -> Lambda -> /api/internal/jobs/daily
 * (or in-process during local development).
 */
export async function sendDailyReminders() {
  const counts = { pickupReminders: 0, dueReminders: 0, overdueNotices: 0 };
  const outbox = [];
  await withTransaction(async (db) => {
    const pickups = await db.query(
      `SELECT b.*, r.id AS reservation_id, r.pickup_deadline, u.id AS user_id, u.name, u.email
         FROM reservations r JOIN users u ON u.id=r.user_id JOIN books b ON b.id=r.book_id
        WHERE r.status='reserved' AND r.reminder_sent_at IS NULL
          AND r.pickup_deadline BETWEEN now() AND now() + interval '24 hours'
        FOR UPDATE OF r SKIP LOCKED`,
    );
    for (const row of pickups.rows) {
      outbox.push(
        await queueNotification(db, {
          user: { id: row.user_id, name: row.name, email: row.email },
          type: 'pickup_reminder',
          data: { book: row, deadline: row.pickup_deadline },
        }),
      );
      await db.query('UPDATE reservations SET reminder_sent_at=now() WHERE id=$1', [row.reservation_id]);
      counts.pickupReminders += 1;
    }

    const due = await db.query(
      `SELECT l.id AS loan_id, l.due_at, u.id AS user_id, u.name, u.email, b.*
         FROM loans l JOIN users u ON u.id=l.user_id JOIN books b ON b.id=l.book_id
        WHERE l.returned_at IS NULL AND l.reminder_sent_at IS NULL
          AND l.due_at BETWEEN now() AND now() + interval '2 days'
        FOR UPDATE OF l SKIP LOCKED`,
    );
    for (const row of due.rows) {
      outbox.push(
        await queueNotification(db, {
          user: { id: row.user_id, name: row.name, email: row.email },
          type: 'due_reminder',
          data: { book: row, dueAt: row.due_at },
        }),
      );
      await db.query('UPDATE loans SET reminder_sent_at=now() WHERE id=$1', [row.loan_id]);
      counts.dueReminders += 1;
    }

    const overdue = await db.query(
      `SELECT l.id AS loan_id, l.due_at, u.id AS user_id, u.name, u.email, b.*
         FROM loans l JOIN users u ON u.id=l.user_id JOIN books b ON b.id=l.book_id
        WHERE l.returned_at IS NULL AND l.due_at < now()
          AND (l.overdue_notice_at IS NULL OR l.overdue_notice_at < now() - interval '3 days')
        FOR UPDATE OF l SKIP LOCKED`,
    );
    for (const row of overdue.rows) {
      outbox.push(
        await queueNotification(db, {
          user: { id: row.user_id, name: row.name, email: row.email },
          type: 'overdue_notice',
          data: { book: row, dueAt: row.due_at },
        }),
      );
      await db.query('UPDATE loans SET overdue_notice_at=now() WHERE id=$1', [row.loan_id]);
      counts.overdueNotices += 1;
    }
  });
  dispatchInBackground(outbox);
  return counts;
}

export async function runDailyJobs() {
  const expiredHolds = await expireHolds();
  const reminders = await sendDailyReminders();
  return { expiredHolds, ...reminders };
}
