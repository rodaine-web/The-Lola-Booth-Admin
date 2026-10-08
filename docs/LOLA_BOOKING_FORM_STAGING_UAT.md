# Staging qualification and release plan

2026-10-08. No production authorization. Booking change remains locally implemented and unqualified on hosted staging.

## Prerequisites and migration order

Verified staging project/environment identities and PostgreSQL system identifier before backup. Fresh source dump restored successfully to lola_restore_20261008_booking. Backup retained encrypted in outer outputs/staging-backups; encryption key separately protected with owner-only permissions. Database backup does not contain Azure blobs. Migration 054 and service/HTTP qualification passed on the separate restore; no migrations applied to the application staging database during this work.

1. Reconfirm application migration history through 053 and paused worker/dispatch flags.
2. Check backup freshness if additional application data changed since the verified snapshot.
3. Apply additive 054 with lock/statement timeouts; record filename only on successful transaction.
4. Deploy staging API; health, catalog allowlist, quota table and origin configuration checks.
5. Deploy staging Admin; inspect lead detail and all proposal selections/quantities.
6. Merge website changes through a staging repository PR; verify isolated staging hosting/configuration, asset URLs and new anonymous inquiry path.
7. Leave worker flags paused. If email delivery is qualified, use approved inboxes and explicit bounded QA message IDs; inspect the pending queue first. This form does not require reminder worker activation.

## Rollback

Rollback website/Admin/API deployments to their recorded prior staging revisions. Leave the additive quota table in place while old API code runs. Do not drop the table while new API replicas still use it. Version 2 inquiry JSON remains on leads and is preserved by API/website rollback; older screens may not display all fields. Restore the verified database only if warranted by a destructive data problem, after assessing post-backup inquiries and queued messages; restoring blindly can lose them. Retain the encrypted archive and restore qualification evidence.

## Mandatory gates

| Gate | Required workflow | Current status |
|---|---|---|
| A | One and multiple experience inquiry → one durable lead | PARTIAL: restore HTTP/service passes, hosted browser pending |
| B | Eligibility, scoped packages, custom quote and all add-on quantities | PARTIAL: validation/prefill tested; hosted Admin journey pending |
| C | Reload persistence and proposal/invoice/event propagation | PARTIAL: unit/persistence evidence; full hosted chain pending |
| D | Correct owner/customer acknowledgement and suppression | BLOCKED: approved delivery qualification pending |
| E | Desktop/mobile/tablet layout, keyboard, expandable details, menu/footer | PARTIAL: observed 773px passes; specific breakpoints pending |
| F | Legacy contact/booking compatibility and failure recovery | PARTIAL: existing suites pass; hosted forms pending |
| G | Honeypot, origin, replay/concurrency, size, quota, allowlist and privacy | PARTIAL: restored router checks pass; hosted configuration and complete consent/suppression checks pending |

GO for production requires every mandatory gate to pass with deployed revision/evidence, all critical defects closed, approved production configuration and separate explicit owner authorization. Current decision: NO-GO. Generated illustrative artwork removes the add-on image dependency; actual physical backdrop inventory and production-quality backdrop library remain separately unqualified.
