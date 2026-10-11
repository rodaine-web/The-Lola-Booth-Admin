# V1.1 / Phase 1 release readiness — production activation, 11 October 2026

**Decision: GO for the scoped Phase 1 booking launch. Deployed and activated with owner authorization.** This is not a declaration of full BoothBook parity or a claim that every possible production journey is perfect.

Application release: `3d9db81f5543ac0d55acb032fb7a910d55303360` on `main-prod`. Production API and worker are pinned to this release. Production database migrations 046–057 were applied in order; the ledger contains 57 migrations. Latest verification: 11 October 2026, 21:54 UTC.

## Activated customer journey

Website inquiry → Admin review and initial proposal → accepted commercial record → automatic invoice → reconciled minimum payment → receipt and agreement → signed agreement and guarded booking confirmation → secure Client Workspace invitation → planning submission, correction/Admin approval and creative approval.

The minimum is a 30% **booking retainer fee**, subject to the approved near-event/full-payment and recorded exception rules. Equipment assignment does not gate confirmation; Admin receives an assignment task. Campaign acceptance uses the commercial-record/invoice/agreement journey rather than bypassing confirmation.

Initial website proposals remain **Admin-reviewed**. Automatic published-price proposal sending is disabled because service-area/travel rules were deferred by the owner. Live Stripe payments, invoice/agreement/workspace handoffs, planning and lifecycle reminders, campaign workers and the client workflow are enabled. Historical queue checks preceded activation; no historical acceptance backfill was performed.

## Qualification and evidence

| Requirement | Status | Evidence and limit |
|---|---|---|
| Normal and campaign booking lifecycle | COMPLETE for staging qualification | Actual Sandbox payments, receipt persistence, signed QA agreements, automatic confirmation without equipment, single-use workspace invitations and customer journeys. No real service obligation created. |
| Payment replay/refunds and failed-payment recovery | COMPLETE for staging qualification | Actual Sandbox journeys and persisted ledger/receipt checks. Financial production E2E has not been run. |
| Stripe dispute handling and replay | COMPLETE for Sandbox qualification | Actual Sandbox dispute withdrawal reduced paid balance and raised review; reinstatement restored balance and completed the Admin task. Actual provider resend returned HTTP 200 duplicate/IGNORED. No LIVE dispute or charge was created. |
| Permissions and access controls | COMPLETE for tested scope | 136 staging HTTP checks; wrong/no-grant denial, staff-assignment restriction, revoked sessions and prior expiry/single-use/wrong-event/customer checks. QA actor and access fixtures deactivated. |
| Reusable/preloaded email templates | COMPLETE for staging qualification | Microsoft accepted both fresh rendered template messages; owner confirmed both arrived in at least one authorized inbox. This does not independently prove delivery to every recipient/provider. Duplicate suppression verified. |
| Mobile planning, documents, creative and custom quote | COMPLETE for tested staging journeys | Authenticated mobile planning and document/payment checks; custom work blocked until acceptance/payment; Admin approval and per-experience creative approval persisted. |
| Production database backup/restore | COMPLETE for tested database backup | Actual daily encrypted private Azure backup on 11 October; readback and isolated PostgreSQL restore passed; 115 tables. Anonymous access denied. |
| Production migrations/queue activation | COMPLETE | Ordered 046–057 deployment succeeded. No pending historical automation/communications, campaign dispatch or reminder population at preflight. Ten backdrop seeds remain inactive with zero stock. |
| Production frontend/API/worker | COMPLETE | Production frontend READY; API health reports production and the release SHA; correct production CSP. API deployment 5d867e60-8a03-49bd-b7de-d8d8503819ed and worker f4a469ab-d700-423e-8147-a64aac35fdee SUCCESS. Final worker heartbeat HEALTHY, jobsPaused=false, no processing error. |
| Production inquiry persistence/email dispatch | COMPLETE for smoke check | Clearly marked QA-only website inquiry saved once as lead 56d1a914-592d-4ba7-8767-13cf9caf6b6f. Acknowledgment and owner notice both SENT_TO_PROVIDER via Microsoft. No proposal/invoice/event created. Production inbox receipt of these two smoke messages has not been independently confirmed. |
| Live Stripe configuration/signed transport | COMPLETE for activation check | Correct live account and enabled endpoint; actual signed nonfinancial LIVE event evt_1UPUTBC7UOE45wwkzAv0ewHR processed with HTTP 200. Temporary customer.created subscription removed; 15 payment/refund/dispute subscriptions remain. This verifies transport, not a live customer payment. |
| First real paid production booking | PARTIAL — monitor at launch | Production is enabled; full paid/signature customer E2E was qualified in Sandbox, not executed with live funds or a real production agreement. Check the first real booking through invoice, payment, receipt, agreement, confirmation and workspace delivery. |
| Full BoothBook parity/photo delivery | PARTIAL — outside this release | Galleries, event-day files/operations, customer changes, broader growth/integrations and BI remain Phase 2. Do not present the full photo-delivery journey as qualified by this release. |

## Automated validation

Exact release candidate CI 38176372288 / job 114579516003 passed. Ordinary available suite: 649 tests, 634 passed, 15 skipped. Separate disposable Phase 1 database suite: 666 passed, zero failed/skipped. Separate V1.1 database checks and browser smoke passed. Frontend production build passed. Conditional provider/database suites skipped in the ordinary suite are not claimed as passing through that result.

PR 17 supplied the safe paused-live-key startup change; PR 18 merged the qualified production release. Temporary validation PR 19 was closed without merging production CSP into staging.

## Remaining launch follow-ups and external dependencies

- Monitor the first real live payment and the complete resulting customer lifecycle. Escalate missing receipts, agreement/workspace delivery or incorrect balances immediately.
- Database daily backup has run successfully. The file-backup schedule is configured; its first unattended run is still pending. Independent owner custody of the recovery key remains to be confirmed; the key is not published in this report.
- Review the Azure trial expiry on 30 October and ensure storage/billing continuity.
- V1.1 follow-up: the public website is now deployed at commit `7b9618f6cbb8e45495ee4c4c500d49fd6c8250e6` (production deployment `dpl_GpzruwsVQE1NAr3aGpknurnUMw5e`, READY). The approved four-experience page, equipment photos and illustrative add-ons are live. Production catalog load, independent Glam/360 Essential selection, Extra Hour quantity 2 and a clearly marked QA-only submission passed in the actual production browser. All four equipment images loaded. Mobile 390px and desktop 1280px checks found no horizontal overflow. The QA inquiry reported success; no payment/contract was performed in this follow-up. Initial proposals still require Admin review.
- The Admin V1.1 frontend release metadata was deployed in commit `d23a3d0ed0a9dd0aabd4d28bff13088ce33b012c` (deployment `dpl_8LfnTKY6gES9TwMtKwCsDDVJvWyT`, READY). Its application/backend remains the qualified Phase 1 code; no further migrations or worker activation changes were introduced. Website VERSION and package/lockfile agree on 1.1.0; 13 available website tests passed.
- Supply usable backdrop assets and actual stock before activating the ten seeds. Own artwork and accepted/paid quoted custom requests remain available.

## GO/NO-GO operation and rollback

GO applies to the scoped booking release described above, with an Admin-reviewed initial proposal and the recorded monitoring limits. It does not mean unrestricted parity or a completed real-money production E2E.

Pause dispatch and treat launch as NO-GO if live account/webhook identity is wrong, payments fail reconciliation, duplicate financial documents/messages appear, unauthorized customer access succeeds, or the API/worker becomes unhealthy.

For containment, pause production automation and invoice/agreement/workspace/campaign/reminder dispatch; disable new live checkout if necessary. Coordinate webhook changes with payment reconciliation rather than discarding incoming payments. Preserve generated invoices, posted payments, receipts and signed agreements. Do not blindly roll back the application to a pre-057 build or reverse financial records. A database restore is a last-resort operation requiring an explicit data-loss assessment.

Temporary qualification-service credential references were cleared and its next start command made inert. Production API/worker credentials remain intact.

---

## Historical checkpoints — superseded by the 11 October production activation

The material below records earlier staging and NO-GO checkpoints. Those dated conclusions are historical; the current decision and limits are above.

# Phase 1 release readiness — 10 October 2026

**Production: NO-GO. Staging: available for owner testing.** Latest qualified application revision `08e5ec4c52b858cc5f4e571f6ae267374a32de81`; migration ledger through 056. This report supersedes earlier checkpoint statements about Railway connectivity, equipment-gated confirmation, paused reminders and unqualified payment replay/refunds. Production was not changed.

## Verified in this qualification

| Requirement | Status | Actual evidence and limits |
|---|---|---|
| Confirm after accepted terms, minimum payment and client signature, without equipment assignment | COMPLETE | Restored-database rehearsal; deployed 056; guarded Admin confirmation and signed QA recovery persist CONFIRMED with zero equipment. One keyed HIGH assignment task; planning unlocks. Payments/signatures still required. |
| Fresh staging backup and restore | COMPLETE | Encrypted PostgreSQL archive, separate restored cluster, migration/count/checksum verification; 056 rehearsal and guarded transaction application. Backup volume retained. Azure files are outside the database backup. |
| Payment replay, partial/full refunds, receipt ledger | COMPLETE for tested provider path | Real Stripe TEST PaymentIntent and canonical event replay; one posted payment; concurrent identical refund requests; separate partial and full provider refunds; net invoice/receipt reconciliation. No live funds. Hosted mobile Checkout/balance and chargeback handling remain broader gates. |
| Known failed-delivery recovery | COMPLETE for known pre-send failure | Actual Microsoft acceptance after a controlled pause failure, one email message, replay suppressed. Unknown provider outcomes require operator review; no blind resend. |
| Signature/balance/planning/creative reminders | COMPLETE for tested schedules and stop conditions | Hosted Microsoft acceptance; duplicate queues suppressed; signed/submitted/approved/cancelled fixtures stop reminders; signing task closes. Fixed PostgreSQL microsecond/JavaScript millisecond deadline mismatch. Staging API/worker enabled after queue audit; historical cutoff retained. |
| Secure Client Workspace access | COMPLETE for tested access controls | Actual hosted HTTP single-use redemption, replay/expired-link denial, Secure HttpOnly SameSite cookie, wrong-event ownership denial, anonymous denial, CSRF/origin denial, logout revocation; signed PDF requires fresh verification. Existing user sessions were not revoked by QA. |
| Admin agreement permissions | COMPLETE for tested routes | Dedicated non-login QA identity: no-permission denied; read:sales allows index but not issue; revoked session denied. Wider role/action matrix remains PARTIAL. |
| Mobile planning and correction | COMPLETE for tested submission/correction/return path; PARTIAL overall | Authenticated 390px workspace/planning, required-field links, saved answers, custom-backdrop request and no-assets declaration, submit → correction → resubmit, and authenticated return navigation. Own-artwork final approval/lock and creative component coverage passed hosted HTTP. Unconfirmed/unpaid custom backdrop remains blocked. Mobile uploads/proof approval still required. |
| Reusable/preloaded templates | COMPLETE for tested delivery | Existing template renders with persisted identity/version; newly created reusable template renders merge data, actual Microsoft acceptance, duplicate send suppressed. New QA template archived after testing. Inbox/content approval and campaign broadcasts remain separate gates. |
| Campaign lifecycle | PARTIAL | Hosted service checks created one campaign proposal under concurrent preparation; accepted-price invoice and actual Microsoft invoice delivery; synthetic manual QA minimum payment → one issued agreement and WON client classification; no premature confirmation/workspace. Full hosted campaign customer/browser journey remains required. QA event cancelled after this test. |
| Approved workspace / signed PDF presentation | COMPLETE for tested cards/actions and downloads | Fresh authenticated 390px proposal/agreement/invoice/receipt downloads; all signed-agreement pages rendered, signature/hash evidence and receipt branding checked. Actual Sandbox balance Checkout returns PAID and two receipts. Paid-invoice payment-link defect fixed and deployed regeneration verified. Remaining mobile uploads/creative review are separate gates. |

Provider acceptance is not proof of inbox receipt for every message. Owner confirmed prior smoke-email receipt, not every new reminder/refund email.

A small follow-up adds The Client Workspace return links to the authenticated planning header and submission confirmation; token-based legacy planning is unchanged. Frontend build and diff checks passed; staging browser verification of this follow-up is required.

## Mandatory A–J gates

Original acceptance definitions remain in `LOLA_STAGING_QUALIFICATION.md`. Phase 2 exclusions do not waive Phase 1 privacy, payment or planning dependencies.

| Gate | Current status | Remaining qualification |
|---|---|---|
| A Booking → planning | PARTIAL | Full campaign browser lifecycle remains. Normal booking handoffs, equipment-free confirmation, submission/correction/resubmission, own-artwork Admin approval/lock and selected-experience creative coverage have hosted evidence. Custom-work acceptance/payment path remains separate. |
| B Backdrop | BLOCKED for production inventory; PARTIAL for logic | Ten inactive seeds stay inactive. Supply usable assets and actual inventory; qualify eligible selection/conflict and custom quote → acceptance → invoice → payment → work authorization. Unpaid custom work is correctly blocked. |
| C Private client assets | COMPLETE for tested staging provider; production preflight PARTIAL | Valid upload/byte readback, invalid/oversize rejection, private/scoped/anonymous/revoked denial and byte-identical readback across API redeployment passed. Production storage capacity and file backup/restore remain required. Event-day files/galleries are Phase 2. |
| D Creative approval | PARTIAL | Earlier hosted V1/change/V2 evidence and current reminder stop evidence exist; finish current full component/readiness workflow with eligible production assets. |
| E Payments | PARTIAL | Real TEST minimum/balance payment, replay/refund and receipt ledger passed; actual mobile balance Checkout yields fully PAID/zero balance, no payment controls and two unique receipts. PDF downloads and corrected paid-invoice regeneration passed. Interruption recovery, chargeback integrity and remaining inbox evidence still require qualification. |
| F Availability | PARTIAL | Restored DB and CI concurrency/expiry/conflict checks passed. Equipment assignment is not confirmation prerequisite. Remaining customer/reschedule inventory journeys need qualification. |
| G Automations | PARTIAL | Handoffs and reminder provider acceptance/dedup/stop passed; staging reminder activation audited. Finish generated/preloaded campaign delivery and inbox checks. Campaign broadcasts remain disabled. |
| H Mobile | PARTIAL | 390px authenticated planning/correction/return, actual Sandbox Checkout and document downloads passed. Workspace has no horizontal overflow at 320/390/768px. Finish uploads, color/backdrop/proof approval at required breakpoints. Staff workflows are Phase 2. |
| I Appearance | PARTIAL | Earlier settings smoke evidence exists; complete deployed contrast/mode/palette persistence matrix. |
| J Permissions | PARTIAL | Client ownership/expiry/CSRF/logout, revoked grants, agreement read/write/session and assigned/unassigned/released staff asset access passed. Complete remaining in-scope role/action matrix. |

## Tests and evidence

GitHub Staging Validation run `38074868055`, job `114279633607`: PASS. Available suite: 637 tests, 626 passed, 11 conditional database skips. Separate fully enabled disposable-database suite: **654 passed, zero failed, zero skipped**; V1.1 database suite passed; frontend build and CI browser journey passed. Those CI providers are simulated/development delivery; real hosted checks are separately identified above. Existing frontend chunk-size advisory remains. The local dependency audit could not reach npm DNS; a fresh hosted `npm audit --omit=dev` on the deployed application completed with **zero reported vulnerabilities** (deployment 63b4b7b8-7e78-4b8b-97a5-5baa7ca417e2). Generated/reusable and preloaded-template provider acceptance/replay passed on deployment fa1bc840-ddda-415f-b157-3cdb49d5d229; post-activation historical scheduled count remains 13. Inbox receipt/content checks are still required.

Hosted qualification deployments:
- Backup `6987938c-9be6-4a97-a14d-e7d55523a6c6`; restored rehearsal `cc3cb0c4-3ae9-48e9-85d0-662d0a7314e0`; migration application `a323fe08-66b6-4a5e-984f-11fab15b8f3c`.
- Stripe TEST/refunds/Microsoft recovery `98eb308e-7b19-4f3a-add0-4c473b7616b4`.
- Reminder delivery/stop qualification `70da6561-ffef-4f00-8aa5-e10e9a709b0a`.
- Hosted access/permissions `a2e66b8c-ce2d-4b17-b946-31c74ad0cce4`.
- Campaign service qualification `6ee54db7-2337-44ad-b131-39887baf2f4a` (manual synthetic QA ledger payment, not Stripe).
- Reminder activation API `c172b4de-d692-44ee-9f1f-d870fbb47dce`; worker `49a9c692-23d0-4d5b-bc7a-566e6209a05b`, both SUCCESS on b4f9cc8; worker startup verified.

Private screenshots and scripts remain under ignored `work/`; no customer tokens, backup keys or provider credentials are committed. QA runner setup failures were corrected before PASS runs; deployment SUCCESS alone was never treated as qualification.

## Activation and rollback

Staging invoice/agreement/workspace handoffs are enabled. Lifecycle/planning/creative reminder flags were enabled on staging API and worker after audited provider delivery and queue inventory. Fresh-job cutoff remains `2026-10-10T03:40:08.309352Z`; 13 historical scheduled communications remain excluded. Open tester recipients are owner-authorized. Stripe remains TEST; campaign broadcasts stay disabled. No historical backlog retry/backfill.

Pause reminder and handoff flags to stop new dispatch; preserve generated invoices, posted payments, signatures and confirmation records. Do not reverse financial history or make confirmation checks bypassable. Retain encrypted backup volume and restore key. Migration rollback requires a reviewed forward fix/function restoration, not deletion of recorded bookings/payments.

## GO criteria and next release actions

1. Close every applicable Phase 1 A–J gate with deployed workflow/persistence/security/failure/browser evidence, including full campaign and final planning/creative approval paths.
2. Supply usable backdrop/inventory and verify durable private planning asset storage, or formally scope disabled optional features with coherent customer messaging and no broken required path.
3. Complete mobile uploads/proof review and remaining role/action matrix; verify inbox delivery/content for mandatory customer communications. Tested mobile payment/download/navigation and access expiry/revocation are recorded below.
4. Re-audit queues, backups, target revisions/provider configuration and rollback before production activation. No unresolved critical financial, privacy, confirmation or delivery defects.
5. Present the concrete production rollout to the owner and obtain explicit approval. **NO-GO until these conditions are met.**

## Return-navigation follow-up qualification

Frontend revision `851ebf9726d4d27b0d6ddbf11e98844d49a7af99` is READY on the staging Vercel project (deployment `dpl_AphWuXY5VXnyoM89ra5eT9s52zo7`, aliases stagingadmin.thelolabooth.com/staging.thelolabooth.com). Backend qualification remains b4f9cc8; no backend behavior or schema changed in this follow-up. GitHub run `38078144644`, job `114289334029`: all validation steps PASS, including automated tests, full disposable DB suite, build and CI browser journey. Local build/diff checks also passed.

At 390px the new planning header return link rendered and navigated to /client. The previously authenticated session expired by this final reload; the post-submit return action's current authenticated presentation and mobile payment/document journeys remain unqualified. The earlier authenticated submission/correction/resubmission evidence is valid and is not replaced with an expired-session rendering claim. Production remains NO-GO.


## Additional qualification — private planning and creative, 10 October

Owner skipped automatic website quote service-area setup. Keep the optional website proposal flag disabled in both environments; Admin reviews and sends the proposal. See `LOLA_PHASE1_WEBSITE_PROPOSAL_QUALIFICATION.md`. Downstream handoffs continue unchanged.

Application commit `2cc91ae1b04fe501b7630ad96162253d56eeefd3`, GitHub run `38083449643`, job `114304931084`: all steps PASS. Full database-enabled suite **657 passed, zero failed, zero skipped**, V1.1 database suite, frontend build and CI browser journey PASS. Available suite remains 628 passes with 12 conditional skips; these are not presented as passes. Automatic-proposal defects found during DB qualification were corrected before activation; the feature remains disabled.

Hosted qualification deployment `a6f871fc-5b1b-4940-a0f2-e10dcf5d0ae8` completed with explicit PASS markers:
- Actual API private PNG upload and byte-identical readback, sandboxed attachment response, anonymous denial and wrong-event ownership denial. Invalid magic and >8MB rejected without creating file rows. Runtime provider LOCAL; API has persistent volume mounted at `/app/storage/uploads`. Cross-deployment readback/production storage and file backup remain separate requirements.
- Selected Glam experience: own-artwork backdrop, required planning facts/style/assets, submit → Admin correction → client resubmit → Admin approval; approved planning refuses edits. No customer booking or custom payment rules bypassed.
- Actual session-scoped proposal, signed agreement, invoice and receipt PDFs plus payment options. These HTTP tests do not claim mobile visual qualification.
- Creative V1 change request → revision V2 → stale-version rejection → V2 approval → replay; approved overlay and welcome-screen coverage complete. Remaining operations readiness still incomplete. Proof is a synthetic 1px QA image, not a supplied production backdrop asset.
- Revoked workspace grant denies workspace/file access with 401; no user grant was revoked. New QA fixture cancelled after checks, prior failed QA-only fixtures cancelled. Manual ledger payment and nonbinding QA-only agreement were used here; actual Stripe TEST evidence is recorded separately above.

Gate C improves for deployed private upload/readback/security, but production persistence/backup remains PARTIAL. Gate D improves for hosted component/version logic; production creative assets and mobile proof review remain PARTIAL. Gate J includes actual revoked-grant denial. Phase 1 remains NO-GO pending the other applicable gates and production preflight/owner approval.

## Authenticated mobile payment and document qualification

Owner supplied a fresh staging workspace session. On the existing explicitly labelled QA client/event, actual 390px Stripe Sandbox Checkout paid the remaining $4,057.90 with a test card. The return workspace shows invoice TLBI-1010 PAID, total/paid $5,797.00, balance $0.00 and two succeeded receipts ($1,739.10 and $4,057.90). No live funds or production records were changed.

Actual mobile buttons downloaded proposal, signed agreement, paid invoice and balance receipt PDFs. The 13-page signed agreement was rendered and visually checked, including the branded cover, all-page contact sheet and signature/hash page; the invoice and receipt were rendered and checked. Branding, signature evidence and zero-balance receipt are readable. A paid invoice still offered a payment QR and displayed copied proposal wording as payment instructions. The follow-up document fix removes payment links/QRs when no balance is due, adds current booking-retainer-fee/confirmation instructions, and labels saved invoice terms separately without changing saved commercial records.

Authenticated Continue Planning opens the submitted confirmation; Return to The Client Workspace returns to the authenticated cards. Workspace widths 320/390/768px and submitted planning at 390px have no horizontal overflow. Temporary viewport overrides were reset. Private screenshots: `work/phase1-mobile-paid-invoice-20261010.png`, `work/phase1-mobile-planning-return-20261010.png`, `work/phase1-320-paid-invoice-20261010.png`. No sign-in tokens are included in the report.

Local document regressions: 18 tests, 17 passed, zero failed, one conditional DB skip. Full available suite after the fix: 642 tests, 630 passed, zero failed, 12 conditional DB skips. Settled/void PDFs have no payment link annotation; outstanding invoices retain the actual decodable payment QR; saved terms/input records remain unchanged. Syntax and diff checks passed. Hosted regeneration of the corrected paid invoice remains pending deployment; earlier downloaded PDFs are evidence of the defect, not the correction.

Gates E/H improve for mobile balance Checkout, receipts, downloads and planning return. Interrupted/failed payment recovery, mobile uploads/proof review, full campaign customer journey, remaining permissions/inbox evidence and production storage/backup/preflight remain open. This checkpoint is not production approval.

## Deployed document correction and storage persistence evidence

Staging API deployment `53dcba8d-d88c-4ee0-a30d-f61bd4e49c06` is SUCCESS on `08e5ec4c52b858cc5f4e571f6ae267374a32de81`. GitHub run `38085234032`, job `114310259141`: all steps PASS; available suite 630 passes/12 conditional skips, full enabled database suite **659 passed, zero failed, zero skipped**, V1.1 DB 3 passes, frontend build PASS and CI browser 1 pass. No schema migration or production activation was introduced.

Hosted post-deployment runner `7640e387-4a49-452c-8794-b5562cf35c0d` explicitly passed:
- The mobile QA invoice persists PAID/zero balance with exactly two Stripe succeeded payments and one receipt for each, without duplicate ledger entries.
- A fresh actual session-scoped API PDF request regenerates the corrected paid invoice with NO PAYMENT DUE, saved terms preserved and no payment link annotation.
- A private QA PNG uploaded before the API redeployment reads back byte-identically afterward from the mounted API volume. A dedicated non-login test reader is denied without permission, denied with read permission but no event assignment, allowed with assignment, denied for a different event, denied planning review writes, denied after assignment release and denied after session revocation. Test identity/profile were deactivated and assignment released; existing user privileges/sessions were not changed.

This closes the tested staging storage-redeployment and paid-invoice correction checks. It does not certify production file backup/restore, all roles, inbox receipt or the remaining end-to-end campaign/mobile workflows. The private proof screenshot of the mobile PAID result is retained with the other evidence. Production remains NO-GO.

## Production preflight and payment recovery — latest checkpoint

Owner explicitly authorized production deployment and then requested closing the blockers. Authorization is recorded; application rollout remains conditional on the required gates. No production application revision, worker activation, live charge or customer booking record was changed in this checkpoint. A dedicated backup helper was added to the actual production project, with no public endpoint and no restart loop.

- Production project `071e2ce9-7103-4dce-aec7-b3ddbc1a799e`, environment `e9bcf249-3fd4-4272-a8d3-c7416d513fa8`: database identity matched its existing configured system identifier and explicitly differed from staging. Encrypted custom-format backup restored successfully into a separate local PostgreSQL cluster in the helper. Deployment `3a02a28c-5fac-4ca9-944b-e9c72d6c2da2` emitted `PRODUCTION_DATABASE_BACKUP_ISOLATED_RESTORE_ENCRYPTION_PASS`. Archive and encrypted SHA-256 checksums plus encryption round-trip were verified; retained restricted backup volume `d0052bf9-2e71-4d6a-850c-dbb62475fac1`. Encryption material is not printed or committed.
- The production snapshot contains 45 migrations. Migrations 046–056 applied in order on that isolated restore only; contract, payment and event row counts were preserved. Deployment `679d807c-baa2-4a87-aec6-9d71a77c7ec8` emitted `PRODUCTION_ISOLATED_RESTORE_046_056_UPGRADE_FINANCIAL_COUNTS_PASS` and ledger 56. This is rehearsal evidence, not a live migration.
- Actual production configured storage provider is Azure. Its documents container denies anonymous access and its production/documents prefix currently has zero objects; the restored file registry has zero active stored-file rows. An encrypted archive and readback/round-trip of that empty namespace passed on deployment `416c4159-49d1-439b-8cb1-56e1ee8f5726`. This does not prove restoration of populated assets or write permission. Railway's file-volume UI requires a Pro plan for new native snapshots; no plan upgrade was purchased and no source volume was detached.
- Fixed a payment failure isolation defect: invoice-wide fallback could fail unrelated pending checkouts. A declined card now resolves the exact Stripe Checkout and keeps it retryable; expired and asynchronously failed sessions update only the matching attempt. Late terminal failures cannot reverse a succeeded attempt; failed attempts create no payments or receipts. No schema change.
- Hosted disposable PostgreSQL regression deployment `40a2d7dd-424c-4519-9f68-e068f130e073`: one integration test passed, zero failed/skipped. Actual migrations and signed webhook handler ran; Stripe responses were simulated, not live or real Sandbox delivery. An initial runner failed before tests due to SQL_ASCII initialization; corrected UTF-8 initialization passed. Full local available suite: 643 tests, 630 passed, zero failed, 13 conditional database skips. Deployment/full CI and real failure recovery remain separate checks.

Remaining: live Stripe account/webhook/key verification after owner connects Stripe; populated private-storage recovery proof and backup retention; full campaign customer journey; chargeback integrity; remaining mobile/permissions/inbox checks; coordinated production flags, fresh queue audit and rollback. Automatic website proposal configuration remains deferred by the owner. **Production remains NO-GO.**


## Daily independent Azure database backups — October 10, 2026

The owner approved the lower-cost Blob Storage option. Daily cron `0 8 * * *` is configured on the isolated production backup helper, with 30-day retention of complete job-owned encrypted snapshot triplets. The Azure PostgreSQL server was not created. No Azure subscription/plan upgrade was purchased.

Actual production backup qualification passed in deployment `8b89ccfe-b3b3-4251-a1ed-a7051ee459ba`: a 3,270,097-byte dump was restored locally, encrypted and uploaded to the existing private production Azure container, downloaded, authenticated/decrypted and restored again. Row counts matched all 115 public tables. Anonymous access returned Azure `409 PublicAccessNotPermitted`. No source database writes, schema migrations or production application rollout occurred.

Daily-mode deployment `7af34a66-a8df-4e29-aed4-55335c4a5e2e` installed the UTC schedule and cleared the temporary verification private key. It is a scheduled deployment, not evidence that tomorrow's cron has run. Recovery private key remains separately on the owner's computer, permissions 0600 and Git-excluded; secure an independent owner-controlled copy. Failure alerts and the qualification-success notice were accepted by Microsoft Graph; inbox receipt has not been independently verified. Runtime failure alerts cannot detect a scheduler/container that never starts; external freshness monitoring remains desirable. Azure trial expiry is still a subscription-retention dependency.

Scripts, restore instructions and full evidence are in `ops/backups/README.md`. This closes the independent uploaded-and-restored database backup check. It does not close live Stripe, campaign, permission/mobile, delivery or other remaining Phase 1 gates; the release remains NO-GO until the scoped mandatory gates pass.

## October 11 UTC — live configuration and mobile Sandbox retry qualification

Production remains **NO-GO**. Live endpoint `we_1UPBsuC7UOE45wwkoOVPPShg` was created at `https://api.thelolabooth.com/api/webhooks/stripe` with API version `2026-08-26.dahlia` and implemented Checkout/payment/refund subscriptions. It remains **disabled**. Fresh production read-only preflight deployments `d9319f61-047d-42c5-97b8-b84069529032` and `614fd095-241e-4fed-9980-a34eb97b696a` verified the owner's LIVE key against `acct_1UNbACC7UOE45wwk`, charges enabled, correct endpoint configuration and matching signing secret. `STRIPE_LIVE_PAYMENTS_ENABLED=false`; temporary comparison secret was cleared. Configuration verification does not prove actual production-signed delivery or a live transaction, both NOT RUN.

Scoped application revision `f95cce5806c9c6bcfe2960b7b08770f292cf8859` passed Staging Validation run `38103577436`; staging API deployment `24351651-e4bc-4d58-abc5-cdf7bdf4faa8` succeeded. Available local suite: **644 tests, 630 passed, zero failed, 14 conditional skips**.

Authenticated browser at 390×844 on synthetic non-binding QA event `cf8d0a62-d071-4f58-a891-fe64532a1708`: notes/theme/mood/color/OWN backdrop saved, private PNG with a long filename uploaded, reload preserved all answers and file; clientWidth and scrollWidth both 390. Removed theme produced explicit missing-field list, inline error and field focus. Restored theme submitted successfully with received/review acknowledgement. Returning-client event selection worked. No inactive seeds were presented as bookable inventory. Mobile proof approval remains open.

Actual Stripe **Sandbox** declined-card then successful retry on invoice `TLBI-1022` passed:
- Before retry, read-only staging ledger deployment `f2ad7bc1-cc13-4f25-aa3a-6093bb536951` showed amount paid $30, balance $70, the exact $70 checkout PENDING with card_declined, no successful Stripe payment and no receipt record. Initial $30 was synthetic manual QA data.
- Retried the same hosted Checkout using Stripe's success test card, with saving payment information disabled. Browser returned to The Client Workspace showing PAID, $100 paid/$0 balance and both payment entries.
- Read-only ledger deployment `70973a36-a426-4d5d-b08b-c77d1e8ca52e` verified one SUCCEEDED checkout, exactly one $70 Stripe payment and exactly one persisted Stripe receipt. The UI also exposes the initial synthetic $30 manual payment's downloadable receipt. No real funds moved.
- Browser screenshots retained privately: `work/phase1-sandbox-decline.jpg`, `work/phase1-sandbox-retry-paid.jpg`; mobile planning evidence in `work/phase1-mobile-private-upload.jpg`, `work/phase1-mobile-required-field.jpg`, `work/phase1-mobile-planning-submitted.jpg`.

This closes the tested **staging declined-card → same-checkout retry → successful payment → invoice/receipt** path and editable mobile planning/upload checks. Remaining: chargeback integrity, complete campaign customer Stripe journey and template inbox checks, mobile creative approval/remaining permissions, custom quote acceptance/invoice/payment/Admin approval browser flow, populated production-file recovery, actual production-signed delivery and coordinated application/worker rollout with fresh queue/rollback checks. Automatic initial website proposals stay deferred by owner decision; Admin review is the launch path. No production GO is implied.

Receipt download follow-up: the browser refused the action with “Request a fresh sign-in link before continuing with this action” after the 15-minute document/payment verification window elapsed. No new receipt PDF download is claimed for this fixture. Previously qualified document downloads remain separate evidence; current receipt persistence and visible actions passed. Final evidence commit `bb04371ed87e2211b42352f7c488732c3215c7e3` passed hosted Staging Validation run `38107487591`.

## October 11 — campaign handoffs, dispute deployment and production recovery checkpoint

**Production remains NO-GO pending the remaining customer qualification and coordinated rollout.** Production API/worker revisions and live Stripe activation were not changed in this checkpoint.

- Chargeback integrity PR #16 merged as `cb7c815c8a8add58c832811c9fb7868e39b6fd6d`. CI `38109450377` passed: **665 database-enabled tests, zero failures, zero skips**, build and hosted browser tests passed. The dispute DB tests exercise signed handlers and canonical provider responses using simulated Stripe data; no real dispute delivery is claimed.
- Staging API `768f3553-eec3-4840-9411-d754f7fe7c73` applied migration **057_payment_dispute_integrity.sql** successfully and started. Worker `084a3b8a-6051-4d39-aa7b-176f8d2dc025` is SUCCESS on the same merged revision. Read-only check confirms reporting_payments exposes disputed_amount.
- Fresh encrypted staging backup and isolated 057 rehearsal passed on `01e6977f-36e4-4f5f-bf3c-93b4fe23aeac`. A capacity problem in the verification helper was resolved by restoring into ephemeral storage; the source database was untouched during rehearsal.
- Actual campaign customer proposal **TLBP-1016**, nonbinding staging QA only, was accepted in the browser. The worker automatically generated/sent invoice **TLBI-1023**. Stripe Sandbox checkout paid its **$299.70 booking retainer fee** on a $999 invoice; the customer return page shows recorded payment and receipt download. A first checkout connection was aborted with HTTP 499, and retry reached Sandbox successfully. No real funds moved.
- Read-only staging check `823ec6b6-d510-4e7e-81f8-15620d4f4c61`: exactly one SUCCEEDED Stripe payment, one persisted receipt, agreement SIGNED as **Jane Doe**, booking CONFIRMED, invoice/agreement/workspace handoff jobs each COMPLETED with one attempt and no error. The agreement was already signed when inspected; no second signature was submitted by the agent. Invitation delivery is SENT_TO_PROVIDER; this is not proof of inbox receipt or authenticated customer completion.
- A fresh production snapshot restored in a disposable local-only cluster; migrations **046–057** from the exact candidate applied in order, preserved contract/event counts and payment count/total, and exposed the new reporting column. `2baad125-7023-4ac4-8337-46b7c3949306` emitted `PRODUCTION_FRESH_ISOLATED_RESTORE_046_057_FINANCIAL_COUNTS_PASS`. No production schema migration or customer jobs ran.
- The actual scheduled production database backup at **08:00 UTC October 11** passed encrypted private-Azure upload/readback and isolated database restore. Earlier Azure-download/decrypt/restore qualification remains valid.
- Populated production private-storage probe `2989e29e-0503-41ff-8497-bcff88dd25af` uploaded a synthetic private file, encrypted and backed it up, downloaded/decrypted it, restored a separate private object byte-identically, and denied anonymous access. Temporary source/restored QA objects were cleaned up; the encrypted recovery artifact remains. This tests populated storage with synthetic content, not a real customer file.
- Separate planning-file backup service `466a83d0-e4b3-4cf2-a147-da47d00e39de` now has daily **08:15 UTC** cron, restart NEVER, QA probe disabled, no endpoint/volume/database access, encrypted AES-256-GCM archives and RSA-OAEP key wrapping to the existing owner recovery key. It backs up production/documents with ETag consistency checks and review limits, retains complete verified triplets for approximately 31 days, and never overwrites live assets during normal operation. Source: `ops/backups/private-production-files.mjs`. Syntax and actual populated recovery passed; first unattended cron execution is not yet observed.

### Remaining launch actions

1. Open the campaign invitation in a fresh authenticated browser session; finish its workspace/planning and inbox/template checks. Mobile creative proof approval, the remaining role/action matrix and chargeable custom-quote customer flow still require explicit evidence.
2. Finish deployed-provider dispute qualification where Sandbox access permits; distinguish real provider delivery from simulated integration evidence.
3. Review owner recovery-key custody and operational backup failure monitoring. The new planning-file schedule has been configured and manually qualified, but its first unattended run remains pending.
4. Audit production queue contents, provider/environment settings, candidate revisions and rollback; coordinate API, worker and frontend deployment, apply the rehearsed migration sequence, then qualify the live Stripe signed endpoint before enabling customer payments and fresh jobs. Do not backfill old acceptances or blindly replay uncertain delivery claims.
5. Publish the final scoped GO/NO-GO and execute only the approved rollout once applicable critical gates pass. Automatic initial website proposals remain owner-deferred; Admin-reviewed proposal delivery is the launch path. Inactive backdrop seeds and Phase 2 gallery/operations scope remain excluded.

Production queue pre-activation audit `47f5490e-cb8e-4598-ad41-265c732cd71a` passed read-only: automation_jobs has **zero rows**; API and worker PRODUCTION_AUTOMATIONS_ENABLED=false; all new handoff/reminder flags are UNSET (disabled); API STRIPE_LIVE_PAYMENTS_ENABLED=false. No queue was modified or dispatched. Temporary rehearsal source database references were cleared after the audit. The private-file cron configuration deployment `799cad12-2e2d-40cf-9de8-b0a20b19f1c4` is SUCCESS with 08:15 UTC daily and restart NEVER. Campaign agreement → Return to The Client Workspace reached the expected signed-out sign-in screen. A fresh Gmail sign-in was requested; authenticated campaign workspace completion is still pending.

## October 11 — authenticated campaign, custom quotation and mobile creative completion

This checkpoint supersedes the preceding pending-authenticated-campaign, unpaid-custom-quote and mobile-proof-review items. **Production remains NO-GO pending the remaining launch actions below. No production application rollout, migration, live payment or automation activation occurred.**

- The owner opened the campaign's Gmail invitation; its actual single-use sign-in redeemed to the approved Client Workspace. Cards/CTAs, returning-client event selection, confirmed booking and unlocked planning were verified. The signed agreement and retainer receipt downloaded using actual authenticated controls. The 12-page agreement's branded first/signature pages and the receipt were rendered and inspected; this checkpoint does not claim a new visual review of every intermediate agreement page.
- At 390 × 844, actual campaign planning saved theme/mood/color and CUSTOM backdrop, declared no assets needed, showed required-field shortcuts and submitted successfully. Admin observed SUBMITTED, reviewed the request, and could not approve planning before backdrop confirmation.
- With explicit owner authorization, the separate **$10 staging-only, nonbinding custom quote** was accepted as “LOLA Staging QA Only”. Quote `8919e278-7c9f-4a2b-9c16-3e2aeba9bd09` linked to dedicated invoice **TLBI-1024**, `b4cac73e-fd66-4e45-b18f-676bf1262d90`. Before payment, Admin backdrop confirmation rejected the action for missing required net payment; planning approval was also rejected. No prerequisite was bypassed.
- The 15-minute workspace payment/document verification window elapsed and the actual sensitive action correctly required a fresh sign-in. The explicitly approved Sandbox payment continued through the issued public secure invoice payment link. A test card paid $10, with saving payment information disabled; the return page showed PAID/zero balance and a receipt. No real funds or design/fabrication obligation were created.
- After reconciliation, Admin confirmed the CUSTOM backdrop and approved planning. The workspace persisted the paid custom invoice alongside the original $999 booking invoice; its booking balance remains $699.30. Booking confirmation stayed independent of equipment assignment.
- Admin prepared one synthetic proof using an existing public LOLA image, scoped to the selected Glam experience's **overlay and welcome screen**. Actual mobile approval persisted APPROVED/production version 1 and appeared in Admin activity. Internal creative notes remained NOT_STARTED; they were not manually changed to pretend to satisfy component coverage. The synthetic approval does not supply production backdrop inventory.
- Read-only staging identity-checked verification deployment `022911b0-b415-4777-a1b8-c41767d38025` emitted `CAMPAIGN_CUSTOM_QUOTE_MOBILE_CREATIVE_PERSISTENCE_PASS`: event CONFIRMED, planning APPROVED, CUSTOM backdrop CONFIRMED, accepted $10 quote with linked PAID $10 invoice, **exactly one** SUCCEEDED Stripe payment and matching receipt, approved creative record containing both required components. This runner made no database writes.
- Current staging API/worker deployments `90acbfbb-3f70-4a50-bc29-d117c9ceb668` and `0052afb3-381d-44d3-b027-c1c40e7c7ce1` were checked SUCCESS on `94dd24896328d99f301423cd28739a2791a58763`. No application code changed in this checkpoint. Latest full enabled CI evidence remains 665 passes, zero failures/skips on the qualified application candidate.
- Private screenshots: `work/phase1-campaign-mobile-planning-submitted.png`, `work/phase1-custom-quote-awaiting-acceptance.png`, `work/phase1-custom-quote-paid.png`, `work/phase1-campaign-mobile-creative-approved.png`. Temporary viewport override reset. No sign-in/payment tokens or credentials are committed.

### Updated scoped gate assessment

Campaign accepted-offer → invoice → Sandbox minimum payment → receipt/agreement → signature/confirmation → invitation redemption → mobile planning → Admin approval → component-scoped creative approval is COMPLETE for this tested synthetic customer path. Custom quote acceptance/invoice/payment authorization and mobile proof approval are COMPLETE for the tested path. Ten collection seeds remain intentionally inactive; galleries and event-day operations remain Phase 2. These statuses do not waive other mandatory gates.

Remaining before production GO:
1. Finish the remaining in-scope role/action matrix and mandatory preloaded/generated communications inbox/content verification. Owner invitation redemption proves that invitation's delivery, not every reminder/receipt/template.
2. Resolve future proposal template wording/contact defaults (legacy “Deposit”/date-securing text and placeholder contact were observed); preserve immutable accepted commercial records.
3. Finish provider dispute delivery qualification where Sandbox access permits; production endpoint still lacks the five implemented dispute subscriptions. Simulated signed-handler coverage is not actual provider delivery.
4. Verify recovery-key custody and backup failure monitoring; first unattended planning-file cron is not yet observed.
5. Coordinate production API/worker/frontend and rehearsed 046–057 migrations with current target/queue/backup/rollback preflight. Qualify live signed Stripe delivery before enabling live payments/new customer jobs; retain no-backfill/uncertain-delivery safeguards.
6. Publish the final scoped GO/NO-GO against these remaining checks. The owner has authorized deployment, but an unfinished launch gate is not a production-ready result. Initial website proposals remain Admin-reviewed, as owner deferred automatic service-area pricing.
