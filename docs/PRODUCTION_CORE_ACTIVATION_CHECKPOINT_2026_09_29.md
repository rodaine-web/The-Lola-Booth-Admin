# Production core activation checkpoint — 2026-09-29

This is an in-progress checkpoint, not launch qualification.

## Verified release and worker

- Branch: `codex/p0-environment-isolation`.
- Production API and dedicated worker code revision: `8da5658da5cdf0f14eb551687b836b97f84dee17`.
- API deployment: `bce827f4-eda9-4d44-8b61-30af1a40177f` (SUCCESS).
- Worker service: `ca362c18-1959-4503-b7e0-e9d6f0ae9f3c`, LOLA Worker Production.
- Worker deployment: `2d55eb2a-c105-4534-ab38-ab6ea23fbdbf` (SUCCESS), command `npm run worker`.
- API physical database ID: `7691050600059834430`.
- Worker physical database ID: `7691050600059834430`. MATCH: YES.
- Expected physical ID enforced before startup. Heartbeat records actual database ID.
- Observed heartbeat HEALTHY, jobsPaused=true, production environment and revision; process started without logged restart loop.
- PRODUCTION_AUTOMATIONS_ENABLED=false; all nine automation definitions disabled.
- PRODUCTION_EMAIL_ENABLED=false; qualification recipient allowlist prepared for olawandeadams@gmail.com and info@thelolabooth.com; exact job selector empty.
- Worker has no shared access to the API's local file volume. Attachment delivery from worker requires qualification; do not assume this is supported by the new service.
- No staging or public website deployment performed in this activation segment.

## Provider state and owner decisions

- Outlook Web authenticated as The Lola Booth; Entra authenticated in tenant `90f8e551-dcbf-4385-9c68-6776a65a5d2a`.
- Owner confirmed newly created app “The Lola Booth”, client ID `b92a32a6-35d5-4bbe-b451-48902decf188`, is the production app. Do not substitute the staging application.
- Mail.Send application permission and dedicated production client secret remain unverified/unconfigured. Latest UI showed only delegated User.Read/openid. No admin consent granted by the agent.
- Owner asked to create the secret and enter it directly into production Railway, not chat.
- Stripe TEST dashboard authenticated; production key/webhook are not configured. Do not reuse staging key. Pending owner choice: dedicated sandbox with sk_test or dedicated restricted TEST key requiring code validation support.
- Webhook route: `https://api.thelolabooth.com/api/webhooks/stripe`.
- Source handles checkout.session.completed, checkout.session.async_payment_succeeded, payment_intent.succeeded, payment_intent.payment_failed, charge.refunded.
- Raw body mounted before JSON parsing; timestamp tolerance 300 seconds; HMAC timing-safe comparison; event livemode must be false. Hosted behavior remains unqualified.

## Backup/restore constraints

- Earlier CLI inspection: Postgres PITR disabled, archive bucket not wired, snapshot list empty, schedule list empty. Reverify after any owner changes.
- Managed backup request failed OAUTH_INSUFFICIENT_GRANT. No backup was created by this request.
- Owner explicitly requires Railway managed restore only. Do not export backups locally, create a temporary database login, copy production database credentials to a restore target, or perform an alternative logical restore.
- Automatic approval review rejected local dump export and a separate-target proposal that would expose the full-access production DB credential. Both were blocked before execution; no dump or restore target was created.
- Production API volume remains separate, mounted /app/storage/uploads, 5 GB. Actual volume backup retention and restore capability are not yet verified.
- System Health is DEGRADED due to unverified storage durability; API, database, environment, worker, communications and backlog healthy. Email intentionally DISABLED; Stripe and PayPal disconnected; optional providers do not determine core aggregate failure.
- Temporary Railway SSH key lola-production-core-temporary was registered for identity checks and successfully removed afterward.

## Qualification matrix

| AREA | STATUS | EVIDENCE | ACTION |
|---|---|---|---|
| Production worker | PASS | Dedicated service deployed at 8da5658; production physical DB guard matches API | Keep paused |
| Worker heartbeat | PASS | HEALTHY; jobsPaused=true; actual production DB ID and revision recorded | Continue monitoring during scheduled test |
| Scheduled email | BLOCKED | Email disabled, no selected job IDs | Configure dedicated Microsoft adapter, then permit one exact job |
| Worker restart | BLOCKED | No completed scheduled QA message yet | Complete one message then restart and compare records |
| Microsoft adapter | BLOCKED | Production app identified; no verified Mail.Send consent/secret | Complete dedicated provider configuration |
| Inbox receipt | BLOCKED | Outlook session available; no production QA mail sent | Verify every controlled delivery in actual inbox |
| Inbound email | BLOCKED | No new Gmail inbound test sent | Send one approved Gmail test and verify Outlook + trace |
| Message Trace | BLOCKED | No production test message trace collected | Verify at least one production delivery and inbound trace |
| Contact form email | BLOCKED | Production email disabled | Submit one marked QA form and verify owner + single acknowledgment |
| Booking form email | BLOCKED | Production email disabled | Same controlled test and deduplication check |
| Proposal email | BLOCKED | No QA send executed | Send once after provider configuration |
| Invoice email | BLOCKED | No QA send executed | Send once and verify stable public CTA |
| Generic email | BLOCKED | No QA send executed | Use exact scheduled QA job |
| Stripe config | BLOCKED | Dedicated production TEST key/webhook absent | Resolve key isolation choice and configure backend |
| Payment page | DEFERRED | No new production QA invoice created in this activation | Verify lookup and direct token flow |
| QR | DEFERRED | No new QA invoice QR | Decode production destination |
| Hosted success | BLOCKED | No Checkout executed | Official TEST method only |
| Webhook | PASS WITH WARNING | Source verification + unit suite; no hosted event | Configure exact production endpoint and test delivery |
| Replay | BLOCKED | No successful event exists | Sequential and concurrent replay with counts |
| Decline | BLOCKED | Provider unconfigured | Official TEST decline |
| Cancel | BLOCKED | Provider unconfigured | Cancel hosted session and verify unpaid state |
| Receipt | BLOCKED | No QA payment | Verify exactly one branded secure receipt |
| Reconciliation | BLOCKED | No QA payment | Check list/detail/public/pay/receipt values |
| Payment confirmation | BLOCKED | No QA payment or email | Verify one controlled receipt acknowledgment |
| Postgres backup | BLOCKED | PITR off; no listed snapshots/schedules; create denied by OAuth grant | Owner restores Railway managed backup permission |
| Restore drill | BLOCKED | Owner requires managed Railway restore only | Restore to separate non-production target, never over production |
| Storage backup | BLOCKED | Writable separate volume; backup retention unverified | Verify managed volume backup configuration |
| Storage recovery | BLOCKED | No provider restore performed | Restore synthetic file in separate temporary context and checksum |
| System Health | PASS WITH WARNING | API/DB/worker healthy, storage honestly DEGRADED | Resolve backup/restore before qualification |
| Tests | PASS | 228/228 full suite; 52/52 targeted suite | Re-run after further code changes |
| Build | PASS WITH WARNING | Vite build passes; existing >500 kB chunk advisory | No build blocker |
| Diff check | PASS | git diff --check passes | Repeat after further edits |

## Automation inventory

All are currently disabled and use SEND_EMAIL_TEMPLATE:

| AUTOMATION | ENABLED? | CHANNEL | SAFE TO ENABLE? |
|---|---|---|---|
| New Website Inquiry Acknowledgement | No | EMAIL | Not until direct-form acknowledgment duplication is excluded |
| New Social Lead Acknowledgement | No | EMAIL | Requires owner approval and recipient qualification |
| Proposal Reminder - 2 Days | No | EMAIL | After successful provider/template qualification and owner approval |
| Proposal Expiring - 1 Day Before | No | EMAIL | Same |
| Deposit Reminder | No | EMAIL | After payment reconciliation and owner approval |
| Balance Reminder - 7 Days | No | EMAIL | Same |
| Balance Reminder - 3 Days | No | EMAIL | Same |
| Event Reminder - 7 Days | No | EMAIL | After template/provider qualification and owner approval |
| Review Request - 2 Days After Completion | No | EMAIL | Keep disabled; not part of this transactional activation |

## QA data and evidence

No new QA leads, clients, events, proposals, invoices, payments, receipts, outbound communications or customer files were created in this segment. Worker heartbeat and System Health snapshots are operational evidence. Retain existing payment/audit evidence from prior work; do not delete blindly.

Evidence directory: `audit-output/production-core/` (ignored). Important files: deployment-status.json, api-health.json, api-db-heartbeat.json, worker-db-heartbeat.json, worker-logs.json, system-health.json, postgres-backup-created.json, volume-list.json, temporary-ssh-key-removed.txt, tests-latest.log, tests-targeted.log, build-latest.log.

Current verdict: **PRODUCTION CORE ACTIVATION BLOCKED**.

PRODUCTION EMAIL: DISABLED

PRODUCTION WORKER: PAUSED (process running, heartbeat healthy)

STRIPE: TEST BLOCKED

LIVE STRIPE: NOT AUTHORIZED

BACKUP/RESTORE: BLOCKED

SMS: DISABLED

MARKETING INTEGRATIONS: DISABLED


## Storage readiness recommendation

Keep the Railway volume for documents and small operational uploads only after its managed backup retention and separate-target restore have been demonstrated. This includes proposal PDFs, invoice PDFs, receipts, CMS media, uploaded proposals and run sheets. A writable mount alone does not prove recovery after deletion/corruption; current recovery remains unqualified. Reference: [Railway volumes](https://docs.railway.com/volumes/reference).

For future high-volume LOLA Gallery, plan object storage with private buckets, signed delivery URLs, environment-specific credentials, lifecycle rules and a tested recovery policy. S3 versioning can preserve prior object versions after overwrite/deletion; explicitly enable and test it. [S3 versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html). R2 is another candidate for large unstructured media and bucket-scoped access; assess its retention/recovery features independently instead of assuming feature parity. [R2 documentation](https://developers.cloudflare.com/r2/). No storage migration was performed or authorized during this activation.
