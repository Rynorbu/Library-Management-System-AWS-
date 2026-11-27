/**
 * API tests against a real PostgreSQL database (code fix C4).
 *   register / login -> reserve -> waitlist -> check out -> return -> waitlist promotion,
 *   plus the race for the last copy, the internal API token, the outbox claim (C2)
 *   and the client IP behind CloudFront (C6).
 *
 *   npm run db:up && npm test          (local, docker-compose Postgres)
 *   TEST_DATABASE_URL=postgres://...    (CI: a Postgres service container)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetTestDatabase, useTestEnvironment, listen, client } from './helpers.js';

useTestEnvironment();
console.log = () => {}; // in test mode the app "delivers" every email to the console

const { initDb, closeDb, query } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { createApp } = await import('../src/app.js');
const { retryPending } = await import('../src/services/notificationService.js');
const { default: bcrypt } = await import('bcryptjs');

const PASSWORD = 'Password@123';
let server;
let api;
let librarian;

async function register(name) {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}@test.local`;
  const r = await api('POST', '/api/auth/register', { body: { name, email, password: PASSWORD } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { name, email, token: r.body.token, id: r.body.user.id };
}

async function createBook(title, copies = 1) {
  const r = await api('POST', '/api/books', {
    token: librarian.token,
    body: { title, author: 'Test Author', category: 'Test', total_copies: copies },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.book;
}

const reserve = (student, bookId) => api('POST', '/api/reservations', { token: student.token, body: { bookId } });
const getBook = async (id) => (await api('GET', `/api/books/${id}`)).body.book;
const reservationOf = async (student, bookId) => {
  const r = await api('GET', '/api/reservations/me', { token: student.token });
  return r.body.reservations.find((x) => x.book_id === bookId && ['reserved', 'waitlisted'].includes(x.status));
};

before(async () => {
  await resetTestDatabase();
  await initDb();
  await migrate();
  const hash = await bcrypt.hash(PASSWORD, 4);
  await query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Test Librarian', 'librarian@test.local', $1, 'librarian')`,
    [hash],
  );
  server = await listen(createApp());
  api = client(server.url);
  const r = await api('POST', '/api/auth/login', { body: { email: 'librarian@test.local', password: PASSWORD } });
  librarian = { token: r.body.token };
});

after(async () => {
  // Let the background email dispatch (after each COMMIT) finish before closing the pool
  for (let i = 0; i < 40; i++) {
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM notifications WHERE status = 'queued'`);
    if (!rows[0].n) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await server?.close();
  await closeDb();
});

describe('health check', () => {
  it('GET /api/health reports the database as up', async () => {
    const r = await api('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.equal(r.body.db, 'up');
  });
});

describe('register and log in', () => {
  it('registers a student and never returns the password hash', async () => {
    const r = await api('POST', '/api/auth/register', {
      body: { name: 'Dorji Wangchuk', email: 'Dorji@Test.local', password: PASSWORD },
    });
    assert.equal(r.status, 201);
    assert.ok(r.body.token);
    assert.equal(r.body.user.role, 'student');
    assert.equal(r.body.user.email, 'dorji@test.local');
    assert.equal(JSON.stringify(r.body).includes('password'), false);
  });

  it('rejects a second account with the same email, in any letter case', async () => {
    const r = await api('POST', '/api/auth/register', {
      body: { name: 'Someone Else', email: 'DORJI@test.local', password: PASSWORD },
    });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already exists/);
  });

  it('validates input', async () => {
    const r = await api('POST', '/api/auth/register', { body: { name: 'X', email: 'not-an-email', password: '123' } });
    assert.equal(r.status, 400);
  });

  it('refuses a wrong password and accepts the right one', async () => {
    const wrong = await api('POST', '/api/auth/login', { body: { email: 'dorji@test.local', password: 'wrong-password' } });
    assert.equal(wrong.status, 401);
    const ok = await api('POST', '/api/auth/login', { body: { email: 'dorji@test.local', password: PASSWORD } });
    assert.equal(ok.status, 200);
    const me = await api('GET', '/api/auth/me', { token: ok.body.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.name, 'Dorji Wangchuk');
  });

  it('protects routes by sign-in and by role', async () => {
    assert.equal((await api('GET', '/api/auth/me')).status, 401);
    const student = await register('Role Check');
    const r = await api('POST', '/api/books', { token: student.token, body: { title: 'x', author: 'y' } });
    assert.equal(r.status, 403);
  });
});

describe('reserve -> waitlist -> check out -> return -> promotion', () => {
  let book;
  let a;
  let b;
  let c;
  let loanId;

  before(async () => {
    book = await createBook('Test-Driven Development', 1);
    [a, b, c] = [await register('Student A'), await register('Student B'), await register('Student C')];
  });

  it('student A reserves the only copy (held 48 h)', async () => {
    const r = await reserve(a, book.id);
    assert.equal(r.status, 201);
    assert.equal(r.body.outcome, 'reserved');
    const hours = (new Date(r.body.reservation.pickup_deadline) - Date.now()) / 3600_000;
    assert.ok(hours > 47 && hours <= 48, `pickup deadline ${hours} h away`);
    assert.equal((await getBook(book.id)).available_copies, 0);
  });

  it('student A cannot reserve the same book twice', async () => {
    const r = await reserve(a, book.id);
    assert.equal(r.status, 409);
  });

  it('students B and C join the waitlist in order', async () => {
    const rb = await reserve(b, book.id);
    assert.equal(rb.body.outcome, 'waitlisted');
    assert.equal(rb.body.position, 1);
    const rc = await reserve(c, book.id);
    assert.equal(rc.body.position, 2);
    assert.equal((await reservationOf(b, book.id)).position, 1);
  });

  it('writes an outbox email for each change in the same transaction', async () => {
    const { rows } = await query(
      `SELECT u.email, n.type FROM notifications n JOIN users u ON u.id = n.user_id
        WHERE n.user_id = ANY($1) ORDER BY n.id`,
      [[a.id, b.id, c.id]],
    );
    assert.deepEqual(
      rows.map((r) => r.type),
      ['reservation_confirmed', 'waitlist_joined', 'waitlist_joined'],
    );
  });

  it('the librarian checks the held copy out to student A', async () => {
    const held = await reservationOf(a, book.id);
    const r = await api('POST', '/api/loans/checkout', { token: librarian.token, body: { reservationId: held.id } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.loan.due_at);
    loanId = r.body.loan.id;
  });

  it('student A cannot renew while others are waiting', async () => {
    const r = await api('POST', `/api/loans/${loanId}/renew`, { token: a.token });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /waiting/);
  });

  it('returning the book promotes student B, and C moves up to #1', async () => {
    const r = await api('POST', `/api/loans/${loanId}/return`, { token: librarian.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.promoted.length, 1);
    assert.equal(r.body.promoted[0].name, 'Student B');
    assert.match(r.body.message, /Now held for Student B/);

    const heldForB = await reservationOf(b, book.id);
    assert.equal(heldForB.status, 'reserved');
    assert.ok(heldForB.pickup_deadline);
    assert.equal((await reservationOf(c, book.id)).position, 1);
    assert.equal((await getBook(book.id)).available_copies, 0, 'the copy is held for B, not on the shelf');

    const { rows } = await query(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'book_available'`, [b.id]);
    assert.equal(rows.length, 1, 'B gets a "now available" email');
  });

  it('when B cancels, the copy passes to C', async () => {
    const held = await reservationOf(b, book.id);
    const r = await api('DELETE', `/api/reservations/${held.id}`, { token: b.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.promoted[0].name, 'Student C');
    assert.equal((await reservationOf(c, book.id)).status, 'reserved');
  });
});

describe('race for the last copy', () => {
  it('10 simultaneous requests -> exactly 1 reserved, 9 waitlisted as #1..#9', async () => {
    const book = await createBook('Concurrency Test Book', 1);
    const students = await Promise.all(Array.from({ length: 10 }, (_, i) => register(`Racer ${i + 1}`)));
    const results = await Promise.all(students.map((s) => reserve(s, book.id)));

    assert.deepEqual(results.map((r) => r.status), Array(10).fill(201));
    assert.equal(results.filter((r) => r.body.outcome === 'reserved').length, 1);
    const positions = results.filter((r) => r.body.outcome === 'waitlisted').map((r) => r.body.position);
    assert.deepEqual(positions.sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal((await getBook(book.id)).available_copies, 0);
  });
});

describe('internal API (called by the Lambdas)', () => {
  it('rejects calls without the right X-Internal-Token', async () => {
    assert.equal((await api('POST', '/api/internal/jobs/daily')).status, 401);
    const wrong = await api('POST', '/api/internal/jobs/daily', { headers: { 'X-Internal-Token': 'nope' } });
    assert.equal(wrong.status, 401);
  });

  it('runs the daily jobs with the right token', async () => {
    const r = await api('POST', '/api/internal/jobs/daily', { headers: { 'X-Internal-Token': 'test-internal-token' } });
    assert.equal(r.status, 200);
    for (const key of ['expiredHolds', 'pickupReminders', 'dueReminders', 'overdueNotices']) {
      assert.equal(typeof r.body[key], 'number', key);
    }
  });
});

describe('outbox sweeper with several instances (C2)', () => {
  let userId;
  before(async () => {
    userId = (await register('Outbox Owner')).id;
  });

  const insertQueued = (n, claimedAt = 'NULL') =>
    query(
      `INSERT INTO notifications (user_id, type, recipient, subject, body, created_at, claimed_at)
       SELECT $1, 'test', 'outbox@test.local', 'Test ' || g, 'body', now() - interval '1 minute', ${claimedAt}
         FROM generate_series(1, $2) g RETURNING id`,
      [userId, n],
    ).then((r) => r.rows.map((x) => x.id));

  it('three sweepers running at once publish each email exactly once', async () => {
    const ids = await insertQueued(30);
    const counts = await Promise.all([retryPending(), retryPending(), retryPending()]);
    assert.equal(counts.reduce((s, n) => s + n, 0), 30, `claimed ${counts.join(' + ')}`);

    const { rows } = await query('SELECT status, attempts FROM notifications WHERE id = ANY($1)', [ids]);
    assert.ok(rows.every((r) => r.status === 'sent' && r.attempts === 1), 'every row sent once, attempts = 1');
  });

  it('leaves rows another instance is still publishing, and retries them after the lease', async () => {
    const [id] = await insertQueued(1, 'now()');
    assert.equal(await retryPending(), 0);
    await query(`UPDATE notifications SET claimed_at = now() - interval '6 minutes' WHERE id = $1`, [id]);
    assert.equal(await retryPending(), 1);
    const { rows } = await query('SELECT status FROM notifications WHERE id = $1', [id]);
    assert.equal(rows[0].status, 'sent');
  });
});

describe('client IP behind CloudFront -> ALB (C6)', () => {
  // X-Forwarded-For as the app sees it: "<viewer>, <CloudFront edge>" (the ALB is the socket)
  const remaining = async (viewer) => {
    const r = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `${viewer}, 130.176.0.1` },
      body: JSON.stringify({ email: 'nobody@test.local', password: 'x' }),
    });
    return Number(/remaining=(\d+)/.exec(r.headers.get('ratelimit'))[1]);
  };

  it('rate-limits each viewer separately, not everyone behind one edge IP together', async () => {
    const first = await remaining('203.0.113.10');
    const second = await remaining('203.0.113.20');
    assert.equal(second, first, 'a different viewer starts with a full allowance');
    assert.equal(await remaining('203.0.113.10'), first - 1, 'the same viewer is counted');
  });
});
