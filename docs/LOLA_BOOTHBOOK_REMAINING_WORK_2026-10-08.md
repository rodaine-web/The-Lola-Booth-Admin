# BoothBook parity: staging release and remaining work

Updated 2026-10-08. Overall status: PARTIAL. Production: NO-GO.

## Staging deployment evidence

Admin/API/worker release: `87a701bc295363e4f0517642aa74580ec3a1be18` on `main-staging`.
Vercel staging deployment `dpl_3GkF8Jj26z6Lvq4HskmB1pEhMems`: READY. Railway API `b5acac28-c0be-414a-a527-038b161fa656` and worker `69082324-39cc-4b47-817a-29be0b709697`: SUCCESS. Vercel labels the staging project's primary branch target “production”; this is the isolated staging project, not LOLA production.
Website staging source PR: https://github.com/rodaine-web/staging/pull/4, merged. Hosted website assets are bundled in Admin public/staging-site.

Fresh staging backup restored successfully before additive migration 054. Archive checksum b009b3b7f48a6e1915303c707e42c9a53bed3a734358553077417aaa9669fb3f. Migration applied with database identity and 053 prerequisite checks. Retain encrypted backup and separate key securely. Code rollback does not roll back data; retaining the additive quota table is safe for the previous code. Restore only through a controlled recovery procedure.

Hosted availability page, booking JS/CSS, illustration, API health and catalog return 200. JS/CSS match reviewed source. Browser confirms independent Glam Signature and 360 Luxe selections, extra-hour quantity 2 retained when adding Vogue, unchecked marketing consent and no overflow at the observed 773px viewport. Specific 375/390/1280px checks remain unqualified; do not treat the browser's unchanged viewport override as a pass.

Automated checks: 613 admin tests, 603 PASS, zero FAIL, 10 SKIPPED; frontend build PASS; 18 website tests PASS. Eleven real PostgreSQL/router checks passed against a disposable staging restore, including duplicate/concurrent inquiry handling, validation, persistence and distributed quotas. These are not full hosted workflow certification. Runtime dependency audit reports zero known vulnerabilities.

## Remaining implementation

| Priority | Requirement | Status and remaining work |
|---|---|---|
| 1 | Complete online booking, audit 40–41 | PARTIAL: inquiry exists; connect public availability, physical capacity, temporary hold, contract, checkout and atomic confirmation into one customer journey. |
| 1 | Experience/package resource mapping, 19–23/41/48 | PARTIAL: unit holds and conflict guards exist; map purchasable experiences/packages to real equipment and backdrop capacity. |
| 1 | Ten physical backdrop assets and inventory, 21 | BLOCKED: supply usable individual files and actual stock; keep inactive zero-stock seeds inactive. Generated add-on illustrations do not establish inventory. |
| 2 | Travel fees, 42 | PARTIAL: manual charges exist; implement distance/radius/mileage rules, provider calculations and audited overrides. |
| 2 | Installments, 44 | PARTIAL: deposit/balance and custom payments exist; implement installment schedule records, due dates, UI and reconciliation/reminder behavior. |
| 2 | Configurable planning/creative and add-on rules | PARTIAL: explicit creative component mapping and compatibility fallbacks exist; complete editable catalog rules and package image/duration content. |
| 2 | Custom backdrop amendments | PARTIAL: acceptance/invoice/net-payment guards exist; complete controlled changes to linked financial terms and resulting invoice resolution. |
| 2 | Post-event growth, 49 | PARTIAL: campaign flow exists; complete event-driven segments, review/referral/anniversary/reactivation workflows. |
| 2 | Reporting, 51 | PARTIAL: real metrics exist; finish package/source/lost-reason/resource/backdrop utilization drilldowns. |
| 2 | Incoming email in Messages | PARTIAL: Microsoft sending exists; mailbox replies are not synchronized into portal threads. Incoming-mail subscription/polling, mapping and deduplication remain to be implemented. |

The older 55-section audit contains baseline gaps superseded by subsequent evidence. Do not rebuild existing booking holds, signatures, client workspace, planning, creative revisions/readiness, custom backdrop payment guards, recurring reminder ledger or Appearance & Display preferences. Dashboard planning/creative deadline attention links already exist.

## Implemented but still requiring qualification

Mandatory A–J gates remain open as a complete certification set:

- Newly booked event → automatic planning invitation → coherent customer workspace; controlled client changes and administrative acceptance.
- Physical backdrop selection/reservation conflicts and custom quotation → acceptance → dedicated invoice → net payment, including refund resolution.
- Private Azure documents/gallery upload/download, invalid/oversized files, cross-client denial and usable delivered gallery.
- Creative component completion/current-version approval, role/email denial and mobile journey; prior V1→changes→V2 approval evidence is retained.
- Stripe hosted deposit/balance, receipts, repeated webhooks, refunds and failure handling through the actual staging UI/provider.
- Concurrent booking/rescheduling/cancellation journeys against actual inventory; SQL/service tests alone do not certify the UI.
- Approved reminder delivery, cadence/retry/revocation/cancellation. Automatic dispatch remains paused.
- 375/390/768px planning/upload/approval and field-staff journeys; Appearance Day/Night/Auto contrast, chart palettes and preference isolation.
- Full altered-request RBAC matrix for financial, files, staff, campaign and settings actions.
- Outlook calendar synchronization and Meta lead capture, field mapping, attribution and deduplication; connected indicators are not qualification.

## Email activation for owner testing

Owner authorized staging email activation on 2026-10-08. STAGING_EMAIL_ENABLED=true applied to staging API and worker. Sending remains limited to olawandeadams@gmail.com and info@thelolabooth.com with staging subject tags. Automation/campaign/planning dispatch flags remain false; historical pending jobs are not resumed. Incoming mailbox delivery is handled by Microsoft 365; portal inbox synchronization is absent. Actual delivery/receipt must be verified by an approved recipient before declaring that gate complete.

## GO / NO-GO

Staging deployment: GO for controlled owner testing. BoothBook sprint completion: NO-GO. Production promotion: NO-GO until remaining agreed requirements and all mandatory A–J gates pass with persisted workflow, permission, failure, provider and mobile evidence. External dependency failures and skipped tests must be explicit. No production deployment or configuration changes were made.

References: LOLA_BOOTHBOOK_PARITY_AUDIT.md, LOLA_STAGING_QUALIFICATION.md, LOLA_BOOKING_FORM_TEST_REPORT.md and LOLA_BOOKING_FORM_STAGING_UAT.md.
