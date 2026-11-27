# Improvements: architecture review, service changes and proposal feedback

**Project:** Cloud-Native Library Book Reservation System (CST, AWS Final Project)
**Reviewed on:** 2026-11-27
**Inputs:** `image.png` (the architecture diagram, the same as proposal slide 7), `AWS Final Project Proposal.pptx.pdf` (11 slides), the application code in this repo, and the rubric for **Part B, AWS Implementation & Deployment (20 %)**

> This file replaces `TODO.md`. `implementation.md` (the step-by-step build guide) replaces `your-task.md`.

---

## 1. Summary

**The architecture is good.** It is a correct three-tier, two-AZ design with private subnets, Multi-AZ RDS, an Auto Scaling group behind an ALB, and an event-driven email pipeline. That is exactly what a production system would use, and the application code already supports every service in it. **You do not need to change the main design or the compute service** (keep Elastic Beanstalk, as in the proposal).

What needs work is mostly **the drawing and a few details**:

| Priority | Improvement | Why it matters for marks |
|---|---|---|
| 🔴 1 | **Draw the missing data flows**: app → SQS → Lambda → SES, EventBridge → Lambda, app → Secrets Manager, CloudWatch → SNS. Arrows 1, 11, 12 and 13 are missing. | The event-driven pipeline is your strongest feature (slide 8), but the diagram doesn't show it. *Architecture Design 2*, *Diagrams 2* |
| 🔴 2 | **Fix wrong placements**: WAF and the Internet Gateway are drawn *inside* a subnet; Lambda is drawn *inside* the VPC (your code runs it outside) | A marker who knows AWS will spot these. *Architecture Design* |
| 🔴 3 | **Fix the database password rotation bug** (section 4, C1). RDS rotates the managed secret every 7 days by default, and the app reads it only once at start-up. | The app could break during the demo week. *Code Quality & SDK Usage*, *Functional* |
| 🟠 4 | **Adapt to AWS Academy Learner Lab** (section 8): us-east-1 instead of Mumbai, no Route 53 + ACM (no domain; CloudFront's default HTTPS), `LabRole` instead of custom roles, session keys instead of OIDC, SES sandbox, limited credit | Every change must be explained in "changes from the proposal", or the marker sees a mismatch |
| 🟠 5 | **Settle the proposal's "either/or" choices**: PostgreSQL (not "MySQL / PostgreSQL"), GitHub Actions (not "or CodePipeline"), one NAT vs two NATs | Implementation must match one clear design |
| 🟠 6 | **Code-quality fixes** (section 4): duplicate-email race, RDS TLS verification, tests + lint in CI, pipeline fixes | *Code Quality 2*, *Deployment 2* |
| 🟢 7 | Show the **CI/CD pipeline, S3 gateway endpoint, DLQ, security groups and the browser → S3 cover download** in the diagram | *Service Integration 4*, *Diagrams 2* |

---

## 2. Architecture diagram review (`image.png`)

### 2.1 What is already good (keep it)

- ✅ One VPC `10.0.0.0/16` across **two AZs**, with **three tiers** (public / private app / private DB). This is textbook.
- ✅ Subnet sizes /19 with "8187 usable" (8192 − 5 reserved by AWS) is correct and shows understanding.
- ✅ Only the ALB and NAT are in public subnets. EC2, cache and DB are private.
- ✅ RDS **primary in AZ-A, synchronous standby in AZ-B**, plus an **async read replica**, with the labels correct.
- ✅ The Auto Scaling app tier in both AZs behind one ALB that spans both AZs.
- ✅ SES → Student inbox and CloudWatch → SNS are shown.
- ✅ Numbered arrows following one request is the right way to explain it.

### 2.2 Problems to fix

| # | Where in the diagram | Problem | Fix |
|---|---|---|---|
| D1 | Arrow numbers | The numbers jump **2 → 10 → 14 → 15**. **1, 11, 12 and 13 are missing**, and there is no legend. | Renumber 1…17 with no gaps and add a **legend table** next to the diagram (use the flow in section 3.3). |
| D2 | SQS, EventBridge, Secrets Manager | These icons have **no arrows at all**. They look decorative. | Draw App → SQS (publish), SQS → Lambda (trigger), SQS → DLQ (after 3 failures), EventBridge → Lambda (daily), App → Secrets Manager (read DB credentials at start-up). |
| D3 | AWS WAF inside *Public subnet A*, between the IGW and the ALB | WAF is **not a network device in a subnet**. It is a web ACL **attached to** CloudFront or the ALB. Traffic doesn't "pass through" a box in subnet A. | Put the WAF icon **on the CloudFront icon** (recommended, see S5) or on the ALB, with a dotted "web ACL" link. Remove arrows 5 and 6 through it. |
| D4 | Internet Gateway inside *Public subnet A* | An IGW is attached to the **VPC**, not to a subnet. | Draw it **on the VPC border**. |
| D5 | AWS Lambda inside *Private app subnet B* | Your Lambdas are **not in the VPC**. They call SES and the app's public HTTPS URL (`lambda/notifier/index.mjs`, `lambda/reminders/index.mjs`). Putting them in the VPC would also need NAT or endpoints for SES. | Move **Lambda (Notifier + Reminders)** **outside the VPC**, next to SQS and EventBridge. Explain in the report that they don't need VPC access because the app owns the business logic. |
| D6 | "/19" and "/21" both appear in every subnet header | Contradiction: a subnet can't be both. "8187 usable" matches **/19**. | Delete the "/21" labels. |
| D7 | NAT Gateway in **both** AZs | Slide 6 says "**One NAT Gateway**" (cost control). The diagram and the slide disagree. | Draw NAT-B **dashed** with the label "scale-up (second NAT)". Private app subnet B routes to NAT-A until then. |
| D8 | Line labels | EC2 → ElastiCache is labelled **HTTPS** and the replica line too. Redis is **TCP 6379** and PostgreSQL is **TCP 5432 (TLS)**. | Correct the protocol and port labels on every line: HTTPS 443, HTTP 8080, TCP 5432, TCP 6379. |
| D9 | S3 arrow (10) goes straight out of the VPC | The proposal mentions a **free S3 gateway endpoint**, but it isn't drawn. Also, **browsers download covers directly from S3** (presigned URLs), not through the app. | Add the **S3 Gateway Endpoint** on the private route table. Add a dotted arrow **Browser → S3 (presigned URL, GET cover)**. |
| D10 | Route 53 + ACM in one icon before CloudFront | Fine if you have a domain. Note that the **ACM certificate for CloudFront must be in us-east-1**, and the ALB needs a second certificate in ap-south-1. | **Learner Lab: remove Route 53 + ACM** (no domain can be registered). Users go straight to CloudFront's default `*.cloudfront.net` HTTPS. |
| D11 | The ALB can be reached directly from the internet | There is nothing stopping someone from bypassing CloudFront and WAF. | Label the ALB security group: "**inbound only from CloudFront** (managed prefix list)". |
| D12 | ElastiCache only in AZ-A | Acceptable for cost, but it is a single point of failure for the cache. The app already **falls back to memory** if Redis is down (`server/src/services/cache.js`). | Label it "single node; app falls back to in-memory cache if it fails". That turns a weakness into a design decision. |
| D13 | VPC interface endpoints "CloudWatch" | "CloudWatch" isn't one endpoint. Logs and metrics are **two**: `logs` and `monitoring`. | Label the endpoints: `secretsmanager`, `sqs`, `logs`, `monitoring`. |
| D14 | Not shown | **CI/CD** (GitHub Actions → OIDC → S3 → Elastic Beanstalk), **security groups**, the **DLQ**, the **Lambda → app status callback**, the **ALB logs bucket**, **SNS → team email**. | Add a small "Deployment" lane at the bottom for CI/CD, and SG labels on each tier. Add a separate **Figure 2: CI/CD pipeline** if space is tight. |
| D15 | Not shown | An **Elastic Beanstalk environment** boundary | Draw a dashed box around the ALB + Auto Scaling group labelled "Elastic Beanstalk environment `cst-library-prod`". |
| D16 | Visual | The **Users** icon and **EC2 AZ-A** have a yellow selection highlight from the editor, and the text is too small to read on a slide. | Remove the highlights. Export at 2× resolution. In slides, show the diagram full-screen and zoom into parts. |

---

## 3. Target architecture

### 3.1 Services: keep, change, add, remove

| Service | Decision | Notes |
|---|---|---|
| Elastic Beanstalk (Node.js 22, Amazon Linux 2023) | **Keep** | The proposal's core. Node 20 is end-of-life, so **use Node.js 22**. Turn on **managed platform updates**, so "no servers to patch" is true. |
| EC2 Auto Scaling 2–4, ALB | **Keep** | Already in `.ebextensions`. |
| Amazon RDS **PostgreSQL** 16, Multi-AZ + read replica | **Keep, and change the slide wording** | Remove "MySQL / " from slide 5. The code is PostgreSQL-only (row locks, JSONB, partial indexes). |
| ElastiCache | **Keep (Valkey or Redis OSS)** | Valkey is cheaper and works with the same `redis` client. Add it to the **service list on slide 5** (it is in the diagram but missing from the list). |
| S3 (covers) | **Keep** | Private bucket, presigned URLs. |
| **S3 (logs bucket)** | **Add** | ALB access logs + a lifecycle rule to Glacier, which makes slide-7 notes "old data moves to cheaper storage classes" true. |
| SQS + **DLQ** | **Keep** | Draw the DLQ separately. |
| Lambda × 2 | **Keep, and move it outside the VPC in the diagram** | Node.js 22 runtime. |
| SES | **Keep** | Learner Lab can't leave the **sandbox**: verify every demo recipient. |
| EventBridge **Scheduler** | **Keep** | Use the time zone **Asia/Thimphu** in the schedule. |
| Secrets Manager | **Keep** | Fix the rotation handling (C1). |
| CloudFront | **Keep** | Gives HTTPS and caching. |
| **AWS WAF** | **Change: attach it to CloudFront, not the ALB** | One web ACL at the edge blocks attacks before they reach your VPC, and the ALB is locked to CloudFront anyway. If the console offers CloudFront's **flat-rate Free plan**, choose it; WAF is included. |
| Route 53 + ACM | **Remove (Learner Lab)** | No domain registration in the lab. Mention them as "real-account design". |
| VPC interface endpoints | **Keep, but demo week only** | About $0.01/hour per endpoint per AZ: 4 endpoints × 2 AZs ≈ **$60/month** if left on. Note: the instances **still need NAT** (Elastic Beanstalk agent, npm install, SES), so endpoints are a security and latency improvement, not a NAT replacement. |
| NAT Gateway | **One** (second = scale-up) | Matches slide 6. |
| CloudWatch Logs, metrics, alarms, dashboard | **Keep, and add a dashboard** | Dashboard screenshots are strong evidence. |
| SNS | **Keep** | Alarm emails to the team. |
| IAM | **`LabRole` / `LabInstanceProfile` in the lab** | Role creation is blocked. Show the least-privilege roles + GitHub OIDC as the real-account design (`implementation.md` §8.1). |
| **GitHub Actions** | **Choose this** (remove "or CodePipeline") | It is already written (`.github/workflows/deploy.yml`). |
| Cognito | **Remove from the slides** (or mark "future work") | The app uses its own JWT auth. Don't promise what you won't build. |
| AWS Budgets | **Not available in Learner Lab** | Track the lab credit each session instead (`implementation.md` §2.1). |
| ECS / EKS | **Don't add** | The proposal chose Beanstalk with reasons. Mention them only in "alternatives considered". |

Total: about **20 AWS services**, which is above the "more than 15" promised.

### 3.2 The domain decision (decided: no domain, because of Learner Lab)

| Option | Cost | What you get |
|---|---|---|
| A. Get a domain (real account only) | A cheap domain + a Route 53 hosted zone at $0.50/month | `library.<domain>` → Route 53 → CloudFront (ACM cert in us-east-1) → ALB (ACM cert in the region), HTTPS end to end. **Not possible in Learner Lab.** Describe it as the real-account design. |
| **✅ B. No domain (chosen)** | $0 | CloudFront's default certificate on `dxxxx.cloudfront.net`. HTTPS for users, and HTTP from CloudFront to the ALB, which only CloudFront can reach. **Route 53 + ACM are removed from the diagram** and explained under "changes from the proposal". |

`implementation.md` Part 3 and Part 11 give the steps.

### 3.3 The request flow (use this as the diagram legend)

| # | Flow | Protocol |
|---|---|---|
| 1–2 | Student opens `https://dxxxx.cloudfront.net` (Learner Lab: no custom domain, so no Route 53 step) | — |
| 3 | **CloudFront** ends HTTPS (default certificate), **WAF** inspects the request, and static `/assets/*` comes from the edge cache | HTTPS 443 |
| 4 | CloudFront forwards `/api/*` and pages to the **ALB** through the Internet Gateway. The ALB only accepts the CloudFront prefix list. | HTTP 80 (inside AWS) |
| 5 | The ALB sends the request to a healthy **EC2 instance in either AZ** (Elastic Beanstalk, Auto Scaling 2–4) | HTTP 8080 |
| 6 | At start-up, each instance reads the DB credentials from **Secrets Manager** (through the interface endpoint) | HTTPS 443 |
| 7 | Catalogue reads are served from **ElastiCache** when cached | TCP 6379 (TLS) |
| 8 | Browsing queries go to the **read replica**. Reservations go to the **RDS primary** (`BEGIN … SELECT … FOR UPDATE … COMMIT`). | TCP 5432 (TLS) |
| 9 | RDS replicates **synchronously** to the standby in AZ-B (automatic failover) | — |
| 10 | Cover uploads go to **S3** through the **gateway endpoint**. The browser downloads covers with a **presigned URL**. | HTTPS |
| 11 | After COMMIT, the app publishes the email event to **SQS** (through the interface endpoint) and replies to the student at once | HTTPS |
| 12 | **SQS triggers the notifier Lambda** (batch of 10, partial batch failures). After 3 failures a message goes to the **DLQ**. | — |
| 13 | The Lambda sends the email through **SES** → 14 the email arrives in the **student's inbox** | HTTPS / SMTP |
| 15 | The Lambda reports `sent` / `failed` back to the app (`/api/internal/...`, shared token) → shown in the librarian's Email log | HTTPS |
| 16 | **EventBridge Scheduler** (08:00 Asia/Thimphu) → reminders **Lambda** → `/api/internal/jobs/daily` (expires holds, queues reminders) | HTTPS |
| 17 | Logs and metrics → **CloudWatch** → alarms → **SNS** → team email | — |
| — | *Deployment lane:* **GitHub Actions** → session keys (lab) / OIDC role (real account) → S3 bundle → **Elastic Beanstalk** rolling deploy (auto-rollback) → updates the Lambdas | — |
| — | *Outbound only:* private instances → **NAT Gateway** → internet (EB agent, npm packages, SES API) | — |

### 3.4 Cost of the full design (approx., check in the AWS Pricing Calculator; us-east-1 is slightly cheaper than ap-south-1)

| Item | Build weeks | Demo week (full diagram) |
|---|---|---|
| EC2 2 × t3.micro | ~$16/mo | 2–4 instances |
| ALB | ~$20/mo | same |
| NAT Gateway | 1 × ~$40/mo + data | 1 (2nd = +$40) |
| RDS db.t4g.micro | single-AZ ~$15 | Multi-AZ ~$30 + replica ~$15 |
| ElastiCache cache.t4g.micro | off | ~$12 |
| Interface endpoints (4 × 2 AZ) | off | ~$60 |
| WAF | off | ~$5 + $1/rule (or included in the CloudFront Free plan) |
| CloudFront, S3, SQS, Lambda, SES, EventBridge, Route 53 | ~$1 | ~$2 |
| **Total** | **≈ $90/month (~$3/day)** | **≈ $230/month (~$8/day)** |

Turn on the full design only for the days you test and present it, then scale back or tear down.

---

## 4. Code improvements (for *Code Quality & AWS SDK Usage*, 2 marks)

| # | Issue | File | Fix | Priority |
|---|---|---|---|---|
| **C1** | **DB password rotation breaks the app.** RDS-managed master secrets **rotate every 7 days by default**. The app reads the secret **once** at start-up, so after a rotation every new DB connection fails, and `/api/health` → 503. The read-replica URL with a password inside has the same problem. | `server/src/db/index.js`, `server/src/services/secrets.js` | `pg` 8.23 accepts **`password` as an async function**. Fetch the secret through a small cache (e.g. 5 min) and refresh it on `28P01` (auth failed). Add `DB_READ_HOST` so the replica pool uses the same secret instead of a URL with the password in it. **Quick workaround:** set the secret's rotation schedule to the maximum (365 days) during the project. | 🔴 |
| C2 | **Duplicate emails with 2+ instances.** `retryPending()` selects `queued` rows **without locking**, and every instance runs it every minute. | `server/src/services/notificationService.js:124`, `server/src/jobs.js:23` | Claim rows atomically: `UPDATE notifications SET attempts = attempts + 1 WHERE id IN (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 50) RETURNING *` | 🟠 |
| C3 | **RDS TLS is not verified** (`rejectUnauthorized: false`) | `server/src/db/index.js:12,24,38,54` | Bundle the RDS CA (`global-bundle.pem`), use `ssl: { ca, rejectUnauthorized: true }` | 🟠 |
| C4 | **No automated tests in the pipeline.** Only the concurrency script exists. | `.github/workflows/deploy.yml` | Add a `test` job: ESLint + a few API tests (register/login, reserve, waitlist, return → promotion) against a Postgres **service container**. `deploy` runs only if tests pass. | 🟠 |
| C5 | **Workflow bugs.** (a) the commit message goes unquoted into a shell command; it breaks on quotes or more than 200 characters and allows injection. (b) the OIDC trust in `docs/DEPLOYMENT.md` uses `ref:refs/heads/main`, but the job runs in `environment: production`, so the token's subject is `repo:…:environment:production`. (c) Node 20. | `.github/workflows/deploy.yml`, `docs/DEPLOYMENT.md` | (a) `--description "commit ${GITHUB_SHA::7}"` (b) Learner Lab: switch the workflow to session keys (`implementation.md` §12.1); keep the corrected OIDC trust as the real-account design (c) `node-version: 22` | 🟠 |
| C6 | **Client IP behind CloudFront.** `trust proxy` is `1`, so with CloudFront in front, every user looks like a CloudFront IP. The login rate limiter then blocks everyone together. | `server/src/app.js:27` | Set it to `2` (or make it an env var `TRUST_PROXY_HOPS`). Also set `AUTH_RATE_LIMIT` higher, because a whole campus shares one public IP. | 🟠 |
| C7 | `/api/internal/*` is reachable from the internet (token-protected only) | `server/src/app.js:66` | Keep the token, but store it in **Secrets Manager**. Add a **WAF rule**: block `/api/internal/*` requests that have no `X-Internal-Token` header. Don't block the path completely, because both Lambdas call it through CloudFront. | 🟢 |
| C8 | Logs are plain text | `server/src/app.js` (morgan) | JSON logs in production, so you can query them in CloudWatch Logs Insights | 🟢 |
| C9 | Optional SDK showcase | — | Publish custom metrics with the **CloudWatch Embedded Metric Format** (e.g. `ReservationsCreated`, `WaitlistJoined`, `EmailsQueued`) and graph them on the dashboard. Optionally switch to `@aws-sdk/client-sesv2`. | 🟢 |
| ✅ | Fixed on 2026-11-25: a stray `"cst-library-reservation-system": "file:.."` dependency in `server/package.json` that would have broken `npm install` on Elastic Beanstalk | `server/package.json` | — | done |

**Already good (mention these in the report):** the AWS SDK v3 modular clients are loaded only when a service is configured; every AWS feature switches on through an env var with a local fallback; SQS partial batch failures; the transactional outbox; advisory-lock migrations; graceful SIGTERM shutdown; the health check includes the DB; validation with `zod`; `helmet`, rate limits, bcrypt.

---

## 5. Feedback on the proposal slides (`AWS Final Project Proposal.pptx.pdf`)

Overall: **clear story, good problem statement, strong reservation-flow slide.** Below is what to fix before you reuse these slides in the final presentation.

| Slide | Feedback |
|---|---|
| 1. Title | Good. Add the module code, the date and "Group N". |
| 2 & 3. Problem | ❌ **The same slide appears twice.** Delete one. The content is good (today vs with the system). |
| 4. Objectives | The "AWS objectives (measurable)" are **not measurable yet**: they describe features, not targets. Add numbers, e.g. *survives the loss of one AZ with < 2 min interruption*, *0 double bookings with 30 simultaneous requests*, *emails delivered < 60 s after the action*, *p95 page response < 500 ms*, *cost < $X per month*. Then **measure them** in testing and show "target vs result" in the final presentation. |
| 5. Services | (1) **"RDS MySQL / PostgreSQL"**: choose **PostgreSQL**. (2) **"GitHub Actions or CodePipeline"**: choose **GitHub Actions**. (3) **Cognito (optional)**: remove it or move it to future work. (4) **ElastiCache, CloudFront, WAF, VPC endpoints and Budgets** are in the diagram but **missing from this list**. (5) The hand-drawn boxes are fine, but use **AWS icons** for a professional look. |
| 6. Feasibility | Good risk table. Fix: "No servers to patch: EB…" (EB runs EC2, so say "managed platform updates patch the EC2 instances"). "One NAT Gateway" contradicts the diagram (see D7). **Add a cost number** (section 3.4). Add the **SES sandbox** status (verified addresses) and the **region**: Mumbai measured lowest latency from Bhutan, but **Learner Lab only allows us-east-1**, so the final presentation must say so. |
| 7. Architecture | See section 2. On a slide the diagram text is **unreadable**. Use the whole slide, remove the title bar, or split it into "network view" and "request flow". Add the legend. |
| 8. Reservation flow | ✅ The best slide. Small fix: step 5 says "logged in the database". It is the **Lambda's callback** that updates the status, so add "(Lambda reports back to the app)". |
| 9. Outcomes | Good mapping of quality → architecture. Make each box **measurable** (same targets as slide 4), so the final presentation can show ✅ / ❌ per outcome. |
| 10. Work plan | Clear weeks with a buffer. Missing: **who does what**. Add a member name or role to each block. Rubric item "AWS Implementation Work Plan" expects responsibilities. |
| 11. Thank you | Fine. |
| Missing | A **cost estimate** slide, a **region choice** sentence, and the **ER diagram** (your week-7 plan says you made one, so show it in the report). |

**For the final presentation** (Part C, Presentation 2 marks), reuse slides 2, 4, 7 (fixed), 8 and 9, and add: live demo → test results (target vs measured) → cost (estimate vs actual) → changes from the proposal → lessons learned.

---

## 6. How to get full marks in Part B (20 %)

| Rubric item | Marks | What the marker needs to see | Where |
|---|---|---|---|
| Architecture Design | 2 | A clean, correct diagram (section 2 fixes) that **matches what is deployed**, with reasons for each choice | Report §4, `docs/architecture.png` |
| Code Quality & AWS SDK Usage | 2 | Fixes C1–C6, tests in CI, short code excerpts showing SDK v3 use (SQS, S3 presign, Secrets Manager, SES in Lambda) | Report §6, GitHub |
| **Functional Requirements** | **10** | **Every feature working on AWS**, shown live and with screenshots: search/filter, reserve, waitlist position, return → promotion → email, renew, pickup/due/overdue reminders, librarian catalogue CRUD + cover upload + ISBN auto-fill, circulation desk, members, dashboard/reports, email log. Plus **concurrency** and **failure** test results. | `implementation.md` Part 14, report §6 + §10 |
| AWS Service Integration | 4 | Services **really talking to each other**: the outbox → SQS → Lambda → SES → callback, EventBridge → Lambda → app, Secrets Manager at boot, S3 presigned, ElastiCache hit/miss, CloudWatch → SNS. Evidence = logs + screenshots of each hop. | `implementation.md` Parts 8–12 |
| Deployment & Configuration | 2 | The documented and **repeatable** deployment: `.ebextensions`, environment properties, the CI/CD run with rolling deploy + rollback, least-privilege IAM, no secrets in Git | `implementation.md` Parts 8 + 11 |

---

## 7. Decisions to make this week

1. ✅ **Domain:** decided, none (Learner Lab). Route 53 + ACM are removed from the diagram.
2. ✅ **Account:** AWS Academy **Learner Lab**. See section 8 and `implementation.md`. **Check your lab's Readme** against the table in section 8, especially Multi-AZ RDS, read replicas, ElastiCache, WAF and interface endpoints.
3. **Who does what?** Suggested split: (1) network + DB + security, (2) Beanstalk + CI/CD, (3) SQS/Lambda/SES/EventBridge + monitoring, (4) code fixes + tests + diagrams + report. Everyone presents their own part.
4. **Budget limit** for the AWS Budget alert.

---

## 8. AWS Academy Learner Lab: what changes and why

The proposal assumed a normal AWS account. In Learner Lab these items **must** change. Each one goes in the report's "Changes from the proposal", stated as **a lab constraint, not a design choice**, together with what you would do in a real account.

| Proposal / design | In Learner Lab | Real-account design (say this in the report) |
|---|---|---|
| Region **ap-south-1 (Mumbai)**, measured fastest from Bhutan | **us-east-1** (the lab only allows us-east-1 / us-west-2) | Mumbai. Show the latency table: CloudFront's edge cache hides part of the distance for static files. |
| Route 53 + ACM, `library.<domain>` | **Removed**: no domain registration | Route 53 hosted zone, ACM in us-east-1 (CloudFront) + the region (ALB), HTTPS to the origin |
| ALB HTTPS 443 | **HTTP 80**, only from CloudFront (prefix-list SG); users still get HTTPS from CloudFront | HTTPS listener with an ACM certificate |
| Custom least-privilege IAM roles | **`LabRole` + `LabInstanceProfile`** (role creation blocked) | `library-ec2-role` with one secret, one queue, `covers/*` only |
| GitHub Actions with **OIDC** (no stored keys) | **Session keys in GitHub secrets**, refreshed every ~4 h session | OIDC role trusted for `environment:production` |
| SES production access | **Sandbox only**: verified recipients | Production access + verified domain with DKIM |
| AWS Budgets / Cost Explorer | **Not available**: track the lab credit per session | Budget alert + Cost Explorer |
| Always-on system | **EC2 stops when the session ends** (~4 h). The NAT/ALB/RDS keep using credit. | 24/7 |

### Services to check in your lab's Readme (they vary between classes)
| Service / feature | Expected | If blocked |
|---|---|---|
| Elastic Beanstalk (with `LabRole` / `LabInstanceProfile`) | ✅ normally works | Critical: ask your lecturer |
| RDS PostgreSQL db.t4g/t3.micro | ✅ | Use t3.micro |
| RDS **Multi-AZ**, **read replica** | usually ✅ | Screenshot the error, keep them in the design as "scale-up" |
| Secrets Manager (RDS-managed secret) | usually ✅ | Self-managed secret (`implementation.md` §5.2 note) |
| ElastiCache | usually ✅ (small nodes) | The app falls back to its memory cache. Explain it. |
| SQS, SNS, Lambda, CloudWatch, S3 | ✅ | — |
| SES | ✅ sandbox | — |
| EventBridge Scheduler with `LabRole` | sometimes refused | Classic EventBridge rule (`implementation.md` §10.4) |
| CloudFront | ✅ | Serve straight from the EB URL (HTTP) and explain it |
| WAF | varies | Skip it; keep it in the design |
| VPC interface endpoints, NAT | ✅ (costs credit) | — |

### Credit budget (approx., us-east-1)
| Item | per day |
|---|---|
| NAT Gateway | ~$1.10 |
| ALB | ~$0.55 |
| 2 × EC2 t3.micro | ~$0.50 |
| RDS db.t4g.micro single-AZ | ~$0.40 |
| **Core total** | **~$2.5/day** |
| + Multi-AZ, replica, ElastiCache, 4 endpoints × 2 AZ, 2nd NAT, WAF | **+ ~$4/day** |

With a $50 credit: build the core about 10 days before the demo, add the extras 2–3 days before, and **pause** (terminate EB, delete NAT) on days you don't work. Running out of credit disables the account and deletes your work.
