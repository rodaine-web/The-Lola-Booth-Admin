# LOLA Campaign Management — staging handoff

Implemented on `main-staging` in `work/lola-admin`. No deployment, migration against a live database, or real email send was performed.

## Delivered

- Grouped, expandable navigation with existing routes, permission/feature filtering, session persistence and automatic expansion of the active group.
- Campaign list with filters and four-step creation: Campaign, Recipients, Offers, Review & send. Text uses a message form; HTML accepts pasted code or an uploaded .html file. The approved Year-End template remains available.
- Reusable campaign records; the initial channel is EMAIL. SMS is reserved in the data model; SMS delivery is not implemented.
- Corporate Year-End template uses the supplied HTML layout and extracted images, compressed as public assets. Structured prices, features, copy, image URLs, subject, sender display name, reply-to and footer are editable.
- Glam $999, 360 $1,099 and Duo $1,799 for four hours; computed $299 saving. Extra hours $200/$250/$350. A mailing address must be supplied before live queuing.
- Downloadable Excel Contacts template with instructions and consent dropdown. Excel/CSV imports validate headers, email addresses, length, row limits and consent; review errors and duplicates before adding recipients. Imported phone numbers persist through explicit lead conversion.
- Catalog experience, package and add-on selection; editable price/features; percentage or dollar discounts. Email offers display a struck-through original price, discounted price and savings. Selected experience/package preferences carry into new leads upon explicit conversion.
- Audience selection from leads, clients, associated company strings, sources, client tags, and explicitly consented manual recipients. Email normalization, deduplication, marketing consent and suppression exclusions. There is no separate Company entity in the current CRM.
- Existing Microsoft email provider, communications records and worker reused. Batches of 25; atomic claims; pause/cancel block future claims. Already claimed sends can finish. Unknown outcomes require provider review and are never automatically resent.
- Personalized preview and explicit test address. Test sends do not create campaign recipients or influence analytics. Test email links use a nonfunctional `preview` token: use a QA campaign to verify form submissions.
- Secure public interest and unsubscribe routes, hashed random tokens, expiry, existing public mutation rate limiting, honeypot and server validation. Interest records, CRM activity and notifications; explicit lead conversion; no automatic event/proposal/invoice.
- Detail tabs: Overview, Recipients, Interested, Content, Activity, Settings. Microsoft acceptance is recorded as Sent to Provider. Delivered/opened/clicked display Unavailable because the current provider has no connected tracking events. A deduplicated internal adapter supports future verified provider events; no unauthenticated provider webhook was added.
- Marketing unsubscribe suppresses future campaigns and preserves transactional messages.

## Files changed

New:
- `server/migrations/037_campaign_management.sql`
- `server/src/routes/campaigns.js`
- `server/src/services/campaign-service.js`
- `server/src/services/campaign-email.js`
- `server/src/templates/corporate-year-end.html`
- `shared/campaign-content.js`
- `public/campaigns/year-end-2026/{logo.png,hero.jpg,glam.jpg,360.jpg}`
- `src/pages/Campaigns.jsx`
- `src/pages/CampaignInterest.jsx`
- `test/campaign-content.test.js`
- `test/campaign-service.test.js`

Updated:
- `.env.example`
- `server/src/routes/admin.js`, `server/src/routes/public.js`
- `server/src/services/automation-service.js`, `server/src/services/email-service.js`
- `server/src/worker.js`
- `src/App.jsx`, `src/components/Layout.jsx`, `src/pages/Communications.jsx`
- `src/styles/reference-design.css`
- `test/phase2-static.test.js` (asserts grouped navigation)

## Migration and permissions

Migration 037 creates campaigns, campaign recipients, interests, events and email suppressions; adds campaign linkage, sender display name and reply-to to communications; seeds one DRAFT campaign without recipients.

Permissions: `campaigns.read`, `campaigns.create`, `campaigns.edit`, `campaigns.send`, `campaigns.schedule`, `campaigns.cancel`. Granted to existing OWNER/ADMIN/SUPER_ADMIN roles. Explicit conversion also requires `write:sales`. Re-login after migration so session permissions refresh.

## Routes

Frontend:
- `/communications/campaigns`
- `/communications/campaigns/:id`
- `/interest/:token` (public)
- `/unsubscribe/:token` (public)

Authenticated API:
- GET `/api/campaigns`, `/api/campaigns/contacts`, `/api/campaigns/:id`
- POST `/api/campaigns/audience-preview`, `/api/campaigns/import-contacts`, `/api/campaigns`
- PATCH `/api/campaigns/:id`
- POST `/api/campaigns/:id/{duplicate,preview,test,send,schedule,pause,resume,retry,cancel,archive,ready}`
- POST `/api/campaigns/:id/interests/:interestId/convert`

Public API:
- GET/POST `/api/public/campaigns/interest/:token`
- GET/POST `/api/public/campaigns/unsubscribe/:token`

## Environment and worker

- `CAMPAIGN_PUBLIC_ORIGIN=https://stagingadmin.thelolabooth.com` — must be the publicly accessible frontend serving the interest routes and assets. No trailing path, localhost, HTTP, or authentication-protected recipient pages.
- `CAMPAIGN_JOBS_ENABLED=false` — safe default. Set to `true` only when intentionally running campaign delivery.
- Retain existing staging environment flags, Microsoft credentials, and staging email recipient allowlist. The allowlist remains enforced; this feature does not bypass it. Set the existing staging email enablement only for QA addresses.
- Existing database/JWT/client origin and email/notification configuration remain required. No new provider credentials.
- Run the existing worker (`npm run worker`). Campaign processing is explicitly opt-in and can run while unrelated staging automation remains paused.

## Verification

Composer follow-up: **491 tests; 486 passed; 0 failed; 5 existing skips**. Build and whitespace checks passed. Additional coverage includes discount rounding, actual catalog package price/hour fields, text and HTML rendering, HTML sanitization, merge fields, CSV/XLSX validation and shipped template round-trip, invalid custom interest selections, and selected experience/package/phone persistence on explicit lead conversion. These service tests mock database responses. Migration 038 and the new UI still need live staging verification.

Initial campaign sprint verification:

Full automated suite: **475 tests; 470 passed; 0 failed; 5 existing skips**. Includes 33 new campaign tests. Build passed with `npm run build -- --configLoader runner`. Whitespace check passed.

Tests exercise HTML generation, escaping and merge fallback, HTTPS links, template features, consent/deduplication, hashes, validation, queue-only requests, permissions, CRUD, audit, scheduling validation, worker claims, provider acceptance/failure, pause/cancel, unknown outcomes, unsubscribe, interest deduplication, notifications and explicit conversion.

Database tests use mocked PostgreSQL responses. They do not prove that migration SQL or queries execute against PostgreSQL. No live database integration, end-to-end browser session, actual mail delivery, Outlook render, or 375px visual verification was completed. This environment refused local network binding and PostgreSQL shared memory; its browser also refused local file navigation. The static HTML review file is provided for manual review, not as evidence of completed browser verification.

## Manual staging deployment

1. Review this change on `main-staging`. Back up the staging database. Keep campaign jobs disabled and do not target production credentials.
2. Apply migrations with `npm run db:migrate` using the staging connection. Verify migration 037 and its seeded DRAFT, then migration 038 (selected experience interest keys and recipient phone). Migration 037 is already applied to staging; 038 has not been applied here.
3. Deploy the admin frontend/API through the existing Vercel process, and update/restart the existing worker with the matching code. This has not been performed here.
4. Configure the public origin above. Verify public interest routes and all four HTTPS assets are accessible without admin login or Vercel protection. Email clients cannot use protected image URLs.
5. Re-login as an admin; verify campaign permissions and grouped sidebar.
6. Supply the real business mailing address in Content. Save and preview. Inspect desktop/mobile and Microsoft Outlook before authorizing QA sends.
7. Select only explicit QA recipients with marketing consent and the staging allowlist. Send a test first, then a small QA campaign for valid interest tokens. Enable campaign worker and existing staging email policy only for this controlled test.
8. Complete the checklist below. Return jobs to disabled until campaign launch is approved.

## Manual QA checklist

- Sidebar: group persistence, correct active route, mobile menu, low-privilege filtering, all previous routes still available.
- Campaign: seeded draft, create/edit/save/duplicate, all filters, company/tag/source selection, deduplication and accurate exclusion count. Missing consent and suppressed addresses are excluded.
- Content: compare supplied mockup at desktop and 375px; logo, hero and package photos, typography, spacing, three prices, saving, features, extra-hour prices and footer. Edit structured fields and confirm email output changes. Outlook should retain usable tables, image proportions and CTA links.
- Personalization: both names populated, missing company, missing first name, escaped special characters; no raw merge placeholders.
- Delivery: test is flagged and excluded from campaign metrics. Immediate send queues first, worker sends once, future schedule does not send early, correct timezone, pause/resume/cancel leave already accepted recipients unchanged. Duplicate does not retain audience/send history. Known failures can retry; uncertain outcomes cannot.
- Interest: main and three package CTAs, preselection still changeable; no login; required package/date/time; location optional; invalid/expired tokens; honeypot; repeat submit produces one response and one notification. Verify thank-you summary and CRM timeline. Verify configured admin notification preferences/email.
- Conversion: existing lead links without duplication; client can open existing record; explicit conversion creates or finds the lead; existing proposal wizard can be opened. Interest alone creates no event, proposal or invoice.
- Unsubscribe: valid and expired/archive marketing links can unsubscribe; future campaigns exclude email; CRM consent updates; normal transactional email remains unaffected.
- Security: unauthorized campaign read/edit/send/convert denied; public routes expose no CRM IDs or full records; hosted pages and API origin integrate without CORS/fetch errors.
- Metrics: provider acceptance count, interested count, failures and recipient activity; unsupported engagement metrics remain Unavailable.

## Current limitations

- Live PostgreSQL and browser/Outlook QA are mandatory before considering this ready for customer delivery.
- Scheduling is available for drafts; rescheduling a queued campaign currently requires cancellation and a fresh duplicate draft.
- Existing media library can provide hosted URLs; an embedded campaign media picker is not included.
- The test preview token intentionally cannot register interest. A QA-only campaign is needed for end-to-end submission testing.
- Existing notification email delivery behavior is reused. Its external email side effect occurs within the interest transaction; provider review may be needed after a crash during notification delivery.

## Staging database verification update

The user ran the prepared Railway SSH checks from their Terminal. The service confirmed `APP_ENV=staging` and the staging admin origin before connecting. PostgreSQL 18.6 was reachable. Migration 037 passed its rollback trial and was then applied to the staging database. All 14 reported checks passed: migration SQL, draft/channel defaults, duplicate recipient and interest constraints, invalid status/package constraints, hashed token resolution, event idempotency, suppression, six permissions and administrator grants, test rollback, final migration application and draft seed. All five tables now exist. No synthetic records remain and no emails were sent.

The hosted `/communications/campaigns` route currently returns Page not found, so browser/API end-to-end tests still await deployment of the campaign application commit. Local GitHub access is blocked by this session's DNS/network restrictions. The branch has not been pushed. Earlier statements about migration not being executed refer to the initial implementation checks, before this staging verification.


## Composer follow-up staging checks

- Apply migration 038 before using updated queue or conversion code; deploy matching API, frontend and worker.
- Create one Text and one HTML draft. Paste/upload the supplied HTML and confirm its table layout in the preview.
- Download the Excel template from Recipients. Import synthetic contacts, including a phone with a leading +, duplicate emails, invalid emails and Yes/No consent; confirm review and exclusion counts.
- Select a catalog experience and package. Confirm starting price and included hours populate correctly; choose an add-on. Test percent and dollar discounts, zero discount, and invalid values above 100% or the original price.
- Preview desktop and 375px. Check crossed-out prices and selected offer CTAs in Outlook.
- Send only to authorized QA addresses under the existing staging policy. Submit interest, verify the selected experience is preselected, and explicitly convert it to a lead. Check phone and preferred experience/package in the proposal wizard.
- Preserve existing year-end draft behavior and unsubscribe/consent exclusions. No real email was sent during implementation.
