# TODO: Proposal check and recommended final architecture

Reviewed on 2026-11-25 against:
- the Final Project rubric (35 marks)
- the proposal deck **"AWS Final Project Proposal.pptx"** (Google Drive)
- the code in this repo, `README.md` and `docs/DEPLOYMENT.md`
- the course labs in `aws-floci-course/labs` (IAM, VPC, EC2, ECS, ECS+ALB, ECS autoscaling, EKS, security, Lambda@Edge, CI/CD, CloudWatch + X-Ray)

> **Not checked:** the slides that are only pictures ("AWS services selected", the architecture
> diagram, "Expected outcomes" table, and the work-plan timeline). The Drive reader returns only
> text. Export those slides as PNG if you want them checked too.

---

## 1. Verdict

**The proposal is correct, well argued, and the code already matches it closely.** Keep it.

| Decision | Recommendation |
|---|---|
| Compute: **Elastic Beanstalk** | **Keep.** The proposal picks it over ECS/EKS with a clear reason (small system, less setup and cost), and promises "deployed system on Elastic Beanstalk". Switching now contradicts your own slides. |
| Show the ECS/container labs too? | **Optional middle ground:** run EB on the **Docker platform** with the image stored in **ECR**. You keep Beanstalk (as proposed) and also show Docker + ECR. Only move to full ECS Fargate if your lecturer says ECS is required. |
| Database: **RDS PostgreSQL** Multi-AZ + read replica | **Keep.** Row locking for the last copy is the right design. DynamoDB would be worse here. |
| Messaging: SQS → Lambda → SES + DLQ, EventBridge daily Lambda | **Keep.** Already built. This is the strongest part. |
| Infrastructure as Code (Terraform) | **Add.** It is not in the proposal, but it doesn't contradict it and it helps the *Deployment & Configuration* marks. You can reuse Assignment 3's `infra/*.tf`. |
| Promises in the proposal that are **not built yet** | **Build them, or present them as "scale-up / production version"** (section 2) |

---

## 2. Proposal vs what is actually built

The marker will compare the implementation with the proposal. These are the gaps.

| Promised in the proposal | Status in the code / docs | What to do |
|---|---|---|
| EB across 2 AZs, Auto Scaling 2–4 | Done (`server/.ebextensions/01-environment.config`) | — |
| RDS Multi-AZ + **read replica** | Supported (`DATABASE_READ_URL`) | Create the replica only for the demo, to save cost, and show it working |
| Row locking, tested concurrently | Done (`npm run test:concurrency`) | Run it against the AWS URL and screenshot it |
| SQS → Lambda → SES, DLQ, EventBridge | Done (`lambda/`) | — |
| ElastiCache for the catalogue | Done (`services/cache.js`) | — |
| Private S3, presigned URLs | Done (`services/storage.js`) | — |
| **"Old data moves to cheaper storage classes"** (logs in S3) | **Not really.** The app writes no logs to S3. EB logs go to CloudWatch. | Turn on **ALB access logs → S3** with a lifecycle rule to Glacier. Easy, and it makes the claim true. |
| **Route 53 + ACM (HTTPS)** | Only in the docs | You need a **domain** for Route 53/ACM on an ALB. If you have none, use **CloudFront's free `*.cloudfront.net` HTTPS** and say so. |
| **CloudFront + WAF** ("production version") | Marked optional in docs | Build CloudFront (cheap, gives HTTPS). WAF is optional, but say clearly "planned for production" if you skip it. |
| **VPC interface endpoints for SQS + Secrets Manager** | Marked optional | About $7–8/month each per AZ. Build them for the demo week only, or move them to "scale-up". |
| **NAT Gateways in both zones** | One NAT (scale-up plan) | Matches the proposal ("started with a single NAT"). OK. |
| **"No servers to patch"** (feasibility slide) | EB still runs EC2 | Turn on **EB managed platform updates** so this claim is true (section 5, Phase 1). |
| CloudWatch alarms → SNS | Documented, not automated | Create them (Terraform), and screenshot one firing |
| GitHub Actions → EB with rollback | Done (`.github/workflows/deploy.yml`) | Add a test step (section 6) |
| Deliverables: diagrams, docs, live demo | Partly | Section 5, Phase 5 |

### Small problems in the deck itself
- [ ] **The "The problem we are solving" slide appears twice** (slides 2 and 3). Delete one.
- [ ] **The architecture slide script is too long for its time slot.** The speaker notes add up to about **4 min 15 s**, but the timings on the other slides leave only about **1 min 30 s** (5:15 → 6:45). Cut it to the request path (steps 2–6) and leave security and "why EB" for questions.
- [ ] Feasibility talks about cost control but gives **no number**. Add one line, e.g. "about $X/month during development, $Y in the demo week" (see section 7).
- [ ] Work plan: make sure each week shows **who** does what (the notes don't name roles; the timeline picture might).

---

## 3. Options compared (for the report's "why we chose" section)

### Compute
| Option | Verdict |
|---|---|
| **Elastic Beanstalk, Node.js platform** (current, as proposed) | Keep. Managed EC2, ASG, ALB, rolling deploys, health checks. |
| EB **Docker platform + ECR** | Optional upgrade that keeps the proposal and shows the container labs |
| ECS Fargate | Matches labs 4–6, but contradicts the proposal. Only if the lecturer asks. |
| EKS | No. About $73/month for the control plane alone, and too complex for this app. |
| Lambda + API Gateway | No. It would need a rewrite (pg pools, transactions, background jobs). |

### Database
| Option | Verdict |
|---|---|
| **RDS PostgreSQL** | Keep. Relational data, foreign keys, `FOR UPDATE` locking, FIFO waitlist. |
| Aurora Serverless v2 | Mention as the future scale option |
| DynamoDB | No for the core data (no joins; the reservation logic would need a rewrite) |
| RDS Proxy | Optional. Not needed at 2–4 instances. |

### Authentication
Custom JWT + bcrypt works. **Cognito** (used in Assignments 2/3) is optional and only worth doing after everything else is finished.

---

## 4. Final architecture (matches the proposal)

```
Users ─HTTPS─► CloudFront (+ WAF optional) ─► ALB (public subnets, 2 AZ, :443)   [Route 53 + ACM if you have a domain]
                                               │
                              Elastic Beanstalk EC2 ×2–4 (private app subnets, 2 AZ, Auto Scaling)
                                               │
        ┌──────────────┬───────────────┬───────┴────────┬─────────────────────────┐
        ▼              ▼               ▼                ▼                         ▼
  RDS PostgreSQL   ElastiCache     S3 (covers,     SQS ─► Lambda notifier ─► SES   Secrets Manager
  Multi-AZ +       Redis           ALB logs →        └► DLQ (3 tries) ─► alarm     (via VPC endpoint)
  read replica                     Glacier)
EventBridge Scheduler (daily) ─► Lambda reminders ─► /api/internal/jobs/daily
CloudWatch Logs + Alarms ─► SNS team email        GitHub Actions (OIDC) ─► EB rolling deploy + rollback
Terraform builds the infrastructure
```

---

## 5. Work plan (checklist)

The rubric marks each task helps with are shown in brackets.

### Phase 0: Confirm first
- [ ] **Which AWS account?** On **AWS Academy Learner Lab** you cannot create IAM roles or the GitHub OIDC provider. Use `LabRole`/`LabInstanceProfile`, and short-lived keys as GitHub secrets. Check that EB, ElastiCache and SES are allowed in your lab.
- [ ] Do you have a domain? If not → CloudFront HTTPS instead of Route 53 + ACM. Write that down as a change from the proposal.
- [ ] Ask the lecturer whether ECS must be shown. If yes → EB Docker + ECR (smallest change) or ECS Fargate.
- [ ] Assign owners: network/Terraform · EB/CI-CD · app/code quality · docs/diagrams/presentation.

### Phase 1: Finish the AWS build as proposed  [Architecture 2, Service Integration 4, Deployment 2]
- [ ] VPC: 2 AZ, public, app and DB subnets, 1 NAT, S3 gateway endpoint
- [ ] RDS PostgreSQL (single-AZ while building → **Multi-AZ + read replica in demo week**)
- [ ] S3 covers bucket + **ALB access-logs bucket with a lifecycle rule to Glacier**
- [ ] SQS + DLQ, both Lambdas, EventBridge schedule, SES identities verified, **SES production access requested now**
- [ ] ElastiCache Redis (demo week)
- [ ] EB environment in private subnets, min 2/max 4. Add to `.ebextensions`:
      `aws:elasticbeanstalk:managedactions` (ManagedActionsEnabled: true, PreferredStartTime) and
      `aws:elasticbeanstalk:managedactions:platformupdate` (UpdateLevel: minor)
- [ ] CloudFront in front of the ALB (and ALB SG limited to the CloudFront prefix list); WAF optional
- [ ] Interface endpoints for SQS + Secrets Manager (demo week, or present them as scale-up)
- [ ] *(Optional)* switch EB to the Docker platform: add `Dockerfile`, push the image to ECR, deploy with `Dockerrun.aws.json`

### Phase 2: Infrastructure as Code  [Deployment & Configuration 2]
- [ ] `infra/` with Terraform, starting from `Assigment-3-AWS/infra` (network, database, queues, storage, monitoring already exist there)
- [ ] Add `elastic_beanstalk.tf` (`aws_elastic_beanstalk_application` + `_environment`), `lambda.tf`, `scheduler.tf`, `cache.tf`, `cdn.tf`
- [ ] Two variable files: `dev.tfvars` (cheap) and `demo.tfvars` (Multi-AZ, replica, Redis, endpoints, WAF)
- [ ] Remote state in S3

### Phase 3: CI/CD  [Deployment 2, Code Quality 2]
- [ ] Add a `test` job before deploy (lint + unit/API tests with a Postgres service container)
- [ ] Add `ci.yml` for pull requests (tests + `terraform fmt -check` / `validate`)
- [ ] Remove `continue-on-error` on the Lambda update step, or report the failure clearly

### Phase 4: Monitoring  [Service Integration 4]
- [ ] Alarms → SNS: EB health, ALB 5xx, EC2 CPU, RDS CPU/storage, **DLQ ≥ 1**, Lambda errors
- [ ] One CloudWatch dashboard (good presentation screenshot)
- [ ] Optional (lab 13): X-Ray tracing
- [ ] AWS Budget alert

### Phase 5: Documentation and presentation  [Clarity 2, Technical Docs 4, Diagrams 2, Presentation 2]
- [ ] `docs/architecture.png`: the same diagram as the proposal, updated to show what was **really** built
- [ ] Sequence diagram: reserve → outbox → SQS → Lambda → SES → status callback
- [ ] `docs/services.md`: each service, its role, why it was chosen over the alternative (section 3), and its config
- [ ] `docs/changes-from-proposal.md`: anything dropped or added and why (e.g. CloudFront HTTPS instead of Route 53 if you have no domain)
- [ ] `docs/cost.md`: AWS Pricing Calculator estimate, dev vs demo week
- [ ] Evidence screenshots: EB Green with 2 instances in 2 AZs, RDS Multi-AZ, SQS/DLQ, Lambda logs, the SES email received, alarms, concurrency test output
- [ ] Failure test: terminate one EC2 instance, and show that the ALB keeps serving while Auto Scaling replaces it
- [ ] Final slides: problem → architecture → live demo (README script) → services → challenges → cost → lessons learned

---

## 6. Code issues found (for the *Code Quality* marks)

0. **FIXED (2026-11-25):** `server/package.json` had a stray `"cst-library-reservation-system": "file:.."` dependency. Elastic Beanstalk's `npm install` would have failed on the next deploy. It has been removed from `package.json` and `package-lock.json`.
0. **Login rate limit vs the campus network:** `server/src/routes/auth.js` allows 50 logins per 15 min **per IP** in production. The whole campus shares one public IP (the same bottleneck you found in Assignment 3), so a class logging in during the demo, or `STUDENTS=40 npm run test:concurrency`, can be blocked. Set the EB env property `AUTH_RATE_LIMIT=1000` for the demo. If you add CloudFront, also change `app.set('trust proxy', 1)` to `2` in `server/src/app.js`, so it reads the real client IP and not the CloudFront IP.

1. **Possible duplicate emails with 2+ instances.** `retryPending()` in `server/src/services/notificationService.js:124` selects `queued` rows with no lock, and every instance runs it (`server/src/jobs.js:23`). Claim rows atomically with `FOR UPDATE SKIP LOCKED` (the comment in `jobs.js:7` already says so, but this query doesn't do it).
2. **RDS TLS is not verified.** `server/src/db/index.js:12,24,38,54` uses `rejectUnauthorized: false`. Ship the RDS CA bundle and verify it.
3. **`/api/internal/*` is reachable from the internet** (`server/src/app.js:66`). It is protected only by a shared token. Block it at CloudFront/WAF, or keep the token in Secrets Manager and rotate it.
4. **No automated tests in CI.** Only the concurrency script exists. Add a few unit and API tests and ESLint.
5. Optional: `@aws-sdk/client-sesv2` instead of the SES v1 client, JSON logs in the API, and handle `SIGTERM` for clean shutdowns during rolling deploys.

---

## 7. Cost guide (approx., ap-south-1, check in AWS Pricing Calculator)

| Item | Dev (while building) | Demo week |
|---|---|---|
| EB: EC2 t3.micro | 2 × ~$8.50/mo | 2–4 |
| ALB | ~$18/mo | same |
| NAT Gateway | 1 × ~$35/mo + data | 1 (2 = scale-up) |
| RDS PostgreSQL t4g.micro | single-AZ ~$13/mo | Multi-AZ ~$26 + replica ~$13 |
| ElastiCache t4g.micro | off | ~$12/mo |
| Interface endpoints (SQS, Secrets Manager) | off | ~$7–8 each per AZ |
| CloudFront, S3, SQS, Lambda, SES, EventBridge | ~free tier | ~free tier |

**Biggest cost risk: the NAT Gateway and the ALB.** Run `terraform destroy` after each work session.

---

## 8. Priority if time runs short

1. **Must:** everything already built, deployed on EB in 2 AZs with RDS, S3, SQS→Lambda→SES, EventBridge, Secrets Manager, alarms, CI/CD, architecture diagram, docs, fix the duplicate slide
2. **Should:** Terraform, CloudFront HTTPS, ALB logs → S3 lifecycle, managed platform updates, code fixes 6.1–6.4, Multi-AZ + read replica on demo day
3. **Could:** WAF, interface endpoints, ElastiCache, EB Docker + ECR, X-Ray, Cognito
