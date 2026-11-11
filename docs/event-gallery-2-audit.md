# Event Gallery 2.0 — architecture audit

Reviewed 2026-11-10. Scope: repository audit and local baseline checks. No staging or production records changed and no mail dispatched.

## Decisions and sample evidence

- All implementation and integration testing targets staging. Production promotion needs separate approval.
- US destinations only; final postcard size is 4×6 only.
- Owner clarification overrides the original prompt: narrow strips are gallery content only, never composed or sent to Lob. Videos are also ineligible for postcards.
- The supplied Fiesta sharing summary contains 63 sharing rows, 55 unique filenames, JPEG and MP4 references, email/phone recipients and boothpics.com links. Repeated sharing rows do not imply additional photos or postcard orders.
- The summary has no mailing addresses, guest names, survey answers or consent evidence. It cannot establish mailing eligibility. Do not infer consent from sharing a photo or visiting a link.
- Keep the sample guest data out of source control, logs and public responses. Use synthetic fixtures in tests.
- Owner-approved defaults: Admin binds one verified Dropbox folder per event, one postcard per verified recipient per event unless an Admin explicitly authorizes extras, accepted proposal allowance plus Admin quantity/cost caps.
- Owner confirmed that Fiesta's survey feature can collect physical addresses. Its actual export structure and configured preference/consent questions remain to be validated with a sanitized sample.

## Existing components to reuse

| Area | Existing implementation | Assessment |
| --- | --- | --- |
| Admin gallery | `src/pages/GalleryAdmin.jsx`, GalleryOverview, GalleryImports, FiestaGalleryImport, DropboxGalleryImport | Existing event workspace; extend rather than create another app. |
| Database | migrations 029, 030, 066, 067 | Event-unique album, private media, people, assignments, access keys, activity, imports, Fiesta shares, Dropbox sources and revision checkpoints. |
| Fiesta | `shared/fiesta-gallery.js`, `fiesta-gallery-service.js` | Strict six-column share-summary parser; event checks, encrypted recipients, replay deduplication, deterministic unique-filename matching. This is not a general survey importer. |
| Dropbox | adapter, connection, permissions and service modules | OAuth connection, verified account, pinned folder ID/account/path, content-hash verification, bounded pagination, leases, replay-safe revision records. |
| Worker | `server/src/worker.js` | Existing periodic Dropbox processor. Extend existing worker for durable import and mailing jobs. |
| Storage | `gallery-storage.js`, Azure/S3 adapters | Environment-prefixed private managed storage; local adapter restricted to development/test. |
| Guest delivery | `private-gallery-service.js`, gallery-policy, gallery-media-delivery and routes/gallery | Hashed opaque keys, environment-bound encrypted credentials, revocation/expiry checks, signed short-lived media tickets and reauthorization on image requests. |
| Client Workspace | SecureClientWorkspace, CustomerGallery, customer-gallery-service and client-session routes | Existing authenticated client/event association and private gallery delivery. Reuse authorization for business requests. |
| Audit/secrets | audit-service and integration-secrets | Existing audit persistence and server-side encrypted integration values. |
| QR | QRCode generation in private-gallery-service | Existing QR output; needs branded favicon composition and scan testing. |

## Confirmed gaps and operational limitations

1. Fiesta import currently accepts only the fixed share-summary CSV, not XLSX or survey fields. It does not retain the original spreadsheet as an import artifact.
2. CSV import and Dropbox source setup are separate actions; the desired spreadsheet-driven import orchestration does not exist.
3. Current matching uses an exact filename only when unique within the album. Unmatched sharing associations remain pending, but richer exception records, survey match review and per-record correction are missing.
4. Dropbox sync stops on an unsupported oversized capture or conflicting filename. A single bad file can prevent the page cursor from advancing; retries replay earlier imports safely but cannot resolve that file automatically. Add per-file exceptions without silently dropping sources.
5. Dropbox sync reads a page per worker invocation, with a five-minute lease. There is no visible per-import progress model or consolidated import history for the proposed workflow. Lease expiry can interrupt a slow page; persisted revision deduplication supports recovery.
6. Media upload validates signatures/checksum and stores originals, but does not populate dimensions or generate a separate optimized preview. View tickets currently serve the managed source, so hiding download controls does not substitute for separate preview/original handling.
7. Access keys support expiry/revocation and album/person scopes; atomic one-time redemption with a reusable short-lived viewing session is not implemented. A link and code are alternate credentials, rather than an optional additional code challenge.
8. QR generation exists but does not embed the authorized favicon.
9. Current states differ from the requested workflow: DRAFT, PROCESSING, READY, PUBLISHED, DELIVERED, EXPIRED, ARCHIVED. Explicit review/unpublished states and migration compatibility are needed.
10. Customer gallery access currently requires published/delivered state. Postcard preparation must authorize against the event separately so an unpublished gallery can still have approved mailing work.
11. No postcard artwork versions, mailing requests, approvals, budget reservations, fulfillment jobs or Lob webhook handling were found in the reviewed gallery implementation.

These are source-confirmed gaps against the new requirements, not claims of a reproduced production failure.

## Proposed architecture and migrations

Preserve existing album/media/person IDs and working routes. Add backward-compatible, event-scoped entities using existing naming conventions:

- Import runs and source spreadsheet artifacts: schema/version, file digest, private storage reference, event binding, progress, actor, checkpoints and safe error codes.
- Survey responses and normalized photo sessions: encrypted mailing/contact fields, original answers in restricted storage, explicit preference/consent evidence, exact source references. Keep share events distinct from recipient identity and photo sessions.
- Matches and exceptions: matching method, certainty, review state, confirmer and corrections. No uncertain match may propagate an address into a mailpiece.
- Media derivatives: verified dimensions, print eligibility and private preview references alongside preserved originals.
- Access grant extensions and redemption sessions: access mode, optional code challenge, selection scope, atomic redemption and expiry/revocation inherited at every image request. Retain existing grants.
- Event postcard configuration and immutable back-artwork versions: 4×6 profile, approved postal zones, validation result and approval history.
- Event mailing requests/items and approval records: authorized business/event, recipient identity, unique default mailing key, front/back/address snapshots, quantity/cost authorization, requester/reviewer and decisions.
- Fulfillment jobs and provider events: durable lease/retry state, stable idempotency key, provider ID, webhook deduplication and reconciliation. A timeout must not create another physical mailpiece.

Use one backend service for Client Workspace and authenticated business gallery requests. A guest gallery grant never authorizes recipient access or postcard requests. Keep publication, business request approval and final dispatch as separate operations. In staging, reject live Lob credentials and live dispatch regardless of UI state.

## Security work and dependencies

- Maintain event/client isolation and explicit staff permissions at every import, survey, proof, approval and dispatch route.
- Do not put names, residential addresses, contact details or spreadsheet contents into logs, QR payloads or public gallery responses.
- Provider fetches must use fixed hosts and bounded downloads; do not retrieve arbitrary spreadsheet URLs.
- Preserve encrypted integration storage, fail-closed environment flags and private original access. Separate view derivatives from download originals.
- Obtain a sanitized survey export showing actual address/preference/consent columns and representative finished 4×6 filenames/layouts. Share summary is sufficient only for its existing matching role.
- Verify staging Dropbox connection, private storage, worker configuration and gallery-domain deployment without exposing credentials. Configuration has not yet been audited live for this phase.
- Lob test credentials and return address must be configured through authorized settings. No real recipient data should be sent during test validation.
- Sample back is a design reference, not approved print artwork: its 1536×1024 resolution and existing postal decoration require validation/rework. Lob documents 6.25×4.25-inch artwork including bleed for a 6×4 trim, at 300 DPI; the reserved address/postage/barcode area must remain clear. Source: https://docs.lob.com/ and https://lobapi.zendesk.com/hc/en-us/articles/42406517966739-Artboard-layout .

## Baseline verification and delivery status

Local parser, Dropbox adapter and security tests: 17/17 passed. Gallery domain isolation/configuration tests: 5/5 passed after granting the test runner permission to open its temporary localhost listener. The first sandboxed run could not open that listener; this was an environment restriction, not an application assertion failure.

Database integration, staging browser flows, provider credentials, Lob proofs/webhooks and full end-to-end import/mail flow have not been verified in this phase.

| Deliverables | Status |
| --- | --- |
| Repository architecture audit, source-confirmed gap report, proposed architecture/migrations | Completed and documented; local baseline tests verified. |
| Redesigned gallery, survey-driven import, exception management, access enhancements, branded QR | Not implemented for Gallery 2.0; existing capabilities above remain intact. |
| 4×6 artwork/proofs, business requests, approvals, Lob fulfillment and tracking | Not implemented. |
| Full survey import validation | Blocked by representative survey export/schema. |
| Staging provider and browser acceptance validation | Not yet performed; credentials/configuration availability unverified. |

## Implementation sequence

1. Confirm source schemas and mailing rules; establish synthetic fixtures and staging integration readiness.
2. Add import runs, safe survey normalization, deterministic matching and recoverable exceptions; orchestrate existing Dropbox ingestion.
3. Add gallery navigation/review states and preview derivatives.
4. Add access redemption sessions, optional code challenges and branded QR exports.
5. Implement 4×6 artwork validation/versioning/proofs and event-scoped business requests with hard limits.
6. Add Admin review/final dispatch, durable Lob test jobs, verified webhooks and reconciliation.
7. Run complete database/API/browser acceptance on staging, including 375px layouts. Report unverified dependencies explicitly. Production remains unchanged.

## Phase-one foundation progress

Implemented locally after owner approval of the defaults:

- Explicit-header survey CSV parser with bounded input, original field preservation, US address checks, explicit affirmative preference/consent values and unresolved-reference flags. No automatic consent or country inference.
- Additive migration 077 for encrypted original survey imports and encrypted responses with same-album foreign keys, source row references, matching metadata and mandatory review state.
- Staff-only count preview/import API endpoints, gated by `GALLERY_V2_ENABLED=true` in staging/development/test. Production is rejected even if the flag is accidentally enabled.
- Idempotent file imports, rejection of changed mappings on a replay, exact unique-filename matches only, encrypted source retention and count-only audit/preview output. Import does not publish or authorize any mailing.
- Six parser tests and one database/HTTP integration test passed, including encrypted persistence, replay safety, event mismatch rejection, production gate, published-album lock and unauthenticated/read-only-user rejection.

The Admin **Fiesta Survey** tab now provides the question setup guide, column mapping, count preview, import history, restricted response/source-answer review, photo preview, explicit match confirmation and response exclusion. Review notes are encrypted. Late photo ingestion reconciles unresolved exact filenames while preserving staff exclusions and confirmations. CSV controls clear after import so the review list is easy to reach.

Local browser verification on 2026-11-11 used the actual Admin component, authenticated API and an isolated database schema with synthetic fixtures. CSV upload, preview, import, private response review, confirmation and exclusion passed. The screen fit a 375px viewport without horizontal overflow. Evidence: ignored `.qa/gallery2/survey-review-desktop.png` and `survey-mobile-375.png`.

Full local application suite: 783 tests, 745 passed, 38 skipped, 0 failed. The three targeted database integration tests (survey, existing Fiesta and Dropbox) ran separately and passed. The production build passed with Vite's runner config loader because the shared node_modules directory is outside the writable sandbox.

This is a CSV import/review phase, not a complete Gallery 2.0 release. XLSX, automatic spreadsheet-driven Dropbox orchestration, advanced session matching and downstream postcard features remain to be implemented. No live provider or real Fiesta survey-format claims are made. A sanitized real Fiesta survey export is still needed to validate event-specific questions, answer values and session/photo references.
