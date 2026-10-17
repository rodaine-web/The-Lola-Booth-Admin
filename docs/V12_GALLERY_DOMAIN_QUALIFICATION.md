# V1.2 owned-domain gallery qualification

17 October 2026. Continue the existing gallery design; do not rebuild it.

## Host routing

- staginggallery.thelolabooth.com is registered and verified on Vercel staging project prj_A9TVWxwVxQnaYWJdKp2dcYZ7YXdJ.
- gallery.thelolabooth.com is registered and verified on production project prj_Uzsvbdt4ckXHrTrRkOg24dV8Hs8w. Registration is not gallery activation. Production gallery code remains disabled and unqualified.
- No nameservers, MX, TXT records, website domains or existing provider credentials were changed.
- Staging root redirects to /gallery. API CORS permits the exact environment gallery host only on /api/gallery endpoints, without credentialed cross-origin requests. It rejects Admin/auth/integration paths and the other environment host. Existing Admin CORS remains unchanged.
- Set GALLERY_PUBLIC_ORIGIN=https://staginggallery.thelolabooth.com on staging API and worker after code deployment. Do not set a production gallery origin or activate production galleries until the scoped release passes.

## Provider dependency

Fiesta Test 2 experiment verified lola-domain-check becomes lola-domain-check.boothpics.com. Its original blank value was restored and persisted. This setting does not configure an owned hostname. Custom email sender domain thelolabooth.com remains pending verification and is separate from gallery hosting.

Dropbox connection remains authorized read-only for info@thelolabooth.com. Its root is still empty in the real signed-in UI; there is no event folder to bind. GALLERY_DROPBOX_SYNC_ENABLED and STAGING_EXTERNAL_INTEGRATIONS_ENABLED remain false. Real Fiesta export/import/replay qualification is BLOCKED until a populated delivery folder is supplied. Do not use manually staged files as proof of automatic Fiesta exports.

## Qualification plan

Local complete suite and production build passed. CI and hosted checks pending. Validate branded code resolution, gallery loading, private photo viewing/download and guest scope. Preserve existing grants; do not publish other albums or send guest messages. Then verify authenticated Client Workspace event gallery and expiry from publication. Existing video support is bounded at 10 MB; real Fiesta video/export qualification remains separate from fixture tests. Production activation remains NO-GO while provider and hosted release gates are open.
