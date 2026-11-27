// Generates the corrected CST Library architecture as an "aws-architecture-lab" v2 draft.
// Usage: node gen-architecture.mjs <output.json>
import { writeFileSync } from 'node:fs';

const out = process.argv[2];

// ---------- helpers ----------
const ipToInt = (ip) => ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
const intToIp = (n) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
function subnetInfo(cidr) {
  const [base, bits] = cidr.split('/');
  const total = 2 ** (32 - Number(bits));
  const b = ipToInt(base);
  const last = b + total - 1;
  return {
    totalAddresses: total,
    usableHosts: total - 5,
    reservedAddresses: [
      { ip: intToIp(b), offset: 0, role: 'Network Address', description: 'First address in the subnet. Identifies the network itself.' },
      { ip: intToIp(b + 1), offset: 1, role: 'VPC Router', description: 'Reserved by AWS for the default VPC router / subnet gateway.' },
      { ip: intToIp(b + 2), offset: 2, role: 'Amazon-Provided DNS', description: 'Reserved by AWS for the DNS resolver (Route 53 Resolver / AmazonProvidedDNS).' },
      { ip: intToIp(b + 3), offset: 3, role: 'AWS Future Use', description: 'Reserved by AWS for potential future internal functionality.' },
      { ip: intToIp(last), offset: total - 1, role: 'Network Broadcast Address', description: 'Last address in the subnet. AWS does not support broadcast in a VPC, but reserves the address.' },
    ],
    usableRange: { start: intToIp(b + 4), end: intToIp(last - 1) },
  };
}

const CATEGORY = {
  user: 'Client / Ingress',
  cloudfront: 'Networking & Content Delivery',
  waf: 'Security, Identity & Compliance',
  internet_gateway: 'Networking & Content Delivery',
  nat_gateway: 'Networking & Content Delivery',
  alb: 'Networking & Content Delivery',
  ec2: 'Compute',
  ec2_auto_scaling: 'Compute',
  elastic_beanstalk: 'Compute',
  privatelink: 'Networking & Content Delivery',
  elasticache: 'Databases',
  rds: 'Databases',
  s3: 'Storage',
  s3_gateway_endpoint: 'Networking & Content Delivery',
  route_tables: 'Networking & Content Delivery',
  secrets_manager: 'Security, Identity & Compliance',
  sqs: 'Integration & Messaging',
  lambda: 'Compute',
  ses: 'Business Applications',
  eventbridge_scheduler: 'Integration & Messaging',
  cloudwatch: 'Management & Governance',
  sns: 'Integration & Messaging',
  iam: 'Security, Identity & Compliance',
  github: 'Third-Party & External',
};

const nodes = [];
const edges = [];

function boundary(id, x, y, w, h, data, z) {
  nodes.push({
    id, type: 'boundaryNode', position: { x, y },
    data: { ...data, width: w, height: h, isSimulating: false, simulationStatus: 'idle' },
    style: { width: w, height: h }, draggable: true, selectable: true, zIndex: z,
    measured: { width: w, height: h }, selected: false, width: w, height: h,
  });
}

function subnet(id, label, type, cidr, az, routeTable, x, y, w, h) {
  boundary(id, x, y, w, h, { label, boundaryType: type, cidr, ...subnetInfo(cidr), az, routeTable }, -3);
}

function sg(id, label, x, y, rules, allowedProtocols) {
  const data = { label, boundaryType: 'security_group' };
  if (rules) data.securityGroupRules = rules;
  if (allowedProtocols) data.allowedProtocols = allowedProtocols;
  boundary(id, x, y, 240, 120, data, -4);
}

function svc(id, serviceId, label, x, y, opts = {}) {
  const { az = 'Edge / Global', subnet = 'global', replicas = 1, multiAz = false, sgs, notes, config, h = 98 } = opts;
  const data = {
    serviceId, label, category: CATEGORY[serviceId], health: 'healthy', az, subnet, replicas, multiAz,
    width: 140, height: h, isSimulating: false, simulationStatus: 'idle',
  };
  if (sgs) data.securityGroupIds = sgs;
  if (notes) data.notes = notes;
  if (config) data.customConfig = config;
  nodes.push({
    id, type: 'serviceNode', position: { x, y }, data, zIndex: 10,
    measured: { width: 140, height: h }, style: { width: 140, height: h }, selected: false, dragging: false,
  });
}

const HANDLES = {
  r: ['source-right', 'target-left'],
  l: ['source-left', 'target-right'],
  d: ['source-bottom', 'target-top'],
  u: ['source-top', 'target-bottom'],
  ur: ['source-top', 'target-left'],
  dr: ['source-bottom', 'target-left'],
  dd: ['source-bottom', 'target-bottom'],
  uu: ['source-top', 'target-top'],
};

function edge(source, target, dir, protocol, relationship, description, opts = {}) {
  const { critical = relationship === 'request', async = ['event', 'telemetry', 'async'].includes(relationship) } = opts;
  const [sh, th] = HANDLES[dir];
  let id = `edge-${source}-${target}`;
  if (edges.some((e) => e.id === id)) id += `-${edges.length}`;
  edges.push({
    zIndex: 1000, source, sourceHandle: sh, target, targetHandle: th, id, type: 'custom',
    markerEnd: { type: 'arrowclosed', color: '#94A3B8' },
    data: {
      relationship, protocol, transport: protocol, lineStyle: 'straight',
      interactionType: async ? 'asynchronous' : 'synchronous',
      isCriticalDependency: critical, timeoutMs: 2500, isSimulating: false, isFailing: false,
      flowStatus: 'idle', description,
    },
  });
}

// ---------- boundaries: VPC + 6 subnets (/19, matching the proposal diagram) ----------
boundary('box-vpc', 60, 40, 1460, 900, { label: 'Library VPC (us-east-1, 10.0.0.0/16)', boundaryType: 'vpc', cidr: '10.0.0.0/16' }, -5);
const PUB_RT = 'library-public-rt (0.0.0.0/0 -> library-igw)';
const PRIV_RT = 'library-private-rt (0.0.0.0/0 -> NAT-A; S3 prefix list -> S3 gateway endpoint)';
const DB_RT = 'library-db-rt (local only; no internet route)';
subnet('box-public-a', 'Public subnet A (us-east-1a) 10.0.0.0/19', 'public_subnet', '10.0.0.0/19', 'AZ-A', PUB_RT, 90, 80, 680, 240);
subnet('box-public-b', 'Public subnet B (us-east-1b) 10.0.32.0/19', 'public_subnet', '10.0.32.0/19', 'AZ-B', PUB_RT, 800, 80, 690, 240);
subnet('box-app-a', 'Private app subnet A (us-east-1a) 10.0.64.0/19', 'private_subnet', '10.0.64.0/19', 'AZ-A', PRIV_RT, 90, 350, 680, 270);
subnet('box-app-b', 'Private app subnet B (us-east-1b) 10.0.96.0/19', 'private_subnet', '10.0.96.0/19', 'AZ-B', PRIV_RT, 800, 350, 690, 270);
subnet('box-db-a', 'Private DB subnet A (us-east-1a) 10.0.128.0/19', 'private_subnet', '10.0.128.0/19', 'AZ-A', DB_RT, 90, 650, 680, 260);
subnet('box-db-b', 'Private DB subnet B (us-east-1b) 10.0.160.0/19', 'private_subnet', '10.0.160.0/19', 'AZ-B', DB_RT, 800, 650, 690, 260);

// ---------- security groups (shown below the VPC) ----------
sg('sg-alb', 'sg-alb (ALB): HTTP 80 from CloudFront prefix list only', 800, 980, null, ['HTTP']);
sg('sg-app', 'sg-app (EB instances): HTTP 8080 from sg-alb', 1060, 980, {
  inbound: [{ protocol: 'HTTP', portRange: '8080', source: { type: 'securityGroup', securityGroupId: 'sg-alb' } }],
  outbound: [{ protocol: 'All', portRange: 'All', source: { type: 'cidr', cidr: '0.0.0.0/0' } }],
});
sg('sg-db', 'sg-db (RDS): TCP 5432 from sg-app', 1320, 980, {
  inbound: [{ protocol: 'TCP', portRange: '5432', source: { type: 'securityGroup', securityGroupId: 'sg-app' } }],
  outbound: [],
});
sg('sg-cache', 'sg-cache (ElastiCache): TCP 6379 from sg-app', 800, 1120, {
  inbound: [{ protocol: 'TCP', portRange: '6379', source: { type: 'securityGroup', securityGroupId: 'sg-app' } }],
  outbound: [],
});
sg('sg-endpoints', 'sg-endpoints (VPC endpoints): HTTPS 443 from sg-app', 1060, 1120, {
  inbound: [{ protocol: 'HTTPS', portRange: '443', source: { type: 'securityGroup', securityGroupId: 'sg-app' } }],
  outbound: [],
});

// ---------- edge / ingress (left) ----------
svc('node-user', 'user', 'Students & Librarians (Browser)', -540, 250, {
  notes: 'Students and staff search, reserve and track books; librarians manage the catalogue and circulation desk. They open https://dxxxx.cloudfront.net (AWS Academy Learner Lab: no custom domain, so no Route 53 / ACM).',
});
svc('node-cf', 'cloudfront', 'Amazon CloudFront (HTTPS *.cloudfront.net, edge cache for /assets/*)', -280, 250, {
  notes: 'Viewer HTTPS with the default CloudFront certificate (Learner Lab has no custom domain). Redirect HTTP -> HTTPS. Default behaviour -> ALB, CachingDisabled + AllViewer. /assets/* -> CachingOptimized. Origin = Elastic Beanstalk domain, HTTP 80 inside AWS. Real account: Route 53 + ACM and an HTTPS origin.',
  config: { behaviors: [{ path: 'Default (*)', cachePolicy: 'CachingDisabled', originRequestPolicy: 'AllViewer' }, { path: '/assets/*', cachePolicy: 'CachingOptimized' }], origin: 'cst-library-<group>.us-east-1.elasticbeanstalk.com (HTTP 80)', certificate: 'Default *.cloudfront.net', priceClass: 'NA, EU, Asia, ME, Africa' },
});
svc('node-waf', 'waf', 'AWS WAF web ACL (attached to CloudFront)', -280, 80, {
  notes: 'Global web ACL on the CloudFront distribution (not a device in a subnet). Core rule set + SQL injection rules + rate-based rule + custom rule: block /api/internal/* without the x-internal-token header.',
  config: { scope: 'CLOUDFRONT', rules: ['AWSManagedRulesCommonRuleSet', 'AWSManagedRulesSQLiRuleSet', 'Rate limit per IP', 'block-internal-without-token'] },
});

// ---------- VPC: public tier ----------
svc('node-igw', 'internet_gateway', 'Internet Gateway (attached to the VPC)', -10, 250, {
  az: 'Multi-AZ', subnet: 'global', multiAz: true,
  notes: 'Attached to the VPC (drawn on the VPC border). Public route table 0.0.0.0/0 -> IGW.',
});
svc('node-nat-a', 'nat_gateway', 'NAT Gateway AZ-A (outbound only)', 330, 180, {
  az: 'AZ-A', subnet: 'public',
  notes: 'Outbound internet for the private app subnets (EB agent, npm install, SES API). One NAT during build weeks to save cost.',
  config: { elasticIp: 'library-nat-a-eip' },
});
svc('node-alb', 'alb', 'Application Load Balancer (public, spans AZ-A + AZ-B)', 700, 150, {
  az: 'Multi-AZ', subnet: 'public', replicas: 2, multiAz: true, sgs: ['sg-alb'], h: 116,
  notes: 'Created and managed by Elastic Beanstalk. HTTP :80 listener (users get HTTPS from CloudFront; no certificate without a domain in Learner Lab). Health check /api/health (checks the DB). Access logs -> S3 logs bucket. SG allows only the CloudFront origin-facing prefix list.',
  config: { listeners: ['HTTP 80 (from CloudFront only)'], targetPort: 8080, healthCheckPath: '/api/health', accessLogs: 's3://library-logs-<account>/alb', subnets: ['public-a', 'public-b'] },
});
svc('node-nat-b', 'nat_gateway', 'NAT Gateway AZ-B (scale-up: demo week)', 1060, 180, {
  az: 'AZ-B', subnet: 'public',
  notes: 'Second NAT added in demo week so each AZ has its own exit (removes the NAT single point of failure). Until then private-app-b routes through NAT-A.',
});

// ---------- VPC: app tier ----------
svc('node-vpce-a', 'privatelink', 'VPC Interface Endpoints AZ-A (secretsmanager, sqs, logs, monitoring)', 120, 440, {
  az: 'AZ-A', subnet: 'private', sgs: ['sg-endpoints'],
  notes: 'Interface endpoints with private DNS: com.amazonaws.us-east-1.secretsmanager, .sqs, .logs, .monitoring. Keeps AWS API traffic inside the VPC. NAT is still needed for the EB agent and SES.',
});
svc('node-ec2-a', 'ec2', 'EC2 instance AZ-A (Elastic Beanstalk, Node.js 22 Express app)', 330, 440, {
  az: 'AZ-A', subnet: 'private', sgs: ['sg-app'],
  notes: 'Node.js 22 on Amazon Linux 2023. Express API + React SPA. No public IP, no SSH key, IMDSv2 only. Instance profile LabInstanceProfile (Learner Lab).',
  config: { instanceType: 't3.micro', platform: 'Node.js 22 on 64bit Amazon Linux 2023', instanceProfile: 'LabInstanceProfile', port: 8080, publicIp: 'none' },
});
svc('node-cache', 'elasticache', 'Amazon ElastiCache (Valkey/Redis): catalogue cache', 560, 440, {
  az: 'AZ-A', subnet: 'private', sgs: ['sg-cache'],
  notes: 'Single cache.t4g.micro node, TLS in transit (rediss://). If it fails the app falls back to an in-memory cache, so it is not a hard dependency.',
  config: { nodeType: 'cache.t4g.micro', engine: 'Valkey / Redis OSS', transitEncryption: true, replicas: 0 },
});
svc('node-ec2-b', 'ec2', 'EC2 instance AZ-B (Elastic Beanstalk, Node.js 22 Express app)', 880, 440, {
  az: 'AZ-B', subnet: 'private', sgs: ['sg-app'],
  notes: 'Second instance of the same Auto Scaling group, in AZ-B.',
  config: { instanceType: 't3.micro', platform: 'Node.js 22 on 64bit Amazon Linux 2023', instanceProfile: 'LabInstanceProfile', port: 8080, publicIp: 'none' },
});
svc('node-asg', 'ec2_auto_scaling', 'EC2 Auto Scaling group (min 2, max 4, CPU 70 %)', 1090, 440, {
  az: 'Multi-AZ', subnet: 'private', replicas: 2, multiAz: true,
  notes: 'Managed by Elastic Beanstalk. Min 2 / max 4 instances across both AZs; scale out at 70 % CPU, in at 25 %. Rolling with additional batch deployments.',
  config: { asg: { memberIds: ['node-ec2-a', 'node-ec2-b'], min: 2, max: 4, desired: 2 }, scaling: { metric: 'CPUUtilization', upper: 70, lower: 25 } },
});
svc('node-vpce-b', 'privatelink', 'VPC Interface Endpoints AZ-B (secretsmanager, sqs, logs, monitoring)', 1310, 440, {
  az: 'AZ-B', subnet: 'private', sgs: ['sg-endpoints'],
  notes: 'Same four interface endpoints, ENIs in AZ-B.',
});

// ---------- VPC: data tier ----------
svc('node-rds-a', 'rds', 'Amazon RDS PostgreSQL 16 primary (AZ-A)', 330, 740, {
  az: 'AZ-A', subnet: 'private', multiAz: true, sgs: ['sg-db'],
  notes: 'db.t4g.micro, encrypted, not public. Master credentials managed in Secrets Manager. Reservations use BEGIN; SELECT ... FOR UPDATE; COMMIT so the last copy goes to exactly one student.',
  config: { engine: 'postgres 16', instanceClass: 'db.t4g.micro', storage: 'gp3 20 GiB', multiAz: true, publiclyAccessible: false, encrypted: true, database: 'library' },
});
svc('node-rds-b', 'rds', 'Amazon RDS standby (AZ-B, synchronous, automatic failover)', 880, 740, {
  az: 'AZ-B', subnet: 'private', multiAz: true, sgs: ['sg-db'],
  notes: 'Multi-AZ standby. Not readable; takes over automatically if the primary or AZ-A fails.',
});
svc('node-rds-ro', 'rds', 'Amazon RDS read replica (AZ-B, async, read-only)', 1150, 740, {
  az: 'AZ-B', subnet: 'private', sgs: ['sg-db'],
  notes: 'Serves catalogue browsing queries (readQuery). Writes and reservations always go to the primary.',
});

// ---------- below the VPC: routing ----------
svc('node-rt-public', 'route_tables', 'library-public-rt -> IGW', 120, 990, {
  notes: 'Associated with public-a and public-b. 0.0.0.0/0 -> IGW.',
});
svc('node-rt-private', 'route_tables', 'library-private-rt -> NAT + S3 endpoint', 330, 990, {
  notes: 'Associated with private-app-a/b. 0.0.0.0/0 -> NAT-A (NAT-B for app-b after scale-up); S3 prefix list -> S3 gateway endpoint. DB subnets have no internet route.',
});
svc('node-s3-gw', 's3_gateway_endpoint', 'S3 Gateway Endpoint (free)', 560, 990, {
  notes: 'Cover uploads from the instances reach S3 without the NAT Gateway.',
  config: { type: 'Gateway', service: 'com.amazonaws.us-east-1.s3', routeTable: 'library-private-rt' },
});

// ---------- regional services (right) ----------
svc('node-s3', 's3', 'Amazon S3: book covers (private, presigned URLs)', 1620, 60, {
  notes: 'Block all public access, SSE-S3. The app uploads covers and returns 1-hour presigned GET URLs; browsers download covers directly from S3.',
  config: { bucket: 'library-covers-<account>', publicAccess: 'blocked', encryption: 'SSE-S3', presignedUrlTtlSeconds: 3600 },
});
svc('node-s3-logs', 's3', 'Amazon S3: ALB access logs (Glacier after 30 days)', 1840, 60, {
  notes: 'Lifecycle: Glacier Flexible Retrieval after 30 days, expire after 365 days.',
  config: { bucket: 'library-logs-<account>', lifecycle: ['-> GLACIER after 30 days', 'expire after 365 days'] },
});
svc('node-secrets', 'secrets_manager', 'AWS Secrets Manager (RDS master credentials)', 1620, 220, {
  notes: 'RDS-managed secret (or a self-managed secret with host/dbname if the lab blocks the managed option). The app reads it at start-up through the interface endpoint.',
});
svc('node-sqs', 'sqs', 'Amazon SQS: library-notifications', 1620, 380, {
  notes: 'Standard queue, visibility timeout 180 s, redrive to the DLQ after 3 receives. The app publishes after COMMIT (transactional outbox).',
  config: { queue: 'library-notifications', visibilityTimeoutSeconds: 180, maxReceiveCount: 3 },
});
svc('node-lambda-notifier', 'lambda', 'AWS Lambda: library-notifier (outside the VPC)', 1840, 380, {
  notes: 'Node.js 22. SQS trigger, batch 10, ReportBatchItemFailures. Sends with SES, then reports sent/failed to the app (/api/internal/notifications/:id/status).',
  config: { runtime: 'nodejs22.x', timeoutSeconds: 30, trigger: 'SQS library-notifications (batch 10, partial batch failures)', vpc: 'none' },
});
svc('node-ses', 'ses', 'Amazon SES (verified sender)', 2060, 380, {
  notes: 'Verified sender identity. Sandbox: recipients verified; production access requested.',
});
svc('node-dlq', 'sqs', 'Amazon SQS: library-notifications-dlq', 1620, 540, {
  notes: 'Messages that failed 3 times. CloudWatch alarm when >= 1 message is visible.',
  config: { queue: 'library-notifications-dlq', retentionDays: 14 },
});
svc('node-inbox', 'user', 'Student inbox (email)', 2060, 540, {
  notes: 'Reservation confirmations, "now available", pickup / due / overdue reminders.',
});
svc('node-scheduler', 'eventbridge_scheduler', 'EventBridge Scheduler: library-daily (08:00 Asia/Thimphu)', 1620, 700, {
  notes: 'cron(0 8 * * ? *) in time zone Asia/Thimphu, 2 retries.',
  config: { schedule: 'cron(0 8 * * ? *)', timezone: 'Asia/Thimphu', target: 'library-daily-reminders', retries: 2 },
});
svc('node-lambda-reminders', 'lambda', 'AWS Lambda: library-daily-reminders (outside the VPC)', 1840, 700, {
  notes: 'Calls POST /api/internal/jobs/daily (shared token): expires uncollected holds, promotes the waitlist, queues reminders. No DB credentials needed.',
  config: { runtime: 'nodejs22.x', timeoutSeconds: 30, vpc: 'none' },
});
svc('node-cloudwatch', 'cloudwatch', 'Amazon CloudWatch (logs, metrics, alarms, dashboard)', 1620, 860, {
  notes: 'EB instance logs (14 days), Lambda logs, dashboard cst-library. Alarms: unhealthy hosts, ALB 5xx, EC2 CPU, RDS CPU/storage, DLQ >= 1, Lambda errors.',
});
svc('node-sns', 'sns', 'Amazon SNS: library-alerts', 1840, 860, {
  notes: 'Email subscriptions for every team member.',
});
svc('node-team', 'user', 'Project team (alarm emails)', 2060, 860);
svc('node-eb', 'elastic_beanstalk', 'AWS Elastic Beanstalk: cst-library-prod', 1620, 1020, {
  notes: 'Manages the ALB, Auto Scaling group and EC2 instances. Enhanced health, managed platform updates, rolling with additional batch, auto rollback on failed health checks. Config in server/.ebextensions.',
  config: { application: 'cst-library', environment: 'cst-library-prod', deploymentPolicy: 'RollingWithAdditionalBatch', managedPlatformUpdates: true },
});
svc('node-github', 'github', 'GitHub Actions (CI/CD: test, build, deploy)', 1840, 1020, {
  notes: 'On push to main: test -> build -> package -> upload to S3 -> new EB version -> rolling deploy -> smoke test /api/health -> update both Lambdas. Learner Lab: signs in with the session keys stored as GitHub secrets (refreshed each session). Real account: OIDC role, no stored keys.',
});
svc('node-iam', 'iam', 'AWS IAM (LabRole / LabInstanceProfile)', 2060, 1020, {
  notes: 'Learner Lab cannot create roles: LabRole is used by Elastic Beanstalk, both Lambdas and the scheduler, and LabInstanceProfile by the EC2 instances. Real-account design: library-ec2-role (one secret, one queue, covers/* only), separate Lambda roles, GitHub OIDC deploy role.',
  config: { labRole: 'LabRole', instanceProfile: 'LabInstanceProfile' },
});

// ---------- edges: main request path (Reserve a book) ----------
edge('node-user', 'node-cf', 'r', 'HTTPS', 'request', '1-3. Student opens https://dxxxx.cloudfront.net; CloudFront ends HTTPS (default certificate) and WAF inspects the request');
edge('node-cf', 'node-igw', 'r', 'HTTP', 'request', '4. /api/* and pages forwarded to the ALB origin (Elastic Beanstalk domain, HTTP 80) through the IGW');
edge('node-igw', 'node-alb', 'r', 'HTTP', 'request', '4. Only CloudFront can reach the ALB (prefix-list security group)');
edge('node-alb', 'node-ec2-a', 'd', 'HTTP', 'request', '5. ALB sends the request to a healthy instance in AZ-A');
edge('node-alb', 'node-ec2-b', 'd', 'HTTP', 'request', '5. ALB sends the request to a healthy instance in AZ-B');
edge('node-ec2-a', 'node-cache', 'r', 'TCP', 'request', '7. Catalogue reads served from ElastiCache when cached (TCP 6379, TLS)', { critical: false });
edge('node-ec2-b', 'node-cache', 'l', 'TCP', 'request', '7. Catalogue reads served from ElastiCache when cached (TCP 6379, TLS)', { critical: false });
edge('node-ec2-a', 'node-rds-a', 'd', 'TCP', 'request', '8. Reservation transaction: BEGIN; SELECT ... FOR UPDATE; INSERT reservation + outbox row; COMMIT (TCP 5432, TLS)');
edge('node-ec2-b', 'node-rds-a', 'd', 'TCP', 'request', '8. Writes always go to the primary (TCP 5432, TLS)');
edge('node-ec2-b', 'node-rds-ro', 'd', 'TCP', 'request', '8. Catalogue browsing queries go to the read replica', { critical: false });
edge('node-rds-a', 'node-rds-b', 'r', 'TCP', 'replication', '9. Synchronous replication to the Multi-AZ standby (automatic failover)', { critical: false });
edge('node-rds-a', 'node-rds-ro', 'dd', 'TCP', 'replication', '9. Asynchronous replication to the read replica', { critical: false, async: true });

// ---------- edges: AWS APIs from the instances ----------
edge('node-ec2-a', 'node-vpce-a', 'l', 'HTTPS', 'request', '6 / 11. AWS API calls (Secrets Manager, SQS, CloudWatch) stay inside the VPC');
edge('node-ec2-b', 'node-vpce-b', 'r', 'HTTPS', 'request', '6 / 11. AWS API calls (Secrets Manager, SQS, CloudWatch) stay inside the VPC');
edge('node-vpce-a', 'node-secrets', 'ur', 'HTTPS', 'request', '6. At start-up the app reads the RDS credentials from Secrets Manager', { critical: false });
edge('node-vpce-b', 'node-secrets', 'ur', 'HTTPS', 'request', '6. At start-up the app reads the RDS credentials from Secrets Manager', { critical: false });
edge('node-vpce-a', 'node-sqs', 'ur', 'HTTPS', 'event', '11. After COMMIT the app publishes the email event to SQS and replies to the student immediately');
edge('node-vpce-b', 'node-sqs', 'ur', 'HTTPS', 'event', '11. After COMMIT the app publishes the email event to SQS and replies to the student immediately');
edge('node-vpce-b', 'node-cloudwatch', 'dr', 'HTTPS', 'telemetry', '17. Instance logs and metrics to CloudWatch', { critical: false });

// ---------- edges: S3 ----------
edge('node-ec2-a', 'node-s3-gw', 'd', 'HTTPS', 'request', '10. Librarian cover upload: PutObject through the S3 gateway endpoint', { critical: false });
edge('node-ec2-b', 'node-s3-gw', 'd', 'HTTPS', 'request', '10. Cover upload / presign through the S3 gateway endpoint', { critical: false });
edge('node-s3-gw', 'node-s3', 'r', 'HTTPS', 'request', '10. Private S3 bucket for covers', { critical: false });
edge('node-user', 'node-s3', 'ur', 'HTTPS', 'request', '10. Browser downloads the cover directly with a 1-hour presigned URL', { critical: false });
edge('node-alb', 'node-s3-logs', 'ur', 'HTTPS', 'telemetry', 'ALB access logs -> S3 (moved to Glacier after 30 days)', { critical: false });

// ---------- edges: event-driven email pipeline ----------
edge('node-sqs', 'node-lambda-notifier', 'r', 'HTTPS', 'event', '12. SQS triggers the notifier Lambda (batch 10, partial batch failures)');
edge('node-sqs', 'node-dlq', 'd', 'HTTPS', 'event', '12. After 3 failed receives the message moves to the dead-letter queue', { critical: false });
edge('node-lambda-notifier', 'node-ses', 'r', 'HTTPS', 'event', '13. The Lambda sends the email through SES');
edge('node-ses', 'node-inbox', 'd', 'SMTP', 'event', '14. Email delivered to the student', { critical: false });
edge('node-lambda-notifier', 'node-cf', 'uu', 'HTTPS', 'request', '15. Lambda reports sent / failed to /api/internal/notifications/:id/status (shared token)', { critical: false });
edge('node-scheduler', 'node-lambda-reminders', 'r', 'HTTPS', 'event', '16. Every day at 08:00 Asia/Thimphu the scheduler invokes the reminders Lambda');
edge('node-lambda-reminders', 'node-cf', 'uu', 'HTTPS', 'request', '16. POST /api/internal/jobs/daily: expire holds, promote waitlist, queue reminders', { critical: false });

// ---------- edges: monitoring ----------
edge('node-lambda-notifier', 'node-cloudwatch', 'dr', 'HTTPS', 'telemetry', '17. Lambda logs (email_sent / email_failed)', { critical: false });
edge('node-dlq', 'node-cloudwatch', 'd', 'HTTPS', 'telemetry', '17. DLQ depth alarm (>= 1 message)', { critical: false });
edge('node-cloudwatch', 'node-sns', 'r', 'HTTPS', 'event', '17. Alarm -> SNS topic library-alerts', { critical: false });
edge('node-sns', 'node-team', 'r', 'SMTP', 'event', '17. Alarm email to every team member', { critical: false });

// ---------- edges: outbound internet (NAT) ----------
edge('node-ec2-a', 'node-nat-a', 'u', 'HTTPS', 'request', 'Outbound only: EB agent, npm packages, SES API, Open Library ISBN lookup', { critical: false });
edge('node-ec2-b', 'node-nat-a', 'u', 'HTTPS', 'request', 'Outbound via NAT-A until the second NAT is added (scale-up)', { critical: false });
edge('node-nat-a', 'node-igw', 'l', 'HTTPS', 'request', 'NAT -> IGW -> internet', { critical: false });
edge('node-nat-b', 'node-igw', 'uu', 'HTTPS', 'request', 'Scale-up: NAT-B -> IGW (each AZ gets its own exit)', { critical: false });

// ---------- edges: security / config attachments ----------
edge('node-waf', 'node-cf', 'd', 'HTTPS', 'dependency', 'WAF web ACL attached to the CloudFront distribution', { critical: false });
edge('node-rt-public', 'node-igw', 'u', 'TCP', 'dependency', 'Public route table: 0.0.0.0/0 -> IGW', { critical: false });
edge('node-rt-private', 'node-nat-a', 'u', 'TCP', 'dependency', 'Private route table: 0.0.0.0/0 -> NAT', { critical: false });
edge('node-rt-private', 'node-s3-gw', 'r', 'TCP', 'dependency', 'Private route table: S3 prefix list -> gateway endpoint', { critical: false });
edge('node-iam', 'node-asg', 'u', 'HTTPS', 'dependency', 'Instance profile LabInstanceProfile (Learner Lab)', { critical: false });

// ---------- edges: deployment lane ----------
edge('node-github', 'node-eb', 'l', 'HTTPS', 'request', 'CI/CD: session keys (GitHub secrets) -> upload bundle -> new EB version -> rolling deploy (auto rollback)', { critical: false });
edge('node-github', 'node-lambda-notifier', 'u', 'HTTPS', 'request', 'CI/CD updates the Lambda code', { critical: false });
edge('node-eb', 'node-asg', 'l', 'HTTPS', 'dependency', 'Elastic Beanstalk manages the Auto Scaling group', { critical: false });
edge('node-eb', 'node-alb', 'u', 'HTTPS', 'dependency', 'Elastic Beanstalk manages the load balancer', { critical: false });

// ---------- draft ----------
const draft = {
  format: 'aws-architecture-lab',
  version: 2,
  applicationRelease: {
    version: '1.0.0',
    buildId: '75e56feb-53b8-4fda-917d-db7fdac86133',
    channel: 'preview',
    builtAt: '2026-10-02T03:59:33.000Z',
    draftVersion: 2,
  },
  savedAt: new Date().toISOString(),
  state: {
    draftName: 'CST-Library-Reservation-System-Final-LearnerLab',
    nodes,
    edges,
    scenario: {
      id: 'reserve-book',
      name: 'Reserve a book',
      method: 'POST',
      path: '/api/reservations',
      startNodeId: 'node-user',
      trafficLevel: 'normal',
    },
    simulationResult: null,
    activeFailures: [],
    activeLabReference: null,
    activeChallengeId: null,
    challengeResult: null,
    appMode: 'design',
    selectedNodeId: null,
    selectedEdgeId: null,
    activeStepIndex: null,
    playbackSpeed: 1,
    highlightTaskFlow: true,
    showNaclSideColumn: false,
    viewport: { x: 420, y: 40, zoom: 0.36 },
  },
};

writeFileSync(out, JSON.stringify(draft, null, 2) + '\n');
console.log(`wrote ${out}: ${nodes.length} nodes, ${edges.length} edges`);
