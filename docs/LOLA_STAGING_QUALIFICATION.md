## October 10 authenticated mobile/payment/storage update

Latest application source `08e5ec4` is deployed to staging API and worker. [Current Phase 1 release report](LOLA_PHASE1_RELEASE_READINESS_2026-10-10.md) contains the authoritative scoped gates; earlier rows below are historical checkpoints. Mobile Stripe Sandbox balance Checkout returned PAID/zero balance/two receipts; database persistence and corrected paid invoice PDF regeneration passed. Authenticated document downloads and planning return passed; workspace widths 320/390/768px have no horizontal overflow. Private upload survived the API redeployment byte-for-byte; assigned/unassigned/released/revoked staff-reader isolation passed. Full enabled database suite 659 passes, zero failures/skips; build and CI browser pass. Production remains NO-GO pending campaign/customer E2E, remaining mobile/roles/inbox checks, chargeback/recovery integrity and production preflight/approval. Automatic website proposals remain disabled following the owner's service-area skip; Admin reviews/sends proposals. No schema migration or production activation.

> October 8 secure journey checkpoint: [implementation, evidence and NO-GO criteria](LOLA_PHASE1_SECURE_JOURNEY_READINESS_2026-10-08.md). Migration 055 passed restored-copy rehearsal and guarded application staging migration; this revision is not yet staging-qualified. Historical milestones below do not certify the new revision.

## October 10 deployed qualification update

Current release report: [Phase 1 release readiness](LOLA_PHASE1_RELEASE_READINESS_2026-10-10.md). This supersedes historical checkpoint statements below. Revision b4f9cc8 and migration 056 are deployed in staging after verified backup/restore. Equipment assignment no longer blocks booking confirmation; Admin receives an assignment task. Real Stripe TEST replay/refund/receipt and Microsoft known-failure recovery passed. Hosted reminders passed delivery/dedup/stop tests and staging lifecycle/planning flags were enabled after queue audit; historical messages remain excluded. Hosted access/permission checks passed. Campaign service qualification passed immutable invoice/delivery, synthetic minimum-payment agreement handoff, client conversion and prerequisite checks; the full campaign browser journey remains open. Authenticated mobile planning submission → correction → resubmission persisted; final approval requires the unconfirmed custom backdrop to be resolved. Remaining private asset storage, creative/readiness, mobile/role/appearance gates remain PARTIAL or BLOCKED. Production remains NO-GO and untouched.

# LOLA sprint qualification — 2026-10-07

## October 8 staging update — supersedes historical deployment statements below

Release 10be19e was deployed to staging frontend/API/worker after a fresh verified backup restore and application migrations through 053. Outbound dispatch remains paused. Authenticated dashboard, event and appearance smoke checks passed; these are not complete A–J qualification.

Controlled QA browser qualification found that the planning-token workspace omitted an existing signed agreement while the proposal-token workspace showed it. The correction loads only issued/unexpired or signed contracts linked to the grant's event AND client through a nondeleted proposal, uses existing contract access checks, and applies event/client filtering again in the public projection. Proposal-free access remains supported.

Corrected service executed against the existing paid staging QA event: one signed agreement with a usable link, one invoice and one successful payment receipt PASS. Full regression: 610 tests, 600 passed, zero failed, ten skipped. Postdeployment browser verification passed: the planning workspace now exposes the signed agreement alongside its invoice and receipt. No payment, refund or email was sent by these checks. One planning invitation was queued for the approved QA record while dispatch remained paused; review it before activation.

Gate A remains PARTIAL: existing deposit persistence and invitation/workspace service checks passed; customer save/return/submit passed on the controlled QA fixture, including persisted experience answers, SUBMITTED state, one open creative-preparation task and a queued acknowledgement. Automatic confirmation still needs complete browser evidence. All other mandatory gates retain their acceptance requirements. Production remains NO-GO.

Creative proof-list browser failure traced to ORDER BY referencing nonexistent created_at. Corrected to requested_at with stable id ordering. Corrected service query passed against the migrated staging database; regression suite remains 610 tests / 600 passed / 10 skipped. Disposable database regression now exercises the real list query and checks that admin responses omit public tokens. Postdeployment creative browser qualification passed: private PNG upload/download → V1 review → changes requested → V2 upload → approved. Real staging service checks passed for stale-version and wrong-email rejection, invitation replay deduplication, immutable approved revision, approval replay without duplicate activity, and preserved V1/V2 history. Both required 360 components are complete; readiness correctly retains twelve missing operational requirements. Customer approval confirmation at 375px has no horizontal overflow. Full mobile/staff/role and actual email delivery gates remain unqualified.

Source audit completed for sections 1–55. This is not a release certificate.

## Current local evidence

- Frontend production bundle builds with `npm run build -- --configLoader runner`. Runner avoids writing Vite temporary config through the existing external node_modules symlink.
- Latest full suite: 609 tests, 599 passed, zero failed, ten skipped. Focused policy checks cover: appearance input/mode safety, creative expiry/version/identity/comment/transition policy and public-field minimization; existing checkout, financial-summary, event-order, customer-document/CSP and creative-service regressions.
- Local database start remains blocked by sandbox shared-memory permissions. Authenticated private Railway SSH enabled a verified staging backup/restore and isolated database testing. All 53 migrations passed on a fresh disposable schema; missing migrations passed on the restored schema. Nine SQL checks and twenty service checks passed. No migration was applied to the application staging database or production. HTTP permission isolation and provider/browser journeys remain unqualified.
- New UI is local. Browser/mobile/contrast review on staged build remains required.
- Existing customer/provider credentials were not printed or changed; no real customer email, payment or refund was performed.

## Mandatory journey gates

| Gate | Status | Required evidence |
|---|---|---|
| A Booking → planning | PARTIAL DB CHECKS | Confirmed booking creates one planning record/invite, save/return/submit, readiness |
| B Backdrop | PARTIAL DB CHECKS | Available selection, operational reservation, conflict rejection, own/custom paths, archived history |
| C Private client assets | NOT QUALIFIED | Valid/invalid/oversized uploads, scoped downloads, cross-client denial |
| D Creative approval | PARTIAL LOCAL CHECKS | V1 → changes → V2 → approval, immutable V2, audit/notification, correct readiness, no stale version approval |
| E Payments | PARTIAL LOCAL CHECKS | Deposit/balance/full checkout, webhook/replay/receipt/admin notification/refund on approved test record |
| F Availability | PARTIAL DB CHECKS | Setup/breakdown/backdrop/equipment overlaps, quantity, hold expiry, concurrent checkout |
| G Automations | PARTIAL DB CHECKS | Invitation/reminders/submission/proofs/change/approval/event/post-event, retries without duplicates |
| H Mobile | NOT QUALIFIED | Planning steps/colors/uploads/proofs and staff workflow at 375/390/768px |
| I Appearance | PARTIAL LOCAL CHECKS | Day/Night/device-change Auto, background/palette/reset persistence per user; public documents unaffected; contrast on every module |
| J Permissions | NOT QUALIFIED | Role matrix for events/finance/files/creative/settings/campaign/staff/equipment; altered API requests |

## Deployment gate

Review changes separately from pre-existing uncommitted integrations/design work. Apply missing 046 then 048–053 only to the application staging database after dispatch pause/release reconciliation/legacy-data review, run above gates and capture actual evidence. Keep production unchanged until release approval. Do not mark a skip, source assertion, or successful render as a journey pass.

## Evidence limits and safety

- Sanitized database evidence is in `docs/qualification/`. No provider messages or real payment/refund requests were made by these checks.
- Patched dependency lockfile was installed in isolated validation dependencies: full test/build PASS and production dependency audit reports zero known vulnerabilities. Original external node_modules was restored afterward.
- Ten automated tests were skipped; isolated SQL/service checks add evidence but do not turn those skips into passes.
- Application staging still runs its previous revision. Its worker is active, five communications are scheduled and 72 integration jobs are queued. New recurring reminders remain opt-in and have not been activated.
- GO for controlled staging qualification only after migration-plan prerequisites; NO-GO for production until mandatory A–J gates pass and remaining release blockers are closed.
