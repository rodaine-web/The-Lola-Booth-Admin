# LOLA non-payment hardening — initial audit

This is an implementation ledger, not a completion certificate. Scope authorized September 22, 2026. The user explicitly excludes payment execution and requires item-level CMS ownership and lifecycle proof.

## Interrupted work reconciliation

The last usage-limit failure in **Build LOLA admin portal** occurred during the Stripe Test Payments + CSP Production Sprint. Raw-body webhook ordering and related source changes subsequently landed, but provider configuration and actual payment tests remained incomplete. Under the current non-payment scope those payment tasks remain **DEFERRED — NEXT SPRINT** as explicitly confirmed by the user. Public CSP, document/email formatting and all applicable non-payment follow-up are included here.

Earlier local document/email work is committed in 4126cac and deployed with the CMS work. It is subject to renewed live verification. Migration 021 and the CMS import are applied: 64 CREATE, 17 UPDATE, 41 SKIP; immediate repeat import yielded 122 SKIP. That does not establish full CMS lifecycle certification.

## Initial defect map

| Area | Current state | Defect / uncertainty | Root cause / evidence | Planned fix |
|---|---|---|---|---|
| Database/API/worker | API and worker deployed at 855f5cd | Prior audit found migrations 016–020 missing | Code expects newer communications, proposal and user columns | Recheck production, restore fresh backup locally, rehearse missing migrations before production application |
| Invoice opening — P0 | getInvoice selects p.proposal_title | Likely missing-column failure; exact production query verification in progress | proposal_title introduced by unapplied migration 020 | Reproduce, repair schema dependency, verify detail/PDF/public link; retain clear HTTP error categories |
| Users — P0 | API lifecycle routes exist; current UI is incomplete | Migration dependency; no complete dedicated management UI | User fields/tokens introduced by 020; navigation permission differs from API | Complete UI, audit server authorization, use isolated QA identities for lifecycle and denied actions |
| CMS data | 16 packages, 4 experiences, 6 hero, 10 gallery, 6 events, 40 FAQ imported/preserved | Item-level audit and each-type lifecycle proof incomplete | Existing page text grouped in JSON; some controls not independent | Inventory latest approved content; normalize eligible items and implement practical editors/publication controls |
| CMS publication | Collection filtering implemented | Page-copy/media/hero static fallback could survive intentional absence | Renderers returned early when records absent | Local fixes pending; test successful-empty response separately from network failure |
| CMS package editor | Save endpoint returned 200 | Experience selector fails | Picker selects nonexistent experiences.category | Select existing slug; verify UI and persisted relationship |
| Public media | Persistent uploaded files exist | Cross-origin policy and shared 120-request API quota need correction | Helmet same-origin policy; images consume shared application quota | Public-permitted media response policy and separate bounded image quota; verify actual browsers |
| Forms/email | Submission and Graph provider code exist | Live delivery, durable retries and history not certified | Public form sends catch delivery errors without durable retry orchestration | Verify persistence independent of email; enqueue/log retryable communications and test controlled inbox |
| Document previews | PDF generation improvements deployed | Admin alignment/preview workflows still require inspection | Invoice detail lacks an integrated preview; existing embedded previews need sizing checks | Shared consistent preview experience; actual multi-page visual verification |
| Dashboard | Existing Recharts trend and many KPI cards | Funnel/source interactions and hierarchy incomplete | Funnel uses static articles; source breakdown is table only | Neutral/gold charts and correctly filtered click-throughs with real data |
| Navigation | Finance has Invoices and Payments only | Actual duplicate editors: Website vs Content packages/experiences; ambiguous Events/Galleries labels | Multiple routes reuse same resources | Consolidate entry points, distinguish website event types from booked events and public gallery from delivery galleries; retain unique finance functions |
| /connect | Approved public contact hub | New request also asks for integration diagnostics | Public purpose differs from administrative diagnostics | Preserve contact hub; authenticated diagnostics with safe status/counts |
| Careers | Previously 404; no approved source | No content to migrate | Missing original page/copy | Record explicit content gap; provide maintainable CMS support without inventing approved copy |
| Storage/automations/auth | Foundations exist | End-to-end/redeploy/denial evidence incomplete | Prior reports often static or local only | Controlled non-payment fixtures, worker state transitions, persistent retrieval and server-side RBAC tests |
| Visual/accessibility | Prior desktop/mobile checks exist | New changes and tablet flows need complete verification | Earlier evidence not sufficient for this expanded scope | Browser/network checks and screenshots across Admin/public/emails/documents |

## Release evidence required

- Item-level CMS parity: live page, section, item, CMS record, ID/slug, published, media, order, API/rendered, edit/replace/unpublish, status.
- Counts: live dynamic items, created, updated, published, skipped, unmapped. Supported unmapped must be zero.
- Representative lifecycle per major CMS type: save/publish, applicable asset replacement, order, unpublish, reload absence, republish and restoration.
- Pricing parity across homepage, package page and CMS; four experiences in Glam/360/Vogue/Audio order.
- Form results: submit, DB, Admin, owner email, customer HTML email.
- Navigation decisions; functional matrix with evidence and unresolved issues; exact tests/build/deployment results.
- All payment execution/provider validation marked DEFERRED — NEXT SPRINT, not PASS or FAIL.

## Confirmed scope and QA recipients

Payments remain **DEFERRED — NEXT SPRINT**. Controlled QA email recipients are funmimasha@gmail.com and olawandeadams@gmail.com. No test messages are authorized to real customers.

## Implementation checkpoint — September 24

- Production schema recovery 016–020 completed after backup and restore rehearsal. Fixed migration 018's nonexistent documents-table references. The previously failing invoice detail opened in live Admin after recovery.
- Remaining migrations 022–023 are implemented and rehearsed on a fresh production backup, and **applied to production September 24 at 12:37 UTC**. They add direct user permissions, independently published page items/image mappings, and typed experience/event presentation fields. Backfill preserves existing publication states and current values.
- Users management now has a dedicated interface, canonical privilege assignment, role hierarchy checks, invitation lifecycle, session revocation, and concurrent single-use setup-token enforcement.
- PDF previews now render actual PDFs with centered pages and fit-to-width scaling. Desktop/tablet/mobile browser checks passed; new draft invoice editing and proposal editing have passed API checks and are undergoing renewed browser checks.
- Draft invoice editing recalculates totals and rejects sent/paid documents. Proposal edits preserve quoted custom services and create version history; public acceptance's missing activity-log import is fixed.
- Public forms persist two scheduled branded HTML communication records; local worker processing succeeds. Microsoft production delivery is not yet certified.
- CMS lifecycle integration checks cover page items, hero, gallery, event types, testimonials, FAQs and image mappings. The remaining live Admin lifecycle matrix is not yet certified.
- Public images have an independent request quota and public cross-origin policy. Website rendering treats successful empty collections as intentional absence; API failure alone can use static resilience content.
- Authenticated CMS connection diagnostics expose counts/import time without credentials. Request logging removes document tokens, query strings, cookies and authorization values.
- Dashboard funnel/source charts and filtered destinations are implemented; four date-range API checks pass. Responsive dashboard browser checks are in progress.

## New upstream content and publication decision

The website advanced from 1e99d17 to **3707f3e** during this sprint. The working copy now preserves those updates: partner logos, brand-activation content and three testimonials. Three partner-image references used nonexistent extensions; local references now match the uploaded JPG assets.

The refreshed inventory contains 12 pages, 923 page-copy slots, 25 image assets, 16 packages, four experiences, six event types, six hero slides, ten gallery items, 40 FAQs and three testimonials. These are source inventory counts, **not a certification of published production records**.

Read-only production audit found all 25 website_content records in DRAFT, with updates on September 23 around 16:36–16:39 UTC. The import protects these manual changes. A question is pending whether to preserve the drafts or reconcile/publish the latest live content.

The latest homepage source explicitly labels the three testimonial quotations as awaiting client wording approval, although they are visible in its markup. A separate question is pending whether to retain them published or keep them as CMS drafts. Local fixtures preserve the source wording for verification only.

No CMS migration PASS or release-ready verdict is justified until these publication choices, production deployment, live lifecycle tests and controlled delivery evidence are resolved.


## Latest local verification — September 24

- Unit suite: **156 passed, 0 failed**; production client build passed.
- Disposable-database integration: **16 groups passed**, covering migrations, authorization, users, documents, CMS lifecycle, forms and worker delivery with a development mail provider.
- Public browser checks: **12 routes at 1440, 820 and 390 pixels**, including pricing, edited API values, intentional unpublish and genuine network-failure fallback.
- Admin browser checks: dashboard filters, user save and centered multi-page PDF preview at those three widths. Mobile navigation now collapses behind an accessible Menu control.
- Visual email pack: **5 email types at 2 widths (10 checks)**; no horizontal overflow or broken images. Proposal and invoice PDFs rendered, and invoice QR verified.
- Invitation and password-reset delivery failures are recorded distinctly in audit history; provider acceptance is not labeled inbox delivery.

These are local results. Production release, controlled real email delivery, item-by-item published parity, and live Admin/public lifecycle evidence remain outstanding.
