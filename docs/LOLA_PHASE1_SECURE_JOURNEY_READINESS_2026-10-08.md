# Phase 1 secure booking journey — readiness checkpoint, October 8, 2026

Latest qualification evidence and remaining gates: [9 October checkpoint](LOLA_PHASE1_QUALIFICATION_2026-10-09.md). The dated records below remain historical.

**Production decision: NO-GO.** This checkpoint records implementation and local evidence. It does not certify customer readiness. No production changes are authorized or performed. Previous milestones and their evidence remain historical.

## Mandatory requirements

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Signed agreement → secure Client Workspace | PARTIAL | Single-use 15-minute invitations, hashed credentials, HttpOnly sessions with 30-minute idle/24-hour absolute expiry, CSRF/origin checks, returning-event selection, scoped planning/proofs/invoice/receipt/PDF actions and revocation implemented. Signing queues one dedicated handoff. Admin uses secure invitation requests. Real provider/inbox delivery, authenticated browser journey, mobile design and recovery remain unqualified. Revoked access restoration needs an explicit reviewed procedure. |
| Confirmation and planning prerequisites | PARTIAL | Database guard protects managed manual transitions; persisted handoffs/campaign invoices remain managed when flags turn off. Contract issuance/signing and public planning/creative/backdrop routes check prerequisites. Campaign payment conversion stays pending contract. Organisation-wide activation is off; all manual-entry and legacy-record journeys still require staging qualification. |
| Campaign immutable commercial linkage | PARTIAL | Interest preparation creates one versioned proposal under concurrent requests. Interest is not contractual acceptance. Accepted proposal version links invoice and agreement journey. Separate campaign deposit-email shortcut is blocked. Changed frozen offers and existing legacy invoices require review. Eight concurrent preparation requests, acceptance-before-invoice, linkage and confirmation rejection pass on disposable PostgreSQL. Full campaign customer acceptance/payment/signing journey remains unqualified. |
| Deadline, signatures, payment exceptions | PARTIAL | Five-calendar-day deadline plus seven internal grace days, escalation, Admin audited extension, typed/drawn signatures and immutable PDF implemented. Approved payment exceptions appear in generated written terms; signed amendments blocked. Contract access expiry also applies to signed bearer links; secure workspace retains scoped document access. Balance defaults to 14 days before event; arbitrary due-date overrides rejected. Real signing/PDF/mobile and written exception journey remain unqualified. |
| Reminder schedules and Admin To-dos | PARTIAL | Signature offsets 2/4/5/8/11 days, day-12 escalation, balance reminders 5/3/1 days before due, overdue escalation, existing planning/creative worker, idempotent ledger and current-state dispatch checks. Failed handoffs create review tasks; uncertain provider outcomes cannot auto-resend. Historical queues inspected, dispatch remains paused. Real schedule, stop-condition and recovery evidence outstanding. |
| Required forms → submission → Admin review → readiness | PARTIAL | Planning missing-field summary and required markers; approved detail review is persisted separately from creative status; correction notes and revision-aware notification checks; readiness requires Admin approval. Agreement and exception/extension forms mark required fields. Remaining Admin-form inventory, actual correction/resubmission and readiness browser journey outstanding. |
| Mandatory staging A–J qualification | BLOCKED | Current new code not yet deployed at this checkpoint. New authenticated browser, email/inbox, Stripe replay/refund/receipts, template delivery, role/session expiry, mobile and failure-recovery evidence is NOT RUN. Existing historic gates do not qualify this revision. |
| Scoped release report and owner approval | PARTIAL | This checkpoint states limitations and GO criteria. Final report follows qualified revision. Explicit owner approval is required before any production rollout. |

## Local verification

- Full suite with disposable local database: **627 tests; 617 passed; zero failed; 10 skipped**. Email/provider acceptance is simulated in the database test; no real Stripe payment or customer message is generated.
- Fresh schema applies all existing migrations through 055. Covers competing proposal acceptances/invoice creation; accepted-price persistence; subminimum payment; repeated reconciliation; manual confirmation rejection; agreement terms conflict; signature/deadline extension; drawn PDF; reminder cancellation; secure invitation replay, concurrent consumption, identity/origin/CSRF/expiry/revocation; provider uncertainty; refunds; campaign preparation/acceptance/invoice linkage.
- Frontend production build passed with Vite runner loader; existing chunk-size advisory remains. Syntax checks and diff whitespace checks pass. Production dependency audit reports zero vulnerabilities. No dependency or API-version changes.
- Skipped conditional suites: reservation database, contracts database, token recovery database, external hub database, paused worker owner lane database, private galleries database, public inquiry persistence database, receipt HTTP authorization, real V1.1 API journey, complete V1.1 migration suite. They are not claimed as passing.
- Private logs are under ignored `work/phase1-secure-workspace-tests.log`, `work/phase1-campaign-db-tests.log`, `work/phase1-secure-workspace-build.log`; never commit execution logs, tokens or backups.

## Staging prerequisites and migration

Confirmed staging Railway project `e2c4de11-8494-4f12-8112-5f1b696f9ae4`, environment `df5a961b-5e13-4102-a9b0-97244773b857`; PostgreSQL `railway`, system identifier `7685003242386444353`. Application migration ledger is through 054; this checkpoint does not claim 055 applied to application staging.

The earlier invoice/agreement milestone introduced no migration. **This secure-access extension requires additive migration 055** for invitation/session/revocation records, deadlines, written payment exceptions, separate Admin planning-review state and confirmation guards. It was rehearsed only on the verified restored copy. Do not deploy schema-dependent API code before 055 applies successfully on the confirmed staging target.

Fresh custom archive size **15,642,497 bytes**, SHA-256 `d26d4ae8fb07f1d16d735570d38ab58058c8c20edd0fc01a93306e4d20c21266`. Encrypted backup at task `outputs/staging-backups/lola-staging-20261008-phase1secure.dump.enc`; recovery key kept separately and excluded from commits. Checksum after local encrypt/decrypt passes. Disposable restore `lola_restore_20261008_phase1secure`: 54 migration records, 135 public tables, zero unvalidated constraints; guarded 055 upgrade PASS. This is PostgreSQL backup evidence, not Azure blob backup.

API and worker currently have automation paused and new handoff/reminder flags disabled; campaign jobs and planning reminders disabled. Queue inspection found 14 completed SEND_EMAIL_TEMPLATE jobs, 10 scheduled and 4 failed communications. Existing cutoff is stale. API/worker email allowlist counts differed (3/2). Owner selected **info@thelolabooth.com** as the consistent controlled qualification inbox. No historical acceptance/job backfill is authorized.

Before deployment/activation: recheck database identity/ledger and backup freshness; audit exact queued recipients/types/times; align both runtime allowlists to owner inbox; keep outbound dispatch paused during deployment; verify API/frontend/worker exact revision and health. Apply 055 in a bounded transaction after prerequisites. Then set a new UTC cutoff and activate only the required fixture processors; verify actual provider/inbox outcomes separately. Activation itself is not delivery evidence.

## Rollback and GO criteria

Pause invoice/agreement/workspace/reminder flags and environment automation dispatch first. Preserve generated invoices, posted payments, contracts, signature records and sessions. Persisted managed-booking safeguards remain active independently of flags. Do not drop 055 or silently undo signed agreements. Roll back code only to a schema-compatible revision; database restore requires an explicit recovery decision and reconciliation of writes since backup. Failed stale delivery claims require operator/provider review.

GO requires all mandatory A–J workflows pass on one deployed revision with real normal and campaign bookings, both generated/preloaded template email delivery, test-mode payment and refund/replay/receipt evidence, no premature confirmation/planning access, working signing and secure workspace, correction/approval/readiness, reminder stop/recovery, role/access expiry and desktop/mobile design. Resolve all critical defects, document skipped conditional tests and provider dependencies, complete the scoped final report and obtain explicit owner approval. Until then **NO-GO**.

## Later staging preparation checkpoint

Owner confirmed `info@thelolabooth.com`. Both API/worker allowlists now contain only that inbox; environment automation stays paused and all four new handoff/reminder flags are explicitly false. New queue review covered 17 pending/failed/processing communications (three owner-scoped), no pending automation jobs. Historical messages are preserved.

Because source activity changed, a second backup was prepared and restored before application migration: **22,067,206 bytes**, SHA-256 `e7f39080a8ac83523835712b9c4dd76bb24edaab685c830d15900bab42bddc94`; encrypted task backup `outputs/staging-backups/lola-staging-20261008-phase1qualification.dump.enc`. Encryption roundtrip and separate restore `lola_restore_20261008_phase1qualification` PASS; guarded 055 rehearsal PASS. Migration 055 then passed on the identity-verified **staging application** database in a five-second-lock/45-second-statement transaction. No production schema changes. Code deployment and new browser/provider journeys still await qualification; this supersedes the earlier restore-only checkpoint above.

## October 9 qualification checkpoint

Combined automated suite with Phase 1 and V1.1 disposable PostgreSQL databases: **627 tests; 620 passed; zero failed; seven skipped**. The complete migration chain, contract database and V1.1 HTTP journey now pass. Campaign fixtures exercise accepted versioned proposals before invoice creation and reject the old direct-invoice shortcut. Owner and Admin roles both have the required approval controls, still subject to finance/sales permissions. Frontend production build PASS. Remaining skipped conditional suites and real provider/browser evidence are not claimed as passing. Private combined log: `work/phase1-secure-combined-tests.log`.

Staging API and worker successfully deployed revision `c956acb3a559f7a6f2809b1b0c4c90f6e7ec462f`; frontend shows the secure workspace entry page. Anonymous browser sign-in correctly rejects invitation dispatch while the workspace flag is paused. Authenticated Admin list access works. These are preliminary checks only. CI on that revision failed on obsolete conditional fixtures; fixture corrections require a fresh passing CI run. Email jobs remain paused with the owner-approved inbox scope. No production changes.

Additional conditional database checks: reservation, gallery privacy, token recovery, receipt HTTP authorization, owner-only paused lane and public-inquiry persistence passed on the dedicated local `lola_phase1_20261009_qa` database (33/34 tests initially; external-integration fixture failed on missing required lead fields). Corrected the external fixture; separate rerun **1/1 PASS**. Combined with the earlier 620/627 run, all seven previously skipped database cases have now executed successfully across the two runs. This is local evidence; real providers and hosted workflow qualification remain outstanding. Required markers/native validation now cover generic event/task/payment forms and inline client/event/proposal contact forms. Browser CI is being corrected to use accessible textbox names after required-label markup changed.

## October 9 record dashboards and run sheet release

**Production decision remains NO-GO.** This release refreshes individual Lead, Client and Event dashboards and the database-backed Event Run Sheet. It does not certify the complete Phase 1 customer journey or enable automation dispatch. No migration, dependency change or production change is included.

Local verification: **634 tests; 623 passed; zero failed; 11 skipped** with no conditional database URLs enabled in this run. The prior separate database evidence remains historical and is not substituted for current hosted qualification. Production frontend build, syntax checks and whitespace checks passed. The new run-sheet renderer tests confirm database-record content, explicit missing fields, two-page ordinary output, QR link inclusion and lossless long-note/equipment overflow. Both ordinary PDF pages and overflow output were rendered and visually inspected. The PDF preview uses synthetic data; a hosted database-backed download remains to be verified. Lead/Client/Event desktop, mobile and Night mode previews were checked using synthetic records; this does not prove hosted persistence or permissions.

Predeploy target verification: staging Railway project `e2c4de11-8494-4f12-8112-5f1b696f9ae4`, environment `df5a961b-5e13-4102-a9b0-97244773b857`. API and worker successfully run previous revision `7089a42c7aa2736c7f1f41613eb22aca48268e24`; its GitHub Staging Validation run passed. Both services report APP_ENV=staging and the staging client origin. Automation/handoff/planning/campaign flags remain false; both staging email allowlists match the approved owner inbox. Deployment success and new revision CI must be verified separately after push.

### Required before production GO

- Qualify normal and campaign acceptance → immutable proposal → invoice → minimum payment → agreement → secure Client Workspace journeys on the deployed revision. Demonstrate that manual actions cannot bypass prerequisites.
- Verify actual owner-inbox delivery of generated and preloaded templates, invoices, agreements, workspace invitations and receipts; verify real test-provider reconciliation, replay and refund behavior.
- Verify single-use invitation replay/expiry, session expiry/revocation, access boundaries, mobile signing and scoped signed-PDF/receipt access.
- Verify event-detail submission, correction/resubmission, Admin approval and accurate creative/readiness state; inventory remaining required-field forms.
- Qualify reminder scheduling, stop conditions and uncertain-delivery recovery before activating processors. Historical queues must not be backfilled or dispatched as part of this design release.
- Verify new hosted detail-page editing and run-sheet download with real staging records and permissions, plus mobile/day/night behavior.
- Resolve revoked-access restoration and any critical defects; complete mandatory A–J qualification, review skipped conditional tests and obtain explicit owner approval for production rollout.

Rollback is application-only to schema-compatible revision `7089a42`; keep workers paused and preserve invoices, payments, agreements, planning records and the additive database schema. No database restore or schema downgrade is required by these UI/PDF changes.
