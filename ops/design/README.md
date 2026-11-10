# Lola staging website and business catalogue redesign

Scope: `main-staging`, staging public website, staging Admin and staging API only. Never promote this release to production without a separate owner instruction.

## Public behaviour

Seven redesigned pages preserve the existing contact/inquiry API contracts, form validation, consent and proposal handoff. Customer labels are Celebrations and Business/Corporates; stored customer enums are unchanged. Business requests select experiences and optional add-ons without selecting internal packages or showing internal rates. The public catalogue rejects business package IDs.

The four primary experiences are Glam, 360, Magic Mirror and Vogue, in that order. Home has four CMS-managed champagne-event hero slides with manual navigation, pause, reduced-motion and visibility handling. Mirror and Vogue home cards use the approved silver styling. Guest photos and transparent equipment cutouts occupy separate experience-page slots. Equipment uses a shared CSS beige circle. Existing FAQ/testimonial content is retained; partner records and new copy/image slots are editable through staging CMS.

Footer links include the page sitemap, experience links, contact information, legal links, XML sitemap and Instagram/TikTok brand marks. Staging remains noindex; canonical URLs target the public domain. Contact details continue to come from CMS settings.

## Internal business plans

Twenty owner-approved rates across Event, Event Plus, Event Premium, Activation and Campaign. Included experiences retain full tier rates; additional experiences receive only the approved 10/15/20 percent matrix discounts. Undefined combinations require an explicitly entered authorized percentage. Printing is per eligible experience; custom additional allowances need a quoted charge. Equipment and active staff assignments are prerequisites for confirming newly accepted structured business plans.

Admin loads published internal pricing through authenticated `/api/pricing/current`. Customer serializers omit internal tier/rate metadata. New proposals freeze approved features and prices, with explicit print counts and tax language. Reopening a discounted proposal restores its original base rate before calculating the additional-experience discount once. Existing issued document snapshots are not rewritten.

## Applying hosted staging content

1. Merge only into `main-staging` after CI passes and verify the API/worker and public/Admin deployment revisions.
2. Migrations 075 and 076 add experience images and confirmation-readiness checks for new structured business plans.
3. Run `APP_ENV=staging node server/src/scripts/update-staging-redesign.js` for a guarded dry run.
4. Apply with `--apply --expected-version=<reviewed-current-version-uuid>`. The script requires an active staging Owner, verifies database environment identity, refuses an unrelated pricing draft, records before-images and publishes business/CMS changes atomically. Publication is idempotent.
5. Verify four home slides, experience order, existing FAQ/testimonial preservation, unchanged add-on prices, twenty internal business plans and no business prices in public catalogue responses.

The local visual preview `node ops/design/preview-redesign.mjs` uses ignored read-only staging baseline fixtures and rejects all writes; it never forwards a request to hosted staging. The optional interactive mode in the business database regression is restricted to disposable localhost test data.

## Verification evidence

- Complete serial local suite: 775 tests, 758 passed, 17 skipped, zero failures.
- Existing pricing Admin/public desktop and mobile browser regression passed, including real inquiry persistence, proposal editing and pricing failures.
- Final targeted catalogue/CMS tests: 16 passed. Checks include private business plans, approved example total $10,697.15, accepted proposal/invoice consistency, historical snapshots, equipment/active-staff gates, CMS preservation, hero order, social links and pricing-rule edits.
- Manual browser: create and reopen a synthetic business draft at $10,697.15 without discount duplication; submit a synthetic public business request successfully; inspect all seven mobile pages without horizontal overflow; expand all package details with aligned CTA positions.
- Local screenshots are ignored under `.qa/redesign/`. Generated asset provenance and final prompt descriptions are in `generated-assets.json`.

Hosting verification must be completed after the reviewed staging deployment; local results alone do not establish a hosted pass.

## Owner-approved production promotion — 2026-11-10

The owner explicitly requested the redesigned website and Admin updates be released to production. `release-production-redesign.js` requires production database identity, an exact reviewed published catalogue version, no open pricing draft and an active Owner. Its single transaction uses existing production experience/package identities, records before-images through the component audit entries, leaves issued financial snapshots untouched and enables the CMS projection only after completion. Physical Audio inventory is never fabricated; existing units alone are assigned to the shared pool.

The separate `The-Lola-Booth-Website` production repository receives only the approved public files. It retains its production API origin, image proxy, analytics, indexing, payment pages and legal content. Staging remains isolated. The public projection retains production FAQs, testimonials and gallery content and draws redesigned slots from CMS records in the production database.
