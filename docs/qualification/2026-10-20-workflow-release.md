# Agreement-first lifecycle release — staging qualification passed; production rollout pending

Scope: promote the complete tested staging state, including pending V1.2 work. Staging qualification passed. Production deployment and smoke results will be appended after rollout.

## Existing staging work preserved

Baseline staging: `33fe471872fc4aa512fc6f223327b2644a978ffb`. Baseline production: `08acbdf44e13bb1e759a3d4a30457b759eae7332`.

The two-tree comparison has 59 changed files: private Admin Event Files, explicit client file sharing, Fiesta CSV-to-private-session mapping, event galleries with package-based retention, authenticated gallery downloads, read-only Dropbox ingestion guards, and environment-specific owned-domain gallery routing. Existing proposal review, Stripe Tax, Contacts and integrations redesign behavior is retained. Their commits appear in staging ancestry but much of that work is already equivalent in production; the promotion review must use tree differences as well as commit ancestry.

Actual production ledger review confirms pending migrations 059, 063, 066, 067 and new 068. Dropbox ingestion remains off until a populated Fiesta export folder is available; no automatic export qualification is claimed.

## Changes for this request

- Derive the existing client/event tracker from accepted proposals, version-linked invoices, current issued/signed agreements, net successful service payments and workspace grants. One seven-step presentation; no new persisted lifecycle status.
- Convert accepted leads idempotently to clients, preserving related records. Resolve stage tasks and record system explanations.
- Issue the agreement from an accepted unpaid invoice. Enforce its signature at all first-payment entry points, including manual Admin recording and event-linked add-on invoices. Opening the payment CTA leads to the agreement; signing opens the existing payment page.
- Preserve signed/issued historical document bytes. New agreements use terms version 2026-10-20 with the newly approved order and installment rules.
- First payment minimum 30%, later custom installments before the deadline, full remaining balance on/after the deadline. Owner approved full balance only in the last 30 minutes because Stripe requires at least 30 minutes for a newly created Checkout. Earlier partial Checkout sessions expire at the balance deadline.
- Retire obsolete Checkout sessions only after Stripe verifies expiry. A completed or uncertain provider session remains pending for reconciliation; a deduplicated Admin task records the need for review. New/replacement agreement issuance closes earlier pending Checkout sessions before taking effect.
- Task assignment follows current ownership or the audited lead creator. Reassign open generated tasks, preserve assignment history, require manual resolution notes and retain automatic closure explanations. Fix PATCH defaults that could reopen a task during an unrelated edit.
- Task notification ledger and current-assignment dispatch checks use existing communications workers. Assignment and daily reminders are opt-in, with a fresh activation cutoff and stop conditions. No historical notification backfill.
- Patch existing sanitize-html and Vite security advisories within their current major versions. Production dependency audit reports zero findings.

## Database, configuration and API

New additive migration: `068_agreement_first_lifecycle_tasks.sql`. Adds task assignment metadata and notification ledger, task auditing/ownership triggers, accepted-proposal conversion and agreement/payment tasks. Revises the existing confirmation guard so an unissued draft does not invalidate a signed agreement. No signed document or posted payment is rewritten or deleted.

New variables: `TASK_NOTIFICATIONS_ENABLED` (default false), `TASK_NOTIFICATIONS_SINCE` (required activation cutoff). Worker needs same environment Stripe account/key configuration as its API to expire obsolete hosted Checkout sessions. Existing handoff flags, email policies, worker pauses, gallery flags and environment isolation remain enforced.

Payment options add `agreementRequired`, `agreementUrl`, `dueAt` and deadline-window policy. Unsigned booking payment-session requests return 409; invalid installment values return 422. Task closing without a fresh note returns 422. Existing webhook endpoints/signature handling and Stripe API version remain unchanged. Tax comes from Stripe and is excluded from the service-principal payment percentage.

The payment sequence and acceptance-to-client classification are intentional behavior changes. Deploy API/migration before activating the new worker behavior and deploy the matching Admin/customer frontend. Never replace production configuration with staging values.

## Qualification evidence

- Full local suite with all disposable PostgreSQL suites enabled: **723 tests, 720 passed, zero failed, 3 conditional browser skips**. CI run **39515655747** passed the full test/database/browser/build and backup-fault jobs. Provider responses inside database tests are simulated.
- Local authenticated desktop/mobile V1.1 + Contacts browser journey passed; preserved V1.2 Event Files, Fiesta private-gallery isolation, integrations marketplace and proposal-review browser matrix **4/4 passed**.
- Production-config build passed. CSP/gallery production-domain checks **13 passed**. Production dependency audit: **zero vulnerabilities**. Backup-transfer fault tests: **11 passed**.
- Final staging encrypted snapshot and isolated restore verified **146 tables**; migration 068 rehearsal passed at **2026-10-20 23:30 UTC**, including historical task ownership repair.
- Production encrypted Azure snapshot at **2026-10-20 23:36 UTC**: **60,709,874 bytes, 143 tables**, bounded upload and three-object readback verified. Downloaded the encrypted Azure object, authenticated RSA/AES decryption with the offline recovery key, restored into an isolated disposable local database, verified all 143 table counts and applied **059, 063, 066, 067, 068** successfully. Temporary plaintext and restored database were removed. Production source data was not modified. Daily backup helper restored to its normal schedule/command.
- Hosted staging **TLBP-1024 / TLBI-1030**: availability prepared an unsent draft; explicit Admin send; authorized QA acceptance converted/linked the returning client without duplication; real workers sent invoice and agreement before any payment. Direct unsigned API payment returned **409**, exposed no providers and created no attempt. Browser payment CTA opened agreement; required consent and authorized QA signing succeeded, then returned to the existing payment page.
- Hosted Sandbox payments: first amount below 30% blocked; insufficient-funds test declined, then successful retry **$209.70 (30%)**, later **$139.80 (50% cumulative)**, final **$349.50 (100%)**. Actual Stripe webhooks reconciled invoice totals, receipts, confirmed booking and Workspace invitation. Returning payments did not re-sign. The client tracker showed **Paid**, **50% Paid** and the final paid state; completed invoice has no enabled payment CTA. Stripe calculated tax separately; this services classification returned $0 tax for the test billing location. Positive-tax/discount/refund/replay and deadline boundaries remain covered by the full database suite and prior tax qualification.
- Actual staging assignment and daily reminder emails were accepted by Microsoft and **owner confirmed both arrived/readable**, along with TLBI-1030 receipts. The reminder rehearsal aged only the named QA task temporarily and scoped selection to that task; no historical tasks were notified and its original assignment timestamp was restored. Manual task completion without a note remained open; supplying a resolution note completed it. Closed-task reminder stop is verified separately.
- Staging application commit: **a75111104f9913da73dd0b9043e17196938ed867**. API, worker and Admin frontend match. Staging task notifications activated only after migration using cutoff **2026-10-20T23:48:21.776524+00:00**. Worker has verified test Stripe credentials for Checkout retirement.
- Public production website compatibility is PR **rodaine-web/The-Lola-Booth-Website#11**, source **2cd9394**: exact staged payment viewer, existing markup/design/config preserved; **17/17 website tests passed**. This separate repository port is required because production `www` serves its own payment page; the Admin staging implementation alone cannot update it. No unrelated website pages were promoted.

Production remains unclaimed until deployment and smoke checks below are recorded. No production charge is authorized or created by qualification.

## Rollback

Pause new dispatch and task notifications first. Preserve invoices, payments, signed agreements, audit history, grants and migration history. Do not undo additive migrations by dropping customer records. Reconcile uncertain provider sends/payments before retrying. Reverting to a payment-first application build would undo the approved signature prerequisite; use a reviewed forward fix or keep affected payment dispatch paused instead of silently reopening that path.

## Production ancestry merge

The production backup branch was merged normally, retaining its ancestry and three backup-source files plus the CI fault-test step. Shared application conflicts were inspected: the incoming copies represented the already deployed older payment-first behavior and placeholder file/gallery UI. The current staging versions preserve all production-equivalent proposal/tax/CRM fixes and the newly tested lifecycle and V1.2 implementation. No staging functionality was removed. The combined tree is requalified before deployment.

Historical queue inspection: staging has no pending handoff jobs or scheduled email; production has no pending handoff jobs or scheduled email. Task notification activation will use a fresh post-migration cutoff. Read-only Stripe verification found three expired staging Checkouts and one open unpaid production Checkout; inspect/retire the obsolete production session before activating the new journey. Both Stripe account identities match their environment, and production charges are enabled; no charges were created for this check.

## Full promotion review

Production hosting differences retained: `vercel.json` permits `api.thelolabooth.com` and routes the owned gallery host to `gallery.thelolabooth.com`. All application code matches tested staging. New task notification flags will use a post-migration production cutoff; existing booking/email/reminder flags remain unchanged. Dropbox synchronization stays disabled. No webhook path, signature algorithm or Stripe API version change.

### Staging commits absent from baseline production

```text
a751111 Merge pull request #44 from rodaine-web/codex/staging-lifecycle-agreement-first
ab39790 Wait for API workflow migration before worker dispatch
80508ac Repair audited open-task ownership and prepare isolated production rehearsal
e433f86 Merge production backup recovery while preserving complete staging workflow
ac2fdc0 Enforce agreement-first bookings and derive lifecycle from persisted events
91d42d4 Fix production backup uploads with bounded block retries
33fe471 Merge pull request #42 from rodaine-web/codex/gallery-owned-domain
7549e24 Preserve request-time environment and local browser CORS configuration
859946c Support isolated owned-domain gallery access in staging
34e0509 Merge pull request #40 from rodaine-web/codex/integrations-marketplace
7a500a2 Refresh management state and surface inbound history failures
14128e3 Label discovery source selector explicitly for accessible interaction
3f4386f Search human-readable integration category labels
4e02382 Refine desktop discovery columns to match approved layout
7b9d8b9 Redesign integrations as a state-aware marketplace
79b698b Merge pull request #39 from rodaine-web/codex/v12-dropbox-ingestion
3da168c Add guarded read-only Dropbox ingestion for draft Fiesta galleries
16dffd5 Merge pull request #38 from rodaine-web/codex/v12-gallery-qualification
54b039d Count gallery media activity once after verified storage read
859e213 Merge pull request #37 from rodaine-web/codex/proposal-availability-stage
7164498 Qualify draft-only availability copy and customer-facing review email
f213dc5 Prepare availability-approved proposals for Admin review instead of automatic delivery
2a7ded9 Merge pull request #35 from rodaine-web/codex/v1.2-fiesta-gallery-20261014
539cfb9 Bind Fiesta personal delivery to its imported recipient
f011575 Cast package retention consistently in PostgreSQL publication update
e91c553 Separate invitation and personal-gallery token fixtures
61f98fb Qualify cookie-authenticated gallery downloads, ZIP and access expiry
382d884 Correct browser evidence workflow configuration
737b787 Use authenticated customer gallery routes and preserve download filenames
37a9493 Add Fiesta CSV guest mapping and package-limited workspace galleries
f0c58d0 Merge pull request #34 from rodaine-web/codex/stripe-tax-public-projection
569f0aa Expose collected Stripe tax through safe public invoice projection
8e381d7 Merge pull request #33 from rodaine-web/codex/stripe-tax-payment-page
0400f7e Use business date for expired-proposal database fixture
8deb22b Clarify service principal and collected Stripe tax on website payment page
ffc5a0d Merge pull request #32 from rodaine-web/codex/stripe-tax-staging-20261014
eec5f75 Add explicit Stripe Tax checkout and principal-safe webhook reconciliation
0b96996 Merge pull request #31 from rodaine-web/codex/proposal-review-stage-20261014
7a69772 Limit browser API fixture interception to API endpoints
408e755 Enforce copy-only proposal permissions in public decision routes
0a1d3ab Qualify review routing with isolated browser configuration
0a2f0c1 Fix proposal revisions and explicit final review with safe recipient delivery
6c7215c Require matching customer binding for shared event files
765593a Require matching event customer before file sharing
a511b60 Qualify V1.2 customer event-file access on staging
957c05c Add explicit customer event-file sharing and secure workspace downloads
9f6185a Qualify CRM sales lifecycle and honest campaign tracking on staging
ccadc0f Clarify lost-sales next actions and unavailable historical tracking
fa5d537 Preserve prospect classification across Contacts and qualify the manual API path
6b7b4d8 Keep manual proposal customers provisional and close Tentative lost events
2597e08 Qualify CRM lifecycle consistency in staging
7b80df6 Scope task editor browser assertions to the active dialog
e89dee7 Supply required booking facts in the lost-lead regression fixture
36d5334 Exercise browser navigation headers using real HTTP rather than fetch override
b341fb0 Verify task editor persistence and distinguish scanner evidence in API regression
71f98d6 Stage synchronized CRM lifecycle and campaign tracking while preserving V1.2
aa1693a Stage CRM Contacts alongside existing V1.2 Event Files
5cb94d0 Isolate Contacts provider recovery checks from other lifecycle jobs
9a2f247 Separate Contacts OAuth configuration from transactional Microsoft email
9ab603f Verify durable Graph throttling, revoked authorization and token refresh recovery
b00ba2a Preserve calendar dates in contact records and qualify contact-to-lead workflow
d7f0a02 Expose discovery permissions and evidence; verify HTTP contact access boundaries
661f4cd Qualify Microsoft discovery fixes with existing staging Event Files
05b0543 Preserve the already-qualified staging Event Files mobile stylesheet
bd8e2ac Validate isolated staging CSP against the staging API origin
fad09eb Stage qualified Contacts while retaining the Event Files release
710dde7 Combine CRM Contacts with existing staging-only Event Files for qualification
4236694 Stage V1.2 private Event Files for deployed qualification
3c33e5f Preserve committed file bytes after uncertain transaction acknowledgement
dd30807 Reject filenames incompatible with private storage keys
d30afb0 Keep private event files table within the mobile page
4ce545c Update staging qualification with accessible file controls
b290627 Qualify file upload through the allowed disposable browser origin
745b34d Name required private file selectors explicitly
4cf4427 Use staging API origin for V1.2 Event Files qualification
7b5b0d3 Give private file input an explicit accessible name
5cba113 V1.2: implement private Event Files upload and download
```

### Files in the complete promotion

```text
.env.example
.github/workflows/staging-validation.yml
docs/V12_DROPBOX_INGESTION_RUNBOOK.md
docs/V12_GALLERY_DOMAIN_QUALIFICATION.md
docs/qualification/2026-10-20-workflow-release.md
ops/backups/README.md
ops/backups/daily-production-backup.py
ops/backups/production-workflow-rehearsal.py
ops/backups/staging-workflow-rehearsal.py
ops/backups/test_backup_transfer.py
ops/qualification/workflow-preflight.mjs
package-lock.json
package.json
public/staging-site/pay.html
public/staging-site/payment-viewer.js
server/migrations/059_private_event_files.sql
server/migrations/063_customer_event_files.sql
server/migrations/066_fiesta_gallery_delivery.sql
server/migrations/067_dropbox_gallery_sources.sql
server/migrations/068_agreement_first_lifecycle_tasks.sql
server/src/index.js
server/src/middleware/environment-cors.js
server/src/routes/admin.js
server/src/routes/client-session.js
server/src/routes/event-files.js
server/src/routes/gallery.js
server/src/services/azure-blob-storage.js
server/src/services/booking-agreement-handoff-service.js
server/src/services/booking-invoice-handoff-service.js
server/src/services/booking-payment-exceptions.js
server/src/services/booking-payment-gate.js
server/src/services/checkout-lifecycle-service.js
server/src/services/client-session-service.js
server/src/services/communication-dispatch-policy.js
server/src/services/contract-delivery-service.js
server/src/services/contract-service.js
server/src/services/customer-event-files-service.js
server/src/services/customer-gallery-service.js
server/src/services/dropbox-gallery-adapter.js
server/src/services/dropbox-gallery-connection.js
server/src/services/dropbox-gallery-permissions.js
server/src/services/dropbox-gallery-service.js
server/src/services/event-files-service.js
server/src/services/fiesta-gallery-service.js
server/src/services/gallery-media-delivery.js
server/src/services/gallery-policy.js
server/src/services/invoice-service.js
server/src/services/payment-reconciliation-service.js
server/src/services/payment-service.js
server/src/services/private-gallery-service.js
server/src/services/proposal-acceptance-service.js
server/src/services/record-journey-service.js
server/src/services/storage-service.js
server/src/services/task-notification-service.js
server/src/worker.js
shared/booking-agreement-terms.js
shared/booking-lifecycle.js
shared/booking-payment-policy.js
shared/environment-isolation.js
shared/event-files.js
shared/fiesta-gallery.js
src/App.jsx
src/components/CustomerEventFiles.jsx
src/components/CustomerGallery.jsx
src/components/DropboxGalleryImport.jsx
src/components/EventFilesPanel.jsx
src/components/FiestaGalleryImport.jsx
src/components/GalleryOverview.jsx
src/components/GalleryThumbnail.jsx
src/components/RecordDashboard.jsx
src/pages/ClientDetail.jsx
src/pages/EventDetail.jsx
src/pages/GalleryAdmin.jsx
src/pages/PublicContract.jsx
src/pages/PublicGallery.jsx
src/pages/PublicInvoice.jsx
src/pages/ResourcePage.jsx
src/pages/SecureClientWorkspace.jsx
src/styles/client-workspace.css
src/styles/event-files.css
src/styles/experience.css
src/utils/booking-overview.js
test/agreement-first-workflow-db.test.js
test/booking-invoice-db.test.js
test/booking-overview.test.js
test/booking-payment-policy.test.js
test/dropbox-gallery-adapter.test.js
test/dropbox-gallery-db.test.js
test/event-files-db.test.js
test/event-files.test.js
test/fiesta-gallery-browser.test.js
test/fiesta-gallery-db.test.js
test/fiesta-gallery.test.js
test/gallery-database.test.js
test/gallery-domain.test.js
test/stripe-csp-production-sprint.test.js
test/stripe-tax-db.test.js
test/support/campaign-sales-journey.js
test/support/crm-contacts-browser.js
test/support/event-files-browser.js
test/support/v11-client-browser.js
test/v11-http-db.test.js
vercel.json
```
