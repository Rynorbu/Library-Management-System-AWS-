import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initDb, withTransaction, query, closeDb } from './index.js';
import { migrate } from './migrate.js';

const cover = (isbn) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;

export const DEMO_PASSWORD = 'Password@123';

const USERS = [
  { name: 'Head Librarian', email: 'librarian@cst.edu.bt', role: 'librarian', department: 'Library Services' },
  { name: 'Tashi Dema', email: 'student.a@cst.edu.bt', role: 'student', student_id: '02230101', department: 'Information Technology' },
  { name: 'Karma Tenzin', email: 'student.b@cst.edu.bt', role: 'student', student_id: '02230102', department: 'Electronics & Communication' },
  { name: 'Pema Lhamo', email: 'student.c@cst.edu.bt', role: 'student', student_id: '02230103', department: 'Civil Engineering' },
  { name: 'Dr. Dechen Wangmo', email: 'staff@cst.edu.bt', role: 'staff', department: 'Department of IT' },
];

// [isbn, title, author, publisher, year, category, shelf, copies, description]
const BOOKS = [
  ['9780132350884', 'Clean Code', 'Robert C. Martin', 'Prentice Hall', 2008, 'Software Engineering', 'SE-A1', 1, 'A handbook of agile software craftsmanship: how to write code that is readable, maintainable and easy to change.'],
  ['9780135957059', 'The Pragmatic Programmer', 'David Thomas, Andrew Hunt', 'Addison-Wesley', 2019, 'Software Engineering', 'SE-A2', 3, 'Timeless, practical advice for becoming a better developer - from personal responsibility to architecture.'],
  ['9780201633610', 'Design Patterns', 'Gamma, Helm, Johnson, Vlissides', 'Addison-Wesley', 1994, 'Software Engineering', 'SE-A3', 2, 'The classic catalogue of 23 object-oriented design patterns from the "Gang of Four".'],
  ['9781449373320', 'Designing Data-Intensive Applications', 'Martin Kleppmann', "O'Reilly Media", 2017, 'Software Engineering', 'SE-B1', 1, 'The big ideas behind reliable, scalable and maintainable data systems.'],
  ['9780262033848', 'Introduction to Algorithms', 'Cormen, Leiserson, Rivest, Stein', 'MIT Press', 2009, 'Computer Science', 'CS-A1', 4, 'The comprehensive reference on algorithms and data structures used in universities worldwide.'],
  ['9780131103627', 'The C Programming Language', 'Brian W. Kernighan, Dennis M. Ritchie', 'Prentice Hall', 1988, 'Computer Science', 'CS-A2', 3, 'The definitive introduction to C, written by the language\'s creators.'],
  ['9780262510875', 'Structure and Interpretation of Computer Programs', 'Harold Abelson, Gerald Jay Sussman', 'MIT Press', 1996, 'Computer Science', 'CS-A3', 2, 'A foundational text on abstraction, recursion and the art of programming.'],
  ['9781118063330', 'Operating System Concepts', 'Abraham Silberschatz, Peter B. Galvin, Greg Gagne', 'Wiley', 2012, 'Computer Science', 'CS-B1', 3, 'Processes, memory, storage and security: the core concepts behind every modern OS.'],
  ['9780078022159', 'Database System Concepts', 'Silberschatz, Korth, Sudarshan', 'McGraw-Hill', 2019, 'Computer Science', 'CS-B2', 3, 'Relational design, SQL, transactions, concurrency control and recovery.'],
  ['9780133594140', 'Computer Networking: A Top-Down Approach', 'James F. Kurose, Keith W. Ross', 'Pearson', 2016, 'Computer Science', 'CS-B3', 4, 'Networking explained from the application layer down to the physical link.'],
  ['9780136042594', 'Artificial Intelligence: A Modern Approach', 'Stuart Russell, Peter Norvig', 'Pearson', 2009, 'Artificial Intelligence', 'AI-A1', 2, 'The leading textbook on artificial intelligence, from search to machine learning.'],
  ['9780262035613', 'Deep Learning', 'Ian Goodfellow, Yoshua Bengio, Aaron Courville', 'MIT Press', 2016, 'Artificial Intelligence', 'AI-A2', 2, 'The mathematical and conceptual background of deep neural networks.'],
  ['9781617295119', 'Amazon Web Services in Action', 'Andreas Wittig, Michael Wittig', 'Manning', 2018, 'Cloud & DevOps', 'CL-A1', 3, 'Hands-on guide to building and running applications on AWS.'],
  ['9780133387520', 'Cloud Computing: Concepts, Technology & Architecture', 'Thomas Erl', 'Prentice Hall', 2013, 'Cloud & DevOps', 'CL-A2', 2, 'Vendor-neutral models, mechanisms and architectures of cloud computing.'],
  ['9781491929124', 'Site Reliability Engineering', 'Betsy Beyer et al.', "O'Reilly Media", 2016, 'Cloud & DevOps', 'CL-A3', 2, 'How Google runs production systems: monitoring, incident response and automation.'],
  ['9780988262591', 'The Phoenix Project', 'Gene Kim, Kevin Behr, George Spafford', 'IT Revolution', 2013, 'Cloud & DevOps', 'CL-B1', 2, 'A novel about IT, DevOps and helping your business win.'],
  ['9781285740621', 'Calculus: Early Transcendentals', 'James Stewart', 'Cengage', 2015, 'Mathematics', 'MA-A1', 5, 'Clear explanations and worked problems covering single and multivariable calculus.'],
  ['9780133918922', 'Engineering Mechanics: Statics', 'R. C. Hibbeler', 'Pearson', 2015, 'Engineering', 'EN-A1', 4, 'Fundamentals of statics with a strong emphasis on problem solving.'],
  ['9781118230718', 'Fundamentals of Physics', 'David Halliday, Robert Resnick, Jearl Walker', 'Wiley', 2013, 'Physics', 'PH-A1', 4, 'A thorough introduction to classical and modern physics.'],
  ['9780735211292', 'Atomic Habits', 'James Clear', 'Avery', 2018, 'Personal Development', 'PD-A1', 3, 'Tiny changes, remarkable results: a proven way to build good habits.'],
  ['9780374533557', 'Thinking, Fast and Slow', 'Daniel Kahneman', 'Farrar, Straus and Giroux', 2013, 'Personal Development', 'PD-A2', 2, 'The two systems that drive the way we think and make decisions.'],
  ['9780062316097', 'Sapiens: A Brief History of Humankind', 'Yuval Noah Harari', 'Harper', 2015, 'History', 'HI-A1', 2, 'How Homo sapiens came to dominate the planet.'],
  ['9780451524935', '1984', 'George Orwell', 'Signet Classic', 1961, 'Fiction', 'FI-A1', 2, 'A dystopian novel about surveillance, truth and totalitarian power.'],
  ['9780061120084', 'To Kill a Mockingbird', 'Harper Lee', 'Harper Perennial', 2006, 'Fiction', 'FI-A2', 2, 'A story of justice and growing up in the American South.'],
  ['9780062315007', 'The Alchemist', 'Paulo Coelho', 'HarperOne', 2014, 'Fiction', 'FI-A3', 3, 'A shepherd boy\'s journey in search of treasure and his personal legend.'],
];

export async function seedIfEmpty() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return false;
  await seed();
  return true;
}

export async function seed() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await withTransaction(async (db) => {
    const userIds = {};
    for (const u of USERS) {
      const { rows } = await db.query(
        `INSERT INTO users (name, email, password_hash, role, student_id, department) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING RETURNING id`,
        [u.name, u.email, hash, u.role, u.student_id || null, u.department || null],
      );
      if (rows[0]) userIds[u.email] = rows[0].id;
    }

    const bookIds = {};
    for (let i = 0; i < BOOKS.length; i++) {
      const [isbn, title, author, publisher, year, category, shelf, copies, description] = BOOKS[i];
      const { rows } = await db.query(
        `INSERT INTO books (isbn, title, author, publisher, published_year, category, shelf_location, total_copies, available_copies, description, cover_url, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10, now() - ($11 || ' days')::interval)
         ON CONFLICT (isbn) DO NOTHING RETURNING id`,
        [isbn, title, author, publisher, year, category, shelf, copies, description, cover(isbn), String(BOOKS.length - i)],
      );
      if (rows[0]) bookIds[isbn] = rows[0].id;
    }

    const lib = userIds['librarian@cst.edu.bt'];
    const c = userIds['student.c@cst.edu.bt'];
    const staff = userIds['staff@cst.edu.bt'];
    if (!lib || !c || !staff) return;

    // Some realistic history so the dashboard has data. Keeps available_copies consistent.
    const loan = async (userId, isbn, outDaysAgo, dueInDays, returned = false) => {
      const bookId = bookIds[isbn];
      if (!bookId) return;
      await db.query(
        `INSERT INTO loans (user_id, book_id, checked_out_at, due_at, returned_at, checked_out_by, checked_in_by)
         VALUES ($1, $2, now() - ($3::text || ' days')::interval, now() + ($4::text || ' days')::interval,
                 CASE WHEN $5::boolean THEN now() - interval '1 day' END, $6::int, CASE WHEN $5::boolean THEN $6::int END)`,
        [userId, bookId, String(outDaysAgo), String(dueInDays), returned, lib],
      );
      if (!returned) await db.query('UPDATE books SET available_copies = available_copies - 1 WHERE id=$1', [bookId]);
      await db.query(
        `INSERT INTO activity_log (actor_id, action, book_id, user_id, created_at) VALUES ($1,'checked_out',$2,$3, now() - ($4 || ' days')::interval)`,
        [lib, bookId, userId, String(outDaysAgo)],
      );
    };

    // The only copy of DDIA is out -> anyone reserving it joins the waitlist
    await loan(staff, '9781449373320', 6, 8);
    // An overdue loan for the overdue report / notices
    await loan(c, '9780062316097', 20, -6);
    await loan(c, '9780735211292', 3, 11);
    await loan(staff, '9781491929124', 10, 4);
    await loan(c, '9780262033848', 1, 13);
    // Returned loans spread over the last two weeks for the charts
    const history = ['9780135957059', '9780133594140', '9781285740621', '9780451524935', '9780062315007', '9781617295119', '9780078022159', '9781118230718', '9780131103627', '9780136042594'];
    for (let i = 0; i < history.length; i++) await loan(i % 2 ? c : staff, history[i], 13 - i, -1, true);
  });
  console.log(`[seed] demo data created. Demo password for all accounts: ${DEMO_PASSWORD}`);
  for (const u of USERS) console.log(`        ${u.role.padEnd(9)} ${u.email}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  initDb()
    .then(migrate)
    .then(async () => {
      const created = await seedIfEmpty();
      if (!created) console.log('[seed] users already exist - skipping (drop the tables to reseed)');
    })
    .then(closeDb)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
