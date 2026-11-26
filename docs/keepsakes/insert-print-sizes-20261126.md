# In-house insert sizing and print approval

Staging change authorized November 26, 2026. No production promotion.

Keychain inserts use 2 × 2 inches (600 × 600 pixels at 300 DPI); magnets use 2 × 3 inches (600 × 900 pixels at 300 DPI). Migration 098 preserves product and variant identifiers, prices, inventory, shipping and tax configuration. Existing order snapshots remain unchanged. Admin configuration defaults missing insert specifications to these owner-supplied sizes; explicit future specifications are retained.

Authorized booth photos and strips retain their original files. Whole-photo fitting adds white space; crop-to-fill uses the selected zoom and position. Product pages display an exact flat print layout beside the illustrative product visualization. Gallery-session in-house/postcard orders permit upscaling, with a warning below 150 effective source DPI. Premium supplier resolution rules remain enforced.

Physical checkout requires the current print-size/crop/quality approval, bound to the immutable quote and recorded with its wording, version and server timestamp. Proof rendering and paid production rendering use the same snapshot policy. Historical variable-size orders retain their historical rendering.

Validation: build; artwork tests for booth photo/strip dimensions, exact DPI, whole-image borders, zoom/upscale and detailed sources exceeding 20 MiB; isolated database tests for quote warnings, denied missing/outdated approval, persisted acceptance, proof rendering, paid production files and unchanged original checksums; local desktop/mobile browser tests for exact print layout, cart, warning and required checkbox. No real payments, customer communications or Gallery publication.

Shipping prices and tax categories still need their separate Admin configuration where absent. This change does not invent them or bypass checkout readiness. WHCC/Gelato products remain coming soon.
