# The Lola Keepsakes — staging implementation

This is a staging release. Production, existing gallery commerce permissions, live Stripe payments and live supplier orders are unchanged. Existing galleries remain commerce-disabled unless an administrator opts a gallery in.

## Implemented

* Opt-in black-and-gold individual-photo viewer with existing permitted free actions and verified-product tiles. Supplier or commerce failures leave the free gallery usable.
* Native responsive shop, genuine available-asset picker, product/variant/quantity selection, local product previews, separate photo configurations, exact server-rendered reduced print-layout proofs with explicit review, editable in-memory cart, postcard recipient/message forms, address-based shipping/tax quotes and Stripe-hosted guest checkout.
* Explicit same-gallery sessions with arbitrary numbers of composite/original/processed/extracted-crop assets, order, branding, merchandise permissions and included/download-sale flags. Historical composites never manufacture fictional originals. Original bytes remain in existing private storage.
* An individual-photo capability expands only through its explicitly confirmed session. It never inherits the entire parent album. Cross-session/event access and included-file sale attempts are rejected. Hidden originals receive reduced previews; paid original downloads use seven-day revocable entitlements.
* Curated Prodigi v5 sandbox adapter: catalogue reads, supplier quotes, URL artwork, stable draft idempotency, separate submission, order/shipments polling and cancellation. Shared account asset/product/settings writes are prohibited. Sandbox keys protect orders, but some other Prodigi resources are shared with live mode.
* Private print renderer using exact configured specifications, source-resolution checks, bleed/safe margins, contain/cover/zoom/position, multiple named print areas and immutable hashes. Initial product checkout supports one physical print area; unvalidated crop controls remain hidden. A preview screenshot is never supplier artwork.
* Reuse of Stripe account/mode verification, raw signed event verification and the existing webhook ledger. Commerce events are dispatched separately from invoice reconciliation. Exact order/session/amount/currency matching precedes durable fulfillment reservations. Success redirects do not fulfill orders.
* Separate guest-paid Lob reservations for each recipient and copy. Reuses existing photo renderer, approved event back artwork and private storage. Personal messages require a reviewed blank left-side zone; overflow/incompatible artwork is rejected before payment. Sponsored postcard queues and consent records are independent.
* Digital fulfillment, independently fulfilled mixed carts, immutable purchase configurations, provider failure/intervention states, supplier artwork capabilities and reconciliation. Order-level advisory locks serialize dispatch/refunds/retries. Ambiguous Lob retries past the provider idempotency window require review.
* Separate destination-based Stripe Tax calculations combined into one payment, recorded after verified payment with per-calculation full-refund reversals, test refund/cancellation workflows and settled Stripe-fee reconciliation. Unknown fees/costs remain unknown rather than fabricated. Supplier tax is separate from customer tax.
* Admin Keepsakes & Orders: sales metrics/charts, event/product breakdowns, searchable orders, provider/tracking/error history, safe retry/refund/cancel actions, product/variant/price/tax-code/template management, Prodigi readiness/test/curated sync and event-level permissions/session mapping.
* Customer contacts and postcard recipients are encrypted at rest with existing integration encryption.
* Guest order status without an account; branded transactional updates through existing communication infrastructure, with durable keys and a dedicated staging recipient allowlist. No marketing enrollment.
* Migration 087 adds commerce tables without changing existing albums' opt-in state. Galleries with order history cannot be deleted/reset; fulfillment records and original-download sources are retained.

## Pages

| Audience | Route |
| --- | --- |
| Admin | `/operations/keepsakes` |
| Prodigi settings | `/operations/keepsakes?tab=integrations` (also linked from Settings → Integrations) |
| Event controls/source mapping | `/operations/galleries/:albumId` → Settings → Keepsakes |
| Guest photo viewer | existing `/gallery/photo/:token` |
| Native shop | `/keepsakes/:type/:token`, type `photo`, `p` or `a` |
| Guest order | `/keepsakes/orders/:orderToken` |

Staging hosts: `https://stagingadmin.thelolabooth.com`, `https://staginggallery.thelolabooth.com`, API `https://stagingapi.thelolabooth.com`. Existing galleries will show their existing experience until explicitly configured; a path alone does not authorize private content.

## APIs

* `GET /api/keepsakes/access/:type/:token`; scoped reduced asset previews under `/assets/:id`.
* `POST .../quote`; scope-bound exact reduced print-layout previews under `.../quotes/:quoteId/proofs/:itemIndex/:side/:recipientIndex`; `POST .../checkout` with required physical-proof review. Prices, eligibility, source checksums, shipping and tax are validated on the server. Quotes expire in 15 minutes.
* `GET /api/keepsakes/orders/:token`; expiring paid-original downloads under `/downloads/:id`.
* `GET /api/keepsakes/artwork/:signedCapability`: paid-order-only supplier print files, seven-day capability, revoked by refund/cancellation.
* Existing `POST /api/webhooks/stripe`: signature/account/mode verification retained; Keepsakes events have dedicated metadata and database state.
* Admin `/api/keepsakes-admin`: dashboard; `/products`, `/products/:id`, `/products/:id/verify`; `/orders/:id`, `/retry`, `/cancel`, `/refund`; `/albums/:id`, `/albums/:id/sessions`; `/integrations/prodigi`, `/test`, `/sync`.

Global financial/product administration requires an administrator role and existing finance/integration permissions. Gallery configuration also enforces event access and operations permissions. All capability routes use no-store/no-referrer and redact tokens from request logs.

## Catalogue verification status

Official v5 contract: [Prodigi OpenAPI](https://www.prodigi.com/print-api/docs/openapi.yml), [documentation](https://www.prodigi.com/print-api/docs/). Base `https://api.prodigi.com/v5`, `X-API-Key`, genuine `sandbox_…` credential. Quotes use catalogue variant IDs, draft order items use SKUs and actual artwork URLs. Managed asset IDs are not substituted for print-area URLs.

| Candidate | Official documented SKU | Account/API validated? |
| --- | --- | --- |
| White photo mug | `GLOBAL-MUG-W` | Pending v5 sandbox credential |
| 4×6 C-type print | `GLOBAL-PHO-4X6` | Pending |
| Classic framed print | `GLOBAL-CFP-12X16` | Pending |
| Single-photo magnet | `MAG-1-10X10` | Pending |

These are documentation candidates, not activated listings. Physical product size is not a print specification. Activation requires catalogue lookup, reviewed exact print-area/DPI/bleed/safe/template evidence, valid attributes and a sandbox destination quote. Each cart receives a fresh destination quote. The documented `PLA-KEYRING` is discontinued and is blocked.

Official product references: [mug](https://www.prodigi.com/products/home-and-living/drinkware/photo-mugs/), [print](https://www.prodigi.com/products/prints-and-posters/photo-prints/c-types/), [frame](https://www.prodigi.com/products/wall-art/framed-prints/classic-frames/), [magnet](https://www.prodigi.com/products/stickers/magnets/), [discontinued keyring](https://www.prodigi.com/products/accessories/keyrings/plastic-keyrings/).

## Configuration and validation boundary

Read-only staging checks confirmed Stripe **test** credentials, active sandbox tax settings and an active sandbox tax registration. The API's newly supplied Prodigi credential had legacy UUID format; the worker lacked `PRODIGI_SANDBOX_API_KEY`. The worker now references the staging API’s Prodigi key and gallery storage credentials, without exposing secret values. Do not prepend `sandbox_` to a legacy key. Replace the API value with an issued v5 sandbox credential; the worker reference follows it. No real Prodigi catalogue/quote/order verification is claimed yet.

Required staging configuration before enabling test checkout:

* API and worker: genuine `PRODIGI_SANDBOX_API_KEY`; existing correct Stripe test key/account; private gallery storage available to both processes.
* `KEEPSAKES_CHECKOUT_ENABLED=true`, `KEEPSAKES_FULFILLMENT_ENABLED=true`, `KEEPSAKES_TAX_REVIEWED=true` only after readiness review. Checkout additionally requires the API's Stripe signing secret. Defaults keep checkout and fulfillment paused.
* `KEEPSAKES_ARTWORK_ORIGIN=https://stagingapi.thelolabooth.com` for supplier retrieval.
* Existing Lob `test_…` secret and `LOB_STAGING_TEST_ENABLED=true` for retail postcard tests. No live Lob key is used.
* `KEEPSAKES_TEST_EMAIL_ALLOWLIST` with controlled test inboxes plus existing staging Microsoft/email permissions. Existing broader staging email settings do not bypass the dedicated Keepsakes allowlist.
* Configure inactive products, exact templates/attributes, reviewed per-product Stripe tax codes and retail prices; verify before activation. Enable only a new synthetic QA gallery, confirm its assets/brand permissions/return address, then run real sandbox checkout/fulfillment.

No API keys are returned to the browser. No live resource provisioning or supplier webhook subscriptions were created. Signed v5 signature verification is implemented/tested; authenticated polling drives staging reconciliation. A shared-account webhook subscription requires a separate review before provisioning.

## Tests and evidence

Focused test files:

* `test/keepsakes-artwork.test.js`: dimensions/DPI, complete-composite edge preservation inside safe/bleed margins, crop/zoom/position, insufficient resolution, immutable hashes and 1/2/3/4/6 real asset counts.
* `test/keepsakes-proofs.test.js`: exact-layout thumbnail edges, dimensions/metadata, safe descriptor generation and invalid-scope input rejection.
* `test/prodigi-service.test.js`: exact v5 paths/schema, sandbox gates, prohibited shared-resource writes, stable creation keys, independent submission/poll/cancel, cents parsing and raw signed-event replay/tamper protection.
* `test/keepsakes-lob.test.js`: approved-back composition, literal message rendering, blank message-zone/overflow validation, test-only transport, one recipient/copy per reservation and sanitized failures.
* `test/keepsakes-db.test.js`: disposable PostgreSQL with real services, session isolation, included-file exclusion, permission revalidation, signed Stripe dispatcher, async/repeated payment events, digital worker/tax/fee state, protected downloads/artwork, failed-order retention, leases/retries/polling, refund/dispatch serialization and expired Lob retry protection.
* Browser tests: `keepsakes-browser`, `keepsakes-admin-browser`, `keepsakes-gallery-browser`. Desktop/tablet/mobile, scoped asset counts, cart editing, multiple recipients, eligible products, commerce-off/API failure, free actions and access revocation.

All automated provider responses in these tests are explicitly synthetic. No actual sandbox payment/order IDs exist yet; none are presented as real API validation. Local temporary database schemas are dropped by the tests. Existing gallery/Fiesta/Dropbox/postcard and Stripe-tax regression suites are also run.

Screenshot folders (local QA artifacts, not customer data):

* `/private/var/folders/q5/p1hs41195wv1sq1ntks98b7w0000gn/T/lola-keepsakes-browser/`
* `/private/var/folders/q5/p1hs41195wv1sq1ntks98b7w0000gn/T/lola-keepsakes-admin-browser/`
* `/private/var/folders/q5/p1hs41195wv1sq1ntks98b7w0000gn/T/lola-keepsakes-gallery-browser/`

## Remaining before production

1. Resolve v5 sandbox credentials and verify worker storage access; complete actual catalogue/template/destination verification for each offered SKU.
2. Run real Stripe test Checkout, its deployed signed webhook, Prodigi sandbox draft/submission/shipments and Lob test postcards; record actual IDs and inspect final print files/provider proofs.
3. Test controlled Microsoft order/shipping/refund emails and digital download expiration on staging, including provider-outcome-unknown recovery.
4. Review exact product print templates, mug/frame realism and image placement. Current local product visuals are previews; multi-print-area checkout, customer-created collages and unverified crops remain unavailable.
5. Confirm merchandise/branding rights and included-original rules per event; manually confirm genuine source mappings before enabling any historical gallery. Dropbox does not automatically infer/recurse session originals from arbitrary subfolders.
6. Review supplier cancellation limitations and partial-refund item/tax allocation. Submitted Lob cancellations require provider review. Dashboard supplier costs are quote-based estimates; missing actual fees remain unknown. Configurable automatic percentage markups, discounts, detailed filtered financial exports and more advanced analytics remain future work; fixed reviewed retail prices are supported.
7. Confirm live payment/tax/provider/communication configuration, production security and return/support details. This code intentionally rejects production Keepsakes operations. A reviewed separate production change and explicit approval are required; this release is not production-ready.
