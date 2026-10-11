# Phase 1 implementation status — 2026-10-08

Release decision: **NO-GO**. Local implementation milestone only. This change has not been deployed or enabled in staging or production. No production changes were made. The approved scope is [the customer-ready release plan](LOLA_CUSTOMER_READY_RELEASE_PLAN.md); galleries and broader operations remain Phase 2.

## Implemented locally, pending staging qualification

| Work | Status | Evidence and limits |
|---|---|---|
| Planning required-field feedback | PARTIAL | Shared server/client missing-field diagnostics, required markers, exact field messages and review links. Incomplete drafts permit a blank email. Remaining Admin forms need the same treatment; real mobile/browser qualification is pending. |
| Proposal acceptance → invoice job | PARTIAL | Acceptance/version/job commit atomically under a proposal lock. Accepted/converted retries do not queue another job. Expired/unversioned proposals fail without queueing. |
| Concurrent invoice conversion | PARTIAL | Twelve concurrent requests produce one invoice and one set of lines. Invoice pricing comes from the accepted version, even after live proposal pricing changes. Draft-edit writes recheck editable status to prevent racing acceptance. |
| Invoice dispatch | PARTIAL | Existing automation_jobs and communications ledgers; persist invoice/message before dispatch; stable communication key; recipient, accepted-version, payment and cancellation checks at dispatch. Worker crash/unknown provider outcome requires review. Real email/browser/payment-path qualification remains pending. |
| Verified payment → agreement job | PARTIAL | Queued inside existing payment reconciliation transaction for new managed proposal bookings. Pending payments and payments below 30% queue nothing; repeated reconciliation queues one agreement. Existing records are not automatically enrolled. |
| Agreement preparation/delivery | PARTIAL | Approved full terms for new agreements, accepted-version pricing/services, persistent issuance and delivery claim, existing contract delivery retry protection. Different manual terms or a revoked agreement require review. Simulation confirms one send across retries and no handoff after refunded payment. Existing signed documents are not rewritten. |
| Managed automatic confirmation guard | PARTIAL | Payment alone, a draft/unsigned/stale-version agreement, missing reservations and closed commercial records cannot satisfy the managed automatic confirmation path. Short-notice full payment uses business-local dates. Manual confirmation paths, per-experience allocation completeness, written confirmation and authorized exception handling still need qualification/implementation. |
| Combined-state next actions | PARTIAL | Pure policy covers independent commercial/payment/agreement/workspace/event/planning states, cents-based minimum and short-notice payment. Not yet exposed consistently in Admin and customer APIs/UI. |

## Mandatory remaining implementation and qualification

1. Signed agreement → secure Client Workspace invitation: single-use short-lived magic links, revocable sessions, returning-client/event selection, coherent approved workspace design and signing-completion trigger. Do not automatically email the existing long-lived bearer workspace grant as a substitute.
2. Enforce confirmation/planning prerequisites across **all** entry points, including manual Admin actions and campaigns. Existing campaign payment conversion currently has its own confirmation path; it must be changed to the approved invoice/payment/agreement/confirmation journey before Phase 1 activation.
3. Campaign offer acceptance → immutable commercial record → invoice and agreement linkage. The new automatic agreement path intentionally requires a proposal and does not pretend to cover proposal-less campaign invoices.
4. Signing deadline (five days), grace/escalation, drawn signatures, signed-PDF/workspace presentation, approved payment exceptions and balance due 14 days before the event. Existing signing-link expiry is not a signing deadline.
5. Complete payment/signature/planning reminder schedules, stop conditions and Admin To-dos using current workers; inspect historical queues before enabling any jobs.
6. Required-field treatment for remaining Admin forms; actual event detail submit → Admin approval/correction → creative requirements/readiness flow.
7. Qualify normal and campaign bookings, reusable/preloaded template delivery, payment replay/refund, receipts, permissions/access expiry, mobile usability and failure recovery in staging.
8. Complete the scoped release readiness report and request explicit owner approval before production rollout.

## Worker activation and rollback

No schema migration is introduced by this milestone. It uses existing proposal_versions, automation_jobs, communications, contracts and delivery tables.

- `BOOKING_INVOICE_HANDOFF_ENABLED=true` enables queueing **new** acceptance jobs and their dedicated worker processor. Default is disabled.
- `BOOKING_AGREEMENT_HANDOFF_ENABLED=true` enables agreement jobs from reconciled payments on managed proposal bookings. Default is disabled.
- Existing environment automation pause remains mandatory. Staging also requires its configured fresh-job cutoff and approved recipient scope; the new processor filters by both. Email allowlist checks remain enforced.
- Do not enable these flags as a production release while the gaps above remain open. No backfill of historical acceptances/jobs is performed.
- Pause flags stop dispatch. Preserve generated invoices, posted payments and signed agreements. Managed-booking confirmation checks remain tied to persisted handoff records rather than becoming bypassable when a flag is disabled.
- Dedicated job types are excluded from generic automation execution/recovery. Stale claims are failed for operator review instead of blindly resending uncertain email.
- Before staging activation, verify target identity, current backup/restore, deployed code, provider credentials, test recipient ownership and queue contents. Activation is a separate qualification step, not proof of delivery.

## Validation evidence

- Full automated suite with the disposable local Phase 1 database enabled: **626 tests; 616 passed; zero failed; 10 skipped**. Other conditional database/provider suites remain skipped and are not claimed as passing.
- PostgreSQL test applies all existing migrations in a fresh disposable schema. Exercises twelve competing acceptances, twelve invoice conversions, accepted-price persistence, pending/subminimum payments, eight repeated reconciliations, agreement preparation, manual-term conflict, committed delivery claim, simulated provider acceptance/replay, refunded-payment stop and confirmation rejection.
- Provider delivery in that database test is **simulated**, not a real Microsoft or Stripe transaction. No real customer messages or charges are generated.
- Frontend production build passed with Vite's runner config loader. Build reports its existing chunk-size advisory.
- Syntax checks and `git diff --check` passed. No dependency/API-version changes made.
- Private execution logs: `work/phase1-validation-tests.log`, `work/phase1-validation-build.log`, `work/phase1-invoice-db-tests.log`. They are excluded from the commit.
- Real staging browser journeys, email acceptance/inbox delivery, Stripe events, session/access controls and mobile validation remain **NOT RUN** for this milestone.
