# Agreement-first lifecycle release — qualification in progress

Scope: promote the complete tested staging state, including pending V1.2 work. Production deployment is not yet claimed.

## Existing staging work preserved

Baseline staging: `33fe471872fc4aa512fc6f223327b2644a978ffb`. Baseline production: `08acbdf44e13bb1e759a3d4a30457b759eae7332`.

The two-tree comparison has 59 changed files: private Admin Event Files, explicit client file sharing, Fiesta CSV-to-private-session mapping, event galleries with package-based retention, authenticated gallery downloads, read-only Dropbox ingestion guards, and environment-specific owned-domain gallery routing. Existing proposal review, Stripe Tax, Contacts and integrations redesign behavior is retained. Their commits appear in staging ancestry but much of that work is already equivalent in production; the promotion review must use tree differences as well as commit ancestry.

Production-pending migrations from the baseline tree are 059, 063, 066 and 067. Actual database ledgers must be checked before applying anything. Dropbox ingestion remains off until a populated Fiesta export folder is available; no automatic export qualification is claimed.

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

## Evidence so far

- Full local suite with all disposable PostgreSQL suites enabled: 723 tests, 720 passed, zero failed, 3 conditional browser skips. Provider responses in database tests are simulated.
- Local authenticated desktop/mobile V1.1 + Contacts browser journey passed, including single tracker, seven ordered steps, 48% actual payments, refresh persistence, task resolution and mobile overflow.
- Production build passed; `git diff --check` passed.
- `npm audit --omit=dev`: zero vulnerabilities after patch updates.
- Fresh staging encrypted snapshot, decrypt, isolated PostgreSQL restore and all 146 table row-count comparisons passed on 2026-10-20 at 23:00 UTC. Migration 068 rehearsal passed on the restored copy. Owner-fallback SQL refinement after that rehearsal requires another rehearsal before applying it to staging.
- Production daily backup upload recovery verified on 2026-10-20 at 18:31 UTC: encrypted upload, all three Azure objects read back, isolated restore and 143 table row-count comparisons passed. Source fix is PR #43; preserve it in the final release.

Hosted staging qualification, real test-provider delivery, final production migration rehearsal, production activation and production smoke checks remain pending. Do not interpret local suite success as production delivery.

## Rollback

Pause new dispatch and task notifications first. Preserve invoices, payments, signed agreements, audit history, grants and migration history. Do not undo additive migrations by dropping customer records. Reconcile uncertain provider sends/payments before retrying. Reverting to a payment-first application build would undo the approved signature prerequisite; use a reviewed forward fix or keep affected payment dispatch paused instead of silently reopening that path.

## Production ancestry merge

The production backup branch was merged normally, retaining its ancestry and three backup-source files plus the CI fault-test step. Shared application conflicts were inspected: the incoming copies represented the already deployed older payment-first behavior and placeholder file/gallery UI. The current staging versions preserve all production-equivalent proposal/tax/CRM fixes and the newly tested lifecycle and V1.2 implementation. No staging functionality was removed. The combined tree is requalified before deployment.

Historical queue inspection: staging has no pending handoff jobs or scheduled email; production has no pending handoff jobs or scheduled email. Task notification activation will use a fresh post-migration cutoff. Read-only Stripe verification found three expired staging Checkouts and one open unpaid production Checkout; inspect/retire the obsolete production session before activating the new journey. Both Stripe account identities match their environment, and production charges are enabled; no charges were created for this check.
