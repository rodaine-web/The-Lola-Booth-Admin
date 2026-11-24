# Staging correction milestone — 24 November 2026

Production is untouched. This change targets Admin `main-staging`, whose Vercel project serves the staging website, Gallery and Shop (`public/staging-site` is the live staging website source).

## Implemented

- Lead and Client opportunity review actions: current calendar review, stale-state fingerprints, closure reason and audit trail; unpaid unsigned tentative opportunities can close as Lost. Paid, signed and confirmed bookings require cancellation review.
- Reopen restores only sales-closed tentative events; previous proposals stay historical. A replacement draft copies the last proposal for review. Released assignments/holds and cancelled emails do not silently restart.
- Accepted-proposal handoff review and repair checks accepted revision, invoice snapshot, automation jobs and both communication ledgers. Existing delivered invoices are not resent; missing jobs are queued once. Unknown or processing deliveries and revoked agreements block automatic repair.
- Acceptance rejects a still-closed linked event, exposing the previously silent handoff problem before acceptance.
- Gallery landing has exactly two primary options: Find My Photos and Find My Gallery. Existing Gallery resolver/PIN paths are preserved. Legacy Shop search redirects to Gallery on the hosted Shop.
- Gallery→Shop photo selections use a hashed, single-use two-minute transfer code in the URL fragment. Full photo bearer sessions are not passed through links. Redemption revalidates the original session and each selected asset.
- Phone lookup must match an existing authorized email/photo association; arbitrary new email bindings cannot grant access. Responses remain neutral; no SMS is used.
- Authenticated Client Workspace opens a separately scoped gallery commerce session; gallery capabilities alone never promote a guest to booking-client privileges. Every media request revalidates the underlying workspace session, signed event grant and gallery publication/expiry.
- Book planning uses 5–20 unique asset selections per guest book; 21 splits 11/10, 45 splits 15/15/15. Multiple books require explicit combined-price confirmation. Titles, cover-photo choices, ordering, copy quantities and layout direction save as revisioned drafts. Premium album planning is booking-client only, max 60 selected images; images, facing pages and spreads are distinct concepts.
- Proposed book prices are Admin-editable per variant: softcover $34.99; hardcover $49.99; premium 8×8 $449; premium 10×10 $529. All start as DRAFT with no fabricated supplier identifiers. Public Starting-at prices derive only from active supported audience-appropriate variants.
- Admin Books & Albums tab shows variants, saved drafts/proof status, credential presence and read-only supplier catalogue checks. WHCC is pinned to the test API host; Gelato discovery uses the Product API. Neither discovery endpoint can place an order.
- Station proposal editor uses published rates rather than a newer unpublished draft; previously published retired versions remain approved for unchanged saved configurations. Genuine custom overrides still require approval.
- Website adds Keepsakes hero slide, section immediately before Audio Guestbook, package station schedule and Gallery/Shop navigation, all on staging domains. Existing booth package prices are untouched.
- Customer station descriptions omit internal manufacturing and Lob routing. Current visualizations are explicitly labelled as illustrations pending actual product sample photography.

## Database changes

091 adds one-time photo handoffs. 092 records station publication history (only already-published/retired policies are backfilled). 093 adds book variants, revisioned drafts and revision history. No existing order prices, paid snapshots or customer records are rewritten.

## Routes

- `https://staginggallery.thelolabooth.com/`
- `/find-photos`, `/photos/check-email`, `/photos/access`, `/photos/memories`, `/photos/transfer`
- Existing `/gallery` and `/gallery/:type/:token`
- `https://stagingshop.thelolabooth.com/shop/transfer`
- `/shop/products/photo-book`
- Staging Admin → Clients → Close / reopen opportunity; Leads → Close / reopen opportunity; accepted Proposals → Review / repair booking setup
- Staging Admin → Keepsakes → Books & Albums

## Remaining supplier-dependent work — not claimed complete

No actual Gelato/WHCC variant has yet passed an authenticated supplier check or fulfillment test. No actual supplier costs are available yet. Supplier configuration, print templates, supported page counts, hosted WHCC editor handoff, final print proofs, customer proof approval, verified order-time availability and idempotent manufacturing are required before enabling book/album checkout. Draft photo sequences are not printer proofs and do not approve production. New catalogue retail checkout, selected/whole-gallery editing/print purchases and new-provider fulfillment are not completed by this milestone; existing legacy Stripe/Lob paths remain protected and unchanged.

Existing book analytics must not count drafts as sales. No book revenue or manufacturing success is invented. Full book revenue/margin dashboards require real paid order integration.

## Missing photography

See `missing-product-assets-20261124.md`. Design references are available, but do not establish the physical construction or exact supplier variant. Do not substitute obsolete Prodigi blanks for WHCC/Gelato products or invent premium product photography.

## Readiness

This milestone is suitable for staging review after CI and live verification. It is not a production release and does not make book/album purchasing ready for launch.
