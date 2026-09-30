# Gallery + Admin experience staging candidate

## Scope and safety

The three owner-provided Gallery reference images dated September 29 are the visual references. Changes are prepared on `codex/gallery-experience`. Production deployment is not authorized. No production records, secrets, provider mode, email state, website content, or integrations were changed in this sprint. All populated visual fixtures are synthetic local QA records; sample images are existing LOLA promotional assets, not copied operational customer galleries.

## Evidence

Local API: `http://localhost:4409`; local preview: `http://localhost:5179/gallery`. The independent local PostgreSQL database contains migrations through `030_gallery_person_download_controls.sql`.

Full test suite: 264 passed, zero failed, zero skipped, with the database-backed tests enabled. Staging-targeted Vite build passed; existing approximately 503 KB application chunk warning remains. `git diff --check` passed. Screenshot/PDF evidence is in `audit-output/gallery-experience/` (ignored local artifacts). Paid/refunded PDF variants are explicitly layout simulations, not executed charges or refunds.

| Area | Status | Evidence | Remaining issue |
|---|---|---|---|
| Gallery data model | PASS | Unique event album; typed grants; same-album composite assignment foreign keys; forward migrations 029/030 | Staging migrations 029 and 030 verified in deployment logs |
| Album access | PASS | SQL-backed full approved album authorization tests | Hosted storage qualification |
| Personal access | PASS | Only assigned visible media; cannot switch to album route; many-to-many tests | Hosted storage qualification |
| QR | PASS | Generated QR decoded in tests to typed secure URL | Scan hosted QA grant after bucket setup |
| Codes | PASS | Random 80-bit codes, SHA-256 lookup, generic errors, rate-limit test | None locally |
| Media protection | PASS | 60-second environment-bound signed tickets; grant/assignment/status rechecked on every request; no permanent public URL | Independently verify private bucket configuration |
| Downloads | PASS | Album/person individual and ZIP controls, HTTP authorization tests | Hosted ZIP/load qualification |
| Analytics | PASS | Privacy-safe opened/viewed/downloaded/denied/expired events and Admin aggregate | Views count authorized image loads, not unique human attention |
| Object storage | BLOCKED | S3-compatible adapter with environment prefix, credentials, checksum and metadata; staging has no gallery bucket credentials | Provision isolated private staging bucket and qualify recovery |
| Fiesta readiness | PASS | Provider-neutral capture/event IDs, deduplication, unmatched imports, match/create-event/ignore, manual assignments | No Fiesta connector/API or biometric matching implemented |
| Admin redesign / sidebar | PASS | Shared black sidebar and ivory workspace; reference-based Gallery overview | Owner visual acceptance |
| Dashboard / tables / cards | PASS | Shared primitives and 1440/820/390 screenshot pack; charts retained | Broader module-by-module owner review |
| Status system | PASS | Existing semantic icon + text badges, operational colors | None observed |
| Responsive | PASS | No page-level overflow on measured QA screens at 1440/820/390; mobile navigation verified | Browser/device coverage remains limited to local Chromium |
| Proposal visual enhancement | PASS | Optional editable/reorderable/removable sections; approved media assets | Owner content review |
| Public proposal | PASS | Visual sections render; pricing/deposit/acceptance retained | Hosted qualification |
| Proposal PDF | PASS | Actual generated visual page with proportional image, ivory/gold branding; commercial pages retained | Existing commercial page pagination remains unchanged |
| Receipt web / PDF | PASS | Secure invoice token + related successful payment; actual local records; date, totals, reference, stable payment route | Hosted qualification |
| Receipt email | PARTIAL | Authoritative shared receipt data and stable receipt/invoice/payment links; existing confirmation idempotency retained | No external email sent; inbox render remains unverified |
| Partial balance | PASS | $1,500 invoice / $500 payment / $1,000 balance, HTTP and model tests | None locally |
| Paid in full | PASS | Model tests and explicit layout simulation; no payment CTA when paid | No new hosted Checkout run in this sprint |
| Refund display | PASS | Refund amount/date and original payment history retained; model tests and layout simulation | No real refund executed |
| Tests | PASS | 264/264, zero skipped | Final committed candidate rerun: 264 passed, zero skipped |
| Build | PASS WITH MINOR ISSUE | Staging build passes | Existing bundle size warning |
| Visual QA | PARTIAL | Gallery/Admin/customer/lightbox/receipt/proposal screenshot and PDF pack | Staging private storage and owner acceptance outstanding |

## Storage setup and recovery gate

Use a dedicated private **staging** bucket and bucket-scoped credentials, never production credentials. Set server-only `GALLERY_STORAGE_PROVIDER=s3`, `GALLERY_STORAGE_ENV=staging`, `GALLERY_S3_BUCKET`, `GALLERY_S3_ACCESS_KEY_ID`, `GALLERY_S3_SECRET_ACCESS_KEY`; configure provider endpoint, region and path-style only as required. Do not send credentials in chat or expose them to Vite. The adapter does not silently fall back to the Railway volume in staging. A matching environment variable is a guard, not independent proof that credentials are isolated.

Before marking storage ready: verify bucket public access is blocked, credential scope is limited, upload/read/ZIP/revocation work through staging, direct unauthenticated object access fails, and a synthetic object can be recovered with the same SHA-256. Choose a versioning/retention policy supported by the provider, and document the actual retention and restore procedure. Back up database metadata and object versions together; a DB-only restore does not restore photos. Retain archived media and ignored imports until an owner-approved deletion policy exists. A failed database write after object upload may leave a private orphan; reconciliation/cleanup is a follow-up, not automatic deletion. No object-storage durability or recovery claim is made from a successful bucket HEAD request alone.

Local disk storage is explicitly test/development only. V1 accepts JPEG/PNG/GIF; video metadata is modeled but video upload/processing is not enabled. ZIP streaming is capped at 1,000 items and 1 GB. Large gallery thumbnail transcoding/pagination, archive cleanup and CDN scale testing remain future production-readiness work.

## Deployment and owner acceptance

Staging deployment status is recorded below after verification. No production deployment is part of this candidate. Staging email stays disabled and worker automation processing stays paused; gallery email drafts and send guards are tested locally. Actual Microsoft gallery delivery requires a separately controlled staging qualification send.

Current verdict: **GALLERY + ADMIN EXPERIENCE READY WITH CONDITIONS**.

PRODUCTION DEPLOYMENT: **NOT AUTHORIZED**

GALLERY STORAGE: **NOT READY**

FIESTA INTEGRATION: **ARCHITECTURE READY**


## Verified staging deployment

Candidate revision: `072140b16fae2c0841deef6a3ebb6e351f084258`.

| Component | Revision / evidence | Status |
|---|---|---|
| Staging Admin | `/build-info.json` reports 072140b; Vercel deployment 98ciYhjh5Lvd2R9Uqa9YjhzFwW73 | PASS |
| Staging API | `/api/health` HTTP 200, environment staging, revision 072140b; Railway deployment a7407ce3-b0ba-4e44-8d00-ca262694b362 | PASS |
| Staging worker | Railway deployment 8bc361fb-5ee5-4954-92a5-f43faea7896f SUCCESS, startup logged; candidate APP_REVISION 072140b | PASS; authenticated heartbeat check pending |
| Staging database | API startup logs explicitly applied 029 and 030 and completed migrations | PASS |
| Customer gallery entry | `https://staging.thelolabooth.com/gallery` renders; invalid code produces generic unavailable message | PASS |
| Capability URL response headers | Gallery route: no-store and no-referrer | PASS |
| Staging authenticated checks | Fresh Admin session requested | BLOCKED pending owner sign-in |
| Production API / Admin | Both still report a55a1ad767558765b9f134bdb464033033c7b029 | Unchanged |

The first staging health probe ran during container startup and returned 502; the completed API returned 200. Staging email remains disabled; the staging worker's existing environment guard always pauses general job processing. No hosted galleries or customer records were created during this deployment. No production deployment or external email was performed.

Owner review: staging Admin `https://stagingadmin.thelolabooth.com`; public entry `https://staging.thelolabooth.com/gallery`. Local evidence index: `audit-output/gallery-experience/index.html`. Private staging bucket setup remains necessary to qualify populated hosted gallery flows.
