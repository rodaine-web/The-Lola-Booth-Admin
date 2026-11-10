# Staging experience catalogue — 9 November 2026

Owner-authorized staging catalogue update. Production data is outside this increment. Website redesign is the subsequent increment; the existing website layout/assets are not redesigned here.

Primary CMS order: The Lola Glam, The Lola 360, The Lola Magic Mirror, The Lola Vogue. Essential/Signature/Luxe last 2/4/6 hours. Signature is most popular. Each primary experience also has a Custom quote package. Detailed owner-supplied feature tables take precedence over the illustrative mockup (notably Vogue Signature has no printing).

| Experience | Essential | Signature | Luxe |
| --- | ---: | ---: | ---: |
| Glam | $599 | $899 | $1,499 |
| 360 | $699 | $1,099 | $1,799 |
| Magic Mirror | $799 | $1,199 | $1,999 |
| Vogue | $899 | $1,399 | $2,299 |

Existing Glam print allowances are preserved: Signature 200 / Luxe 500. Mirror matches those allowances and the current Glam upgrade matrix. Vogue Luxe retains 500; Signature has no included printing. Feature labels support current hours/selected-print substitution and remain editable under Pricing & travel.

Audio Guest Book retains its existing experience ID for history and standalone booking. The base rental is from $299 with logistics/delivery excluded; its existing 8-hour rental duration remains. Add-on price is $249 across the four primary experiences. Existing add-on IDs/count/prices are preserved except that explicitly authorized Audio price change. Applicable existing enhancements gain Mirror compatibility. Audio cannot be added again when the standalone Audio rental is already selected. Obsolete standard Audio Signature/Luxe offers are archived, not deleted. Other catalogues and historical commercial documents are preserved.

## Application and safeguards

The explicit `server/src/scripts/update-staging-experience-catalog.js` command does not execute on deployment/migration. Dry-run is the default; apply requires `--apply --expected-version=<reviewed-id>`. It requires staging, verifies configured database identity, locks the update, refuses another pricing draft, writes one atomic transaction, synchronizes only STAGING experience/package CMS records through versioned CMS services, publishes a new immutable pricing version and records a complete before-state in the audit log. Repeat invocation is idempotent. No invoice, agreement, proposal, payment or outbound send is edited/created by the operation.

A separately reviewed Magic Mirror equipment photo is still required for the website redesign. This update does not relabel an Audio photo as a Mirror or fabricate inventory counts.

## Validation before release

- Full local Node test suite:730 passed, 35 skipped, 0 failed.
- Targeted pricing/identity/add-on tests:22 passed.
- Two serial disposable local PostgreSQL integration suites passed, including atomic catalogue publication, prior snapshot immutability, exact existing add-on price preservation, unaffected FAQ content, order, standalone rental and production refusal.
- Admin build and git diff whitespace check passed.
- An initial rehearsal exposed an SQL integer/numeric inference conflict; explicit casts fixed it before hosted mutation. A parallel test attempt raced PostgreSQL extension creation; the serial run matches CI and passed.

Hosted release/application results are recorded after deployment and final verification.
