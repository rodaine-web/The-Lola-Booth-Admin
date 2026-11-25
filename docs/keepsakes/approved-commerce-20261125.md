# Approved Keepsakes assets and staging commerce — 2026-11-25

Staging-only implementation. Production promotion is not authorized. Existing historical order snapshots, original Gallery photos, production hosting and production supplier submissions remain unchanged.

## Asset mapping

All 19 supplied originals are preserved with SHA-256 checksums in `public/brand/keepsakes-approved/manifest.json`. The prompt names 18; the additional acrylic-insert alternate is also retained. Each has 480, 960 and 1254 pixel WebP derivatives. `shared/keepsakes-product-assets.js` is the common Shop/Admin mapping.

| Internal asset | Exact supplied filename | Product |
|---|---|---|
| keychain-mono | ChatGPT Image Nov 24, 2026, 08_44_18 PM-1.png | keychain |
| keychain-color | ChatGPT Image Nov 24, 2026, 08_58_28 PM-1.png | keychain |
| magnet-mono | ChatGPT Image Nov 24, 2026, 08_44_19 PM-2.png | magnet |
| magnet-color | ChatGPT Image Nov 24, 2026, 08_58_29 PM-2.png | magnet |
| photo-jacket | ChatGPT Image Nov 24, 2026, 08_44_20 PM-3.png | jacketed-print |
| acrylic-insert | ChatGPT Image Nov 24, 2026, 08_44_21 PM-4.png | acrylic-display |
| acrylic-insert-alternate | ChatGPT Image Nov 24, 2026, 08_58_32 PM-4.png | acrylic-display |
| guest-photo-book | ChatGPT Image Nov 24, 2026, 08_44_22 PM-5.png | photo-book |
| premium-album | ChatGPT Image Nov 24, 2026, 08_44_23 PM-6.png | photo-book |
| album-linen | ChatGPT Image Nov 24, 2026, 08_58_33 PM-5.png | photo-book |
| album-open | ChatGPT Image Nov 24, 2026, 08_58_34 PM-6.png | photo-book |
| uv-acrylic-mono | ChatGPT Image Nov 24, 2026, 08_44_24 PM-7.png | premium-acrylic |
| uv-acrylic-color | ChatGPT Image Nov 24, 2026, 08_58_35 PM-7.png | premium-acrylic |
| frame-champagne | ChatGPT Image Nov 24, 2026, 08_44_25 PM-8.png | framed-photo |
| frame-ivory | ChatGPT Image Nov 24, 2026, 08_44_26 PM-9.png | framed-photo |
| frame-silver | ChatGPT Image Nov 24, 2026, 08_58_36 PM-8.png | framed-photo |
| frame-antique-gold | ChatGPT Image Nov 24, 2026, 08_58_37 PM-9.png | framed-photo |
| frame-metal | ChatGPT Image Nov 24, 2026, 09_38_01 PM-1.png | framed-photo |
| postcard-lifestyle | ChatGPT Image Nov 24, 2026, 09_38_01 PM-2.png | postcard |

The supplied metal-frame photograph belongs to Framed Photos. It is not used for Metal Photo Prints. An approved Metal Photo Print marketing photograph remains unavailable; that separate product uses a labeled material illustration and remains coming soon.

## Personalized previews

Product-specific quadrilaterals, aspect ratios, masks, material treatment and versioned templates replace sample photography within the actual insert surfaces. Keychain hardware, jacket corner tabs, acrylic panels and frame rails remain visible. Contain preserves the entire photograph; cover provides zoom and horizontal/vertical positioning. The quote snapshots the template geometry, selected source IDs/checksums, variant/dimensions and crop. Customer order previews use that saved geometry.

Primary templates cover keychains, magnets, the folded jacket, simple insert acrylic, framed photos, the postcard front and solid premium acrylic. Additional frame/appearance templates are retained. Book/album layouts and alternative lifestyle templates are visual planning only, not approved supplier print proofs. Book ordering remains coming soon. Full-resolution supplier layout/editor approval is still required for premium products.

Digital products use generic editing illustrations and private reference thumbnails. They never fabricate a finished unbranded edit. Purchase validates suitable underlying originals, branded strips and same-capture references. Selling a future edit is distinct from charging for an unchanged, included download.

## Availability and Admin configuration

Migration 095 records the owner's confirmed in-house supply availability for digital edits, keychains, magnets, acrylic inserts, jacket prints, ordinary framed photos and postcards. It preserves existing retail prices. Previously specified 4 × 6 photo inserts and the approved 6 × 4 postcard print layout have configured baseline dimensions.

Shipping charges are maintained in **Admin → Keepsakes → Products → Configure ordering**. This also maintains stock, actual insert dimensions, print resolution, frame appearance and tax category. Blank stock quantity uses the owner's confirmed supply availability, with another mandatory stock/capacity check before manufacturing; a recorded numeric stock count is reserved atomically after verified payment.

Unset delivery/tax pricing prevents checkout with a clear message. Keychain and magnet insert sizes still need their actual dimensions entered in Admin; no size was invented. Those products are listed as available supply, but Add to Cart cannot promise an unconfigured print size.

Premium acrylic, guest books, client albums, metal frames and Metal Photo Prints remain **Coming soon**. Metal-frame variants cannot be activated through the in-house configuration endpoint. WHCC/Gelato order submission is not enabled. Prodigi remains retired; no new catalogue route or UI reactivates it. PrintKK remains disabled backup.

## Cart, payment and fulfillment

The new shop cart reuses `keepsakes_quotes`, `keepsakes_orders`, `keepsakes_fulfillments`, the existing Stripe account/signature/event checks, tax calculations, Lob integration and private storage. No separate order system was introduced.

Cart lines retain distinct authorized photos, variants, crop, quantity, price reference and delivery configuration. They support editing, removal, continuation and quantity changes. Each quote rechecks source permissions, current price/configuration, print resolution and operational readiness. Session capabilities remain in Bearer headers, including proof requests; they are not inserted into payment cancellation or print-proof URLs. Recipient and item delivery addresses remain encrypted in snapshots.

Only a matching verified TEST payment creates fulfillment rows. Duplicate payment events neither duplicate jobs nor reserve stock twice. Paid digital editing jobs retain source references and accept separate quality-reviewed photo/strip uploads through Admin. Edited outputs are private, expire, and stop downloading after refunds. Original Gallery media are unchanged. Existing staging transactional notification controls and test-recipient restrictions remain in force.

In-house jobs wait for an operator to review the actual print file and confirm stock/capacity before production. Admin records dispatch and tracking, then delivery. Postcards create one Lob mailing job for every recipient record. Final supplier products remain gated.

## Postcards

The editor uses the trusted original `lola-connect-v2` artwork and its integrity-checked raster, not the lifestyle photograph. Accent changes affect the outer decorative rule only. White background, writing/address lines, branding, logo and QR pixels remain unchanged. The server preview and print renderer use the same message fonts and boundaries.

Five choices: Cormorant serif, Liberation Sans, Caveat handwriting, Patrick Hand and Great Vibes script. Historical typewriter orders remain renderable. The flow supports sender name/return address, one recipient per postcard, shared or individual notes, live font/color previews, final print proofs and cart purchase.

## Guest/client and bulk

Client access derives from the existing signed commercial grant, authenticated workspace session, booking ownership and authorized event Gallery. Guest role selection or spreadsheet contacts cannot grant client privileges. Guest books require more than five eligible available photographs, allow up to 20 selected images per book, and preserve balanced allocation/explicit multi-book confirmation. Client albums retain their 60-photo limit and supplier gating. Unfulfillable book prices are not shown as purchasable offers.

Client bulk supports a single destination with individual/whole eligible photo selection, and a downloadable CSV spreadsheet template. CSV is an Excel/Sheets-compatible format; direct `.xlsx` upload is not implemented. Upload review validates columns, US addresses, normalized contacts, authorized definitive IDs/links, ambiguous matches and duplicates. Contacts never merge identities or expand permissions. A review grid preserves each recipient/photo configuration before the current cart quote and final payment approval.

Existing checkout limits remain 30 configured lines, 100 physical units and 25 tax destinations. Larger imports must be split into reviewed batches; no hidden manufacturing request is made.

## Verification evidence

- Unit suite: 900 tests, 836 passing / 64 environment-dependent skips at the latest complete unit run; rerun results accompany the release.
- Disposable local PostgreSQL tests cover all three digital editing products in one mixed cart, two in-house products, five postcard mailings, current proof rendering, payment replay, stock reservation, quality-reviewed editing outputs, refund download revocation, mandatory production approval/tracking and authenticated client bulk isolation.
- Tests use synthetic photographs, addresses, payment/provider responses and development email transport. No real customer emails, live payment or paid supplier manufacturing were used.
- Desktop/mobile browser tests cover approved image mapping, private photo selection, digital source references, crop/cart/quote/checkout navigation, client bulk single destination, guest restrictions, Admin layout, postcard font choices, book draft allocation and shared site chrome.
- Browser evidence is recorded at `/private/tmp/lola-approved-cart-1440.jpg`, `/private/tmp/lola-approved-cart-390.jpg`, plus the approved-mask contact sheet `/private/tmp/lola-approved-product-masks.jpg`. These show synthetic QA photos, not customer data.

## Hosted staging targets

- https://stagingshop.thelolabooth.com/shop
- https://stagingadmin.thelolabooth.com
- https://staginggallery.thelolabooth.com/find-photos

Deployment identifiers and live validation are recorded after the staging release completes.

## Production readiness

Not ready for production promotion. Enter final in-house shipping/tax rates and keychain/magnet dimensions, finish supplier-specific premium configurations/editors/proofs and order-time quotes, confirm Gelato test-order safety, and complete the remaining real staging provider checks before requesting a separately approved production release. Core local checkout/fulfillment tests passing does not claim a real supplier order was submitted.
