# Supplier verification — staging only

Checked 24 November 2026 (America/Chicago). No production deployment, customer email, payment or manufacturing submission was performed. API credentials were read only in process memory and never written to these records.

## Verified access

Both staging API and worker have the WHCC test and Gelato credential configuration. WHCC catalogue and blank configured-product checks used `https://apis-stage.whcc.com/api` exclusively. Gelato checks used `https://product.gelatoapis.com` exclusively. The owner is unsure whether the Gelato account is a test-only account; Gelato order submission remains unavailable.

Admin → Keepsakes → Books & Albums now allows catalogue inspection and draft mapping verification. Saving a mapping records supplier evidence, specification and available product cost with an audit reason. It always saves DRAFT and cannot enable checkout. WHCC mappings must match the variant's advertised size; Gelato mappings require an activated US-supported product, matching cover type, supported page count, USD quantity-one cost and cover dimensions. Internal supplier evidence is omitted from public variant responses.

No manufacturing endpoints are exposed by these catalogue controls. The pricing check does not constitute a shipping or tax quote. No new migration is required.

## Observed costs, not retail prices or final quotes

| Supplier configuration | Observed product cost (USD) | Qualification |
|---|---:|---|
| Gelato 5.5×5.5 softcover, API pageCount 28 | 7.492242336273193 | US, quantity 1; no shipping/tax quote |
| Gelato 8×8 softcover, API pageCount 28 | 9.686836242675781 | US, quantity 1; no shipping/tax quote |
| Gelato 8×8 hardcover, API pageCount 28 | 12.83071994781494 | US, quantity 1; no shipping/tax quote |
| WHCC 8×8 test album, default five spreads | 120.50 | Blank, awaiting editor, empty-spread validation errors |
| WHCC 10×10 test album, default five spreads | 154.25 | Blank, awaiting editor, empty-spread validation errors |

WHCC's two blank configurations also returned a combined $1.00 surcharge. These defaults must not be used as the verified cost of the planned 20-spread album. Product creation returned `awaiting-editor`; subsequent reads returned validation details, not a final print proof or completed order.

Actual Gelato catalogue IDs are `soft-cover-photobooks` and `hard-cover-photobooks`. The supported US product UIDs observed were:

- Mini: `photobooks-softcover_pf_140x140-mm-5_5x5_5-inch_pt_170-gsm-65lb-coated-silk_cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0_cpt_250-gsm-100-lb-cover-coated-silk_ver`
- Softcover 8×8: `photobooks-softcover_pf_200x200-mm-8x8-inch_pt_170-gsm-65lb-coated-silk_cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0_cpt_250-gsm-100-lb-cover-coated-silk_ver`
- Hardcover 8×8: `photobooks-hardcover_pf_200x200-mm-8x8-inch_pt_170-gsm-65lb-coated-silk_cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0_cpt_130-gsm-65-lb-cover-coated-silk_ver`

Identifiers are catalogue observations, not activated sellable mappings. Do not infer US support from similarly named imperial-first aliases.

## Remaining gates

Gelato cover dimensions queried with `pageCount=28` returned `pagesCount=32`. The exact cover/interior PDF convention must be reconciled with the supplier template; no guessed PDF or simulated success is accepted. The selected image count is independent of printable page count.

WHCC albums require the hosted editor. The blank default has five spreads; creation does not automatically produce the requested 20-spread design. Editor completion, immutable final proof, customer approval and final supplier calculation are still required.

Book/album checkout, order-time revalidation, final supplier pricing, approved print files, idempotent manufacturing and provider fulfillment events remain incomplete. Existing legacy Stripe/Lob paths are unchanged. The broader selected/whole-gallery editing/print commerce phase is not completed by this supplier-mapping increment.

## Primary references

- [WHCC albums workflow](https://www.whcc.com/developer/docs/guides/albums/)
- [Gelato product details](https://dashboard.gelato.com/docs/products/product/get/)
- [Gelato pricing](https://dashboard.gelato.com/docs/products/prices/)
- [Gelato cover dimensions](https://dashboard.gelato.com/docs/products/product/cover-dimensions/)
- [Gelato photo book design](https://support.gelato.com/en/articles/8996282-how-do-i-design-a-photo-book)
- [Gelato test account guidance](https://support.gelato.com/en/articles/8996575-do-you-have-a-sandbox-environment)
