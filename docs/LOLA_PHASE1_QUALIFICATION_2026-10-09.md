# Phase 1 qualification — 9 October 2026

**Production decision: NO-GO.** This checkpoint verifies database workflows and addresses two defects. Controlled Microsoft delivery and the normal booking handoffs have provider evidence; the complete hosted customer journey and remaining gates are still unqualified.

## Verified work

- Fresh staging PostgreSQL backup, separate restore and migration-ledger comparison: PASS. Encrypted local copy passed decrypt/checksum verification. Source database `railway`, system identifier `7685003242386444353`; 55 applied migrations through `055_phase1_secure_client_journey.sql`. No application migration executed. Azure blobs are outside this backup.
- Readiness now loads persisted Admin planning approval. Database regressions verify approved submissions count, requested corrections and outstanding changes remain incomplete, and approval without submission cannot count.
- Planning/creative reminder creation now respects the environment automation pause, approved staging recipient scope and fresh invitation/request cutoff. Database regressions verify historical and unapproved-recipient exclusion, duplicate prevention and completion stop conditions.
- Full automated suite with all available disposable local database flags, run sequentially: **651 passed, zero failed, zero skipped**. Covers booking holds, lifecycle, agreements, migrations, HTTP APIs, receipt access, inquiry persistence, storage and external integration database suites. Provider delivery remains simulated/development-mode; these results do not establish Microsoft inbox delivery or real Stripe behavior.
- Frontend production build and `git diff --check`: PASS.
- Hosted Client Workspace sign-in entry at 375, 390 and 768 pixels: no horizontal document overflow. Email has a required marker and blank submission leaves the required field invalid. Full authenticated workspace, planning and signing mobile journeys remain NOT RUN.

The first broader database run failed two tests because concurrent migration suites raced while installing a shared PostgreSQL extension. Sequential execution passed all tests. This is a test-harness limitation, recorded rather than omitted.

## Staging controls

API and worker retain the single approved recipient `info@thelolabooth.com`. Microsoft credential fields and Stripe test-key/webhook fields are configured; presence alone is not delivery evidence.

Read-only queue inventory: no pending/processing/failed automation jobs; **13 scheduled and four failed historical communications**, including three owner-scoped messages. Preserve and exclude this backlog. Global booking enforcement is false. Environment dispatch and booking handoff, lifecycle/planning reminder and campaign flags remain disabled at this checkpoint.

Private evidence: `work/phase1gates-prerequisites.json`, `work/phase1gates-db-tests.log`, `work/phase1gates-all-db-tests.log`, `work/phase1gates-all-db-sequential-tests.log`, `work/phase1gates-build.log`, `work/phase1gates-browser/`. Backups, keys, logs and customer screenshots stay outside commits.

## Mandatory work still open

1. Deploy/verify fixes on API and worker; recheck revision, cutoff, queue and recipient scope before controlled processor activation.
2. Fresh normal and campaign browser journeys: acceptance → immutable invoice → reconciled minimum booking retainer fee → agreement → signature → secure invitation → workspace/event selection. Verify manual Admin actions cannot bypass prerequisites.
3. Real Microsoft acceptance/inbox delivery of generated and preloaded templates, invoice, agreement, receipt, workspace and reminders; duplicate prevention and uncertain-delivery recovery.
4. Stripe test-mode payment, replay, refund, partial payments, receipt access and ledger reconciliation. No live charges.
5. Planning submission → Admin correction/approval → creative requirements/approval → readiness; required-field feedback across remaining forms.
6. Signing deadline/grace/escalation, balance due rules, approved written exceptions, reminder schedules/stop conditions, Admin To-dos, role permissions and session expiry/revocation/returning access.
7. Complete desktop/mobile journeys and failure recovery. Review legacy confirmed records without agreements and anomalous due dates; do not silently change customer commercial records.

GO requires scoped mandatory staging gates passing on the deployed revision, no critical defects, provider/browser evidence and explicit owner approval. No production rollout is authorized by this checkpoint.

## Hosted follow-up evidence

- Revision `3af59c80b0e85585ae35709c012df4af8b46d78a` deployed successfully to both API (`c0935610-98ad-47cc-a259-ee266742a4fd`) and worker (`b46e6c36-9c8c-40f2-a33a-bfde65aa76cc`). API health reports that exact staging revision. GitHub validation run `38020289781` passed. Item 1 above is complete for deployment verification; controlled automatic processor activation remains outstanding.
- One new, explicitly labelled qualification communication to `info@thelolabooth.com` was accepted by Microsoft and persisted as `SENT_TO_PROVIDER` at `2026-10-10T03:24:36.638Z` (communication `f8d74e8d-13a6-46d7-88df-64e432f72fe2`). Repeating the same send prevented duplication and preserved the original timestamp. **Owner confirmed inbox receipt in this chat.** This smoke message does not qualify invoice/agreement/template/reminder content or workflow delivery.
- Historical messages were not retried; global automation and handoff/reminder flags remain paused. No production changes, customer charges or application migrations.
- Five hosted access checks passed: anonymous client session/event and Admin run-sheet requests returned 401; an untrusted origin returned 403; an unknown invitation returned 401. Client responses use `private, no-store`. Evidence: `work/phase1gates-access-evidence.json`. This is partial access qualification, not the full role/session-expiry matrix.

## Controlled normal-booking checkpoint — evening of 9 October

Owner confirmed the smoke email inbox receipt and authorized signing the explicitly non-production QA agreement. New fixture: `PHASE 1 QA ONLY — No real event`; no real booking, service obligation or live charge.

- API/worker deployment of revision `3af59c8`: PASS. Controlled invoice, agreement and workspace handoff flags enabled with recipient scope exactly `info@thelolabooth.com` and fresh cutoff `2026-10-10T03:40:08.309352Z`. API deployment `bc89906d-778a-4f40-8e8a-d1225c9ea690`, worker `792e56cf-7644-4325-b8dd-0f08cd26c49b`. Lifecycle/planning reminders and campaign broadcasts remain disabled; historical queues excluded. This supersedes the earlier paused checkpoint above.
- Preloaded proposal delivery through Admin and customer acceptance: PASS. Accepted immutable version `030fe14c-8ea1-42a8-952d-a283640452df`; worker generated one invoice `TLBI-1009`, total $599, minimum $179.70, balance due 1 December 2030 (14 days before event). Microsoft accepted invoice delivery.
- Actual Stripe sandbox Checkout: PASS for initial payment. Test card payment $179.70 persisted; invoice partially paid, outstanding $419.30. Customer receipt download exposed. No live funds. Replay/refund/receipt-PDF inspection remain pending.
- Minimum-payment → agreement worker: PASS. One agreement issued, five-day signing deadline and seven-day grace persisted; Microsoft accepted the signing invitation. Owner-approved typed signature persisted at `2026-10-10T04:14:45.785Z`. Signed-copy PDF link visible; full PDF inspection and drawn signature journey remain pending.
- Signed agreement → short-lived secure workspace invitation worker: PASS for dispatch, one completed job/attempt and Microsoft `SENT_TO_PROVIDER`. Actual owner inbox/link redemption/event selection remains pending. No long-lived bearer grant substituted.
- Admin workspace invitation before signing: rejected as required. Event remains INQUIRY; no premature confirmation. Full manual-confirmation, availability and campaign bypass matrix remains pending.
- Fixes prepared: proposal HTML/PDF next steps include agreement signing/workspace; booking retainer fee terminology; zero-payment exception display; stored accepted terms/prices preserved. Manual payment labels/required markers/browser validation added, failed requests retain entered values, duplicate click disabled, local calendar date used, finance write permission enforced in UI.

Private evidence: `work/phase1-controlled-activation.json`, `work/phase1-staging-journey-audit.mjs.json`, `work/phase1gates-browser/normal-payment-recorded.png`, `normal-agreement-signed.png`, `work/phase1-copy-tests.log`. Provider acceptance does not establish inbox receipt for each workflow email. **Overall Phase 1 status remains PARTIAL and production remains NO-GO.**


## October 10 workspace and agreement presentation correction

Owner supplied a staging screenshot showing the old five-link workspace, missing CTAs, a logo in place of the hero image and a separate receipt card. Corrected both secure and legacy presentations toward the approved ivory/gold six-card design. The secure workspace now includes navigation icons, account menu, event metadata, planning hero, event details dialog, protected proposal PDF, signed agreement, invoice/payment and receipt actions, gallery information and repeat booking. Planning CTAs remain visible with an explanation when confirmation prerequisites are unmet. Deferred galleries and rescheduling are not claimed as delivered workflows.

Agreement PDF presentation now includes the actual LOLA wordmark, embedded brand fonts, event/service summary, numbered terms, repeating header/footer, typed or drawn signature and document fingerprint. Rendering does not change signed terms, snapshots, consent or stored hashes. Canonical PDF regression verifies every numbered section, printable text bounds and page numbering; visual checks covered first, continuation and signature pages.

Latest local available suite: 636 tests, 625 passed, zero failed, 11 database suites skipped. A database-enabled attempt failed at connection setup with EPERM after local network permissions changed; this is BLOCKED, not a database pass. Earlier 652-pass evidence predates these presentation changes. Focused document regressions: 23 passed. Frontend build passed. Staging deployment and authenticated browser/download qualification for these corrections remain pending at this checkpoint. Production remains NO-GO.
