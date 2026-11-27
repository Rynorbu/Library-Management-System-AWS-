# Deploying to AWS

This follows the architecture in the proposal: one VPC across 2 AZs, a public ALB, Elastic Beanstalk instances in private subnets, RDS Multi-AZ in DB subnets, and an event-driven email pipeline. Region used below: **ap-south-1 (Mumbai)**. Change it if you need to.

> **Cost control (student budget):** create an AWS Budget alert first. Use a single NAT Gateway at first and add the second as the "scale-up" step. Stop or terminate the EB environment and RDS after each lab and demo.

```
Route 53 → ACM (HTTPS) → [CloudFront + WAF optional] → ALB (public subnets, :443)
   → Elastic Beanstalk EC2 ×2-4 (private app subnets) → RDS PostgreSQL Multi-AZ (+ read replica)
                                                   ↘ ElastiCache Redis
                                                   ↘ S3 (covers, private, presigned URLs)
                                                   ↘ SQS → Lambda notifier → SES   (DLQ after 3 tries)
EventBridge Scheduler (daily) → Lambda reminders → ALB → /api/internal/jobs/daily
CloudWatch Logs + Alarms → SNS email to the team
```

---

## 1. Network (VPC)

VPC console → **Create VPC → "VPC and more"**:
- Name `cst-library`, CIDR `10.0.0.0/16`, **2 AZs**
- 2 public subnets, **4 private subnets** (2 for the app, 2 for the database)
- NAT gateways: **In 1 AZ** (scale-up: 1 per AZ)
- VPC endpoints: **S3 Gateway** (free)

Optional (proposal): Interface endpoints for **SQS** and **Secrets Manager** in the app subnets, so traffic to those services stays inside AWS.

### Security groups
| SG | Inbound |
|---|---|
| `sg-alb` | 443 (and 80 for the redirect) from 0.0.0.0/0 |
| `sg-app` | 8080 from `sg-alb` only (EB creates this; adjust) |
| `sg-db` | 5432 from `sg-app` only |
| `sg-cache` | 6379 from `sg-app` only |

## 2. Database: RDS PostgreSQL

1. RDS → Subnet groups → create `cst-library-db` with the 2 private DB subnets.
2. Create database → PostgreSQL 16 → **Multi-AZ DB instance** (for the demo `db.t4g.micro`; single-AZ during development to save cost).
   - DB name `library`, master user `library_admin`
   - **Manage master credentials in AWS Secrets Manager** ✔ (this creates the secret)
   - VPC `cst-library`, subnet group above, SG `sg-db`, *Public access: No*
3. Copy the **secret ARN** (Secrets Manager → `rds!db-…`). It holds only `username` and `password`, so also set `DB_HOST=<RDS endpoint>` and `DB_NAME=library` as EB environment properties. These are not secret.
4. Optional: create a **read replica**. Then set `DB_READ_HOST=<replica endpoint>`. The replica pool uses the same Secrets Manager secret, so it keeps working after a password rotation. (`DATABASE_READ_URL=postgres://user:pass@replica-endpoint:5432/library` still works, but it puts the password in an env var and breaks on rotation.)

The app creates the schema on boot. The migration uses an advisory lock, so several instances can start together safely. Set `SEED_ON_START=true` for the first deploy only if you want the demo data in AWS.

## 3. Storage: S3 (book covers)

- Create bucket `cst-library-covers-<account-id>`, **Block all public access ✔**, SSE-S3 encryption.
- Lifecycle rule: move `logs/` to Glacier after 30 days (proposal: cheaper storage classes).
- The app uploads covers and serves them through **presigned URLs that expire after 1 hour**.

## 4. Email pipeline: SES + SQS + Lambda

### SES
- SES → Verified identities → verify the sender (`library@yourdomain` or your own Gmail for testing).
- **In the sandbox, every recipient must also be verified.** Verify the demo student addresses, or request production access early (top risk in the proposal).

### SQS
1. Create queue `library-notifications-dlq` (Standard, retention 14 days).
2. Create queue `library-notifications` (Standard), visibility timeout 60 s,
   **Dead-letter queue → `library-notifications-dlq`, Maximum receives = 3**.

### Lambda: notifier
1. Run `npm run package` locally → `build/lambda-notifier.zip`.
2. Lambda → Create function `library-notifier`, Node.js 22.x, upload the zip, handler `index.handler`.
3. Execution role permissions: `AWSLambdaSQSQueueExecutionRole` + `ses:SendEmail` on your identity.
4. Environment: `SES_FROM_EMAIL`, `APP_URL=https://<your-domain-or-EB-URL>`, `INTERNAL_API_TOKEN=<same as EB>`.
5. Add trigger → SQS `library-notifications`, batch size 10, **Report batch item failures ✔**.

### Lambda: daily reminders
1. Create `library-daily-reminders` (Node.js 22.x) from `build/lambda-reminders.zip`, timeout 30 s.
2. Environment: `APP_URL`, `INTERNAL_API_TOKEN`.
3. EventBridge → **Scheduler** → create schedule `library-daily`, cron `0 2 * * ? *` (08:00 Bhutan time), target this Lambda, retry 2 times.

## 5. Cache: ElastiCache (optional, "enhanced" tier)

ElastiCache → Redis OSS → serverless or `cache.t4g.micro`, in the private app subnets, SG `sg-cache`.
Set `REDIS_URL=rediss://<endpoint>:6379` (use `rediss://` when in-transit encryption is enabled).
If Redis is unreachable, the app falls back to its in-memory cache.

## 6. Application: Elastic Beanstalk

### Instance role (`aws-elasticbeanstalk-ec2-role`)
Attach `AWSElasticBeanstalkWebTier` plus an inline policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": "<DB secret ARN>" },
    { "Effect": "Allow", "Action": "sqs:SendMessage", "Resource": "<library-notifications queue ARN>" },
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": "arn:aws:s3:::cst-library-covers-<id>/covers/*" }
  ]
}
```
No access keys go in the code or environment. The AWS SDK picks up the instance role automatically.

### Create the environment
1. `npm run package` → `build/library-app.zip`
2. EB → Create application `cst-library` → Web server environment `cst-library-prod`
   - Platform **Node.js 22 on Amazon Linux 2023**, upload `library-app.zip`
   - *Configure more options*:
     - **Network:** VPC `cst-library`; load balancer in **public** subnets; instances in **private app** subnets; public IP **off**
     - **Capacity:** Load balanced, min 2, max 4 (`.ebextensions` sets this too)
     - **Load balancer:** Application LB, add listener **443 HTTPS** with an ACM certificate; redirect 80 → 443
     - **Environment properties:**

| Name | Value |
|---|---|
| `JWT_SECRET` | long random string (`openssl rand -hex 32`) |
| `INTERNAL_API_TOKEN` | another long random string (same one in both Lambdas) |
| `DB_SECRET_ARN` | the RDS secret ARN |
| `DB_HOST` / `DB_NAME` | RDS endpoint / `library` |
| `SQS_QUEUE_URL` | `https://sqs.ap-south-1.amazonaws.com/<id>/library-notifications` |
| `S3_BUCKET` | `cst-library-covers-<id>` |
| `REDIS_URL` | ElastiCache endpoint (optional) |
| `APP_URL` | `https://library.yourdomain` (used for links in emails) |
| `AWS_REGION` | `ap-south-1` |
| `SEED_ON_START` | `true` for the first deploy only, then remove it |

`.ebextensions/01-environment.config` already sets: health check `/api/health` (it checks the DB), rolling-with-additional-batch deploys, enhanced health, and CloudWatch log streaming.

3. When health is **Green**, open the EB URL. Then run the race test against it:
   `API_URL=https://<eb-url> STUDENTS=20 npm run test:concurrency`

### DNS
Route 53 → hosted zone → `A` alias record → the EB environment / ALB. Request the ACM certificate in the **same region as the ALB**.

## 7. CI/CD: GitHub Actions

> **AWS Academy Learner Lab:** the lab blocks IAM identity providers and roles, so the workflow signs in with the lab's **session keys** stored as GitHub secrets instead (`implementation.md` §12). The OIDC setup below is the **real-account design**.

1. IAM → Identity providers → add `token.actions.githubusercontent.com` (OIDC), audience `sts.amazonaws.com`.
2. Create role `github-actions-library-deploy` that trusts your repo. The deploy job runs in the `production` **environment**, so the token's subject is the environment, not the branch:
   ```json
   "Condition": {
     "StringEquals": {
       "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
       "token.actions.githubusercontent.com:sub": "repo:<owner>/<repo>:environment:production"
     }
   }
   ```
   (`repo:<owner>/<repo>:ref:refs/heads/main` would never match, and the login would fail.) Give the role permissions for the Elastic Beanstalk deploy, the EB S3 bucket, and `lambda:UpdateFunctionCode` on the two functions.
3. In the workflow, swap the session-key login for `role-to-assume` (the snippet is in the header of `.github/workflows/deploy.yml`) and add `id-token: write` to `permissions`.
4. In the repo, set the **Variables** listed at the top of `.github/workflows/deploy.yml`.
5. Push to `main` → build → package → upload → rolling deploy → wait → smoke test `/api/health`.
   If health checks fail, Elastic Beanstalk rolls back automatically and the workflow fails.

## 8. Monitoring: CloudWatch + SNS

Create an SNS topic `library-alerts` with the team's email addresses. Then create CloudWatch alarms that notify it:

| Alarm | Metric | Threshold |
|---|---|---|
| Environment unhealthy | `AWS/ElasticBeanstalk EnvironmentHealth` | ≥ 20 (Degraded) for 5 min |
| 5xx errors | `AWS/ApplicationELB HTTPCode_Target_5XX_Count` | > 10 in 5 min |
| High CPU | `AWS/EC2 CPUUtilization` (ASG) | > 80 % for 10 min |
| DB CPU / storage | `AWS/RDS CPUUtilization`, `FreeStorageSpace` | > 80 % / < 2 GB |
| **Emails failing** | `AWS/SQS ApproximateNumberOfMessagesVisible` on the **DLQ** | ≥ 1 |
| Lambda errors | `AWS/Lambda Errors` (both functions) | ≥ 1 |

Optional: put AWS WAF (managed rule groups *Core* and *SQL injection*, plus a rate-based rule) on the ALB or CloudFront.

## 9. Demo-day checklist

- [ ] SES sender and demo recipient addresses verified (or production access granted)
- [ ] EB health Green, 2 instances in 2 AZs
- [ ] `/api/health` returns `{"status":"ok","db":"up"}`
- [ ] Librarian dashboard → *System* card shows **SQS → Lambda → SES**, **Private S3**, **ElastiCache**
- [ ] Run the demo script from the README; watch *Emails* change from **In SQS** to **Sent**
- [ ] Deployment freeze; after the demo, scale down or terminate and delete the NAT Gateway
