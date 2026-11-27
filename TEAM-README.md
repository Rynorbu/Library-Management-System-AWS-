# Team plan: two people, one deployment (single source of truth)

**Project:** CST Library Reservation System, AWS Final Project, Part B (Implementation & Deployment, 20 %) + Part C (Documentation & Presentation, 10 %)
**How to use this file:** this is the plan, and `implementation.md` is the how-to. Every task here points to a section of `implementation.md` (written as **§9.1** etc.).
When you finish a task, tick it here in a commit (`docs: tick A7`). Then this file always shows where the project stands.

| File | What it is |
|---|---|
| **`TEAM-README.md`** (this file) | Who does what, in what order, and the hand-offs between you |
| `implementation.md` | Step-by-step instructions + screenshot list (S01–S57), Learner Lab edition |
| `improvement.md` | Why the design is like this, code fixes C1–C9, proposal feedback |
| `docs/architecture/library-architecture.json` | The architecture, ready to import into the lab site |

---

## 1. The two roles

| | **Person A: Cloud & Infrastructure** | **Person B: Application, Pipeline & QA** |
|---|---|---|
| Name | `__________` | `__________` |
| Owns | The **project AWS account** (A's Learner Lab). All console work. | The **code**, the **GitHub repo/pipeline**, **testing**, **diagrams**, the **report** |
| `implementation.md` parts | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 16 | 1, 12 (workflow), 15, 17 |
| Screenshots | AWS console screenshots (about 40) | App, GitHub, inbox and terminal screenshots (about 30) |
| Report sections | Architecture, services, deployment, security, monitoring, cost | Summary, objectives, implementation + code, testing, changes, lessons |

### Why it's split like this
- **A Learner Lab is tied to one student's login.** The real deployment, and every console screenshot, must come from **one** account: Person A's. Don't share lab keys or logins.
- Person B never needs that console. B works through the **code**, **GitHub** and the **public CloudFront URL**, so you can both work at the same time without blocking each other.
- Person B may use **their own Learner Lab as a sandbox** to rehearse (e.g. try the Lambda + SQS + SES flow or an EB deploy). Delete those test resources the same day to save B's credit. **No report screenshots come from B's account.**

### Rules for working at the same time
1. **Git:** B works on branches (`fix/c1-secret-rotation`, `ci/learner-lab-keys`, …) → pull request → **A reviews** → merge. A commits docs/config on branches too. **Nobody pushes straight to `main`.**
2. **A push to `main` deploys** (once Part 12 is set up). Merge to `main` only when **A has refreshed the lab keys** in that session. Until the pipeline is ready, B sets the workflow to run manually only (task B3).
3. **Secrets never go in Git or chat.** `JWT_SECRET`, `INTERNAL_API_TOKEN` and the librarian password live in a shared password manager entry. Non-secret values (URLs, ARNs, queue URL) go in the **shared record sheet** (`implementation.md` Appendix B), kept in a private shared doc, **not** in this repo.
4. **Repo admin:** the lab keys are GitHub *secrets*, so **Person A needs admin rights on the repo** (the repo owner adds A as an admin collaborator) to refresh them each session (§12.3).
5. **Daily 15-minute sync** (call or chat): what I finished, what I'm doing next, what I'm blocked on. Update the checkboxes in this file the same day.

---

## 2. Timeline at a glance

Day 1 should be **about 12 days before the presentation**. Learner Lab credit runs out if the stack runs much longer than that (`improvement.md` §8: core ≈ $2.5/day, demo extras ≈ +$4/day).

| Day | Person A (AWS account) | Person B (code, pipeline, QA, docs) | Hand-off |
|---|---|---|---|
| 1 | A1–A3: start lab, record credit, read lab Readme, **VPC + security groups** | B1–B3: code fixes C1–C6, CI test job, workflow switch to session keys | — |
| 2 | A4–A7: **RDS + secret, S3 buckets, SES identities, SQS + DLQ** | B4–B5: build `library-app.zip` + Lambda zips, release `v1.0-aws`; verify SES emails from A | **H1: B → A** release bundle + env-var list |
| 3 | A8–A9: **Elastic Beanstalk** environment, seed, librarian password | B6: import the architecture JSON, simulate, export diagram; start the report skeleton | **H2: A → B** EB URL + demo accounts |
| 4 | A10–A11: **Lambdas + EventBridge**, email flow works | B7: functional tests F01–F06 on the EB URL | — |
| 5 | A12: **CloudFront + WAF**, lock the ALB to CloudFront, switch `APP_URL` | B8: functional tests F07–F19 | **H3: A → B** CloudFront URL |
| 6 | A13: **GitHub secrets (lab keys)** + repo variables | B9: first pipeline run through a PR merge; zero-downtime deploy rehearsal | **H4: A ↔ B** pipeline goes live |
| 7 | A14: **monitoring**: SNS, alarms, dashboard, Logs Insights | B10: concurrency test + security checks | — |
| 8 | A15: **pause** if no work is planned for 2+ days (§16) | B11: report sections + figures 2–4 | — |
| 9–10 | A16: re-start/restore if paused. Write the A report sections. | B12: report sections; presentation slides | — |
| D-3 | A17: **demo-week upgrades** (Multi-AZ, replica, ElastiCache, endpoints, 2nd NAT) | B13: re-run the smoke tests after the upgrades | **H5: A → B** "upgrades done" |
| D-2 | **Joint**: failure tests (instance loss, DB failover, DLQ alarm, zero-downtime deploy) | **Joint** | — |
| D-1 | A18: remove expensive extras if credit is low (keep Multi-AZ); credit screenshot | B14: final report + slides; rehearsal ×2 | — |
| **D** | Start the lab **45 min early**; EB green; DLQ purged | Demo browser windows logged in; backup screenshots ready | — |
| D+1 | A19: **tear down** (§16) after marks are safe | B15: submit report, repo tidy-up | — |

---

## 3. Person A: task list (Cloud & Infrastructure)

| ✔ | ID | Task | Guide | Needs | Screenshots | Done when |
|---|---|---|---|---|---|---|
| ☐ | A1 | Start the lab, read the lab **Readme**, compare it with `improvement.md` §8, and write down any blocked service in §7 of this file | §2.1–2.3 | — | S01 | Blocked services noted |
| ☐ | A2 | Generate `JWT_SECRET` + `INTERNAL_API_TOKEN` into the shared password manager | §1.5 | — | — | Both secrets stored |
| ☐ | A3 | VPC `library` with the 6 /19 subnets, 1 NAT, S3 gateway endpoint; security groups `sg-app/db/cache/endpoints` | §4 | — | S04–S07 | Resource map matches the diagram |
| ☐ | A4 | RDS PostgreSQL 16 (single-AZ), DB `library`, secret ARN recorded; rotation set per §5.4 | §5 | A3 | S08–S10 | Endpoint + secret ARN in the record sheet |
| ☐ | A5 | S3 covers bucket + logs bucket (policy + lifecycle) | §6 | — | S11–S12 | Both buckets exist |
| ☐ | A6 | SES: verify the sender + **every demo address B sends you** | §7.1 | B's address list | S13 | All identities *Verified* |
| ☐ | A7 | SQS queue + DLQ (max receives 3) | §7.2 | — | S14 | Queue URL in the record sheet |
| ☐ | A8 | `LabRole` screenshot + write the least-privilege design note for the report | §8 | — | S15 | — |
| ☐ | A9 | **Elastic Beanstalk** with **release `v1.0-aws` from B** (H1), all env properties, health Ok; remove `SEED_ON_START`; change the librarian password; create demo users | §9 | A3–A7, **H1** | S16–S20, S21 | `/api/health` → ok. **Send H2.** |
| ☐ | A10 | Lambda `library-notifier` + SQS trigger; test one email | §10.1–10.2 | A9 | S24, S25 | Email log shows **Sent** |
| ☐ | A11 | Lambda `library-daily-reminders` + Scheduler (or EventBridge rule) | §10.3–10.4 | A9 | S28, S29 | Test returns job counts |
| ☐ | A12 | CloudFront + `/assets/*` behaviour + WAF; ALB SG → CloudFront prefix list; update `APP_URL` in EB + both Lambdas | §11 | A9–A11 | S30–S32 | App works on `https://…cloudfront.net`. **Send H3.** |
| ☐ | A13 | Put the lab keys in GitHub secrets (**every session you deploy**); add repo variables | §12.3–12.4 | repo admin | S35 | Keys set. **H4 with B.** |
| ☐ | A14 | SNS `library-alerts` (both emails), 7 alarms, dashboard `cst-library`, Logs Insights query | §13 | A9–A12 | S39–S42 | All alarms *OK* |
| ☐ | A15 | **Pause** (terminate EB, delete NAT, stop RDS) on days without work | §16 "Pause" | — | — | Credit stops climbing |
| ☐ | A16 | Restore after a pause (NAT + route, EB restore, `APP_URL` unchanged) | §16 | A15 | — | Health Ok again |
| ☐ | A17 | Demo-week upgrades: Multi-AZ, read replica (`DB_READ_HOST`), ElastiCache (`REDIS_URL`), 4 interface endpoints, 2nd NAT | §14 | D-3 | S43–S46 | System card shows *redis*. **Send H5.** |
| ☐ | A18 | Failure tests (lead): terminate an instance, RDS failover, show the DLQ alarm | §15.3–15.5 | A17, B on the probe | S49, S50, S51 | RTO numbers recorded |
| ☐ | A19 | Record the credit at the end, then tear down after the marks are safe | §15.8, §16 | after D | S55, S57 | Credit stops |
| ☐ | A20 | Write report §4 Architecture, §5 Services, §7 Deployment, §8 Security, §9 Monitoring, §11 Cost | §17.2 | screenshots | — | Sections in the shared report |

---

## 4. Person B: task list (Application, Pipeline & QA)

| ✔ | ID | Task | Guide | Needs | Screenshots | Done when |
|---|---|---|---|---|---|---|
| ☐ | B1 | Code fixes **C1** (secret rotation + `DB_READ_HOST`), **C2** (outbox `SKIP LOCKED`), **C3** (RDS TLS CA), **C6** (`trust proxy` 2) | §1.3, `improvement.md` §4 | — | — | PR merged, local `npm run dev` + race test pass |
| ☐ | B2 | **C4**: ESLint + API tests (register, reserve, waitlist, return → promote) with Postgres in CI | §1.3 | B1 | — | `test` job green on the PR |
| ☐ | B3 | **C5 + Learner Lab workflow**: session-key login, safe `--description`, Node 22, `needs: test`; **trigger = manual only** until H4 | §12.1 | — | — | PR merged |
| ☐ | B4 | Send A the list of demo email addresses to verify in SES (`+studenta`, `+studentb`, `+librarian`, both members) | §7.1 | — | — | A confirms they are verified (A6) |
| ☐ | B5 | `npm run package` → GitHub **release `v1.0-aws`** with `library-app.zip`, `lambda-notifier.zip`, `lambda-reminders.zip` + the env-var table from §9.1 | §1.4 | B1–B3 | — | **Send H1** |
| ☐ | B6 | Import `docs/architecture/library-architecture.json` into the lab site → Simulate "Reserve a book" → export Figure 1; draw Figures 2 (sequence), 3 (CI/CD), 4 (ER) | §17.1 | — | — | 4 PNGs in `docs/` |
| ☐ | B7 | Functional tests **F01–F06** on the EB URL (H2), with the test table filled in | §15.1 | **H2** | S22, S23, S47-F01…F06 | Rows pass |
| ☐ | B8 | Email evidence + functional tests **F07–F19** (the CloudFront URL after H3) | §10.2, §15.1 | A10, **H3** | S26, S27, S33, S47-F07…F19 | All rows pass, or a bug is filed |
| ☐ | B9 | Pipeline go-live: set the `production` environment with **A as required reviewer**, merge a small PR → A approves → watch it deploy | §12.4–12.5 | **H4** | S36, S37 (A takes S38) | Run green + smoke test |
| ☐ | B10 | Concurrency test (30 students) + security checks (S3 private, ALB direct blocked, internal API, no public IPs) | §15.2, §15.7 | H3 | S48, S54a–d | 1 reserved / 29 waitlisted |
| ☐ | B11 | Zero-downtime deploy test: probe running + push (A approves) | §15.6 | B9 | S53 | Probe all 200 |
| ☐ | B12 | Pricing Calculator estimate (real account, ap-south-1) + latency check from Bhutan | §15.8 | — | S56 | PDF + numbers in the report |
| ☐ | B13 | Re-run the smoke tests after the demo-week upgrades (H5); show the alarm email from the DLQ test | §14, §15.5 | **H5**, A18 | S52 | — |
| ☐ | B14 | Report §1–3, §6 Implementation (code excerpts), §10 Testing, §12 Changes from proposal, §13 Lessons, §14 Future work; assemble the final report | §17.2 | all | — | Report complete |
| ☐ | B15 | Slides (fix the proposal deck per `improvement.md` §5) + 2 rehearsals with A | §17.3 | B14 | — | 10-min run-through |

---

## 5. Hand-offs (the only points where one person waits for the other)

| ID | From → To | What exactly is handed over | Where |
|---|---|---|---|
| **H1** | B → A | GitHub release `v1.0-aws` (3 zips) + the env-var table | GitHub Releases link in chat |
| **H2** | A → B | EB URL, demo accounts (emails + passwords), librarian password | URL in the record sheet; passwords in the password manager |
| **H3** | A → B | CloudFront URL (`https://dxxxx.cloudfront.net`), confirmed working | Record sheet |
| **H4** | A ↔ B | A has set the lab keys + variables. B switches the workflow back to "on push to main" and merges the first PR. | Live, during one call |
| **H5** | A → B | Demo-week upgrades finished, with their time (credit is now running faster) | Chat |

**If you're blocked:** while waiting for H1, A builds Parts 4–7 (nothing there needs the bundle). While waiting for H2/H3, B does B6 and B12 and drafts the report.

---

## 6. Screenshot ownership (from `implementation.md` Appendix A)

| Person A (console) | Person B (app, GitHub, terminal, inbox) |
|---|---|
| S01, S04–S21, S24, S25, S28–S32, S35, S38–S46, S49, S50, S51, S55, S57 | S22, S23, S26, S27, S33, S36, S37, S47-F01…F19, S48, S52, S53, S54a–d, S56 |

- Save to `docs/screenshots/` with the S-number in the file name, and add the caption line to `docs/screenshots/CAPTIONS.md` (rules: `implementation.md` Part 0).
- **Joint tests** (S49, S50, S53): A operates the console, B runs the probe in a terminal. Both capture their own screen.
- **Hide the account ID and secrets** before committing any screenshot.

---

## 7. Shared status board

Update this at every daily sync.

| Item | Value |
|---|---|
| Presentation date (D) | `____-__-__` |
| Day 1 (≈ D-12) | `____-__-__` |
| Lab credit used / total (last checked) | `$__ / $__` on `____-__-__` |
| Services the lab blocks (from A1) | `____` |
| EB URL / CloudFront URL | in the record sheet (H2 / H3) |
| Current release deployed | `v1.0-aws` |
| Open blockers | `____` |

**Progress:** Person A `0 / 20` · Person B `0 / 15` · Hand-offs `0 / 5`

---

## 8. Definition of done for the assignment

- [ ] App works on the CloudFront HTTPS URL. All of **F01–F19** pass (B).
- [ ] Every service in the diagram is either **built** (with a screenshot) or **explained** under "Changes from the proposal" (A + B).
- [ ] The email flow **SQS → Lambda → SES → inbox → "Sent"** is shown (A10 + B8).
- [ ] Pipeline run green with the **test job**, and a zero-downtime deploy proven (B9, B11).
- [ ] Failure tests with **measured numbers** (A18).
- [ ] Code fixes C1–C6 merged (B1–B3).
- [ ] Figures 1–4 + all screenshots S01–S57 (except S02, S03, S34) in `docs/` (A + B).
- [ ] Report complete and mapped to the rubric (§17.2). Slides rehearsed twice (B14, B15, A20).
- [ ] Lab torn down **after** the marks are safe (A19).

---

## 9. Risks and what to do

| Risk | Owner | Prevention / response |
|---|---|---|
| Lab credit runs out (account deleted) | A | Record the credit every session; pause on idle days (A15); upgrades only from D-3 |
| Session ends during a long step | A | Start RDS / EB / Multi-AZ in the **first hour** of a session |
| Pipeline fails with `ExpiredToken` | A + B | A refreshes the keys (§12.3) → B re-runs the job |
| Emails not arriving | A + B | All recipients verified (A6/B4); check Spam; Email log + Lambda logs |
| A person is ill or unavailable | both | This file + the record sheet + the password manager let the other continue. B can rebuild in B's own lab in an emergency. |
| Merge conflicts | B | Small PRs. A reviews within a day. Docs and code in separate PRs. |
| Demo-day lab slowness | both | Start the lab 45 min early; S47 screenshots as a backup; no merges on D-1 or D (deployment freeze) |
