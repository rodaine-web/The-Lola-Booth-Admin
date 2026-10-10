# Phase 1 release readiness — 10 October 2026

**Production: NO-GO. Staging: available for owner testing.** Application revision `b4f9cc8810cf9714a545dcb0f9277126e0ca0386`; migration ledger through 056. This report supersedes earlier checkpoint statements about Railway connectivity, equipment-gated confirmation, paused reminders and unqualified payment replay/refunds. Production was not changed.

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
| Mobile planning and correction | PARTIAL | Authenticated 390px workspace/planning; no document overflow; specific required-field links; saved answers; custom-backdrop request and no-assets declaration; submit, Admin correction, client resubmit and persisted audit. Final approval correctly rejects an unconfirmed custom backdrop. No paid custom-work prerequisite bypassed. |
| Reusable/preloaded templates | COMPLETE for tested delivery | Existing template renders with persisted identity/version; newly created reusable template renders merge data, actual Microsoft acceptance, duplicate send suppressed. New QA template archived after testing. Inbox/content approval and campaign broadcasts remain separate gates. |
| Campaign lifecycle | PARTIAL | Hosted service checks created one campaign proposal under concurrent preparation; accepted-price invoice and actual Microsoft invoice delivery; synthetic manual QA minimum payment → one issued agreement and WON client classification; no premature confirmation/workspace. Full hosted campaign customer/browser journey remains required. QA event cancelled after this test. |
| Approved workspace / signed PDF presentation | PARTIAL overall | Owner confirmed corrected workspace works; earlier hosted branded signed PDF inspection. Current hosted access returns a signed PDF; full fresh-session mobile document/payment actions remain required. |

Provider acceptance is not proof of inbox receipt for every message. Owner confirmed prior smoke-email receipt, not every new reminder/refund email.

A small follow-up adds The Client Workspace return links to the authenticated planning header and submission confirmation; token-based legacy planning is unchanged. Frontend build and diff checks passed; staging browser verification of this follow-up is required.

## Mandatory A–J gates

Original acceptance definitions remain in `LOLA_STAGING_QUALIFICATION.md`. Phase 2 exclusions do not waive Phase 1 privacy, payment or planning dependencies.

| Gate | Current status | Remaining qualification |
|---|---|---|
| A Booking → planning | PARTIAL | Full campaign browser lifecycle and final submitted-detail approval with eligible backdrop/creative requirements. Normal booking handoffs and equipment-free confirmation have hosted evidence. |
| B Backdrop | BLOCKED for production inventory; PARTIAL for logic | Ten inactive seeds stay inactive. Supply usable assets and actual inventory; qualify eligible selection/conflict and custom quote → acceptance → invoice → payment → work authorization. Unpaid custom work is correctly blocked. |
| C Private client assets | PARTIAL | Confirm durable production storage, valid/invalid/oversized upload and actual cross-client denial on the deployed storage provider. No-assets planning declaration passed. Event-day files/galleries are Phase 2. |
| D Creative approval | PARTIAL | Earlier hosted V1/change/V2 evidence and current reminder stop evidence exist; finish current full component/readiness workflow with eligible production assets. |
| E Payments | PARTIAL | Real TEST payment/replay/refund and receipt ledger passed. Complete balance/full and mobile Checkout, interruption recovery, chargeback and customer receipt/document journeys. |
| F Availability | PARTIAL | Restored DB and CI concurrency/expiry/conflict checks passed. Equipment assignment is not confirmation prerequisite. Remaining customer/reschedule inventory journeys need qualification. |
| G Automations | PARTIAL | Handoffs and reminder provider acceptance/dedup/stop passed; staging reminder activation audited. Finish generated/preloaded campaign delivery and inbox checks. Campaign broadcasts remain disabled. |
| H Mobile | PARTIAL | 390px authenticated planning save/review/submit/correction passed. Finish actual documents/payments, uploads and creative proof at required breakpoints. Staff workflows are Phase 2. |
| I Appearance | PARTIAL | Earlier settings smoke evidence exists; complete deployed contrast/mode/palette persistence matrix. |
| J Permissions | PARTIAL | Hosted client ownership/expiry/CSRF/logout and agreement read/write/session checks passed. Complete remaining in-scope role/action matrix and grant revocation. |

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
3. Complete mobile document/payment and remaining role/expiry/revocation matrix; verify inbox delivery/content for mandatory customer communications.
4. Re-audit queues, backups, target revisions/provider configuration and rollback before production activation. No unresolved critical financial, privacy, confirmation or delivery defects.
5. Present the concrete production rollout to the owner and obtain explicit approval. **NO-GO until these conditions are met.**

## Return-navigation follow-up qualification

Frontend revision `851ebf9726d4d27b0d6ddbf11e98844d49a7af99` is READY on the staging Vercel project (deployment `dpl_AphWuXY5VXnyoM89ra5eT9s52zo7`, aliases stagingadmin.thelolabooth.com/staging.thelolabooth.com). Backend qualification remains b4f9cc8; no backend behavior or schema changed in this follow-up. GitHub run `38078144644`, job `114289334029`: all validation steps PASS, including automated tests, full disposable DB suite, build and CI browser journey. Local build/diff checks also passed.

At 390px the new planning header return link rendered and navigated to /client. The previously authenticated session expired by this final reload; the post-submit return action's current authenticated presentation and mobile payment/document journeys remain unqualified. The earlier authenticated submission/correction/resubmission evidence is valid and is not replaced with an expired-session rendering claim. Production remains NO-GO.
