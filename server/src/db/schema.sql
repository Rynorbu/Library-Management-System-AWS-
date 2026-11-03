-- Cloud-Native Library Book Reservation System - PostgreSQL schema
-- Idempotent: safe to run on every deploy.

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  name           TEXT        NOT NULL,
  email          TEXT        NOT NULL,
  password_hash  TEXT        NOT NULL,
  role           TEXT        NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'staff', 'librarian')),
  student_id     TEXT,
  department     TEXT,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS books (
  id                SERIAL PRIMARY KEY,
  isbn              TEXT UNIQUE,
  title             TEXT        NOT NULL,
  author            TEXT        NOT NULL,
  publisher         TEXT,
  published_year    INT,
  category          TEXT        NOT NULL DEFAULT 'General',
  description       TEXT,
  cover_url         TEXT,          -- external image URL
  cover_key         TEXT,          -- object key in S3 (or local uploads dir)
  shelf_location    TEXT,
  total_copies      INT         NOT NULL DEFAULT 1 CHECK (total_copies >= 0),
  available_copies  INT         NOT NULL DEFAULT 1 CHECK (available_copies >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT books_available_lte_total CHECK (available_copies <= total_copies)
);
CREATE INDEX IF NOT EXISTS books_category_idx ON books (category);
CREATE INDEX IF NOT EXISTS books_title_idx ON books (lower(title));

-- reserved   = a copy is held for the user until pickup_deadline
-- waitlisted = no copy free; user is queued (FIFO by created_at)
-- fulfilled  = user collected the book (a loan was created)
CREATE TABLE IF NOT EXISTS reservations (
  id                SERIAL PRIMARY KEY,
  user_id           INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id           INT         NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  status            TEXT        NOT NULL CHECK (status IN ('reserved', 'waitlisted', 'fulfilled', 'cancelled', 'expired')),
  reserved_at       TIMESTAMPTZ,
  pickup_deadline   TIMESTAMPTZ,
  reminder_sent_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A user can only have one active reservation per book
CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_per_user_book
  ON reservations (user_id, book_id) WHERE status IN ('reserved', 'waitlisted');
CREATE INDEX IF NOT EXISTS reservations_book_status_idx ON reservations (book_id, status, created_at);
CREATE INDEX IF NOT EXISTS reservations_user_idx ON reservations (user_id, status);

CREATE TABLE IF NOT EXISTS loans (
  id                 SERIAL PRIMARY KEY,
  user_id            INT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id            INT         NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  reservation_id     INT         REFERENCES reservations(id) ON DELETE SET NULL,
  checked_out_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at             TIMESTAMPTZ NOT NULL,
  returned_at        TIMESTAMPTZ,
  renewals           INT         NOT NULL DEFAULT 0,
  checked_out_by     INT         REFERENCES users(id) ON DELETE SET NULL,
  checked_in_by      INT         REFERENCES users(id) ON DELETE SET NULL,
  reminder_sent_at   TIMESTAMPTZ,
  overdue_notice_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS loans_active_idx ON loans (due_at) WHERE returned_at IS NULL;
CREATE INDEX IF NOT EXISTS loans_user_idx ON loans (user_id);
CREATE INDEX IF NOT EXISTS loans_book_idx ON loans (book_id);

-- Transactional outbox + email log. Rows are written in the same transaction as the
-- reservation change, then published to SQS -> Lambda -> SES.
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INT         REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL,
  recipient   TEXT        NOT NULL,
  subject     TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  html        TEXT,
  status      TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'published', 'sent', 'failed')),
  attempts    INT         NOT NULL DEFAULT 0,
  error       TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_pending_idx ON notifications (created_at) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS activity_log (
  id          SERIAL PRIMARY KEY,
  actor_id    INT         REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,
  book_id     INT         REFERENCES books(id) ON DELETE SET NULL,
  user_id     INT         REFERENCES users(id) ON DELETE SET NULL,
  details     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_created_idx ON activity_log (created_at DESC);
