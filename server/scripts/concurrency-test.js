/**
 * Concurrency test: N students click "Reserve" on the LAST copy at the same instant.
 * Expected: exactly 1 gets the copy, the other N-1 are waitlisted in FIFO order.
 *
 *   API_URL=http://localhost:8080 npm run test:concurrency
 *   API_URL=https://your-eb-env.elasticbeanstalk.com STUDENTS=20 npm run test:concurrency
 */
const API = (process.env.API_URL || 'http://localhost:8080').replace(/\/$/, '');
const N = Number(process.env.STUDENTS || 10);
const LIBRARIAN = { email: process.env.LIB_EMAIL || 'librarian@cst.edu.bt', password: process.env.LIB_PASSWORD || 'Password@123' };

async function api(path, { token, ...opts } = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const body = res.status === 204 ? null : await res.json();
  return { status: res.status, body };
}

const run = Date.now();
console.log(`\nConcurrency test against ${API} with ${N} students\n`);

const lib = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(LIBRARIAN) });
if (lib.status !== 200) throw new Error(`Librarian login failed: ${JSON.stringify(lib.body)}`);
const libToken = lib.body.token;

// A fresh single-copy book so the test is repeatable
const created = await api('/api/books', {
  method: 'POST',
  token: libToken,
  body: JSON.stringify({ title: `Concurrency Test Book ${run}`, author: 'Test Harness', category: 'Test', total_copies: 1 }),
});
const bookId = created.body.book.id;
console.log(`Created test book #${bookId} with 1 copy`);

const tokens = await Promise.all(
  Array.from({ length: N }, async (_, i) => {
    const r = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: `Load Student ${i + 1}`, email: `load-${run}-${i}@test.local`, password: 'Password@123' }),
    });
    if (r.status !== 201) throw new Error(`Register failed: ${JSON.stringify(r.body)}`);
    return r.body.token;
  }),
);

console.log(`Firing ${N} simultaneous reservation requests...`);
const t0 = performance.now();
const results = await Promise.all(
  tokens.map((token) => api('/api/reservations', { method: 'POST', token, body: JSON.stringify({ bookId }) })),
);
const ms = Math.round(performance.now() - t0);

const reserved = results.filter((r) => r.body?.outcome === 'reserved').length;
const waitlisted = results.filter((r) => r.body?.outcome === 'waitlisted');
const errors = results.filter((r) => r.status >= 400);
const positions = waitlisted.map((r) => r.body.position).sort((a, b) => a - b);
const uniquePositions = new Set(positions).size === positions.length;

const book = await api(`/api/books/${bookId}`);
console.log(`\nResults in ${ms} ms:`);
console.log(`  reserved:   ${reserved}`);
console.log(`  waitlisted: ${waitlisted.length}  (positions ${positions.join(', ')})`);
console.log(`  errors:     ${errors.length}`);
console.log(`  book available_copies after: ${book.body.book.available_copies}`);

const pass = reserved === 1 && waitlisted.length === N - 1 && errors.length === 0 && uniquePositions && book.body.book.available_copies === 0;
console.log(pass ? '\nPASS: exactly one student got the last copy\n' : '\nFAIL: invariant violated\n');

// Clean up: cancel everything and delete the test book
const all = await api(`/api/reservations?q=${encodeURIComponent(`Concurrency Test Book ${run}`)}`, { token: libToken });
for (const r of all.body.reservations || []) await api(`/api/reservations/${r.id}`, { method: 'DELETE', token: libToken });
await api(`/api/books/${bookId}`, { method: 'DELETE', token: libToken });
process.exit(pass ? 0 : 1);
