# LOLA Admin Phase 14 Production UAT

## A. Executive Summary

Phase 14 asked one operating question: can the owner run a real photobooth booking from first website inquiry through completed event and post-event follow-up without developer intervention?

Codebase certification status: **GO WITH CONDITIONS**.

The core LOLA Admin workflows are implemented and covered by the automated suite. The local certification evidence is:

- `npm test`: PASS, 127/127 tests
- `npm run build`: PASS
- Phase 13C communication hardening: PASS
- SMS live sending: NO-GO until a real provider adapter, credentials, and consent capture are configured

Status key: PASS, FAIL, MANUAL VERIFICATION REQUIRED, NOT APPLICABLE, GO WITH CONDITIONS, NO-GO.

Production release remains conditional because this local workspace cannot verify the deployed frontend, deployed API, deployed PostgreSQL, deployed worker, live DNS/SSL, live file/media access, or provider webhooks without access to the production environment.

## B. Environment Status

| Component | Status | Configured? | Production verified? | Blocker | Action |
| --- | --- | --- | --- | --- | --- |
| Frontend deployment | MANUAL VERIFICATION REQUIRED | Build passes locally | No | Deployed URL not verified in this workspace | Open production URL, verify login and public routes |
| API deployment | MANUAL VERIFICATION REQUIRED | `/api/health` exists | No | Deployed API not queried | Check production health endpoint and logs |
| PostgreSQL | MANUAL VERIFICATION REQUIRED | `DATABASE_URL` required | No | Production database not connected here | Confirm migrations 001-019 applied |
| Worker deployment | MANUAL VERIFICATION REQUIRED | Worker entrypoint exists | No | Independent deployed worker not observed | Run worker as durable process and verify heartbeat |
| Environment variables | MANUAL VERIFICATION REQUIRED | Inventory exists in `env.js` and `.env.example` | No | Production env values unavailable | Verify without exposing secrets |
| Email provider | MANUAL VERIFICATION REQUIRED | Microsoft adapter covered by tests | No | Production Graph credentials not verified | Send controlled provider test email |
| Payment provider | MANUAL VERIFICATION REQUIRED | Stripe test/sandbox paths covered | No | Live/sandbox webhook not executed here | Complete sandbox payment and webhook replay |
| Public URLs | MANUAL VERIFICATION REQUIRED | `PUBLIC_BASE_URL` and `PUBLIC_APP_URL` supported | No | Production URLs not opened | Verify HTTPS proposal, invoice, approval, gallery links |
| CORS | MANUAL VERIFICATION REQUIRED | Origin allowlist exists | No | Production origins not tested | Submit public inquiry from production domain |
| SSL | MANUAL VERIFICATION REQUIRED | HTTPS required for production base URL | No | Certificate not inspected | Verify valid HTTPS certs |
| File/media access | MANUAL VERIFICATION REQUIRED | Storage-backed document/media flows exist | No | Production storage path/provider not verified | Open generated PDFs and uploaded media from production |
| Scheduled jobs | MANUAL VERIFICATION REQUIRED | Worker processor covered locally | No | Deployed scheduler not observed | Schedule test communication and watch worker process it |
| System Health | MANUAL VERIFICATION REQUIRED | Health checks include worker, SMS, communications, fallback | No | Production health snapshot unavailable | Review admin System Health after UAT |

## C. End-to-End UAT Results

| Workflow | Result | Evidence | Production note |
| --- | --- | --- | --- |
| Website inquiry to lead | MANUAL VERIFICATION REQUIRED | Public inquiry persistence and email helper tests pass | Must submit from production website |
| Lead to client/event | PASS | Duplicate review and conversion coverage exists | Confirm with a test lead in production |
| Proposal creation and send | PASS | Template rendering, PDF generation, public proposal routes, and `SENT_TO_PROVIDER` status covered | Provider send acceptance must be verified |
| Public proposal acceptance | PASS | Secure public proposal acceptance routes exist | Double-accept UAT required in production |
| Invoice creation and delivery | PASS | Invoice templates, PDF generation, public invoice routes, payment link handling covered | Provider handoff must be verified |
| Deposit payment | MANUAL VERIFICATION REQUIRED | Stripe checkout/webhook tests pass | Must complete sandbox payment against deployed webhook |
| Booking confirmation | MANUAL VERIFICATION REQUIRED | Payment reconciliation and automation framework exist | Confirm actual business state after sandbox deposit |
| Creative approval | PASS | Versioned snapshots, public token responses, request-change, and approval routes covered | Visual proof opening should be smoke-tested |
| Event preparation | PASS | Staff/equipment/run sheet/brief/checklist workflows covered | Staff brief provider send needs production email check |
| Event-day operations | PASS | Attendant workflows, QR labels, offline replay, incidents covered | Real device camera/offline testing still required |
| Gallery delivery | PASS | Secure delivery token, gallery email template, viewed/revoked/archive states covered | Public delivery URL should be opened in production |
| Post-event automation | PASS | Stop conditions and scheduled communications covered | Confirm no stale reminders after event completion |
| Communication Center | PASS | Template edit/preview/draft/schedule/cancel/retry UI and routes covered | Worker-processed scheduled send requires production worker UAT |
| Automation review | MANUAL VERIFICATION REQUIRED | Automation engine and stop conditions covered | Owner must review enabled production automation records |
| RBAC | PASS | Permission checks and role-gated UI coverage exist | Spot-check real production roles |
| Failure scenarios | PASS/MANUAL VERIFICATION REQUIRED | Invalid tokens, duplicate webhooks, stale jobs, missing provider config covered | Provider outages and storage failures require controlled production/sandbox tests |

## D. Worker Certification

Local/code certification: **PASS**.

Production worker certification: **MANUAL VERIFICATION REQUIRED**.

Confirmed in code and tests:

- Worker starts from `server/src/worker.js`.
- Worker heartbeats are recorded.
- Scheduled communications are processed automatically.
- Due communication claiming uses `FOR UPDATE SKIP LOCKED`.
- Stale scheduled communications in `PROCESSING` recover back to `SCHEDULED`.
- Processing success/failure metadata is recorded.
- Duplicate send protection prevents already-sent communication rows from being sent again.

Required production certification:

- Confirm the worker is deployed independently of the web/API process where the host requires it.
- Confirm heartbeat age remains healthy in System Health.
- Schedule a test communication and watch the deployed worker process it.
- Restart the worker and verify no duplicate send occurs.
- Create a controlled failed job and verify admin visibility plus retry behavior.

## E. Website Inquiry Results

Status: **MANUAL VERIFICATION REQUIRED** for production, **PASS** for covered local behavior.

Expected production UAT:

- Submit a public inquiry with a unique email such as `lola.uat+phase14@example.com`.
- Include UTM values for source, medium, campaign, content, and term.
- Confirm one lead is created.
- Confirm source attribution and UTM fields are preserved.
- Confirm client and event fields are correct.
- Confirm timeline entry exists.
- Confirm acknowledgement communication is created.
- Confirm owner notification is created and sent to provider.
- Submit the same form again and confirm duplicate behavior is safe.

## F. Proposal Results

Status: **PASS**, with provider handoff requiring production confirmation.

Validated expectations:

- Custom Brand Activation Proposal is represented in the template system.
- Per-proposal editing is supported without changing master templates.
- Proposal PDF generation exists.
- Secure public token proposal route exists.
- Proposal email renders from active template and falls back with a tracked fallback event only when needed.
- Communication status is `SENT_TO_PROVIDER`, not `DELIVERED`.

Production UAT still required:

- Generate the proposal PDF and visually inspect branding, totals, terms, event details, and public URL.
- Confirm DOCX only if the currently supported document export includes it.
- Accept once, then try accepting again and verify no duplicate downstream actions.

## G. Invoice Results

Status: **PASS**, with payment-provider UAT still required.

Validated expectations:

- Invoice creation can reference client, event, and proposal.
- Line items, subtotal, discount, tax, deposit, total, balance, and due date are modeled.
- Invoice PDF generation exists.
- Public invoice route and secure payment entry point exist.
- Invoice email renders from active template.
- Communication and email records use `SENT_TO_PROVIDER`.

Required production UAT:

- Verify a 30% deposit using actual invoice values.
- Verify QR/payment link if enabled in the generated PDF.
- Confirm fallback is not used under normal template configuration.

## H. Payment Results

Status: **MANUAL VERIFICATION REQUIRED** for provider callback, **PASS** for code coverage.

Covered locally:

- Stripe hosted checkout is server-side.
- Payment sessions are scoped to trusted invoice amounts.
- Webhook raw body is preserved for signature verification.
- Success, failure, refund, and duplicate webhook handling are tested.
- Idempotency protects against duplicate payments.

Required sandbox UAT:

- Complete a deposit payment through the configured test/sandbox provider.
- Confirm webhook receipt.
- Confirm payment record, invoice amount paid, balance, receipt, booking status, event status, timeline, audit, and payment confirmation communication.
- Replay the webhook and verify no duplicate payment or duplicate communication.

## I. Creative Approval Results

Status: **PASS**, with visual smoke required in production.

Validated expectations:

- Approval requests use secure public tokens.
- Versions preserve immutable snapshots.
- Customer change requests and approvals are recorded with identity and timestamp.
- Revised approval versions can be sent.
- Communications and timeline activity are integrated.

Required production UAT:

- Open version 1 as the customer and request changes.
- Create version 2 as admin and send it.
- Approve version 2 as the customer.
- Confirm version 1 remains immutable and version 2 is the approved snapshot.

## J. Event Ops Results

Status: **PASS**, with real-device testing still required.

Covered behavior:

- Staff assignment.
- Equipment assignment and conflict detection.
- Run sheet.
- Staff brief.
- Checklist.
- Event instructions and readiness.
- Attendant access, My Events, event detail, acknowledgement, equipment check-out/check-in, incident creation, and offline replay support.
- QR label PDF generation uses a maintained QR encoder.

Manual verification required:

- Real mobile device camera QR scanning.
- Real offline/online transition.
- File/photo upload against production storage.

## K. Gallery Results

Status: **PASS**, with production URL smoke required.

Validated expectations:

- Secure delivery token exists.
- Gallery delivery email template exists.
- Public delivery experience exists.
- Viewed status, revocation, archive, and expiration reminder states are represented.
- Client/event timeline integration exists.

Production UAT:

- Publish a test gallery.
- Open the secure delivery link.
- Confirm viewed status.
- Revoke and confirm access is blocked.
- Archive and verify reminders stop.

## L. Communication Results

Status: **PASS** for email/template/scheduled readiness, **NO-GO** for SMS live sending.

Validated expectations:

- Central template rendering is used for business emails.
- Fallback events are recorded.
- Drafts, schedules, cancellation, retry, and historical snapshots exist.
- Scheduled communication processor is worker-backed.
- Duplicate send protection exists.
- Provider handoff status is `SENT_TO_PROVIDER`.
- SMS readiness remains disabled/not configured unless a real adapter is present.
- SMS consent guards block marketing SMS without opt-in and all SMS after opt-out.

Production UAT:

- Edit, preview, and save a template.
- Send a draft.
- Schedule and cancel a communication.
- Schedule another and allow the worker to send it.
- Create a controlled failure and retry it.
- Confirm historical communications remain immutable after template edits.

## M. Automation Results

Status: **PASS** for engine safety, **MANUAL VERIFICATION REQUIRED** for production automation records.

Validated expectations:

- Automation jobs use durable records.
- SEND_EMAIL jobs are supported.
- Unimplemented actions fail non-retryably instead of falsely succeeding.
- Stop conditions cover proposals, invoices, events, gallery state, and creative approvals.
- Worker restart recovery is covered.

Required production review:

- Review each enabled automation's trigger, conditions, actions, template, send mode, stop conditions, last run, and failure behavior.
- Disable or fix anything that could send an inappropriate message.

## N. RBAC Results

Status: **PASS**, with production role spot-check recommended.

Representative roles to test:

- Owner
- Admin
- Bookkeeper/Operations equivalent
- Staff/Attendant
- Viewer where applicable

Protected areas:

- Payments and refunds.
- Template management.
- Communication sending.
- Automation management.
- System Health.
- Root-only functions.

## O. Failure Test Results

| Scenario | Result | Notes |
| --- | --- | --- |
| Email provider unavailable | PASS/MANUAL VERIFICATION REQUIRED | Provider classification exists; production outage simulation required |
| Payment webhook duplicate | PASS | Stripe duplicate webhook coverage exists |
| Worker restart | PASS/MANUAL VERIFICATION REQUIRED | Stale recovery and duplicate protection covered; deployed restart required |
| Invalid proposal token | PASS | Public token routes exist and are covered |
| Invalid invoice token | PASS | Public token routes exist and are covered |
| Invalid approval token | PASS | Public token route exists |
| Missing template variable | PASS | Template renderer blocks unresolved unsafe variables |
| Inactive template | PASS | Fallback event tracking exists |
| Missing recipient email | PASS | Validation/error paths exist |
| Failed scheduled communication | PASS | Failed state and retry paths exist |
| Equipment conflict | PASS | Operations conflict detection covered |
| File upload failure | MANUAL VERIFICATION REQUIRED | Requires production storage/provider failure test |

## P. System Health

Status: **PASS** for implementation, **MANUAL VERIFICATION REQUIRED** for production reading.

System Health covers:

- API.
- Database.
- Worker.
- Email provider.
- SMS provider.
- Payments.
- Scheduled communications.
- Failed communications.
- Legacy template fallback.
- Creative approvals.
- Environment readiness.

Expected SMS production state today: **NO-GO / DISABLED** unless a real provider and consent capture have been configured and smoke-tested.

## Q. Document Review

Status: **MANUAL VERIFICATION REQUIRED**.

Documents to visually inspect in production UAT:

- Proposal PDF.
- Proposal DOCX if still supported.
- Invoice PDF.
- Receipt PDF.
- Run sheet PDF.
- QR label PDF.

Review criteria:

- LOLA branding.
- Vertical customer-facing logo requirements.
- Readable layout.
- No clipped content.
- Correct totals.
- Correct client/event information.
- Working public URLs and QR codes.

## R. Manual Verifications

Required before unconditional go-live:

- Deployed frontend opens over HTTPS.
- Deployed API health endpoint passes.
- Production database migrations through 019 are applied.
- Durable worker is deployed, alive, and updating heartbeat.
- Scheduled communication is processed by deployed worker.
- Production email provider accepts a controlled message.
- Stripe sandbox checkout and webhook succeed against deployed endpoint.
- Public proposal, invoice, approval, and gallery links open on mobile and desktop.
- File/media URLs work from the deployed environment.
- Real-device attendant QR and offline workflow are tested.
- Production System Health is reviewed after UAT.
- Production automation records are reviewed by the owner.
- Backups and restore procedure are confirmed.

## S. Open Risks

- Production worker remains a launch blocker until verified as a durable deployed process.
- Payment provider readiness cannot be certified until sandbox checkout and deployed webhook replay are completed.
- Email readiness cannot be certified until the production provider accepts a controlled message.
- File/media access cannot be certified until generated documents and uploaded assets are opened from production.
- Real-device event-day behavior still needs mobile camera and offline testing.
- SMS remains intentionally disabled and is not approved for live sending.

## T. Release Decision

| Area | Decision | Condition |
| --- | --- | --- |
| Core LOLA Admin | GO WITH CONDITIONS | Production deployment, database, and role smoke checks required |
| Email Communications | GO WITH CONDITIONS | Production provider acceptance test required |
| Scheduled Automations | GO WITH CONDITIONS | Durable production worker certification required |
| Payments | GO WITH CONDITIONS | Stripe sandbox checkout and webhook replay required |
| Public Proposal/Invoice | GO WITH CONDITIONS | Mobile/desktop public URL smoke required |
| Creative Approvals | GO WITH CONDITIONS | Public token visual smoke required |
| Event Operations | GO WITH CONDITIONS | Real-device QR/offline test required |
| Gallery | GO WITH CONDITIONS | Public gallery token smoke required |
| SMS | NO-GO | Real provider, credentials, consent capture, and smoke test required |

Overall decision: **GO WITH CONDITIONS**.

No code-level blocker was found by the automated certification suite. The remaining blockers are deployment and provider verification tasks that must be performed against the actual production/sandbox environment.

## Production Checklist

| Group | Status | Required before unconditional GO |
| --- | --- | --- |
| Deployment | MANUAL VERIFICATION REQUIRED | Frontend and API deployed, HTTPS active |
| Database | MANUAL VERIFICATION REQUIRED | PostgreSQL reachable, migrations 001-019 applied |
| Worker | MANUAL VERIFICATION REQUIRED | Durable worker alive, heartbeat healthy, scheduled send processed |
| Email | MANUAL VERIFICATION REQUIRED | Provider credentials verified, controlled email accepted |
| Payments | MANUAL VERIFICATION REQUIRED | Sandbox checkout, webhook, replay, refund path verified |
| Website | MANUAL VERIFICATION REQUIRED | Inquiry submits from production domain with attribution |
| Public routes | MANUAL VERIFICATION REQUIRED | Proposal, invoice, approval, gallery links smoke-tested |
| Documents | MANUAL VERIFICATION REQUIRED | PDFs visually inspected |
| Automations | MANUAL VERIFICATION REQUIRED | Enabled records reviewed and safe |
| Backups | MANUAL VERIFICATION REQUIRED | Backup and restore process confirmed |
| Security | PASS/MANUAL VERIFICATION REQUIRED | RBAC covered; production role spot-check required |
| Monitoring | MANUAL VERIFICATION REQUIRED | System Health reviewed after UAT |
| Operations | PASS/MANUAL VERIFICATION REQUIRED | Workflows covered; real-device event-day test required |
