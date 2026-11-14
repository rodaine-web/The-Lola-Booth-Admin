# MinIO postcard test result

Local event: MINIO Brand Activation, `5694d89d-1ce7-49a8-adc7-47605ecffd93`.
Gallery: `cc7176fb-6fe1-47e9-b974-dc55f112ed37`.

The owner explicitly authorized uploading four matched guest photos, their recipient mailing details, approved event artwork and client return address to Lob TEST. No live dispatch or physical mailing was enabled.

## Result

- J*** / IL 606**: `psc_273cb0d3d9b724a8`, rendered, draft revision 2.
- K*** / MD 211**: `psc_88f4f53121bdf0ee`, rendered, revision 1.
- W*** / MD 212**: `psc_2f8fc510cf124556`, rendered, revision 1.
- J*** / MD 212**: provider rejected recipient deliverability. Owner explicitly chose to leave this card on hold. Its job remains NEEDS_REVIEW; no automatic retry.

All six pages of the three provider PDFs were rendered and visually reviewed. Return address is the owner-provided MinIO client address, stored encrypted in the event mailing request and snapshotted into jobs. Global sender configuration was not used.

One initial attempt stopped before dispatch at the local combined artwork size limit. Complete Lob TEST history was checked (two provider records, no match for the stopped postcard). The stopped job was cancelled through the normal Admin reconciliation workflow; its draft was rebuilt, reapproved and submitted with an auditable new revision. The cancellation history is retained.

## Fixes exercised

- Explicit combined "event photograph printed and mailed" survey permission establishes postal request and consent when no separate preference was collected. Explicit No and conflicting answers still block.
- Admin US-only import context fills missing country only; original CSV remains unchanged and context is saved encrypted and audited. Explicit foreign countries remain blocked.
- Admin can record client-provided return-address instructions without impersonating a client session. Existing request, quantity, proof and dispatch reviews remain mandatory.
- Removed an unused empty-src hidden image.
- Upload artwork now uses lossless PNG compression (compression level 9 with adaptive filtering). Approved pixels and proof hashes are preserved; the existing upload limit remains enforced.

## Validation

- 17 focused parser, print policy and survey tests passed.
- Isolated database/API gallery qualification passed, including migration preservation, corrected survey evidence, dispatch claims, provider failures, duplicate controls, immutable return addresses and partner invitation lifecycle.
- Three real Lob TEST orders reached rendered status; PDFs saved in the local Downloads folder.
- Dedicated gallery-only test worker restored after the fix. API and Vite remain local. Webhooks still need a public callback for deployment; status polling works locally.

This is a TEST result, not evidence of printing, postage purchase, physical delivery or production deployment.
