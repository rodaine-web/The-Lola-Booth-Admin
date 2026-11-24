# Product imagery

`prodigi-white-mug-11oz.png` is the unmodified official Prodigi 11oz mug blank.
Source product: https://www.prodigi.com/products/home-and-living/drinkware/photo-mugs/
Download: https://www.prodigi.com/download/blanks/prodigi-11oz-mug-blank-asset.zip
Retrieved 2026-11-21. The supplier supplies this blank for compositing customer artwork.

The guest photo is loaded from the existing authorized Lola gallery endpoint and composited in the browser. This placement illustration is not a Prodigi-generated mockup or printer proof. No guest image is uploaded to Prodigi to render this illustration. Exact production artwork and its separately reviewed print-layout proof are unchanged.

Message fonts are bundled for consistent browser/print rendering: Liberation Sans (existing licensed font), Special Elite (Google Fonts, Apache 2.0), Caveat and Patrick Hand (Google Fonts, OFL), and the existing Great Vibes (OFL). License files accompany the fonts. Font metadata and the limited ink palette are defined in `shared/postcard-message-styles.js`.

`prodigi-classic-frame-black.png`: unmodified Black classic frame_blank.png from https://www.prodigi.com/download/blanks/prodigi-classic-frame-blanks.zip, linked by the official classic frames product page. Used as a supplier reference for the black classic frame, not as an exact-size print proof.

`prodigi-c-type-gloss.jpg`: unmodified C-Type - Gloss.jpg from https://www.prodigi.com/download/product-range/c-types/prodigi-c-types-photo-assets.zip. This is the supplier's paper-finish reference; its sample photograph is not the customer's purchased artwork.

`lola-postcard-back-v2.svg`: deterministic Lola-owned postcard back, approved for this workflow, with protected Lob mailing space and a verified QR to https://thelolabooth.com/connect. Native source and geometry are recorded in the corresponding postcard deliverable. The canonical PNG is pinned by SHA-256 on the server; only decorative ink can be themed, with the QR kept black.

The 2026-11-22 personalized collection uses native canvas product visualizations from these supplier blanks. Classic frame corners and rails are taken from the supplier image, with its aperture adapted to the configured print ratio. The 11oz mug uses a cylindrical projection of the configured wrap layout. The complete selected photo stays inside the configured safe border in contain mode. These visualizations remain separate from the server-generated print proofs.

`prodigi-classic-frame-gold.png` and `prodigi-classic-frame-white.png` are the unmodified Gold Classic Frame_blank.png and White classic frame_blank.png from the same official Prodigi classic-frame archive. Only catalogue-verified, album-enabled variants are offered.

2026-11-23 twelve-product preview quality correction: the 118×91 catalogue crops
are replaced with 1000×750 illustrative renders from CoreKeepsakePreview. The
sample portrait is cropped without enlargement from the owner's approved
“ChatGPT Image Nov 23, 2026, 09_36_52 AM-5.png”; the sample strip is a clearly
illustrative branded arrangement of that portrait. The hero is a native-size
crop of “The Lola Keepsakes_ Luxury Photo Collection.png”. No customer image or
supplier API is involved in these public examples. They are product
visualizations, not supplier-generated proofs. Guest selections continue to use
their authorized images. Physical SKU and ordering readiness gates are unchanged.

Run `node scripts/build-keepsake-preview-assets.mjs` from the repository root to
rebuild the static examples using the same renderer as the storefront. It also
updates the six station images in the served staging website bundle. The
script serves only a local rendering fixture and makes no order/API mutations.
