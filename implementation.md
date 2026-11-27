# Implementation guide: build, test and document the project on AWS

**Project:** Cloud-Native Library Book Reservation System. **Region:** `us-east-1` (N. Virginia). **Account:** AWS Academy **Learner Lab**.
**Repo:** `Rynorbu/Library-Management-System-AWS-`

> ### ⚠️ Learner Lab edition: read this first
> This guide is written for **AWS Academy Learner Lab**. The lab adds these rules (the full list is in your lab's **Readme** button; check it against `improvement.md` §8):
> - **Region:** only **us-east-1** (or us-west-2). We use **us-east-1**. Mumbai, which we measured as fastest from Bhutan, is **not allowed**. Explain this in the report.
> - **IAM:** you **cannot create roles, users or policies**. Use the ready-made **`LabRole`** (for services) and **`LabInstanceProfile`** (for EC2 / Elastic Beanstalk). Put the least-privilege policies from this guide in the report as "the design for a real account".
> - **No domain:** Route 53 domains can't be registered, so there is **no Route 53 + ACM**. CloudFront's default certificate (`https://dxxxx.cloudfront.net`) gives HTTPS.
> - **CI/CD:** no GitHub OIDC (that needs an IAM identity provider). GitHub uses the lab's **temporary session keys**, which expire when the session ends.
> - **Sessions last about 4 hours.** When a session ends, **EC2 instances are stopped**, but the NAT Gateway, load balancer, RDS and other resources **keep running and keep using credit**.
> - **Credit is limited** (usually $50 or $100). **If the credit runs out, the account is disabled and your work is lost.** No AWS Budgets or Cost Explorer: watch the credit display on the lab page.
> - **SES stays in the sandbox:** you cannot get production access, so every recipient must be a verified address.

This is the step-by-step runbook for **Part B, AWS Implementation & Deployment (20 %)**. It also collects the evidence for **Part C (documentation and presentation)**.
Do the parts **in order**. Each step says **what to do**, **what to write down**, and which **📸 screenshot** to take. Screenshots are numbered in the order you will take them (S01 → S57).

Read `improvement.md` first. It explains **why** the design is like this. This file is **how** to build it.

> AWS changes console labels sometimes. If a button has a slightly different name, use the closest match.
> This file replaces `your-task.md`.

---

## Contents

| Part | What | Rough time |
|---|---|---|
| [0](#part-0-screenshot-rules-read-first) | Screenshot rules | 10 min |
| [1](#part-1-prepare-the-code-on-your-laptop) | Prepare the code (and code fixes) | ½–1 day |
| [2](#part-2-learner-lab-setup-credit-region-sessions-team) | Learner Lab setup: credit, region, sessions, team | 30 min |
| [3](#part-3-https-without-a-domain) | HTTPS without a domain (no Route 53 / ACM) | 5 min |
| [4](#part-4-network-vpc-subnets-nat-security-groups) | VPC, subnets, NAT, security groups | 1 h |
| [5](#part-5-database-rds-postgresql--secrets-manager) | RDS PostgreSQL + Secrets Manager | 1 h |
| [6](#part-6-storage-s3-buckets) | S3 buckets | 30 min |
| [7](#part-7-messaging-ses-and-sqs) | SES + SQS | 30 min (+ SES approval) |
| [8](#part-8-iam-roles) | IAM roles | 30 min |
| [9](#part-9-the-application-on-elastic-beanstalk) | Elastic Beanstalk | 1–2 h |
| [10](#part-10-lambda-functions-and-eventbridge-scheduler) | Lambdas + EventBridge | 1 h |
| [11](#part-11-cloudfront-waf-and-dns) | CloudFront, WAF, DNS | 1 h |
| [12](#part-12-cicd-pipeline-github-actions) | CI/CD pipeline | 1–2 h |
| [13](#part-13-monitoring-cloudwatch--sns) | CloudWatch + SNS | 1 h |
| [14](#part-14-high-availability-upgrades-demo-week) | High-availability upgrades (demo week) | 1 h |
| [15](#part-15-testing-and-evidence) | Testing and evidence | ½ day |
| [16](#part-16-tear-down) | Tear down | 30 min |
| [17](#part-17-diagrams-report-and-presentation) | Diagrams, report, presentation | 2–3 days |
| [A–D](#appendix-a-screenshot-checklist) | Checklist, record sheet, troubleshooting, Learner Lab | — |

**Credit plan (approx., us-east-1):** the core stack (Parts 4–13) uses about **$2.5/day**, mostly the NAT Gateway (~$1.1), load balancer (~$0.55), 2 EC2 (~$0.5) and RDS (~$0.4). Part 14 adds about **$4/day**. With $50 of credit:
- Build the core **no more than ~10 days before the demo**, and do Part 14 only **2–3 days before**.
- If you won't work on it for several days, run **Part 16 "pause"** (delete the NAT, terminate the EB environment).
- Take screenshots **as you go**. If the credit runs out, the account and everything in it is gone.

---

## Part 0: Screenshot rules (read first)

1. **Save to** `docs/screenshots/`, named with the number from this guide: `S16-eb-health-ok.png`.
2. **Tool:** Windows **Win + Shift + S** → *Window* or *Rectangle* → save as PNG.
3. **Every screenshot must show:**
   - the **region** (top-right of the console) and the **page title / service name**
   - the **status that proves the point** (*Available*, *Ok*, *Healthy*, *Verified*, *Sent*, a green tick)
   - for the web app: the **address bar** (proves it is the AWS URL, not localhost)
   - a **date/time** where possible (events, logs, graphs)
4. **Hide before saving** (Snipping Tool pen or Paint):
   - the **12-digit account ID** (top-right menu and inside ARNs)
   - **secret values**: `JWT_SECRET`, `INTERNAL_API_TOKEN`, passwords, access keys
   - **never** press "Retrieve secret value" in Secrets Manager while recording or capturing
5. Use browser zoom 100 % and the same theme every time, with no unrelated tabs.
6. After each screenshot, add a caption line to `docs/screenshots/CAPTIONS.md`:
   `S16: Elastic Beanstalk environment cst-library-prod, health Ok, 2 instances in 2 AZs (2026-12-02)`
   These lines become your report's figure captions.
7. **Take extra screenshots.** After teardown you can't go back.

---

## Part 1: Prepare the code on your laptop

### 1.1 Tools
Node.js **22 LTS** (`node -v`), Git, Docker Desktop. Optional: AWS CLI v2 (`aws --version`).

### 1.2 Run it locally once
```bash
git pull
npm run setup
cp server/.env.example server/.env
npm run db:up
npm run dev                 # http://localhost:5173
npm run test:concurrency    # in a second terminal
```

### 1.3 Make the code fixes from `improvement.md` §4 **before** the first AWS deploy
Do at least the 🔴 and 🟠 items:

| Fix | What changes | Why now |
|---|---|---|
| **C1** secret rotation | `db/index.js`: `password` becomes an async function that reads Secrets Manager through a short cache, and a new `DB_READ_HOST` builds the replica pool from the same secret | Otherwise the app breaks when RDS rotates the password (every 7 days by default) |
| C2 outbox claim | `notificationService.js`: `retryPending()` uses `FOR UPDATE SKIP LOCKED` | No duplicate emails with 2+ instances |
| C3 RDS TLS | add the RDS CA bundle, `rejectUnauthorized: true` | Encryption in transit, verified |
| C4 tests | ESLint + API tests, `test` job in the workflow | *Code Quality* marks |
| C5 workflow | safe `--description`, Node 22 | The pipeline won't break on commit messages |
| C6 proxy | `app.set('trust proxy', 2)` (CloudFront → ALB) | Rate limiting per real user, not per CloudFront IP |

> If you have not finished C1 when you deploy, use the workaround in step 5.4 (rotation schedule = 365 days).

### 1.4 Build the bundles
```bash
npm run package
```
This creates `build/library-app.zip` (Elastic Beanstalk) and `build/lambda-notifier.zip` and `build/lambda-reminders.zip`.
The command below must print **nothing** (the stray dependency was fixed on 2026-11-25):
```bash
grep "file:\.\." server/package.json
```

### 1.5 Generate two secrets
Run this **twice**, and keep the values in a password manager, **never in Git**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Value 1 = `JWT_SECRET`, value 2 = `INTERNAL_API_TOKEN`.

### 1.6 Open the record sheet
Copy **Appendix B** into a private note and fill it in as you go.

---

## Part 2: Learner Lab setup: credit, region, sessions, team

### 2.1 Start the lab and record the credit
1. AWS Academy → your course → **Modules → Learner Lab** → **Start Lab**. Wait until the dot next to "AWS" is **green**, then click **AWS** to open the console.
2. Click **Readme** and read the *Service usage and other restrictions* section. Compare it with the table in `improvement.md` §8, and note anything your lab blocks.
3. Note the **used / remaining credit** shown on the lab page. Check it at the start of **every** session and write it in the record sheet. These numbers become the cost section of your report.

📸 **S01**: the Learner Lab page showing the session timer and the **credit used / remaining** (instead of AWS Budgets, which the lab blocks).

### 2.2 Region
Top-right → **US East (N. Virginia) us-east-1**. Every resource goes here. CloudFront and its WAF are global.

### 2.3 Working in 4-hour sessions
- Each session lasts about 4 hours. Check the timer on the lab page. **Start Lab** again extends it.
- Long steps (RDS ~10 min, Elastic Beanstalk ~15 min, Multi-AZ ~15 min) must **start early in a session**.
- When a session ends, the **EC2 instances stop**. On the next start they boot again, but Elastic Beanstalk may show *Degraded* for a few minutes. If it stays red: EB → **Actions → Restart app servers**.
- The **temporary AWS keys** (Learner Lab → **AWS Details → AWS CLI → Show**) change **every session**. Update them in GitHub (Part 12) and in your terminal before using the CLI.
- **Never click "Reset"** on the lab page. It deletes everything in the account.

### 2.4 Team split (write it in the report)
| Member | Owns | Presents |
|---|---|---|
| 1 | Parts 4–6 (network, RDS, S3, security) | Architecture + security |
| 2 | Parts 9, 12 (Elastic Beanstalk, CI/CD) | Deployment + pipeline |
| 3 | Parts 7, 10, 13 (SES, SQS, Lambda, EventBridge, monitoring) | Event-driven pipeline + monitoring |
| 4 | Part 1 fixes, Part 15 tests, Part 17 diagrams + report | Live demo + test results |

---

## Part 3: HTTPS without a domain

Learner Lab can't register a domain, so this project uses **CloudFront's default certificate**: users get `https://dxxxx.cloudfront.net`. Nothing to build in this part.

Notes for the report (section "Changes from the proposal"):
- *"Route 53 and ACM were not used because the AWS Academy Learner Lab does not allow domain registration. CloudFront's default certificate provides HTTPS for users. Traffic from CloudFront to the load balancer uses HTTP inside AWS's network, and the load balancer accepts only CloudFront (prefix-list security group). In a real account we would add Route 53 + ACM and HTTPS to the origin."*
- Screenshots **S02 and S03 are not used** in this edition. Keep the numbering so the checklist stays the same.

---

## Part 4: Network: VPC, subnets, NAT, security groups

### 4.1 Create the VPC (matching the diagram's CIDRs)
**VPC → Create VPC → VPC and more**

| Field | Value |
|---|---|
| Name tag | `library` |
| IPv4 CIDR | `10.0.0.0/16` |
| Number of AZs | **2** (`us-east-1a`, `us-east-1b`) |
| Public subnets | **2** |
| Private subnets | **4** |
| **Customize subnet CIDR blocks** | public `10.0.0.0/19`, `10.0.32.0/19`; private `10.0.64.0/19`, `10.0.96.0/19`, `10.0.128.0/19`, `10.0.160.0/19` |
| NAT gateways | **In 1 AZ** (second NAT = Part 14) |
| VPC endpoints | **S3 Gateway** |
| DNS hostnames / resolution | both on |

Create, then rename the subnets (Subnets → select → *Name* → edit) to match the diagram:

| CIDR | AZ | Name |
|---|---|---|
| 10.0.0.0/19 | a | `public-a` |
| 10.0.32.0/19 | b | `public-b` |
| 10.0.64.0/19 | a | `private-app-a` |
| 10.0.96.0/19 | b | `private-app-b` |
| 10.0.128.0/19 | a | `private-db-a` |
| 10.0.160.0/19 | b | `private-db-b` |

> If the wizard put the CIDRs in a different order, rename by **CIDR and AZ**, not by the wizard's names.

📸 **S04**: VPC → **Resource map** (subnets, route tables, IGW, NAT, S3 endpoint).
📸 **S05**: Subnets list filtered by `library` (name, AZ, CIDR, available IPs = 8187).
📸 **S06**: a private route table → Routes (`0.0.0.0/0 → nat-…` and `pl-… → vpce-…`).

### 4.2 Security groups
**VPC → Security groups → Create**, VPC = `library`:

| Name | Inbound | Purpose |
|---|---|---|
| `sg-app` | *(none; Elastic Beanstalk adds the ALB → instance rule)* | App instances. Used as the "source" below. |
| `sg-db` | TCP **5432** from `sg-app` | Only the app reaches RDS |
| `sg-cache` | TCP **6379** from `sg-app` | Only the app reaches ElastiCache |
| `sg-endpoints` | TCP **443** from `sg-app` | Interface VPC endpoints |

📸 **S07**: the security group list, plus `sg-db` → Inbound rules (5432 from `sg-app`).

---

## Part 5: Database: RDS PostgreSQL + Secrets Manager

### 5.1 DB subnet group
**RDS → Subnet groups → Create**: `library-db`, VPC `library`, subnets **`private-db-a`, `private-db-b`**.

### 5.2 Create the database
**RDS → Create database → Standard create**

| Section | Value |
|---|---|
| Engine | **PostgreSQL 16.x** |
| Template | Dev/Test (or Free tier) |
| Availability | **Single-AZ** now → **Multi-AZ in Part 14** |
| Identifier | `library-db` |
| Master username | `library_admin` |
| Credentials | **Managed in AWS Secrets Manager** ✔ |
| Class | **db.t4g.micro** |
| Storage | gp3 20 GiB, autoscaling off |
| VPC / subnet group | `library` / `library-db` |
| Public access | **No** |
| Security group | **`sg-db`** only (remove `default`) |
| AZ | `us-east-1a` (matches "Primary AZ-A") |
| **Additional configuration → Initial database name** | **`library`** ← don't miss this |
| Backup | 7 days. Encryption **on**. |
| Deletion protection | off (say in the report: *on in production*) |

About 10 minutes.

> **If the lab blocks "Managed in AWS Secrets Manager"** (the database fails to create, or you get an access error): choose **Self managed** with a strong password. Then go to **Secrets Manager → Store a new secret → Other type of secret** with the keys `username`, `password`, `host` (RDS endpoint), `port` (5432) and `dbname` (`library`). Name it `library/db` and use its ARN as `DB_SECRET_ARN`. The app reads all of these keys (`server/src/db/index.js`). With a self-managed secret, rotation is off by default, so 5.4 doesn't apply.

### 5.3 Write down
- **Endpoint** → `DB_HOST`
- **Master credentials ARN** (Configuration tab) → `DB_SECRET_ARN`

### 5.4 Secret rotation
**Secrets Manager → the `rds!db-…` secret → Rotation.**
- If code fix **C1 is done**: leave rotation on. That's good security, and you can show it in the report.
- If **C1 is not done**: **Edit rotation → schedule 365 days**, otherwise the app breaks after 7 days.

📸 **S08**: RDS **Connectivity & security** (endpoint, *Publicly accessible: No*, `sg-db`, DB subnets).
📸 **S09**: RDS **Configuration** (engine, class, *Encryption: Enabled*, master credentials in Secrets Manager).
📸 **S10**: Secrets Manager secret **overview + Rotation** section (**no value shown**).

---

## Part 6: Storage: S3 buckets

### 6.1 Book covers
**S3 → Create bucket** `library-covers-<account-id>`. **Block all public access ✔**, SSE-S3, Bucket Key on. → `S3_BUCKET`.

📸 **S11**: covers bucket → Permissions → *Block all public access: On*.

### 6.2 Logs (ALB access logs → Glacier)
1. Create `library-logs-<account-id>` (same settings).
2. **Permissions → Bucket policy** (`127311923021` = the ELB account for us-east-1):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::127311923021:root" },
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::library-logs-<account-id>/alb/AWSLogs/<account-id>/*"
  }]
}
```
3. **Management → Lifecycle rule** `logs-to-glacier`: → Glacier Flexible Retrieval after **30 days**, expire after **365 days**.

📸 **S12**: the lifecycle rule summary.

---

## Part 7: Messaging: SES and SQS

### 7.1 SES (sandbox only in Learner Lab)
1. **SES → Identities → Create identity → Email address** → your sender (e.g. a group Gmail) → click the link in the email.
2. Learner Lab **cannot leave the SES sandbox**, so every **recipient** must be verified too. Use Gmail `+` aliases: `you+studenta@gmail.com`, `you+studentb@gmail.com`, `you+librarian@gmail.com` (one inbox, but verify each one). Also verify each member's own address if they will demo.
3. Don't request production access; the lab doesn't allow it. In the report, say: *"In production we would request SES production access and verify a domain with DKIM."*
4. Emails from a Gmail sender through SES often land in **Spam**. Check there, and mark them "Not spam" before the demo.

→ `SES_FROM_EMAIL`

📸 **S13**: SES identities, all **Verified**, plus the account dashboard showing **Sandbox** (to explain why recipients are verified).

### 7.2 SQS
1. **Create queue → Standard** `library-notifications-dlq`, retention **14 days**.
2. **Create queue → Standard** `library-notifications`: visibility timeout **180 s**, **DLQ on** → `library-notifications-dlq`, **max receives 3**.
3. Record the queue **URL** → `SQS_QUEUE_URL` and both **ARNs**.

📸 **S14**: the queue list (both queues) **and** `library-notifications` → Dead-letter queue tab (max receives 3).

---

## Part 8: IAM roles (Learner Lab: use the ready-made roles)

You **cannot create IAM roles** in Learner Lab. Use the roles the lab provides everywhere:

| Where | Use |
|---|---|
| Elastic Beanstalk **service role** | **`LabRole`** |
| Elastic Beanstalk **EC2 instance profile** | **`LabInstanceProfile`** |
| Lambda execution role (both functions) | **`LabRole`** (*Use an existing role*) |
| EventBridge Scheduler execution role | **`LabRole`** |

`LabRole` allows much more than this app needs. That's a lab limitation, not a design choice, so the report must show **the least-privilege design you would use in a real account**:

### 8.1 The least-privilege design (for the report, not created in the lab)
Instance role `library-ec2-role` = `AWSElasticBeanstalkWebTier` + this inline policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ReadDbSecret",  "Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": "<DB_SECRET_ARN>" },
    { "Sid": "PublishEmails", "Effect": "Allow", "Action": "sqs:SendMessage", "Resource": "<library-notifications ARN>" },
    { "Sid": "BookCovers",    "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": "arn:aws:s3:::<S3_BUCKET>/covers/*" }
  ]
}
```
Notifier Lambda: `AWSLambdaSQSQueueExecutionRole` + `ses:SendEmail` on the sender identity. Reminders Lambda: basic execution role only. GitHub: an OIDC role limited to Elastic Beanstalk deploys and `lambda:UpdateFunctionCode` on the two functions.

📸 **S15**: **IAM → Roles → `LabRole`** → Permissions + Trust relationships (shows which AWS services can use it). Put the JSON above in the report as the real-account design.

---

## Part 9: The application on Elastic Beanstalk

### 9.1 Create the environment
**Elastic Beanstalk → Create application**

**Step 1: Configure environment**
| Field | Value |
|---|---|
| Tier | **Web server** |
| Application | `cst-library` |
| Environment | `cst-library-prod` |
| Domain | `cst-library-<group>` |
| Platform | **Node.js 22 on 64bit Amazon Linux 2023** |
| Code | **Upload** `build/library-app.zip`, version `v1-initial` |
| Preset | **Custom configuration** |

**Step 2: Service access**
- Service role: **Use an existing service role → `LabRole`**
- EC2 instance profile: **`LabInstanceProfile`**
- Key pair: **none** (no SSH, so a smaller attack surface. Don't pick `vockey`.)

**Step 3: Networking and database**
- VPC `library`. **Instance subnets: `private-app-a`, `private-app-b`**. **Public IP: off**.
- **Enable database: OFF** (we use our own RDS, so it survives if the environment is deleted)

**Step 4: Instance traffic and scaling**
- IMDSv1 **deactivated**. Security group **`sg-app`**.
- **Load balanced**, min **2**, max **4**, **t3.micro**, AZs: **any 2**
- Scaling trigger: CPU, upper 70 %, lower 25 %
- Load balancer: **Application, dedicated, public**, subnets **`public-a`, `public-b`**
- **Listeners**: keep **80 HTTP** only. There is no certificate without a domain; CloudFront gives users HTTPS. Step 11.5 locks port 80 to CloudFront only.
- Instance type: if the lab rejects `t3.micro`, use `t2.micro` (the lab limits instance types and counts; up to 4 instances is normally fine).
- Processes → default: health check **`/api/health`**
- **Access logs: on** → bucket `library-logs-<id>`, prefix `alb`

**Step 5: Updates, monitoring and logging**
- Health: **Enhanced**
- **Managed platform updates: on**, weekly window, **minor and patch**
- Deployment: **Rolling with additional batch**, batch size 1
- **Log streaming to CloudWatch: on**, 14 days
- **Environment properties:**

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | value 1 |
| `INTERNAL_API_TOKEN` | value 2 |
| `DB_SECRET_ARN` | RDS secret ARN |
| `DB_HOST` | RDS endpoint |
| `DB_NAME` | `library` |
| `DB_SSL` | `true` |
| `SQS_QUEUE_URL` | the queue URL |
| `S3_BUCKET` | covers bucket |
| `AWS_REGION` | `us-east-1` |
| `APP_URL` | the EB URL for now (`http://cst-library-<group>.us-east-1.elasticbeanstalk.com`). Changed in Part 11. |
| `SEED_ON_START` | `true` (**first deploy only**) |
| `AUTH_RATE_LIMIT` | `1000` (the campus shares one IP, and the race test registers many users) |
| `IN_PROCESS_REMINDERS` | `false` |

**Step 6: Submit.** Wait about 10–15 minutes.

### 9.2 Check it
1. Environment **Health: Ok**.
2. `<EB URL>/api/health` → `{"status":"ok","db":"up",...}`.
3. The home page shows the demo books.

If it is not green, use **Appendix C**.

📸 **S16**: EB environment overview (Health **Ok**, platform, running version).
📸 **S17**: **Health** tab, 2 instances **in 2 AZs** (turn on the AZ column).
📸 **S18**: **Configuration**: Capacity, Load balancer, Rolling updates, Managed updates sections.
📸 **S19**: **Environment properties**, **names only** (cover the values).
📸 **S20**: **EC2 → Target groups** → *Targets*: 2 healthy targets in 2 AZs.
📸 **S21**: the browser at `/api/health` (address bar visible).

### 9.3 After the first good deploy
1. Delete `SEED_ON_START` from the environment properties → Apply.
2. Log in as `librarian@cst.edu.bt` / `Password@123` → **Account → change the password** (the default is published in the README).
3. Register 2 students with your verified `+studenta` / `+studentb` addresses. As librarian, use **Members** to make `+librarian` a librarian if you created one.

📸 **S22**: the app home page on AWS.
📸 **S23**: Librarian **Dashboard → System card** (email via SQS, covers in S3).

---

## Part 10: Lambda functions and EventBridge Scheduler

### 10.1 Notifier (SQS → SES)
1. **Lambda → Create function** `library-notifier`, **Node.js 22.x**, arm64. **Execution role: Use an existing role → `LabRole`**. **No VPC** (matches the corrected diagram).
2. **Upload .zip** `build/lambda-notifier.zip`, handler `index.handler`.
3. Timeout **30 s**, memory 256 MB.
4. Env vars: `SES_FROM_EMAIL`, `APP_URL` (EB URL for now), `INTERNAL_API_TOKEN`.
5. `LabRole` already allows SQS polling and SES sending, so there is nothing to attach.
6. **Add trigger → SQS** `library-notifications`, batch **10**, **Report batch item failures ✔**.

### 10.2 Test the email flow
Student A → reserve a book → librarian **Email log**: **In SQS → Sent** → the email arrives (check spam).

📸 **S24**: Lambda overview with the **SQS trigger**.
📸 **S25**: CloudWatch log group `/aws/lambda/library-notifier` → a line with `"event":"email_sent"`.
📸 **S26**: the email in the inbox.
📸 **S27**: the app's **Email log** showing **Sent**.

### 10.3 Reminders Lambda
Create `library-daily-reminders`, Node.js 22.x, role **`LabRole`**, `build/lambda-reminders.zip`, timeout **30 s**, env `APP_URL`, `INTERNAL_API_TOKEN`. **Test** with `{}`.

📸 **S28**: a successful test result with the job counts.

### 10.4 EventBridge Scheduler
**EventBridge → Scheduler → Create schedule** `library-daily`: **Recurring, cron** `0 8 * * ? *`, **time zone Asia/Thimphu**, flexible window off → target **Lambda invoke** `library-daily-reminders`, payload `{}` → retries **2** → execution role: **use existing role → `LabRole`**.

> **If Scheduler refuses `LabRole`** (its trust policy may not include the scheduler service): use a classic **EventBridge rule** instead. It needs no role, because EventBridge adds a Lambda resource permission itself.
> **EventBridge → Rules → Create rule** `library-daily` → *Schedule* → cron `0 2 * * ? *` (**UTC**, = 08:00 Bhutan) → target **Lambda function** `library-daily-reminders`. Write down which one you used.
>
> Remember: when the lab session is stopped, the app's EC2 instances are stopped too, so a 08:00 run fails. That's fine: test it with the Lambda **Test** button and the app's **Run daily jobs now** button.

📸 **S29**: the schedule (or rule) details: cron, time zone, target, next run times.

---

## Part 11: CloudFront and WAF

### 11.1 Create the distribution
**CloudFront → Create distribution**
- **Origin:** the EB domain `cst-library-<group>.us-east-1.elasticbeanstalk.com`, **HTTP only**, port 80
- **Default behaviour:** *Redirect HTTP to HTTPS*. Allowed methods **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**. Cache policy **CachingDisabled**. Origin request policy **AllViewer**.
- **Security (WAF):** **Enable security protections**. If a pricing-plan choice appears, the **Free flat-rate plan** includes WAF. *If the lab blocks WAF, choose "Do not enable" and say so in the report.*
- Create and wait until it is *Deployed* (5–10 min).

### 11.2 Cache static files
**Behaviors → Create** `/assets/*` → same origin, Redirect to HTTPS, cache policy **CachingOptimized**.

### 11.3 (No DNS step in Learner Lab)
There's no domain, so the app's address is the CloudFront domain `https://dxxxx.cloudfront.net`.

### 11.4 WAF rules
**WAF & Shield → Web ACLs** (scope **Global / CloudFront**) → your ACL → check it has the **Core rule set**, **SQL database** rules and a **rate-based rule**.
Add a custom rule `block-internal-without-token`: **if** URI path starts with `/api/internal/` **and** the header `x-internal-token` **does not exist** → **Block**.

📸 **S30**: CloudFront distribution **General** + **Behaviors** tabs.
📸 **S31**: WAF web ACL → **Rules** list.

### 11.5 Lock the ALB to CloudFront
EC2 → Security groups → the **load balancer SG created by EB** → Inbound → change the port **80** rule's source to **prefix list `com.amazonaws.global.cloudfront.origin-facing`**, and delete any `0.0.0.0/0` rule. (The prefix list counts as about 55 of the 60 rules allowed in a security group, so only one port can use it.)

📸 **S32**: the ALB SG inbound rule using the CloudFront prefix list.

### 11.6 Switch every URL to HTTPS
New `APP_URL` = `https://dxxxx.cloudfront.net`. Update it in:
- EB environment property `APP_URL`
- both Lambdas' `APP_URL`

📸 **S33**: the app on `https://dxxxx.cloudfront.net` with the **padlock** (click it to show the certificate).
*(S34 is not used in the Learner Lab edition; it was the Route 53 records.)*

---

## Part 12: CI/CD pipeline (GitHub Actions)

The workflow `.github/workflows/deploy.yml`: **test → build → package → S3 → new EB version → rolling deploy → wait → smoke test → update the Lambdas.**

**Learner Lab difference:** the workflow currently signs in with **OIDC**, which needs an IAM identity provider and role, and the lab blocks both. Instead it uses the lab's **temporary session keys**, stored as GitHub **secrets**. They expire when the session ends, so the pipeline only works during an active lab session, after you refresh the keys (12.3).
In the report, describe OIDC as *the design for a real account* (no stored keys), and session keys as *the lab workaround*.

### 12.1 Workflow changes
In `.github/workflows/deploy.yml`:
1. In the `deploy` job, replace the `configure-aws-credentials` step with:
   ```yaml
   - uses: aws-actions/configure-aws-credentials@v4
     with:
       aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
       aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
       aws-session-token: ${{ secrets.AWS_SESSION_TOKEN }}
       aws-region: ${{ vars.AWS_REGION }}
   ```
2. Replace `--description "${{ github.event.head_commit.message || 'manual deploy' }}" | head -c 0` with `--description "commit ${GITHUB_SHA::7}" > /dev/null`
3. `node-version: 22`
4. Add the `test` job (C4), and make `build` depend on it with `needs: test`

### 12.2 (No OIDC provider or deploy role in Learner Lab)
Skip it. The lab doesn't allow creating IAM identity providers or roles.

### 12.3 Put the session keys in GitHub (repeat every session)
1. Learner Lab → **AWS Details → AWS CLI: Show**. Copy the 3 lines into `~/.aws/credentials` under `[default]`.
2. With the GitHub CLI (`gh auth login` once), run in Git Bash:
   ```bash
   gh secret set AWS_ACCESS_KEY_ID     --body "$(aws configure get aws_access_key_id)"
   gh secret set AWS_SECRET_ACCESS_KEY --body "$(aws configure get aws_secret_access_key)"
   gh secret set AWS_SESSION_TOKEN     --body "$(aws configure get aws_session_token)"
   ```
   Or paste them by hand under **Settings → Secrets and variables → Actions → Secrets**.

📸 **S35**: the repository **Secrets** page showing the 3 secret **names** (GitHub never shows the values).

### 12.4 GitHub settings
**Settings → Secrets and variables → Actions → Variables:**

| Variable | Value |
|---|---|
| `AWS_REGION` | `us-east-1` |
| `EB_APPLICATION` | `cst-library` |
| `EB_ENVIRONMENT` | `cst-library-prod` |
| `EB_BUCKET` | `elasticbeanstalk-us-east-1-<account-id>` |
| `APP_URL` | your HTTPS URL |

**Settings → Environments → `production`** → *Required reviewers* = one member (a manual approval gate, good for the report).

📸 **S36**: the Variables page (account ID hidden) + the `production` environment protection rule.

### 12.5 Run it
**First refresh the session keys (12.3)**, then make a small visible change → commit → `git push origin main` → **Actions** → approve → watch test → build → deploy. EB **Events** shows the batches.
If the run fails with `ExpiredToken` / `The security token included in the request is expired`, refresh the keys and click **Re-run jobs**.

📸 **S37**: the Actions run, every job green (expand *Deploy* and *Smoke test*).
📸 **S38**: EB **Application versions** (`v-<sha>-…`) + **Events** for the rolling deploy.

---

## Part 13: Monitoring (CloudWatch + SNS)

### 13.1 SNS
**SNS → Create topic (Standard)** `library-alerts` → **email subscriptions** for each member → everyone confirms.

📸 **S39**: the topic's subscriptions, all **Confirmed**.

### 13.2 Alarms (action → `library-alerts`)
| Alarm | Metric | Condition |
|---|---|---|
| `library-unhealthy-hosts` | ApplicationELB, per target group, **UnHealthyHostCount** | ≥ 1 for 2 min |
| `library-5xx` | ApplicationELB **HTTPCode_Target_5XX_Count** (Sum) | > 10 in 5 min |
| `library-ec2-cpu` | EC2 by Auto Scaling group **CPUUtilization** | > 80 % for 10 min |
| `library-rds-cpu` | RDS **CPUUtilization** | > 80 % for 10 min |
| `library-rds-storage` | RDS **FreeStorageSpace** | < 2 GB |
| `library-email-dlq` | SQS DLQ **ApproximateNumberOfMessagesVisible** | ≥ 1 |
| `library-lambda-errors` | Lambda `library-notifier` **Errors** | ≥ 1 in 5 min |

📸 **S40**: the alarm list (all *OK*).

### 13.3 Dashboard
**CloudWatch → Dashboards → Create** `cst-library`: ALB requests + response time + 5xx, EC2 CPU, RDS CPU + connections, SQS sent/received + DLQ depth, Lambda invocations/errors (+ your custom metrics if you did C9).

📸 **S41**: the dashboard **after real use** (graphs with data).

### 13.4 Logs Insights
Log group `/aws/elasticbeanstalk/cst-library-prod/var/log/web.stdout.log`:
```
fields @timestamp, @message
| filter @message like /api\/reservations/
| stats count() by bin(5m)
```

📸 **S42**: the query + the result chart.

---

## Part 14: High-availability upgrades (demo week)

These complete the diagram, but together they add about **$4/day** to your lab credit. Do them **2–3 days before the presentation**, take the screenshots and run the failure tests (15.3–15.4), then remove the expensive ones (interface endpoints, second NAT, replica) if the credit is low. Keep Multi-AZ for the demo itself.
If the lab refuses one of them (e.g. Multi-AZ or the read replica because of instance limits), screenshot the error and explain it in "Changes from the proposal".

| # | Upgrade | How | Then |
|---|---|---|---|
| 1 | **RDS Multi-AZ** | RDS → Modify → **Multi-AZ DB instance** → Apply immediately | standby appears in AZ-B |
| 2 | **Read replica** | RDS → Actions → **Create read replica** `library-db-replica`, AZ `us-east-1b`, `sg-db`, subnet group `library-db` | With C1: EB property **`DB_READ_HOST=<replica endpoint>`**. Without C1: `DATABASE_READ_URL=postgres://library_admin:<url-encoded password>@<replica endpoint>:5432/library` |
| 3 | **ElastiCache** | **Valkey** (or Redis OSS) → *Design your own* → node-based, `cache.t4g.micro`, cluster mode off, 0 replicas, subnet group = `private-app-a`, `private-app-b`, preferred AZ `us-east-1a`, SG `sg-cache`, **encryption in transit on** | EB property `REDIS_URL=rediss://<primary endpoint>:6379` |
| 4 | **Interface endpoints** | VPC → Endpoints → Create (4 times): `com.amazonaws.us-east-1.secretsmanager`, `.sqs`, `.logs`, `.monitoring` → VPC `library`, subnets `private-app-a/b`, SG `sg-endpoints`, **private DNS on** | nothing; DNS switches automatically |
| 5 | **Second NAT** | NAT gateways → Create in `public-b` → edit the **private-app-b** route table: `0.0.0.0/0 → new NAT` | each AZ has its own exit |

After the EB properties update (rolling), the librarian **System card** shows cache **redis**.

📸 **S43**: RDS list, **Multi-AZ: Yes** on the primary + the **replica** row.
📸 **S44**: ElastiCache cluster *Available* + the System card showing **redis**.
📸 **S45**: VPC → Endpoints (1 gateway + 4 interface endpoints).
📸 **S46**: NAT gateways (2) + the two private-app route tables pointing to different NATs.

---

## Part 15: Testing and evidence

Set the URL once in Git Bash: `URL=https://dxxxx.cloudfront.net` (your CloudFront domain).

### 15.1 Functional tests (10 of your 20 marks): screenshot every row
Fill in a table like this in the report: **ID · requirement · steps · expected · actual · pass/fail · screenshot**.

| ID | Requirement | Steps | Expected | 📸 |
|---|---|---|---|---|
| F01 | Register + log in | register a student, log out, log in | logged in, name in the header | S47-F01 |
| F02 | Search / filter / sort | search an author, filter a category, sort by title | correct results | S47-F02 |
| F03 | Live availability + shelf + cover | open a book | copy count, shelf location, cover image | S47-F03 |
| F04 | Reserve a copy | Student A → *Clean Code* → **Reserve** | "Held until …" (48 h) + email | S47-F04 |
| F05 | Join the waitlist | Student B → same book → **Join waitlist** | "You're #1" | S47-F05 |
| F06 | My Library | Student A → My Library | the hold with its pickup deadline | S47-F06 |
| F07 | Check out (circulation desk) | Librarian → Circulation → Ready for pickup → **Check out** | loan created, due date shown | S47-F07 |
| F08 | Renew | Student A → renew the loan while someone waits | **refused**, because someone is waiting | S47-F08 |
| F09 | Check in → promote waitlist | Librarian → Active loans → **Check in** | toast "Now held for Student B" | S47-F09 |
| F10 | "Now available" notification | Student B → bell + inbox | in-app + **real email** | S47-F10 |
| F11 | Walk-in checkout | Librarian → walk-in checkout for a member | loan created, count decreases | S47-F11 |
| F12 | Catalogue CRUD + ISBN auto-fill | add a book with an ISBN → auto-filled → edit → delete a test book | works | S47-F12 |
| F13 | Cover upload to S3 | upload a cover → open DevTools → Network → the image URL | URL contains `X-Amz-Signature` (presigned S3) | S47-F13 |
| F14 | Members | change a role, deactivate a test user | the deactivated user can't log in | S47-F14 |
| F15 | Dashboard / reports | Librarian → Dashboard | stats, 14-day chart, demand ranking, subjects, activity feed | S47-F15 |
| F16 | Email log | Librarian → Email log | statuses In SQS → Sent | S47-F16 |
| F17 | Daily reminders | Dashboard → **Run daily jobs now** (or wait for the 08:00 schedule) | reminder / overdue notices queued | S47-F17 |
| F18 | Hold expiry | temporarily set EB property `PICKUP_WINDOW_HOURS=1`, reserve, wait > 1 h, run daily jobs | hold expired, next student promoted. Then remove the property. | S47-F18 |
| F19 | Cancel reservation | student or librarian cancels a hold | copy freed or next in line promoted | S47-F19 |

### 15.2 Consistency: "two students take the last copy"
```bash
API_URL=$URL STUDENTS=30 LIB_PASSWORD='<new librarian password>' npm run test:concurrency
```
Expected: **1 reserved, 29 waitlisted, positions 1…29 in order.**
📸 **S48**: the terminal output.

> The test users have fake emails, so SES rejects them (sandbox). After 3 tries the messages go to the **DLQ** and the **DLQ alarm** fires. That's your evidence for 15.5. Afterwards: SQS → DLQ → **Purge**.

### 15.3 Availability test 1: lose an app server
Terminal (probe):
```bash
while true; do echo "$(date +%T) $(curl -s -o /dev/null -w '%{http_code}' $URL/api/health)"; sleep 1; done
```
EC2 → Instances → one `cst-library-prod` instance → **Terminate**. The probe keeps returning **200**, and Auto Scaling launches a replacement.
📸 **S49**: the probe output + **Auto Scaling group → Activity** (terminate + launch).

### 15.4 Availability test 2: database failover (needs Multi-AZ)
Probe running → RDS → **Reboot → Reboot with failover**. Count the seconds of non-200 responses. That is your measured **RTO**.
📸 **S50**: RDS **Logs & events** (failover started/completed) + the probe output.

### 15.5 Reliability test: email failure → DLQ → alarm
📸 **S51**: the DLQ with messages + the `library-email-dlq` alarm **In alarm**.
📸 **S52**: the SNS alarm email in the inbox.

### 15.6 Zero-downtime deploy
Probe running → push a small commit → approve → watch it. The probe stays **200** throughout.
📸 **S53**: the probe output next to the EB events of the deploy.

### 15.7 Security checks
| Check | How | 📸 |
|---|---|---|
| S3 is private | open a cover URL **without** the `?X-Amz-…` part | **AccessDenied**, S54a |
| ALB not reachable directly | `curl -m 5 http://<EB URL>/api/health` | **timeout**, S54b |
| Internal API protected | `curl -X POST $URL/api/internal/jobs/daily` | **403** (WAF) or 401, S54c |
| No public IPs on servers, DB not public | EC2 instance details (no public IPv4) + S08 | S54d |

### 15.8 Performance and cost
- Quick latency check from Bhutan: `curl -s -o /dev/null -w '%{time_total}\n' $URL/api/books` (10 runs, report the average). Expect roughly 0.4–0.8 s, because us-east-1 is far from Bhutan. Compare it with a cached `/assets/...` file served by CloudFront's nearby edge. This shows why CloudFront matters and why Mumbai would be chosen outside the lab.
- **Cost:** Cost Explorer is blocked in Learner Lab. Use the **credit used** from your record sheet (one value per session) to make a "credit used per day" table. Make an estimate in the **AWS Pricing Calculator** for a **real** account in **ap-south-1** (export the PDF), and compare the two.
📸 **S55**: the Learner Lab credit display at the end of the project. 📸 **S56**: the Pricing Calculator summary.

---

## Part 16: Tear down

**Pause (when you won't work on it for 2+ days, to save credit):**
1. Elastic Beanstalk → **Terminate environment** (removes the ALB and EC2s). Later, **Restore terminated environment** (possible for 6 weeks) or recreate it from the same app version.
2. VPC → **NAT gateway → Delete** (and release its Elastic IP). Later, create a new one in `public-a` and point the private-app route tables' `0.0.0.0/0` at it.
3. Delete the interface endpoints, ElastiCache, the replica and the second NAT if they exist.
4. RDS → **Stop temporarily** (up to 7 days).
Keep the VPC, subnets, security groups, S3, SQS, Lambdas and CloudFront. They cost almost nothing when idle.

**After the presentation**, delete in this order:
1. Elastic Beanstalk environment → **Terminate**, then delete the application.
2. CloudFront → Disable → Delete. Delete the WAF web ACL.
3. ElastiCache cluster.
4. RDS **replica** first, then the primary (final snapshot only if needed).
5. VPC **interface endpoints**, **NAT gateways**, then release the **Elastic IPs**.
6. Lambdas, EventBridge schedule, SQS queues, SNS topic, alarms, dashboard.
7. S3: **Empty** → Delete (covers, logs, `elasticbeanstalk-us-east-1-…`).
8. **Delete the VPC.**
9. SES identities, and the GitHub secrets (the keys are expired anyway).
10. Check that the lab credit stops rising. **Don't use "Reset"** until the marks are final, in case you need to show something again.

📸 **S57** (optional): empty EB / RDS / VPC lists.

---

## Part 17: Diagrams, report and presentation

### 17.1 Redraw the architecture diagram
Import `docs/architecture/library-architecture.json` into the architecture lab site (already fixed: D1–D16, Learner Lab edition, us-east-1, no Route 53/ACM). Run **Simulate** so the numbered flow appears, and export the picture. Or redraw it in **draw.io** with the **AWS Architecture Icons** library.
Then:
- **Figure 1: Architecture** with the legend table from `improvement.md` §3.3 (flows 1–17)
- **Figure 2: Reservation sequence**: Student → API → DB (BEGIN, FOR UPDATE, INSERT reservation + outbox, COMMIT) → SQS → Lambda → SES → callback → status `sent`
- **Figure 3: CI/CD**: push → GitHub Actions (test, build, package) → session keys (lab) / OIDC (real account) → S3 → EB version → approval → rolling deploy → health check → smoke test → Lambdas
- **Figure 4: ER diagram** (users, books, reservations, loans, notifications, activity_log, from `server/src/db/schema.sql`)

Export at 2× to `docs/` as PNG.

### 17.2 Report outline (mapped to the rubric)

| § | Section | Content | Screenshots | Rubric |
|---|---|---|---|---|
| 1 | Title, members, module, date | — | — | — |
| 2 | Executive summary | problem, solution, results (numbers), cost | — | Clarity |
| 3 | Objectives | business + **measurable** AWS targets | — | Clarity |
| 4 | Architecture | Figure 1 + legend; tiers, AZs, why each choice; alternatives considered (EB vs ECS/EKS, PostgreSQL vs DynamoDB); **region: us-east-1 because Learner Lab requires it; ap-south-1 Mumbai measured fastest from Bhutan and would be used in a real account** | S04–S07 | **Architecture 2, Diagrams 2** |
| 5 | AWS services | table: service · role · why · configuration | S08–S15, S24, S29–S31 | **Service integration 4** |
| 6 | Implementation | features; **code excerpts** (row locking, outbox → SQS, Secrets Manager, S3 presign, Lambda partial batch failures); env-var configuration | S22–S28, S47 | **Functional 10, Code quality 2** |
| 7 | Deployment & configuration | EB setup, `.ebextensions`, env properties, CloudFront/WAF, CI/CD (Figure 3) | S16–S21, S32–S38 | **Deployment 2** |
| 8 | Security | IAM: `LabRole`/`LabInstanceProfile` in the lab **plus the least-privilege design (8.1) and OIDC for a real account**; Secrets Manager; private subnets; SG chain; WAF; HTTPS; private S3; IMDSv2 | S07, S10, S15, S31, S32, S54 | Technical docs |
| 9 | Monitoring | alarms, dashboard, logs, SNS | S39–S42 | Service integration |
| 10 | Testing | functional table F01–F19; concurrency; failure tests with **measured** results; target vs result for each objective | S48–S53 | **Functional 10** |
| 11 | Cost | lab credit used per day vs the Pricing Calculator estimate (real account, ap-south-1), cost decisions | S55, S56 | Technical docs |
| 12 | Changes from the proposal | **Learner Lab constraints:** us-east-1 instead of Mumbai, no Route 53/ACM (no domain), `LabRole` instead of custom roles, session keys instead of OIDC, SES sandbox. **Design improvements:** WAF moved to CloudFront, Lambda outside the VPC, Node 22. | — | Clarity |
| 13 | Challenges & lessons learned | real problems and fixes | — | Presentation |
| 14 | Conclusion & future work | Terraform, Cognito, containers/ECS, multi-region DR | — | — |
| 15 | Team contribution | the table from 2.4 | — | — |
| A | Appendix | link to the repo, `implementation.md`, `docs/DEPLOYMENT.md` | — | Technical docs |

**Writing tips:** number and caption every figure and refer to it in the text. Report results as numbers ("0 failed requests while an instance was terminated", "failover 52 s", "30 requests → 1 reserved, 29 waitlisted"). Keep code excerpts to 5–15 lines and explain them.

### 17.3 Final presentation (about 10 min)
1. Problem (1 min) → 2. Architecture (2 min, Figure 1 full-screen) → 3. **Live demo** (4 min: F04, F05, F07, F09, F10 + Email log; keep the S47 screenshots as a backup) → 4. Pipeline + monitoring (1 min) → 5. Tests: target vs result + cost (1 min) → 6. Lessons learned, questions (1 min).

**Before the demo (Learner Lab):** **Start Lab at least 45 minutes early** (EC2 boots and EB turns green). Check the session timer covers the presentation. Then: EB Ok, emails verified, DLQ purged, alarms OK, **no pushes to `main`** (deployment freeze), the second browser already logged in as Student B. Have the S47 screenshots ready in case the lab is slow.

---

## Appendix A: Screenshot checklist

| ID | Screenshot | Part |
|---|---|---|
| S01 | Learner Lab credit + session timer | 2.1 |
| S02 | *(not used: Route 53)* | — |
| S03 | *(not used: ACM)* | — |
| S04 | VPC resource map | 4.1 |
| S05 | Subnets with CIDRs | 4.1 |
| S06 | Private route table | 4.1 |
| S07 | Security groups + `sg-db` inbound | 4.2 |
| S08 | RDS connectivity | 5 |
| S09 | RDS configuration | 5 |
| S10 | Secret overview + rotation | 5.4 |
| S11 | Covers bucket, public access blocked | 6.1 |
| S12 | Logs lifecycle rule | 6.2 |
| S13 | SES identities | 7.1 |
| S14 | SQS queues + DLQ | 7.2 |
| S15 | `LabRole` permissions + trust | 8 |
| S16 | EB health Ok | 9.2 |
| S17 | EB instances in 2 AZs | 9.2 |
| S18 | EB configuration | 9.2 |
| S19 | EB env property names | 9.2 |
| S20 | Target group healthy | 9.2 |
| S21 | `/api/health` | 9.2 |
| S22 | App home page | 9.3 |
| S23 | System card | 9.3 |
| S24 | Notifier with SQS trigger | 10.2 |
| S25 | Notifier `email_sent` log | 10.2 |
| S26 | Email in inbox | 10.2 |
| S27 | Email log "Sent" | 10.2 |
| S28 | Reminders Lambda test | 10.3 |
| S29 | EventBridge schedule | 10.4 |
| S30 | CloudFront general + behaviors | 11 |
| S31 | WAF rules | 11.4 |
| S32 | ALB SG with prefix list | 11.5 |
| S33 | App on HTTPS (padlock) | 11.6 |
| S34 | *(not used: Route 53 records)* | — |
| S35 | GitHub secret names | 12.3 |
| S36 | GitHub variables + environment rule | 12.4 |
| S37 | Actions run green | 12.5 |
| S38 | EB versions + rolling events | 12.5 |
| S39 | SNS subscriptions | 13.1 |
| S40 | Alarms | 13.2 |
| S41 | Dashboard | 13.3 |
| S42 | Logs Insights | 13.4 |
| S43 | RDS Multi-AZ + replica | 14 |
| S44 | ElastiCache + "redis" | 14 |
| S45 | VPC endpoints | 14 |
| S46 | 2 NATs + route tables | 14 |
| S47-F01…F19 | Functional tests | 15.1 |
| S48 | Concurrency test | 15.2 |
| S49 | Instance loss test | 15.3 |
| S50 | DB failover test | 15.4 |
| S51 | DLQ + alarm | 15.5 |
| S52 | Alarm email | 15.5 |
| S53 | Zero-downtime deploy | 15.6 |
| S54a–d | Security checks | 15.7 |
| S55 | Lab credit used | 15.8 |
| S56 | Pricing Calculator | 15.8 |
| S57 | Teardown proof (optional) | 16 |

---

## Appendix B: Record sheet (keep private, 🔒 = never commit)

| Item | Value |
|---|---|
| Account ID | |
| Credit used / remaining, per session (date: value) | |
| VPC ID | |
| Subnets (public-a/b, private-app-a/b, private-db-a/b) | |
| `sg-app` / `sg-db` / `sg-cache` / `sg-endpoints` | |
| `DB_HOST` | |
| `DB_SECRET_ARN` | |
| Replica endpoint | |
| `S3_BUCKET` / logs bucket | |
| `SES_FROM_EMAIL` | |
| `SQS_QUEUE_URL`, queue ARN, DLQ ARN | |
| EB URL | |
| CloudFront domain / `APP_URL` | |
| `REDIS_URL` | |
| SNS topic ARN | |
| Scheduler or EventBridge rule used (10.4) | |
| 🔒 `JWT_SECRET` | password manager only |
| 🔒 `INTERNAL_API_TOKEN` | password manager only |
| 🔒 Librarian password | password manager only |

---

## Appendix C: Troubleshooting

| Symptom | Cause → fix |
|---|---|
| EB deploy fails with `npm ERR` | Old bundle → `npm run package` again. Check there is no `file:..` in `server/package.json`. |
| Health red, `db: down` / timeouts | `sg-db` doesn't allow `sg-app`, `sg-app` is not attached to the instances, or `DB_HOST` is wrong |
| Health suddenly red after ~7 days, `password authentication failed` | Secret rotated, and C1 isn't done → restart the app servers (EB → Actions → Restart app servers) and set rotation to 365 days (5.4) |
| `AccessDeniedException … secretsmanager` | Check `DB_SECRET_ARN` is copied exactly (it ends with a random suffix), and the instance profile is `LabInstanceProfile` |
| `… is not authorized to perform: iam:CreateRole` (any wizard) | Learner Lab blocks role creation → choose **existing role `LabRole`** / **`LabInstanceProfile`** |
| EB environment won't create / instances stop after a few hours | The lab session ended (EC2 is stopped) → Start Lab, then EB → **Restart app servers** |
| `database "library" does not exist` | Initial DB name missed in 5.2 → `DB_NAME=postgres` or create the DB |
| Instances can't install packages | The private route table has no `0.0.0.0/0 → NAT` |
| Targets unhealthy, health check timeout | `.ebextensions` sends health checks to **port 8080**. Make sure the instance SG allows 8080 from the ALB SG. Check EB → Logs. |
| CloudFront 502 / 504 | Origin protocol must be **HTTP only**, port 80. The ALB SG must allow the CloudFront prefix list. The EB environment must be running (session started). |
| Security group "rules limit exceeded" with the prefix list | The prefix list counts as about 55 rules. Only one port can use it (see 9.1 listeners). |
| Emails stay "In SQS" | Lambda trigger off, or a Lambda error → check `/aws/lambda/library-notifier` |
| `Email address is not verified` | SES sandbox (permanent in Learner Lab) → verify that recipient |
| Email arrives but the log never shows "Sent" | Lambda `APP_URL` / `INTERNAL_API_TOKEN` don't match the app, or the WAF rule blocks it (the header name must be `x-internal-token`) |
| Login 429 "Too many attempts" | `AUTH_RATE_LIMIT` missing, or `trust proxy` is not 2 (C6) |
| GitHub: `ExpiredToken` / `security token … expired` / `InvalidClientTokenId` | Session keys are old → refresh the 3 secrets (12.3), then **Re-run jobs** |
| GitHub: `InvalidParameterValue` creating the version | The description fix (12.1) is missing |
| Broken covers | `S3_BUCKET` is wrong, or the presigned URL expired (it lasts 1 hour; reload the page) |

Logs: EB → **Logs → Last 100 lines**, or CloudWatch `/aws/elasticbeanstalk/cst-library-prod/var/log/web.stdout.log`.

---

## Appendix D: Learner Lab quick reference

| Topic | In this project |
|---|---|
| Region | **us-east-1** everywhere. ALB log bucket principal `127311923021`. |
| IAM | **`LabRole`** (EB service role, Lambdas, Scheduler), **`LabInstanceProfile`** (EB instances). Never "create new role". |
| Domain / HTTPS | No Route 53 or ACM. HTTPS from CloudFront's default certificate. |
| CI/CD login | GitHub secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, refreshed every session (12.3) |
| SES | Sandbox only: verify every recipient |
| Sessions | About 4 h. EC2 stops at the end; other resources keep using credit. Start the lab 45 min before the demo. |
| Credit | Watch it every session. Pause (Part 16) when idle. Running out = account disabled. |
| Billing tools | No Budgets or Cost Explorer. Use the lab credit display and the Pricing Calculator. |
| Danger | **Reset** deletes everything. Don't press it. |
