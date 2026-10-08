# LOLA parity sprint — release readiness, October 7, 2026

**Production decision: NO-GO.** The implemented changes have local and isolated database evidence, but mandatory application staging A–J qualification is incomplete. This is a checkpoint report, not a production certificate or a claim that the full 55-section sprint is finished. No production changes, customer sends, charges or refunds were made.

## Verified prerequisite

User-approved staging backup PASS: private authenticated staging SQL connection; PostgreSQL identity confirmed; custom archive restored into a disposable database with 126 public tables, 46 recorded migrations and no unvalidated constraints. Encrypted local archive, separate recovery key and checksum manifest are outside the repository under the task's `outputs/staging-backups/`. Database backup does not cover Azure blobs. Full details and rollback procedure: `LOLA_STAGING_MIGRATION_PLAN.md`.

Application staging currently records 001–045 and 047. Missing 046 then 048–053 passed on the restored schema. All 53 migrations also passed on a fresh disposable schema. Application staging database remains unmigrated by this sprint.

## Functionality implemented and isolated evidence

| Area | Evidence | Remaining acceptance |
|---|---|---|
| Booking holds | Selected resource holds, bounded expiry, retry preserves expiry, concurrent one winner, expired checkout refusal, atomic resource assignment/confirmation and replay; manual status bypass rejected | Full public booking path and experience-to-unit mapping; actual customer checkout race |
| Inventory changes | SQL rejects conflicting event reschedule, stock reduction and reserved-unit maintenance; cancellation releases equipment | Actual admin reschedule/cancel UI; physical backdrop checkout/return linkage |
| Customer workspace | Proposal-free planning invitation opens one workspace; planning and current creative actions; current grant/ownership; revocation denies entry | Actual browser, cross-client HTTP requests, email links and mobile |
| Creative/readiness | Exact components per selected experience; only current approved version qualifies; staff count derives from selected experiences; net custom-work payment included | Complete revision/approval browser journey, role checks and operational acceptance |
| Recurring reminders | Existing communication infrastructure; unique per-grant/version/cadence ledger; submission cancels eligibility; opt-in disabled | Actual three-period cadence/revocation/current-version/retry and approved recipient delivery |
| Chargeable backdrop work | Immutable scope/price; client acceptance; dedicated event/client invoice; net-payment requirement; refund removes qualification; changed selection hides stale quote/pay link and rejects stale acceptance; unlinked withdrawal retains history, linked invoice blocks withdrawal | Actual client acceptance/invoice/checkout; linked-invoice amendments and financial resolution |
| Late payment | Already posted payment remains one record, event stays unconfirmed and one review alert persists under replay | Real webhook/receipt/replay/refund browser/provider checks |
| Backdrop assets | Ten-item individual asset intake manifest; existing seeds remain inactive and zero stock | Approved individual files, usage rights, actual stock and image/mobile QA |

The hold UI reserves selected equipment; backdrop holds are supported by the existing scoped API. This is not a complete self-service online booking experience. A linked invoice must be resolved explicitly before replacing accepted quoted work; no silent cancellation or refund was introduced.

## Verification results

- Full automated suite: **609 tests; 599 PASS; zero FAIL; ten SKIPPED**. Skips include environment-dependent database tests; they are not counted as successful acceptance.
- Frontend production build PASS using `npm run build -- --configLoader runner` and patched validation dependencies.
- Production dependency audit: **zero known vulnerabilities** after lockfile overrides for proxy-addr, shell-quote and source-map-js. Deployment must use the committed lockfile; the existing external node_modules installation was not modified.
- Nine reservation/inventory SQL checks PASS; twenty actual service/database checks PASS. Sanitized evidence: `docs/qualification/`.
- Public planning writes now pass through the existing public write rate limiter. Tokens are redacted and public grant responses prohibit caching; full adversarial HTTP/role review remains outstanding.
- No actual staging browser/mobile journey, Azure upload/download qualification, delivered reminder email, Stripe checkout/webhook/refund replay or production qualification occurred in this checkpoint.

## Deployment blockers and safe next sequence

1. Reconcile the release with staging branch `5b3bc23925ac81f69563a8ed85f2c88a03642ee9`. Actual working-file comparison found 425 identical tracked files, 35 changed tracked files and no missing tracked files. Local HEAD is older; preserve newer staging fixes and include required new files. Do not push the entire dirty tree without reviewing this comparison.
2. Review legacy reserved-event conflicts and missing booked times before application migration. Missing legacy times conservatively occupy a full day; new holds require explicit start/end.
3. Pause staging dispatch with a verified maintenance procedure. Read-only queue inventory found five scheduled communications, four failed communications and 72 queued integration jobs. Automation pause alone does not stop earlier campaign/owner processing; email/campaign/API paths also need control. Do not resend failed or uncertain provider outcomes blindly.
4. Confirm backup freshness and scoped environment settings. API startup runs `npm run db:migrate && npm start`, so a branch push may immediately execute migrations. Only push after prerequisites are met.
5. Execute ordered migrations, deploy matching API/frontend/worker revision, verify health, then run approved fixture A–J journeys. Keep recurring reminder flag disabled until delivery/cancellation gates pass.

No staging dispatch configuration, application migration or deployment was changed during this checkpoint. Disposable restore resources are removed after qualification; encrypted backup is retained.

## Outstanding parity work

Public online booking still needs a coherent availability → selection → agreement → deposit → confirmation workflow and configured resource capacity. Travel pricing needs service radius/mileage/fixed/venue overrides and an auditable quote snapshot. Installments need persisted dated schedules and payment allocations beyond existing deposit/balance choices. Marketing needs event-driven segments, post-event/referral/anniversary workflows and qualified suppression. Reporting needs package/experience/source/lost-reason and staff/equipment/backdrop utilization drilldowns. External calendars/social capture/storage depend on actual provider configuration and workflow evidence; connection state alone does not qualify them.

## Explicit release criteria

**GO for a controlled staging migration/qualification window:** reconciled tested revision, verified current backup, known rollback operator/path, reviewed legacy reservations, paused dispatch, confirmed staging-only database/provider/storage identity.

**GO for production:** every mandatory A–J gate passes actual application staging workflow/persistence/security/failure handling, release blockers closed, required external dependencies qualified or expressly accepted as disabled conditions, tested deployment/rollback recorded and separate explicit production authorization received.

**NO-GO:** any mandatory gate is skipped/unqualified/failed; stale grant or wrong-client access; duplicate delivery/charge; resource oversubscription or expired-hold confirmation; chargeable work without accepted terms/required payment; unverified private storage; unknown provider outcome; missing usable assets/actual stock for advertised backdrop availability. Today's state remains NO-GO for production.
