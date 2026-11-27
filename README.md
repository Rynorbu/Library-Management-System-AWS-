# CST Library: Cloud-Native Library Book Reservation System

AWS Final Project · College of Science and Technology, Royal University of Bhutan
Kelden Phuntsho Dorji · Ranjung Yeshi Norbu · Pema Dolker · Tshering Wangpo Dorji

A self-service library system that replaces the queue at the library desk. Students and staff search the catalogue, see live copy counts and shelf locations, reserve a copy or join a first-come-first-served waitlist, and get an email when a book is ready. Librarians manage the catalogue, check books in and out, and see reports.

**Stack:** React 18 (Vite) · Node.js 22 / Express · PostgreSQL 16 · AWS Elastic Beanstalk, RDS, SQS, Lambda, SES, S3, ElastiCache, Secrets Manager, EventBridge, CloudWatch

---

## Features

| Students & staff | Librarians |
|---|---|
| Search by title / author / ISBN / subject, filter, sort | Dashboard: stats, 14-day activity chart, demand ranking, subject breakdown, activity feed |
| Live availability, shelf location and cover image | **Circulation desk**: check out held books, check in returns, walk-in checkout |
| Reserve a copy (held 48 h) or join the waitlist | Waitlist and overdue views, cancel reservations |
| See your waitlist position | Catalogue management: add/edit/delete, **ISBN auto-fill** from Open Library, cover upload (S3) |
| My Library: holds, loans, due dates, history | Members: change roles, deactivate accounts |
| Renew a loan (if nobody is waiting) | Email log: live delivery status (queued → SQS → sent / failed) |
| In-app notifications + email | "Run daily jobs now" button for the live demo |

### How a reservation works (proposal slide 7)

1. **Lock the book**: `BEGIN; SELECT … FROM books WHERE id=$1 FOR UPDATE`
2. **Reserve or queue**: if a copy is free, reserve it with a pickup deadline; if not, join the waitlist
3. **Commit + publish**: the email is written to a `notifications` *outbox* row **in the same transaction**, then published to SQS after commit. The request returns immediately.
4. **Lambda notifier** reads SQS with retries; failures go to the dead-letter queue
5. **SES email** is sent and its status is written back to the database

**On return:** the first waitlisted student is promoted to *reserved* and gets a "now available" email.
**Every day:** EventBridge Scheduler → Lambda → expires uncollected holds, sends pickup / due / overdue reminders.

Concurrency is tested: `npm run test:concurrency` sends N simultaneous reserve requests for the last copy. Exactly one wins, and the rest get waitlist positions 1…N-1 in order.

---

## Run it locally

Requirements: Node.js 22 LTS (20 also works locally), Docker Desktop.

```bash
npm run setup          # installs root, server and client dependencies
cp server/.env.example server/.env
npm run db:up          # PostgreSQL 16 in Docker on localhost:5433
npm run dev            # API on :8080 + React on :5173
```

Open **http://localhost:5173**. On first start the server creates the schema and loads demo data.

| Role | Email | Password |
|---|---|---|
| Librarian | librarian@cst.edu.bt | Password@123 |
| Student A | student.a@cst.edu.bt | Password@123 |
| Student B | student.b@cst.edu.bt | Password@123 |
| Student C | student.c@cst.edu.bt | Password@123 |
| Staff | staff@cst.edu.bt | Password@123 |

The login page has one-click demo buttons. Locally, emails are printed to the API console and shown in the app's Notifications page and the librarian's Email log.

### Live demo script

1. **Student A** opens *Clean Code* (1 copy) → **Reserve a copy** → confirmation email
2. **Student B** opens *Clean Code* → **Join the waitlist** → "You're #1"
3. **Librarian** → Circulation → *Ready for pickup* → **Check out** to Student A
4. Librarian → *Active loans* → **Check in** → toast: "Now held for Karma Tenzin"
5. **Student B** → bell icon → "Now available: Clean Code" (in AWS this arrives via SQS → Lambda → SES)
6. Librarian → Dashboard → **Run daily jobs now** → reminders / overdue notices

### Useful commands

```bash
npm run test:concurrency                       # race test (API must be running)
STUDENTS=40 npm run test:concurrency
npm run package                                # build/library-app.zip + Lambda zips
docker compose --profile cache up -d redis     # optional local Redis (set REDIS_URL)
```

Reset local data: `docker compose down -v && npm run db:up`, then restart the API.

---

## Project structure

```
client/                React SPA (Vite)
  src/pages/           Home, Catalogue, BookDetail, MyLibrary, Notifications, Account, Auth
  src/pages/admin/     Dashboard, Circulation, ManageBooks, Members, EmailLog
  src/components/      Layout + shared UI (covers, badges, modals, pagination)
server/                Express API (also serves the built SPA in production)
  src/services/        reservationService (locking, waitlist, jobs), notificationService (outbox → SQS),
                       cache (ElastiCache/memory), storage (S3/local), secrets (Secrets Manager)
  src/routes/          auth, books, reservations, loans, notifications, admin, internal (Lambda-only)
  src/db/              schema.sql, migrate (advisory lock), seed
  .ebextensions/       Elastic Beanstalk config: ALB health check, 2-4 instances, rolling deploys, logs
  scripts/             concurrency-test.js
lambda/notifier        SQS → SES (partial batch failures, DLQ)
lambda/reminders       EventBridge → /api/internal/jobs/daily
.github/workflows      CI/CD to Elastic Beanstalk (Learner Lab session keys; OIDC in a real account)
docs/DEPLOYMENT.md     Step-by-step AWS setup
```

## Configuration

Every AWS integration is optional and turned on by an environment variable, so the same code runs on a laptop and on AWS. See [`server/.env.example`](server/.env.example).

| Variable | AWS service | Without it |
|---|---|---|
| `DB_SECRET_ARN` / `RDS_*` / `DATABASE_URL` | RDS PostgreSQL + Secrets Manager | local Docker Postgres |
| `DB_READ_HOST` (or `DATABASE_READ_URL`) | RDS read replica for catalogue browsing (same secret as the primary) | primary only |
| `SQS_QUEUE_URL` | SQS → Lambda → SES | console email |
| `SES_FROM_EMAIL` + `SES_DIRECT=true` | SES straight from the app | console email |
| `S3_BUCKET` | private S3 + presigned cover URLs | `server/uploads` |
| `REDIS_URL` | ElastiCache catalogue cache | in-memory cache |
| `JWT_SECRET`, `INTERNAL_API_TOKEN` | (required in production) | dev defaults |

Deployment: see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.
