# Website CMS migration status — 2026-09-22

Production content/schema changes by this task: **none yet**. The reviewed implementation is committed locally; production push authorization is pending.

## Verified

- Root cause: the legacy homepage renderer replaced current HTML prices with older API values, while the Packages page remained static.
- During this task, existing production CMS edits corrected Glam prices to $599 / $899 / $1,499. Custom still has numeric 0 in the old API. This task must not claim credit for those intervening edits.
- The shared renderer and API contract cover 16 packages across Glam, 360, Vogue and Audio. Custom projects a null numeric price and approved custom copy.
- All 151 automated tests and the admin build pass.
- Local PostgreSQL checks pass for migration 021, read-only dry-run, transactional import, repeat import, manual-edit conflicts, FAQ save/publish/unpublish/reorder, and authenticated draft-preview service behavior.
- Desktop/mobile tests pass on 12 routes at 1440px and 390px, including price parity, API override, offline fallback, images, gallery filtering/lightbox, event sections and page titles.
- New approved Gallery, Events, About and Contact commits are incorporated through public source revision 36a6c20.
- All 21 approved public image checksums match the manifest.
- A private production PostgreSQL custom-format backup was created and restored into a disposable local database. Restored counts: 5 packages, 43 FAQs, 15 migrations. The test database was removed.
- The latest production dry run (2026-09-22 20:33 UTC) reports **64 CREATE, 17 UPDATE, 41 SKIP, zero conflicts**. This is a plan, not applied totals.
- The API deploys from `rodaine-web/The-Lola-Booth-Admin`, main, and has a persistent volume at `/app/storage/uploads`.

## Production content preserved

The current production baseline contains 40 published FAQs and three archived/deleted FAQs. The 40 are retained exactly; archived questions are not revived. One inactive package, one draft testimonial, one draft hero, 10 draft content records and the unused draft Brand Activations event are preserved. Corporate/Digital experience records are retained for internal operations; only their website visibility is changed by the proposed import.

## Next deployment sequence

1. Obtain explicit approval for both remote main-branch pushes. The earlier automatic approval review rejected the exact main-branch operation; no push occurred.
2. Deploy the public website first. Its migration guard retains current approved static fallback until the API supplies experience-qualified package keys.
3. Apply **only** forward migration 021. Do not run migrations 016–020 as part of this task.
4. Run the production dry-run again and review conflicts. Apply the approved import through the API container, using the mounted media volume.
5. Push the Admin/API commit to its main branch and verify Railway and Admin Vercel deployment. Confirm 16 public packages, four experiences, six hero slides, six event types, 10 gallery records and 40 FAQs.
6. Repeat production dry-run: expect only SKIP. Complete live desktop/mobile comparison and authenticated Admin browser UAT.
7. Revoke the temporary Railway SSH key and stop its isolated local agent.

No secrets are included in either repository. Raw production inventory and backups remain in the ignored, restricted `audit-output/website-cms/production` directory. Do not commit or publish those files.

## Remaining content gaps

- `/careers` was 404 with no approved source in the inspected repository. No careers content was invented.
- Gallery's existing video category uses an approved image thumbnail without a playable video asset. Its current design and behavior are preserved.
- Page copy/SEO uses bounded JSON text slots in the existing Homepage editor. Icons, forms and layout remain in source; this is not a visual page builder.
- Migrations 016–020 and the pre-existing System Health problem remain outside this scoped website migration.

The content map and full package table are in `LOLA_WEBSITE_CMS_CONTENT_MAP.md`.
