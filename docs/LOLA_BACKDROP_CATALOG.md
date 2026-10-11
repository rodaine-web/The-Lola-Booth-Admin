# Backdrop catalog and reservations

Catalog → Backdrops reuses the admin shell and read:events/write:operations permissions. New backdrops carry category, physical/digital kind, final image URL, quantity, status, premium flag and upgrade price, notes and display order. Archive retains event history.

Migration 050 seeds LOLA Ivory, Midnight, Champagne Glow, Silver Luxe, Modern Arch, Garden Romance, Blush, Emerald Luxe, Celebration and Studio White. All are INACTIVE with zero stock and no final image. The supplied collage is a design reference, not an inventory or image source. Supply final individual images and actual stock before activation.

Client selection supports collection, own artwork and custom design. A selection is NEEDS_REVIEW until LOLA confirms it. Physical reservations serialize through the shared reservation advisory transaction lock and compare overlapping active event windows including setup/start, breakdown/end, overnight handling and configured equipment turnaround buffers. Cancelled/completed events release the overlap count. Digital backdrops do not consume stock.

Premium/custom work requires audited client acceptance of immutable quoted scope/price, a dedicated event/client invoice for that total and required net payment before confirmation. Invoices still use existing finance workflows; payment is not charged automatically. Quote withdrawal preserves history and is blocked after invoice linkage. Own artwork is uploaded privately in the assets step. There is no automatic proof production from a selected backdrop.

Isolated SQL/service checks pass concurrent holds, expiry, atomic confirmation, reschedule protection, inventory reduction/maintenance denial, cancellation release, accepted terms, invoice/payment requirements and refund invalidation. Outstanding: actual staging journeys, final assets/stock, dedicated physical backdrop checkout/return linkage, linked-invoice amendment/refund resolution and production qualification. No seed has been activated. Asset intake manifest: LOLA_BACKDROP_ASSET_MANIFEST.json.
