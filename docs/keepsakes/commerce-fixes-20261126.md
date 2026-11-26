# Keepsakes commerce corrections — staging, 26 November 2026

Scope: corrected attachment `1bd78047-c8cd-4025-83da-fab373dd639f`. The previous simple-phone/email attachment is superseded; the deployed masked-email retrieval policy remains unchanged. No production promotion, customer photos, messages, or live payments are authorized by this release.

## Customer experience

Owner follow-up: removed customer-facing Product example labels, the sample-photo note and book inspiration captions. Editing-service/source and final-proof explanations remain.

- The twelve stable product keys retain pricing and history, with the requested display names and order below. `signature` remains the internal collection key; its display name is Premium Keepsakes.
- A sole eligible photo resolves automatically. Otherwise the selected Gallery capture carries through, with an authorized, in-place Change Photo picker. Changing a photo preserves crop, style, quantity and postcard personalization. The cart stores each item's source IDs and customization separately.
- Add to Cart stays on the product page and announces success with Continue Shopping and View Cart. Cart contact/delivery/recipient forms open only after Checkout is selected. Postcard message/font/accent customization stays on the product page; validated sender/recipient mailing details are entered at checkout.
- Authorized photo sessions return one unambiguous contact email when available. The order email prepopulates and has a Change Email control; changes persist independently of the Gallery bearer capability and never alter customer identity or photo permissions. Direct photo links without an associated email still require an order email.
- Digital-only orders use a billing address for Stripe Tax; no shipping address is requested or submitted. In-house physical delivery requires a delivery address; postcards retain separately validated recipient destinations. Order review and proof approval still precede Stripe test checkout.

## Catalog and approved image mapping

| Position | Stable key | Display name | Marketing image |
| --- | --- | --- | --- |
| 1 | edited-strip | Branded Photo Strips from Our Photo Booth | keepsakes-digital/edited-strip.svg |
| 2 | edited-photo | Unbranded Photos from Our DSLR Camera | keepsakes-digital/edited-photo.svg |
| 3 | edited-package | Digital Package | keepsakes-digital/edited-package.svg |
| 4 | postcard | Postcards | postcard-lifestyle |
| 5 | keychain | Photo Keychain | keychain-mono / keychain-color |
| 6 | magnet | Photo Magnet | magnet-mono / magnet-color |
| 7 | jacketed-print | Photo in a Jacket | photo-jacket |
| 8 | framed-photo | Framed Photos | frame-champagne / frame-ivory / frame-silver / frame-antique-gold |
| 9 | acrylic-display | Simple Acrylic Block | acrylic-insert / acrylic-insert-alternate |
| 10 | metal-print | Metal Photo Prints | frame-metal (legacy asset filename retained) |
| 11 | premium-acrylic | Premium Acrylic Block (UV Printing) | uv-acrylic-mono / uv-acrylic-color |
| 12 | photo-book | Photo Books & Albums | guest-photo-book / premium-album / album-linen / album-open |

All 19 supplied originals retain their exact bytes and hashes. The November 24 09:38:01 PM-1 image had been incorrectly classified as a framed photograph. It is the approved brushed-metal panel and now belongs to metal-print; no product or order IDs were renamed. Its existing `frame-metal` asset/file ID is retained to avoid breaking URLs, but removed from selectable framed-photo examples. Existing unsupported metal-frame variant guards remain intact.

Digital imagery previously used generic geometric placeholders instead of the approved sample photography. The three existing SVG paths now compose approved sample-photo and sample-strip pixels, with a labeled before/after split and editing indicators. No replacement stock or newly generated photography was introduced. Customer sources appear separately, explicitly as references rather than completed edits.

## Validation failures and fixes

The storefront used the general commercial catalog, while quote/checkout used active, verified products allowed by the source Gallery. Thus a general available listing could offer Add to Cart for an item the Gallery did not permit. The collection now exposes its existing per-photo product allowlist; Add to Cart checks those same permissions (both inputs for a package). A valid sole source no longer fails because selection state was empty. Fixed-size physical styles still require their real print specifications; keychain/magnet inserts are sized in-house per the owner’s latest instruction. Premium supplier configurations remain unavailable.

An additional source mismatch treated DIGITAL_EDIT as physical merchandise in `availableProducts`. It now uses digital eligibility, so an authorized branded strip can be edited even when physical branded merchandise is disabled.

Before quoting, cart items resolve their stable product key against the current catalog and confirm the persisted variant ID still exists. The backend continues to check exact IDs, current permissions, prices, stock, production readiness, image resolution and proof/version snapshots. Retired rows are excluded. Removed styles and unavailable Gallery products produce actionable per-product messages; the rest of the cart remains editable. The framed-photo regression verifies a permitted current frame survives Review Total and a removed variant or missing Gallery permission still fails. These establish the identified failure paths; no historical unsaved customer quote was available for forensic reconstruction.

## Tests and evidence

- Unit suite at initial implementation: 844 passed, 69 opt-in skipped; final exact-head CI is the release gate.
- Isolated local PostgreSQL regression: configured framed-photo quote; removed frame style; Gallery allowlist mismatch; digital billing-only quote; physical delivery requirement; branded-strip digital versus physical eligibility; existing payment, proof, stock, fulfillment, edited-output and Lob protections.
- Authorized session email survives the one-use Gallery-to-shop handoff. Existing cross-event, revoked, unrelated-photo and download checks remain covered.
- Synthetic browser test at 1440, 390 and 320 px: exact order, every landing image loads, nine available products added to one cart, three premium entries blocked, checkout-only contact fields, prefilled email and changed email preserve nine items, another photo/quantity/crop adds a tenth item, sole-photo auto-selection, and digital-only Review Total with billing but no shipping.
- Existing retail browser verifies explicit proof approval before the synthetic Stripe checkout destination. The database suite exercises Stripe API contracts/webhooks using deterministic test fixtures, never live payments.
- Existing guest book tests retain >5-photo collection eligibility, balanced 20-photo maximum per guest book, multiple-book confirmation, soft/hardcover selection, client-only premium albums and 60-photo limits. Supplier mapping checks alone still cannot enable book checkout.
- Visual evidence: [desktop landing](commerce-fixes-qa/home-1440.png), [mobile landing](commerce-fixes-qa/home-390.png), [desktop cart](commerce-fixes-qa/digital-cart-1440.png), [mobile cart](commerce-fixes-qa/digital-cart-390.png), [desktop customization](commerce-fixes-qa/personalized-1440.png), [mobile customization](commerce-fixes-qa/personalized-390.png). Mobile review caught and corrected cramped source-reference text in cart thumbnails.

## Limits and deployment boundary

WHCC/Gelato products remain Coming Soon. It would contradict the supplier verification rules to make all twelve purchasable for this UI release; the nine existing ordering routes are exercised with configured synthetic fixtures, and the other three are tested for safe blocking. Keychain and magnet checkout does not require fixed insert dimensions: supplies vary. Their reviewed source/crop is retained at native resolution without assigning invented print dimensions or DPI, and paid production jobs retain the existing artwork, fit, stock and capacity review before manual sizing/printing. Shipping, tax and operational configuration remain in Admin. Fixed-size prints/postcards and supplier products retain their specification checks. No prices or Gallery availability grants were invented.

A real hosted Stripe test-card payment is not represented by the deterministic test fixtures. It requires a synthetic staging collection and configured delivery/tax settings; this report does not claim such a card payment occurred. No live supplier manufacturing or customer delivery was performed.

Release target: main-staging and its isolated API, worker, shop, Gallery and Admin deployment. Production remains unchanged. Exact merge/deployment IDs and public postflight checks are recorded in the final staging release report.
