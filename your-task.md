# Your task: build it on AWS, collect evidence, write the report

A step-by-step runbook for the **CST Library Reservation System** final project.
Do the parts **in order**. Each step says what to click, what to write down, and which **📸 screenshot** to take.

- Architecture: as in your proposal (Elastic Beanstalk, RDS PostgreSQL, S3, SQS → Lambda → SES, EventBridge, CloudFront, CloudWatch)
- Region: **ap-south-1 (Mumbai)**. Use the same region everywhere. Check the region name in the top-right of the console **before every step**.
- Repo: `Rynorbu/Library-Management-System-AWS-`
- Other files: `TODO.md` (why we chose this design), `docs/DEPLOYMENT.md` (shorter reference)

> AWS changes console labels from time to time. If a button is named a little differently, look for the closest match.

---

## Contents

- [Part 0: Rules for screenshots (read first)](#part-0-rules-for-screenshots-read-first)
- [Part 1: Prepare on your laptop](#part-1-prepare-on-your-laptop)
- [Part 2: Account safety: budget and region](#part-2-account-safety-budget-and-region)
- [Part 3: Network: VPC and security groups](#part-3-network-vpc-and-security-groups)
- [Part 4: Database: RDS PostgreSQL](#part-4-database-rds-postgresql)
- [Part 5: Storage: S3 buckets](#part-5-storage-s3-buckets)
- [Part 6: Email: SES and SQS](#part-6-email-ses-and-sqs)
- [Part 7: IAM roles](#part-7-iam-roles)
- [Part 8: The application on Elastic Beanstalk](#part-8-the-application-on-elastic-beanstalk)
- [Part 9: Lambda functions and EventBridge](#part-9-lambda-functions-and-eventbridge)
- [Part 10: CloudFront (HTTPS)](#part-10-cloudfront-https)
- [Part 11: CI/CD pipeline with GitHub Actions](#part-11-cicd-pipeline-with-github-actions)
- [Part 12: Monitoring: CloudWatch and SNS](#part-12-monitoring-cloudwatch-and-sns)
- [Part 13: Demo-week upgrades (high availability)](#part-13-demo-week-upgrades-high-availability)
- [Part 14: Testing and evidence](#part-14-testing-and-evidence)
- [Part 15: Tear down (stop paying)](#part-15-tear-down-stop-paying)
- [Part 16: Write the report](#part-16-write-the-report)
- [Appendix A: Screenshot checklist](#appendix-a-screenshot-checklist)
- [Appendix B: Record sheet](#appendix-b-record-sheet)
- [Appendix C: Troubleshooting](#appendix-c-troubleshooting)
- [Appendix D: If you use AWS Academy Learner Lab](#appendix-d-if-you-use-aws-academy-learner-lab)

---

## Part 0: Rules for screenshots (read first)

1. **Folder:** save every screenshot to `docs/screenshots/` with the number from this guide, e.g. `S15-eb-health-ok.png`. Appendix A lists them all.
2. **Tool:** on Windows press **Win + Shift + S** (Snipping Tool) → *Window* or *Rectangle* → save as PNG.
3. **What must be visible:**
   - the **AWS region** (top-right) and the **service name / page title**
   - the **status** that proves your point (e.g. *Available*, *Ok*, *Healthy*, *Sent*, a green tick)
   - for the app: the **browser address bar** (shows it is the real AWS URL)
   - a **date or time** where possible (events, logs, CloudWatch graphs)
4. **Hide private data before saving.** Use the Snipping Tool pen or Paint to cover:
   - the **12-digit AWS account ID** (top-right menu, ARNs)
   - **secret values**: `JWT_SECRET`, `INTERNAL_API_TOKEN`, passwords, access keys
   - real personal email addresses (optional; your group's own are usually fine)
   - **Never** click "Retrieve secret value" in Secrets Manager while taking a screenshot.
5. Browser zoom **100 %**, the same browser theme every time, and close unrelated tabs. It looks professional in the report.
6. Straight after each screenshot, add one line to `docs/screenshots/CAPTIONS.md`:
   `S15: Elastic Beanstalk environment cst-library-prod, health Ok, 2 instances (2026-12-02)`.
   Your report figure captions then come straight from this file.
7. Take **more** screenshots than you need. You can't go back after teardown.

---

## Part 1: Prepare on your laptop

### 1.1 Install / check tools
- Node.js 22 LTS (`node -v`), Git, Docker Desktop (for local testing)
- Optional: AWS CLI v2 (`aws --version`). Useful for tests in Part 14.

### 1.2 Pull, install and test locally
```bash
git pull
npm run setup
cp server/.env.example server/.env
npm run db:up
npm run dev          # open http://localhost:5173 and click around
```
Run the race test locally once: `npm run test:concurrency` (in a second terminal while `npm run dev` runs).

### 1.3 Build the deployment bundle
```bash
npm run package
```
This creates:
- `build/library-app.zip`: the Elastic Beanstalk app (server + built React app)
- `build/lambda-notifier.zip` and `build/lambda-reminders.zip`: the two Lambda functions

Check that the stray dependency is gone (it was removed on 2026-11-25). The command below must print **nothing**:
```bash
grep "file:\.\." server/package.json
```

### 1.4 Generate two secrets
Run this twice and save the two values in a **password manager or a private note, not in Git**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
- Value 1 → `JWT_SECRET`
- Value 2 → `INTERNAL_API_TOKEN` (the app and both Lambdas must use the same value)

### 1.5 Open the record sheet
Copy **Appendix B** into a private note. You will fill in IDs and URLs as you go.

---

## Part 2: Account safety: budget and region

### 2.1 Budget alert (do this first)
1. Console → **Billing and Cost Management → Budgets → Create budget**
2. *Use a template* → **Monthly cost budget**. Name `cst-library-budget`, amount e.g. **$30** (or your limit), email = all group members.
3. Create.

📸 **S01**: the budget in the Budgets list (name, amount, alert emails).

### 2.2 Region
Top-right → **Asia Pacific (Mumbai) ap-south-1**. Every service below must be created here.

---

## Part 3: Network: VPC and security groups

### 3.1 Create the VPC
1. **VPC → Your VPCs → Create VPC → "VPC and more"**
2. Settings:

| Field | Value |
|---|---|
| Name tag auto-generation | `cst-library` |
| IPv4 CIDR | `10.0.0.0/16` |
| Number of AZs | **2** |
| Public subnets | **2** |
| Private subnets | **4** (two for the app, two for the database) |
| NAT gateways | **In 1 AZ** (the second NAT is the "scale-up" step in your proposal) |
| VPC endpoints | **S3 Gateway** (free) |
| DNS hostnames / resolution | both **enabled** |

3. **Create VPC**, wait until all items are green.
4. Rename the private subnets so they are easy to pick later (Subnets → select → edit Name):
   - the two private subnets in AZ a and b with the **lower** numbers → `cst-library-app-a`, `cst-library-app-b`
   - the other two → `cst-library-db-a`, `cst-library-db-b`

📸 **S02**: VPC → your VPC → **Resource map** tab (shows subnets, route tables, IGW, NAT, S3 endpoint).
📸 **S03**: Subnets list filtered by `cst-library` (names, AZs, CIDRs).
📸 **S04**: a private route table → Routes tab (`0.0.0.0/0 → nat-…`, and the S3 prefix list → `vpce-…`).

### 3.2 Security groups
**VPC → Security groups → Create security group**, VPC = `cst-library`. Create in this order:

| Name | Inbound rules | Purpose |
|---|---|---|
| `sg-app` | *(none; Elastic Beanstalk adds the load balancer rule itself)* | Attached to the app servers. Used as the "source" below |
| `sg-db` | PostgreSQL **5432**, source **`sg-app`** | Only the app can reach the database |
| `sg-cache` | Custom TCP **6379**, source **`sg-app`** | Only the app can reach Redis (Part 13) |
| `sg-endpoints` | HTTPS **443**, source **`sg-app`** | Interface VPC endpoints (Part 13) |

Leave outbound as "All traffic".

📸 **S05**: `sg-db` → Inbound rules tab (5432 from `sg-app`). This proves the tiered security design.

---

## Part 4: Database: RDS PostgreSQL

### 4.1 DB subnet group
**RDS → Subnet groups → Create**: name `cst-library-db`, VPC `cst-library`, AZs a + b, subnets **`cst-library-db-a`, `cst-library-db-b`**.

### 4.2 Create the database
**RDS → Databases → Create database → Standard create**

| Section | Value |
|---|---|
| Engine | **PostgreSQL**, version **16.x** (matches `docker-compose.yml`) |
| Templates | **Dev/Test** (or Free tier if offered) |
| Deployment | **Single-AZ DB instance** for now. You switch to **Multi-AZ** in Part 13. |
| DB instance identifier | `cst-library-db` |
| Master username | `library_admin` |
| Credentials management | **Managed in AWS Secrets Manager** ✔ |
| Instance class | **db.t4g.micro** |
| Storage | gp3, **20 GiB**, untick storage autoscaling |
| Compute resource | Don't connect to an EC2 compute resource |
| VPC / subnet group | `cst-library` / `cst-library-db` |
| Public access | **No** |
| Security group | remove `default`, choose **`sg-db`** |
| **Additional configuration → Initial database name** | **`library`** ← important, otherwise the database is not created |
| Backups | 7 days, encryption **enabled** |
| Deletion protection | off (student project). Say in the report you would turn it on in production. |

Create. It takes about 10 minutes.

### 4.3 Write down
- **Endpoint** (Connectivity & security tab) → record sheet `DB_HOST`
- **Master credentials ARN** (Configuration tab → Secrets Manager link) → record sheet `DB_SECRET_ARN`

📸 **S06**: RDS database → **Connectivity & security** (endpoint, *Publicly accessible: No*, `sg-db`, subnets). Hide the account ID.
📸 **S07**: RDS **Configuration** tab (engine, class, *Encryption: Enabled*, *Master credentials: Secrets Manager*).
📸 **S08**: **Secrets Manager → Secrets** → the `rds!db-…` secret overview (name, encryption key, rotation). **Do not reveal the value.**

---

## Part 5: Storage: S3 buckets

### 5.1 Book covers bucket
**S3 → Create bucket**
- Name `cst-library-covers-<your-account-id>` (must be globally unique)
- **Block all public access ✔** (default), Bucket Key on, SSE-S3 encryption (default)

Record → `S3_BUCKET`.

📸 **S09**: covers bucket → **Permissions** tab showing *Block all public access: On*.

### 5.2 Load-balancer logs bucket (makes the proposal's "cheaper storage classes" claim true)
1. Create bucket `cst-library-logs-<account-id>` (same settings).
2. **Permissions → Bucket policy**. Paste this, after replacing `BUCKET` and `ACCOUNT_ID`. `718504428378` is AWS's load balancer account for **ap-south-1**:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::718504428378:root" },
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::BUCKET/alb/AWSLogs/ACCOUNT_ID/*"
  }]
}
```
3. **Management → Create lifecycle rule** `logs-to-glacier`: apply to all objects. Transition current versions to **Glacier Flexible Retrieval after 30 days**. **Expire after 365 days**.

📸 **S10**: the lifecycle rule summary (transitions and expiration).

---

## Part 6: Email: SES and SQS

### 6.1 SES identities (start early; this is the top risk in your proposal)
1. **Amazon SES → Identities → Create identity → Email address**: your sender, e.g. a group Gmail. Click the link in the verification email.
2. While SES is in **sandbox**, every **recipient** must be verified too. Trick: Gmail ignores `+tags`, so verify
   `yourname+studenta@gmail.com`, `yourname+studentb@gmail.com`, `yourname+librarian@gmail.com`.
   They all land in one inbox, but each must be verified separately.
3. Optional: **Account dashboard → Request production access** (explain: college library notifications, low volume, opt-in users). Approval can take a day or more.

Record → `SES_FROM_EMAIL`.

📸 **S11**: SES → Identities list with status **Verified**.

### 6.2 SQS queues
1. **SQS → Create queue → Standard**, name `library-notifications-dlq`, message retention **14 days** → Create.
2. **Create queue → Standard**, name `library-notifications`:
   - Visibility timeout **180 seconds** (6 × the Lambda timeout of 30 s, as AWS recommends)
   - **Dead-letter queue: Enabled** → `library-notifications-dlq`, **Maximum receives 3**
3. Record the queue **URL** → `SQS_QUEUE_URL`, and the **ARN** of both queues.

📸 **S12**: the SQS queue list showing both queues, **and** `library-notifications` → **Dead-letter queue** tab (max receives 3).

---

## Part 7: IAM roles

### 7.1 EC2 instance role for Elastic Beanstalk
1. **IAM → Roles → Create role** → trusted entity **AWS service → EC2** → Next.
2. Attach **`AWSElasticBeanstalkWebTier`** → name **`cst-library-ec2-role`** → Create.
3. Open the role → **Add permissions → Create inline policy → JSON** (replace the ARNs):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ReadDbSecret", "Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": "<DB_SECRET_ARN>" },
    { "Sid": "PublishEmails", "Effect": "Allow", "Action": "sqs:SendMessage", "Resource": "<library-notifications queue ARN>" },
    { "Sid": "BookCovers", "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": "arn:aws:s3:::<S3_BUCKET>/covers/*" }
  ]
}
```
Name it `cst-library-app-access`. This is **least privilege**: only one secret, one queue and one folder.

📸 **S13**: the role → Permissions tab (managed policy + inline policy), and the inline JSON expanded.

### 7.2 Lambda roles
You can let the Lambda console create these in Part 9. Then add:
- notifier: **`AWSLambdaSQSQueueExecutionRole`** + inline `ses:SendEmail` and `ses:SendRawEmail` on `arn:aws:ses:ap-south-1:<account-id>:identity/*`
- reminders: the basic execution role only (it just calls your app over HTTPS)

---

## Part 8: The application on Elastic Beanstalk

### 8.1 Create the environment
**Elastic Beanstalk → Create application** (the console walks you through the steps below).

**Step 1: Configure environment**

| Field | Value |
|---|---|
| Environment tier | **Web server** |
| Application name | `cst-library` |
| Environment name | `cst-library-prod` |
| Domain | e.g. `cst-library-<group>` → URL `cst-library-<group>.ap-south-1.elasticbeanstalk.com` |
| Platform | **Node.js**, branch **Node.js 22 on 64bit Amazon Linux 2023** (Node 20 is end-of-life) |
| Application code | **Upload your code** → `build/library-app.zip`, version label `v1-initial` |
| Presets | **Custom configuration** |

**Step 2: Service access**
- Service role: **Create and use new service role** (`aws-elasticbeanstalk-service-role`)
- EC2 instance profile: **`cst-library-ec2-role`**
- EC2 key pair: none (no SSH, which is more secure; mention it in the report)

**Step 3: Networking and database**
- VPC `cst-library`
- **Instance subnets:** `cst-library-app-a`, `cst-library-app-b`, with **Public IP address unticked**
- Database: **leave "Enable database" OFF.** We use our own RDS, so deleting the environment cannot delete the data.

**Step 4: Instance traffic and scaling**
- Root volume gp3. **IMDSv1: deactivated**.
- EC2 security groups: tick **`sg-app`**
- Capacity: **Load balanced**, instances **min 2, max 4**, instance type **t3.micro** (or t4g.micro), AZs **Any 2**
- Scaling trigger: CPUUtilization, upper 70 %, lower 25 % (`.ebextensions` sets this too)
- Load balancer: **Application**, **Dedicated**, visibility **Public**, subnets = the **2 public** subnets
- Listener: port 80 HTTP (HTTPS comes from CloudFront in Part 10)
- Processes → default: health check path **`/api/health`**
- **Access log files: enabled** → bucket `cst-library-logs-<id>`, prefix `alb`

**Step 5: Updates, monitoring and logging**
- Health reporting: **Enhanced**
- **Managed platform updates: Activated**, weekly window, update level **Minor and patch**. (This makes the proposal's "no servers to patch" claim true.)
- Deployment policy: **Rolling with additional batch**, batch size fixed 1
- **Instance log streaming to CloudWatch Logs: Activated**, retention 14 days
- **Environment properties**: add all of these:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | value 1 from step 1.4 |
| `INTERNAL_API_TOKEN` | value 2 from step 1.4 |
| `DB_SECRET_ARN` | the RDS secret ARN |
| `DB_HOST` | the RDS endpoint |
| `DB_NAME` | `library` |
| `DB_SSL` | `true` |
| `SQS_QUEUE_URL` | the queue URL |
| `S3_BUCKET` | the covers bucket name |
| `AWS_REGION` | `ap-south-1` |
| `APP_URL` | `http://<your EB domain>` for now. It changes to the CloudFront URL in Part 10. |
| `SEED_ON_START` | `true` (**first deploy only**, to load demo books) |
| `AUTH_RATE_LIMIT` | `1000` (the campus shares one IP, and the race test registers many users) |
| `IN_PROCESS_REMINDERS` | `false` (EventBridge does it) |

**Step 6: Review → Submit.** Wait about 10–15 minutes.

### 8.2 Check that it is healthy
1. The environment page should show **Health: Ok** (green).
2. Open `http://<EB domain>/api/health`. Expect `{"status":"ok","db":"up",...}`.
3. Open `http://<EB domain>/`. The library home page loads with demo books.

If it is red, read **Appendix C** before changing anything.

📸 **S15**: the EB environment overview (Health **Ok**, platform, running version, URL).
📸 **S16**: the **Health** tab: 2 instances, both Ok, **in two different AZs** (enable the AZ column if it's hidden).
📸 **S17**: **Configuration** page sections *Capacity*, *Load balancer*, *Rolling updates and deployments*, *Managed updates*.
📸 **S18**: **Environment properties**: show the **names only**, and cover every secret value.
📸 **S19**: **EC2 → Target groups** → the EB target group → *Targets*: 2 healthy targets in 2 AZs.
📸 **S20**: the browser showing `/api/health` JSON with the EB URL in the address bar.

### 8.3 After the first good deploy
- EB → Configuration → Environment properties → **delete `SEED_ON_START`** → Apply (rolling update).
- Log in as `librarian@cst.edu.bt` / `Password@123`. Go to **Account** and **change the password** (the default is public in the README).

### 8.4 Create real demo users (for emails in the SES sandbox)
1. Log out. **Register** 2 students using your verified `+studenta` / `+studentb` Gmail addresses.
2. Log in as librarian → **Members** → change your `+librarian` account to **Librarian** if you made one.

📸 **S21**: the app home page on the AWS URL.
📸 **S22**: Librarian **Dashboard → System card** showing email mode **SQS**, covers **S3**.

---

## Part 9: Lambda functions and EventBridge

### 9.1 Notifier Lambda (SQS → SES)
1. **Lambda → Create function → Author from scratch**: name **`library-notifier`**, runtime **Node.js 22.x**, architecture arm64. Execution role: *create a new role with basic permissions*.
2. **Code → Upload from → .zip** → `build/lambda-notifier.zip`. Handler stays **`index.handler`**.
3. **Configuration → General**: timeout **30 s**, memory 256 MB.
4. **Configuration → Environment variables**:
   - `SES_FROM_EMAIL` = your verified sender
   - `APP_URL` = `http://<EB domain>` (changes to CloudFront in Part 10)
   - `INTERNAL_API_TOKEN` = value 2
5. **Configuration → Permissions** → open the role → attach `AWSLambdaSQSQueueExecutionRole` and add the SES inline policy from 7.2.
6. **Add trigger → SQS** → `library-notifications`, batch size **10**, **Report batch item failures ✔** → Add.

### 9.2 Test the email path end to end
1. In the app, log in as student A → open a book → **Reserve a copy**.
2. Librarian → **Email log**: the status goes **In SQS → Sent** within a few seconds.
3. Check the inbox (and the spam folder) of `+studenta`.

📸 **S14**: Lambda `library-notifier` overview (diagram with the **SQS trigger**).
📸 **S23**: **CloudWatch → Log groups → /aws/lambda/library-notifier** → a log line with `"event":"email_sent"`.
📸 **S24**: the received email in the inbox (sender, subject, time).
📸 **S25**: the app's **Email log** page showing **Sent**.

### 9.3 Daily reminders Lambda
1. Create function **`library-daily-reminders`**, Node.js 22.x, upload `build/lambda-reminders.zip`, timeout **30 s**.
2. Env vars: `APP_URL`, `INTERNAL_API_TOKEN`.
3. **Test** tab → event `{}` → Test. The result shows counts such as `{"expired":0,"pickupReminders":…}`.

📸 **S27**: the successful test result.

### 9.4 EventBridge Scheduler
1. **Amazon EventBridge → Scheduler → Schedules → Create schedule**
2. Name `library-daily`, **Recurring → Cron-based**: `0 8 * * ? *`, **time zone Asia/Thimphu** (08:00 Bhutan time). Flexible window **Off**.
3. Target: **AWS Lambda Invoke** → `library-daily-reminders`, payload `{}`.
4. Settings: retry policy on, **max retries 2**. Execution role: *create new role*.

📸 **S26**: the schedule details (cron, time zone, target, next invocation times).

---

## Part 10: CloudFront (HTTPS)

You have no domain of your own, so an ACM certificate on the load balancer is not possible. CloudFront gives free HTTPS on `*.cloudfront.net`, plus edge caching. Explain this in the report as a change from the proposal (Route 53 + ACM need a registered domain).

### 10.1 One small code change first
CloudFront adds one more proxy in front of the load balancer, so the app must trust 2 proxies to see each user's real IP (for the login limit).
In `server/src/app.js`, change
```js
app.set('trust proxy', 1); // behind the Application Load Balancer
```
to
```js
app.set('trust proxy', 2); // CloudFront -> Application Load Balancer
```
Commit it. It deploys through the pipeline in Part 11. You can also run `npm run package` and upload it in EB (*Upload and deploy*).

### 10.2 Create the distribution
**CloudFront → Create distribution**
- **Origin domain:** the EB domain `cst-library-<group>.ap-south-1.elasticbeanstalk.com`. **Protocol: HTTP only**, port 80.
- **Default cache behavior:**
  - Viewer protocol policy **Redirect HTTP to HTTPS**
  - Allowed methods **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**
  - Cache policy **CachingDisabled**, origin request policy **AllViewer** (passes the login token and form data)
- **Web Application Firewall:** "Do not enable" to save money, **or** enable it for the demo week (it adds core rules and SQL-injection protection, a proposal item).
- Price class: **Use North America, Europe, Asia, Middle East, and Africa**.
- Create. Wait about 5 minutes until *Deployed*.

### 10.3 Add a cached behaviour for static files
Distribution → **Behaviors → Create behavior**: path pattern **`/assets/*`**, same origin, **Redirect HTTP to HTTPS**, cache policy **CachingOptimized**.

### 10.4 Point everything at the HTTPS URL
Record `https://dxxxxxxxx.cloudfront.net` → `APP_URL`, then update:
- EB environment property `APP_URL`
- Lambda `library-notifier` and `library-daily-reminders` env var `APP_URL`

### 10.5 (Optional, stronger security) Only allow CloudFront to reach the load balancer
EC2 → Security groups → the **load balancer security group EB created** (its description mentions the environment) → Inbound → edit the port 80 rule: replace source `0.0.0.0/0` with the prefix list **`com.amazonaws.global.cloudfront.origin-facing`**.
After this, the EB URL only works through CloudFront. Re-check this rule after big EB configuration changes.

📸 **S28**: the CloudFront distribution **General** tab and the **Behaviors** tab.
📸 **S29**: the app opened at `https://….cloudfront.net` with the **padlock** in the address bar.
📸 **S30** (optional): the ALB security group inbound rule using the CloudFront prefix list.

---

## Part 11: CI/CD pipeline with GitHub Actions

The workflow `.github/workflows/deploy.yml` runs on every push to `main`: build → package → upload to S3 → new EB version → rolling deploy → wait → smoke test → update both Lambdas. It logs in to AWS with **OIDC**, so **no AWS keys are stored in GitHub**.

### 11.1 Fix the workflow first (two small edits)
1. In `deploy.yml`, the line
   ```
   --description "${{ github.event.head_commit.message || 'manual deploy' }}" | head -c 0
   ```
   breaks when a commit message contains quotes or is over 200 characters. It also lets a commit message inject shell code. Replace it with:
   ```
   --description "commit ${GITHUB_SHA::7}" > /dev/null
   ```
2. Change `node-version: 20` to `node-version: 22`.

### 11.2 OIDC identity provider
**IAM → Identity providers → Add provider → OpenID Connect**
- Provider URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com` → Add.

### 11.3 Deploy role
**IAM → Roles → Create role → Web identity** → provider above, audience `sts.amazonaws.com`, GitHub organization `Rynorbu`, repository `Library-Management-System-AWS-` → Next.
Attach **`AdministratorAccess-AWSElasticBeanstalk`**. Name **`github-actions-library-deploy`**.

Then **edit the trust policy**. The deploy job uses `environment: production`, so GitHub sends `environment:production` (not `ref:refs/heads/main`, which `docs/DEPLOYMENT.md` says). Make the condition:
```json
"Condition": {
  "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
  "StringLike": {
    "token.actions.githubusercontent.com:sub": [
      "repo:Rynorbu/Library-Management-System-AWS-:environment:production",
      "repo:Rynorbu/Library-Management-System-AWS-:ref:refs/heads/main"
    ]
  }
}
```
Add an inline policy so the pipeline can update the Lambdas:
```json
{ "Version": "2012-10-17", "Statement": [{ "Effect": "Allow", "Action": "lambda:UpdateFunctionCode",
  "Resource": ["arn:aws:lambda:ap-south-1:<id>:function:library-notifier", "arn:aws:lambda:ap-south-1:<id>:function:library-daily-reminders"] }] }
```

📸 **S31**: the role's **Trust relationships** tab (hide the account ID).

### 11.4 GitHub settings
Repo → **Settings → Secrets and variables → Actions → Variables → New repository variable**:

| Variable | Value |
|---|---|
| `AWS_REGION` | `ap-south-1` |
| `AWS_DEPLOY_ROLE_ARN` | the role ARN |
| `EB_APPLICATION` | `cst-library` |
| `EB_ENVIRONMENT` | `cst-library-prod` |
| `EB_BUCKET` | `elasticbeanstalk-ap-south-1-<account-id>` (see the S3 bucket list) |
| `APP_URL` | `https://dxxxx.cloudfront.net` |

Optional but good for the report: **Settings → Environments → New environment `production`** → *Required reviewers* = one team member. Every deploy then needs an approval.

📸 **S32**: the Variables page (values of non-secret variables only; cover the account ID inside the ARN).

### 11.5 Run the pipeline
1. Make a visible small change (e.g. text on the Home page), commit, `git push origin main`.
2. GitHub → **Actions** → watch `build` → `deploy`.
3. EB → **Events** shows the rolling deploy, one batch at a time.

📸 **S33**: GitHub Actions run, all steps green (expand *Deploy* and *Smoke test*).
📸 **S34**: EB **Application versions** list (versions named `v-<sha>-…`) + **Events** for the rolling deploy.

---

## Part 12: Monitoring: CloudWatch and SNS

### 12.1 SNS topic
**SNS → Topics → Create topic → Standard** `library-alerts` → **Create subscription** → Email → each member. Each person clicks *Confirm subscription*.

📸 **S35**: the topic's subscriptions, all **Confirmed**.

### 12.2 Alarms
**CloudWatch → Alarms → Create alarm** for each row. Action: **In alarm → SNS `library-alerts`**.

| Alarm name | Metric | Condition |
|---|---|---|
| `library-unhealthy-hosts` | ApplicationELB → per target group → **UnHealthyHostCount** | ≥ 1 for 2 × 1 min |
| `library-5xx` | ApplicationELB → per LB → **HTTPCode_Target_5XX_Count** (Sum) | > 10 in 5 min |
| `library-ec2-cpu` | EC2 → by Auto Scaling group → **CPUUtilization** | > 80 % for 10 min |
| `library-rds-cpu` | RDS → `cst-library-db` → **CPUUtilization** | > 80 % for 10 min |
| `library-rds-storage` | RDS → **FreeStorageSpace** | < 2 GB |
| `library-email-dlq` | SQS → `library-notifications-dlq` → **ApproximateNumberOfMessagesVisible** | ≥ 1 |
| `library-lambda-errors` | Lambda → `library-notifier` → **Errors** (Sum) | ≥ 1 in 5 min |

📸 **S36**: the alarm list (all *OK*).

### 12.3 Dashboard
**CloudWatch → Dashboards → Create** `cst-library` with widgets: ALB RequestCount + TargetResponseTime, EC2 CPU, RDS CPU + DatabaseConnections, SQS messages sent/received + DLQ depth, Lambda invocations/errors.

📸 **S37**: the dashboard **after** you have used the app for a while (graphs with data).

### 12.4 Logs Insights
**CloudWatch → Logs Insights** → choose log group `/aws/elasticbeanstalk/cst-library-prod/var/log/web.stdout.log` → run:
```
fields @timestamp, @message
| filter @message like /api\/reservations/
| stats count() by bin(5m)
```

📸 **S39**: the query and its result chart.

---

## Part 13: Demo-week upgrades (high availability)

Do this **only in the week of the demo**. It costs more per day. Each item is in your proposal.

| # | Upgrade | How | Then set |
|---|---|---|---|
| 1 | **RDS Multi-AZ** | RDS → Modify → Multi-AZ DB instance → **Apply immediately** (about 15 min) | — |
| 2 | **Read replica** | RDS → Actions → **Create read replica** `cst-library-db-replica`, same class, `sg-db` | EB property `DATABASE_READ_URL=postgres://library_admin:<password>@<replica-endpoint>:5432/library`. Get the password from the secret without screen-sharing, and URL-encode special characters. |
| 3 | **ElastiCache** | ElastiCache → **Valkey** (or Redis OSS) → *Design your own* → node-based cluster, `cache.t4g.micro`, cluster mode off, 0 replicas, subnet group = app subnets, SG `sg-cache`, **encryption in transit on** | EB property `REDIS_URL=rediss://<primary endpoint>:6379` |
| 4 | **Interface endpoints** | VPC → Endpoints → Create → AWS service `com.amazonaws.ap-south-1.sqs` and `…secretsmanager` → VPC `cst-library`, app subnets, SG `sg-endpoints`, **private DNS on** | nothing (DNS switches automatically) |
| 5 | **Second NAT gateway** | VPC → NAT gateways → create in the second public subnet → edit that AZ's private route table to use it | — |
| 6 | **WAF** (if not done in Part 10) | CloudFront → Security → enable protections | — |

After setting EB properties, wait for the rolling update, then check the Librarian **System card** (cache: **redis**).

📸 **S40**: RDS list showing the primary as **Multi-AZ: Yes** plus the **replica** row.
📸 **S41**: ElastiCache cluster *Available*, and the System card showing cache **redis**.
📸 **S42**: VPC → Endpoints list (S3 gateway + SQS + Secrets Manager interface endpoints).

---

## Part 14: Testing and evidence

Use the CloudFront URL as `URL` below. Run the commands in Git Bash.

### 14.1 Functional demo (README demo script). Screenshot every step.
| # | Action | 📸 |
|---|---|---|
| 1 | Student A opens *Clean Code* → **Reserve a copy** | **S43a** confirmation |
| 2 | Student B opens *Clean Code* → **Join the waitlist** → "You're #1" | **S43b** |
| 3 | Librarian → **Circulation → Ready for pickup → Check out** to Student A | **S43c** |
| 4 | Librarian → **Active loans → Check in** → toast "Now held for …" | **S43d** |
| 5 | Student B → bell icon → "Now available: Clean Code" + the **real email** in the inbox | **S43e** |
| 6 | Librarian → Dashboard → **Run daily jobs now** | **S43f** |
| 7 | Librarian → Manage books → add a book with **ISBN auto-fill** and **cover upload** | **S43g** (the cover image URL in DevTools shows `X-Amz-Signature`, i.e. a presigned S3 URL) |

### 14.2 Concurrency test: "two students take the last copy"
```bash
API_URL=$URL STUDENTS=30 LIB_PASSWORD='<new librarian password>' npm run test:concurrency
```
Expected: **exactly 1** reserved, **29** waitlisted in order 1…29.
📸 **S44**: the terminal output.

> Side effect: the test users have fake emails, so SES (in sandbox) rejects them. After 3 tries the messages land in the **DLQ** and the **`library-email-dlq` alarm** fires. That is the evidence for 14.5. After that, **SQS → DLQ → Purge**.

### 14.3 Failure test 1: lose an app server (high availability)
1. Terminal 1, availability probe:
   ```bash
   while true; do echo "$(date +%T) $(curl -s -o /dev/null -w '%{http_code}' $URL/api/health)"; sleep 1; done
   ```
2. **EC2 → Instances** → select one `cst-library-prod` instance → **Terminate**.
3. Watch: the probe keeps printing `200`. The ALB sends all traffic to the other AZ, and Auto Scaling launches a replacement (about 3–5 min).

📸 **S45**: the probe output (all 200s) **and** **EC2 → Auto Scaling groups → Activity** showing the terminate and launch.

### 14.4 Failure test 2: database failover (only after Multi-AZ, Part 13)
1. Start the probe again.
2. RDS → `cst-library-db` → Actions → **Reboot** → tick **Reboot with failover**.
3. Note how many seconds return `503` (usually 30–120 s), then `200` again. This is your measured **RTO**.

📸 **S46**: RDS **Logs & events** (failover started/completed) + the probe output with the gap.

### 14.5 Failure test 3: email failure → DLQ → alarm
(From 14.2.) 📸 **S47**: the DLQ showing messages available, **and** the `library-email-dlq` alarm *In alarm*.
📸 **S38**: the **alarm email** from SNS in the inbox.

### 14.6 Zero-downtime deploy
Start the probe, push a small commit, and watch the pipeline. The probe stays `200` the whole time (rolling with an additional batch).
📸 **S48**: the probe output during the deploy, next to the EB events.

### 14.7 Security checks
- Open an S3 cover URL **without** its signature part (cut everything after `?`) → **AccessDenied**. 📸 **S49**
- RDS *Publicly accessible: No* (S06). Instances have **no public IP** (EC2 → instance → details). 📸 **S49b**
- `curl -X POST $URL/api/internal/jobs/daily` (no token) → **401/403**. 📸 **S49c**

### 14.8 Cost evidence
**Billing → Cost Explorer**: daily cost grouped by **Service** for the project period.
📸 **S50**: the Cost Explorer chart. Also make an estimate in the **AWS Pricing Calculator** and export the PDF (for the report).

---

## Part 15: Tear down (stop paying)

**Between work days:** the NAT Gateway (~$1.1/day), the load balancer (~$0.6/day) and RDS cost money even when idle. Try to do Parts 3–12 in a few days in a row. RDS can be **stopped** for up to 7 days.

**After the final presentation**, delete in this order:
1. Elastic Beanstalk → environment → **Terminate** (removes EC2, ASG, load balancer). Then delete the application.
2. CloudFront → **Disable**, wait, **Delete**. Delete the WAF web ACL if created.
3. ElastiCache cluster → Delete.
4. RDS → delete the **read replica** first, then the primary (take a final snapshot only if you need it).
5. VPC → **interface endpoints** → Delete. **NAT gateways** → Delete. **Elastic IPs** → Release.
6. Lambda functions, the EventBridge schedule, SQS queues, the SNS topic, CloudWatch alarms and dashboard.
7. S3 buckets: **Empty**, then Delete (covers, logs, `elasticbeanstalk-ap-south-1-…`).
8. VPC → **Delete VPC** (removes subnets, route tables, IGW, security groups).
9. IAM roles (`cst-library-ec2-role`, `github-actions-library-deploy`, Lambda roles, the EB service role), the OIDC provider, SES identities.
10. Check Billing the next day. It should show no new charges except storage for retained snapshots.

📸 **S51** (optional): the empty EB / RDS lists as proof of clean-up.

---

## Part 16: Write the report

### 16.1 Diagrams (2 marks)
Use **draw.io / diagrams.net** → *More shapes* → enable **AWS 2026 / AWS Architecture Icons**.

**Figure 1: Architecture** (match what you really built):
- Outer box **AWS Cloud (ap-south-1)** → **VPC 10.0.0.0/16** → two columns **AZ a / AZ b**
- Rows: **public subnets** (ALB, NAT), **private app subnets** (EB EC2 in an Auto Scaling group box), **private DB subnets** (RDS primary / standby (+ replica), ElastiCache)
- Outside the VPC: Users → CloudFront (+WAF) → ALB. S3 (covers, logs), SQS + DLQ → Lambda notifier → SES, EventBridge Scheduler → Lambda reminders, Secrets Manager, CloudWatch → SNS, GitHub Actions → Elastic Beanstalk
- **Number the arrows 1–8** to follow one reservation, as in your proposal script
- Export as PNG at 2× → `docs/architecture.png`

**Figure 2: Reservation sequence**: Student → API → DB (BEGIN, FOR UPDATE, INSERT reservation + outbox, COMMIT) → SQS → Lambda → SES → callback → DB status `sent`.

**Figure 3: CI/CD pipeline**: push → GitHub Actions (build, package) → OIDC → S3 → EB version → rolling deploy → health check → smoke test → Lambdas.

### 16.2 Report structure (mapped to the rubric)

| # | Section | What to write | Screenshots | Rubric |
|---|---|---|---|---|
| 1 | Title page | project, members, module, date | — | Clarity |
| 2 | Executive summary | ½ page: problem, solution, result, cost | — | Clarity |
| 3 | Introduction & objectives | the library problem; business + measurable AWS objectives (from the proposal) | — | Clarity |
| 4 | Architecture design | Figure 1 + a walkthrough of one request; the VPC tiers; why each design choice (2 AZs, private subnets, outbox pattern) | S02–S05 | **Architecture 2, Diagrams 2** |
| 5 | AWS services | one row per service: role, **why chosen vs alternative** (copy from `TODO.md` section 3: EB vs ECS/EKS, RDS vs DynamoDB), key config | S06–S14, S26, S28 | **Service integration 4** |
| 6 | Implementation | app features (table from the README); **code highlights with short snippets**: row locking (`reservationService.js`), outbox + SQS publish (`notificationService.js`), Secrets Manager (`secrets.js`), presigned S3 (`storage.js`), Lambda partial batch failures (`lambda/notifier/index.mjs`); config through env vars | S21–S25, S43a–g | **Functional 10, Code quality 2** |
| 7 | Deployment & configuration | EB setup, environment properties, `.ebextensions`, CloudFront, CI/CD with OIDC (Figure 3) | S15–S20, S29, S31–S34 | **Deployment 2** |
| 8 | Security | least-privilege IAM, no keys in code, Secrets Manager, private subnets, SG chain, private S3 + presigned URLs, HTTPS, internal token, IMDSv2 | S05, S08, S13, S49 | Tech docs |
| 9 | Monitoring & operations | alarms, dashboard, logs, SNS | S35–S39 | Service integration |
| 10 | Testing | functional test table (step / expected / actual / pass); concurrency; **3 failure tests with measured results** (downtime seconds, RTO); zero-downtime deploy | S44–S48 | **Functional 10** |
| 11 | Cost | Pricing Calculator estimate (dev vs demo week) + actual Cost Explorer; cost-saving choices | S50 | Tech docs |
| 12 | Changes from the proposal | e.g. CloudFront HTTPS instead of Route 53 + ACM (no domain); what went into scale-up; reasons | — | Clarity |
| 13 | Challenges & lessons learned | real problems you hit (SES sandbox, OIDC trust, etc.) and how you fixed them | — | Presentation |
| 14 | Conclusion & future work | Terraform, Cognito, ECS/containers, multi-region | — | — |
| 15 | Team contribution | who did what (table) | — | — |
| A | Appendix | setup guide (link to this file / `docs/DEPLOYMENT.md`), repo link | — | Tech docs |

### 16.3 Writing tips
- Every figure needs a **number and caption** ("Figure 7: EB environment health Ok with two instances in two AZs"), and the text must **refer to it**.
- Put numbers in results: "0 failed requests while one instance was terminated", "database failover 47 s", "30 concurrent requests → 1 reserved, 29 waitlisted".
- Keep code snippets short (5–15 lines) and explain why the code is written that way.
- Write "we" consistently. Use the same service names everywhere (e.g. always "Amazon SQS", not "the queue service").

### 16.4 Presentation (2 marks), 10 minutes
1. Problem (1 min) → 2. Architecture diagram (2 min) → 3. **Live demo** (4 min, the 14.1 script; keep S43 screenshots ready as a backup in case the Wi-Fi fails) → 4. Pipeline + monitoring (1 min) → 5. Tests + cost (1 min) → 6. Lessons learned + questions (1 min).
Before the demo: EB health Ok, emails verified, alarms OK, DLQ purged, **no pushes to `main` (deployment freeze)**.

---

## Appendix A: Screenshot checklist

| ID | What | Part |
|---|---|---|
| S01 | Budget alert | 2.1 |
| S02 | VPC resource map | 3.1 |
| S03 | Subnets list | 3.1 |
| S04 | Private route table (NAT + S3 endpoint) | 3.1 |
| S05 | `sg-db` inbound rule | 3.2 |
| S06 | RDS connectivity (not public) | 4.3 |
| S07 | RDS configuration (encrypted, Secrets Manager) | 4.3 |
| S08 | Secrets Manager secret (no value) | 4.3 |
| S09 | S3 covers bucket, public access blocked | 5.1 |
| S10 | Logs bucket lifecycle rule | 5.2 |
| S11 | SES verified identities | 6.1 |
| S12 | SQS queues + DLQ redrive | 6.2 |
| S13 | EC2 role policies | 7.1 |
| S14 | Notifier Lambda with SQS trigger | 9.1 |
| S15 | EB environment Health Ok | 8.2 |
| S16 | EB instances in 2 AZs | 8.2 |
| S17 | EB configuration | 8.2 |
| S18 | EB env property names (values hidden) | 8.2 |
| S19 | Target group healthy targets | 8.2 |
| S20 | `/api/health` JSON | 8.2 |
| S21 | App home page on AWS | 8.4 |
| S22 | Librarian System card | 8.4 |
| S23 | Notifier log `email_sent` | 9.2 |
| S24 | Email in inbox | 9.2 |
| S25 | App Email log "Sent" | 9.2 |
| S26 | EventBridge schedule | 9.4 |
| S27 | Reminders Lambda test | 9.3 |
| S28 | CloudFront general + behaviors | 10 |
| S29 | App on HTTPS (padlock) | 10 |
| S30 | ALB SG with CloudFront prefix list (optional) | 10.5 |
| S31 | OIDC role trust policy | 11.3 |
| S32 | GitHub variables | 11.4 |
| S33 | GitHub Actions run green | 11.5 |
| S34 | EB versions + rolling deploy events | 11.5 |
| S35 | SNS subscriptions confirmed | 12.1 |
| S36 | Alarm list | 12.2 |
| S37 | CloudWatch dashboard | 12.3 |
| S38 | Alarm email | 14.5 |
| S39 | Logs Insights query | 12.4 |
| S40 | RDS Multi-AZ + replica | 13 |
| S41 | ElastiCache + System card "redis" | 13 |
| S42 | VPC endpoints | 13 |
| S43a–g | Functional demo steps | 14.1 |
| S44 | Concurrency test output | 14.2 |
| S45 | Instance terminated, still 200 + ASG activity | 14.3 |
| S46 | RDS failover events + probe | 14.4 |
| S47 | DLQ messages + alarm | 14.5 |
| S48 | Zero-downtime deploy probe | 14.6 |
| S49a–c | Security checks | 14.7 |
| S50 | Cost Explorer | 14.8 |
| S51 | Teardown proof (optional) | 15 |

---

## Appendix B: Record sheet

Keep this in a **private** note. Don't commit values marked 🔒.

| Item | Value |
|---|---|
| Account ID | |
| Region | ap-south-1 |
| VPC ID | |
| Public subnets | |
| App subnets (a, b) | |
| DB subnets (a, b) | |
| `sg-app` / `sg-db` / `sg-cache` / `sg-endpoints` | |
| `DB_HOST` (RDS endpoint) | |
| `DB_SECRET_ARN` | |
| Read replica endpoint | |
| `S3_BUCKET` (covers) | |
| Logs bucket | |
| `SES_FROM_EMAIL` | |
| `SQS_QUEUE_URL` | |
| Queue ARN / DLQ ARN | |
| EB application / environment | cst-library / cst-library-prod |
| EB URL | |
| CloudFront URL (`APP_URL`) | |
| `REDIS_URL` | |
| Deploy role ARN | |
| SNS topic ARN | |
| 🔒 `JWT_SECRET` | (password manager only) |
| 🔒 `INTERNAL_API_TOKEN` | (password manager only) |
| 🔒 New librarian password | (password manager only) |

---

## Appendix C: Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| EB health **Severe**, logs say `npm ERR` | Bundle built before the dependency fix → run `npm run package` again and upload. Check that `server/package.json` has no `file:..`. |
| EB health red, `/api/health` → `db: down` or timeouts | `sg-db` doesn't allow 5432 from `sg-app`, or `sg-app` is not attached to the instances (EB → Configuration → Instances), or `DB_HOST` is wrong |
| `AccessDeniedException ... secretsmanager` in the logs | Wrong secret ARN in the inline policy (the ARN ends with a random suffix; copy it exactly) |
| `database "library" does not exist` | Initial DB name was not set in 4.2 → set `DB_NAME` to `postgres`, or create the DB |
| Instances can't download npm packages | Private subnet route table has no `0.0.0.0/0 → NAT` |
| Target group "unhealthy", health check timeout | The `.ebextensions` health check uses **port 8080**. Make sure the instance security group allows 8080 from the load balancer SG (EB normally adds this). Check EB → Logs → `web.stdout.log`. |
| Emails stay "In SQS" | Lambda trigger disabled, or a Lambda error → check `/aws/lambda/library-notifier` logs |
| Lambda error `Email address is not verified` | SES sandbox → verify that recipient (6.1) or get production access |
| Emails "sent" but not received | Check spam. Gmail sender over SES may fail DMARC checks. |
| Email log never changes to "Sent" (but the email arrives) | Notifier `APP_URL` or `INTERNAL_API_TOKEN` doesn't match the app |
| Login returns 429 "Too many attempts" | `AUTH_RATE_LIMIT` not set (Part 8). After CloudFront, `trust proxy` must be 2 (10.1). |
| GitHub Actions: `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust policy `sub` mismatch → use `environment:production` (11.3) |
| GitHub Actions: `InvalidParameterValue` on create-application-version | The description fix in 11.1 wasn't applied |
| CloudFront 502 | Origin protocol must be **HTTP only**. The ALB SG must allow the CloudFront prefix list. |
| Cover images broken | Instance role lacks `s3:GetObject` on `covers/*`, or `S3_BUCKET` is wrong |

To see app logs: EB → **Logs → Request logs → Last 100 lines**, or CloudWatch log group `/aws/elasticbeanstalk/cst-library-prod/var/log/web.stdout.log`.

---

## Appendix D: If you use AWS Academy Learner Lab

The Learner Lab blocks some things. Changes:
- **Region:** usually only **us-east-1** (or us-west-2). Use it everywhere instead of ap-south-1. For the ALB log bucket policy, use account `127311923021` (us-east-1).
- **IAM:** you can't create roles. Use **`LabRole`** for Lambda and Scheduler, and **`LabInstanceProfile`** as the EB instance profile and service role. Show `LabRole` in the report and explain that in a real account you would use the least-privilege policy from 7.1.
- **CI/CD:** no OIDC provider. Store `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` from *AWS Details* as GitHub **secrets**, and change the `configure-aws-credentials` step to use them. They expire when the lab session ends (about 4 h), so update them before each deploy.
- **Budgets / Cost Explorer** may be hidden. Use the lab's remaining-credit display instead.
- The lab **stops EC2 when the session ends**. Start the lab before your demo and wait for EB to become healthy.
