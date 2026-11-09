# Staging Audio Guestbook fulfillment — 9 November 2026

Supersedes the Audio pricing/duration paragraph in `staging-magic-mirror-catalogue.md`. Production remains outside this release.

Audio standalone is a flat $299 per event with no hourly duration or package tiers. Its $249 add-on shares the same real equipment units. Glam gains a $199 inflatable enclosure and a $299 premium pipe-and-drape enclosure. Other add-ons/prices and historical pricing snapshots are preserved.

Admin opens Event → Team & Equipment → Equipment → Audio Guestbook fulfillment. Choose a physical unit, rental option, local drop-off/pickup or shipping with return shipping, and enter dispatch, expected return and inspection-ready dates in the displayed timezone. Quote delivery/round-trip shipping separately using existing manual proposal travel/logistics pricing. These dates must cover event setup, service and breakdown. Shipping requires return shipping confirmation.

Each unit is reserved for the entire fulfillment interval. Database locks and triggers enforce conflicts across standalone rentals, add-ons, generic assignments and booking holds. Overdue dispatched/returned units remain blocked until actual return and inspection are recorded. Cancelling an event releases an unshipped reservation but does not free a phone already dispatched. Completed history cannot be deleted or rewritten. Generic equipment checkout/return synchronizes the Audio lifecycle; a generic return alone does not complete inspection.

Migration 074 adds the inventory group and fulfillment records. It does not invent stock. The separately invoked staging-only `update-staging-audio-rental.js` defaults to dry-run. Apply requires the reviewed current pricing version, existing inventory IDs and an audited owner. It refuses other pricing drafts, publishes an immutable new version, saves before-state, and is idempotent. Tag only the existing two reviewed Audio Phone units. No client documents or messages are changed by the update.

Validation: 730 general tests passed; Audio database regression covers pricing, existing snapshot preservation, transit/inspection conflicts, second-unit availability, invalid shipping, generic assignment/hold bypass, rescheduling, cancellation, overdue physical returns, inspection and concurrent reservations. Existing pricing database regression and Admin production build passed. Hosted CI and deployment verification are required before application.
