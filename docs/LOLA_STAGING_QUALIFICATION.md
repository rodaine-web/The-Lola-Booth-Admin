# LOLA sprint qualification — 2026-10-07

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
