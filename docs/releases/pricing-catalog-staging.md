# Versioned pricing overhaul — staging release

Status: published catalog version 1 is active on staging. The deployed application-service qualification passed; hosted Admin and website review is recorded in the owner release report.
Production promotion is a separate owner-approved task.

## Source audit and approach

The existing database-backed packages/add-ons, public enquiry, proposal review/versioning, accepted-price invoice conversion, Stripe Tax, secure Workspace and gallery workflows are retained. Migration 072 extends those records rather than introducing another package or add-on module. New package pricing is calculated in integer cents from an immutable published catalog snapshot; existing catalog rows are the editable drafts. Old accepted documents, payments and signed agreements are not repriced.

The actual staging website is served from this repository's `public/staging-site` by the same Vercel project as staging Admin. Both hosts were verified on the pre-release deployment `dpl_B4Q9vfpYFqptpkdBBJDDcC9aQr5S`, revision `dd64c9a30b0ec512d23b4859b4cdec65f37cd83f`. The separate `rodaine-web/staging` checkout is a source mirror, not the currently served staging deployment.

## Approved business decisions

- Customer type and event purpose are separate. Ordinary company celebrations default to standard pricing. Professional events can choose standard packages.
- Downtown Chicago is the dispatch label. No exact address or coordinate is fabricated.
- One shared trip is charged once, using the longest included package coverage. Extra trips/vehicles require review.
- Each individual 2×6 strip counts as one physical print. Estimated paper consumption uses two strips per 4×6 sheet; actual costs/capacity remain unconfigured until Admin supplies them.
- Prices are before tax. Stripe calculates final tax using billing address. No tax percentage is introduced.
- Staffed services retain the approved General — Services classification (`txcd_20030000`, existing environment configuration). Separately charged print upgrades retain the owner-approved Printing classification (`txcd_20090028`) through invoice conversion. No Stripe SDK/API version, registration or account setting is changed.

## Implemented scope

- 36 standard/professional/activation/custom package definitions, with per-experience hours/rental duration, printing, design/music/phone allowances, styling, travel coverage and included enhancements.
- Configurable print price matrix; inclusion-credit upgrades; no duplicate print/hour/travel add-ons; high-volume and unlimited requests require explicit scope and price approval.
- Configurable operating estimates for consumable cost and printer capacity. Missing values remain unknown, never invented.
- Existing add-on management extended with methods, compatible experiences/packages, quantities, resource requirements, approval rules, active state and display order. Other existing enhancements are retained as reviewable requests.
- Catalog versions, effective dates, publication snapshots and immutable saved pricing reviews. Staging preparation is idempotent and captures the original public catalog before updating draft configuration. The public website keeps that baseline until activation; switching the flag off restores its prices and add-ons while respecting current archiving/active filters.
- Admin pricing/travel controls, published-price proposal selectors, quote review in both proposal editors, controlled negotiated/custom charges, audited approvals and draft revisions that retain print allowances without charging them twice.
- Website package catalogs, printing/hours/options and server-calculated live price estimates. Live estimates create no durable quote rows and use a separate bounded quota from enquiry submission.
- Durable enquiry pricing, availability-approved draft preparation, proposal/invoice line consistency, Workspace inclusions and CRM read-only pricing summaries.
- Internal approval reasons, route evidence and operating costs are stripped from customer JSON.

## Travel methodology and explicit fallback

Repository audit found no existing directions/boundary routing adapter. The supported active mode is `MANUAL_REVIEW`.

The reusable calculation accepts verified driving/boundary evidence and calculates $2.50 per excess one-way mile once, with configurable rate and review threshold. Those calculations have deterministic fixture tests; no real routing-provider distance is claimed. Without verified route evidence, the quote cannot be sent until authorized staff approve a travel charge, including an explicit zero charge and reason. No radius, state-line surcharge, downtown time-radius substitute or invented boundary crossing is used.

Automatic boundary routing requires a separately configured exact origin and a provider capable of the policy. This release must not be described as a live automated routing integration.

## Scope approvals

Audio delivery targets are configuration targets, not automatic binding promises. Audio/professional/activation/custom scopes and quote-only enhancements require Admin review. Approved scope text is recorded with the quote. Unresolved requests remain review-required and cannot be sent. Actual equipment assignment, printing, lead capture, reporting and audio production continue through existing/manual operations; configuring a priced enhancement does not create a new third-party fulfillment integration.

## Migration and recovery

- Migration: `072_versioned_pricing_catalog.sql`.
- SHA-256: `d2e9db2f0c52f6de802f6c89018efba73566face38589a6bd2719e4925246d59`.
- Adds package catalog/profile fields, add-on policy, immutable version/review tables and proposal quote linkage. No existing row is deleted or repriced by the migration.
- Fresh staging-only encrypted backup completed, decrypted/readback-verified, restored on isolated localhost PostgreSQL and migration-rehearsed with all 151 existing table row counts unchanged.
- Recovery proof timestamp: `2026-11-03T12:05:45.354Z`; encrypted archive SHA-256: `ec6931f693c08dc48199daad76adadb9f5831b82883762c5d9cfa1028db2b29c`.
- Backup material is outside Git in an owner-private directory. No credentials, backup key or customer records are included in this report.
- The older scheduled staging backup helper still reports a failed rehearsal; this successful separate snapshot does not claim that cron/helper was repaired.

## Staging rollout

1. Run local and CI unit/database/browser checks and production build.
2. Merge only the tested branch into `main-staging`; do not merge `main-prod`.
3. Deploy verified staging API/worker revision and frontend. Migration runs against the expected staging database identity; Stripe stays in test mode.
4. Keep `PRICING_CATALOG_ENABLED=false` while preparing/reviewing/publishing the staging catalog in Admin.
5. Enable the flag on staging API/worker only after publication; verify the deployed revision and catalog version.
6. Qualify desktop/mobile website, proposal revisions, price preservation, permissions and customer-facing documents using clearly labelled synthetic records and owned test recipients.
7. Report exact executed checks, remaining issues and staging screenshots; stop for owner review.

## Rollback

Disable `PRICING_CATALOG_ENABLED` on staging API/worker to stop new versioned calculations, or roll back those deployments and the frontend to the verified previous revision. Retain the additive tables and all generated financial documents. Do not delete quotes, signed documents or posted payments, and do not restore a backup over an active database as a routine code rollback. Backups are for a separately planned recovery. Old accepted prices and payment handling continue to use their existing snapshots.

Future production promotion requires explicit owner approval, target/revision and recovery verification, a controlled production catalog configuration plan using production IDs (no copying staging customers), and production smoke checks. No production change is authorized by staging acceptance.

## Validation evidence

See the private owner release report for final local/CI/hosted results, revision IDs and screenshots. Do not infer provider delivery or a real Stripe transaction from simulated database fixtures.

## Activation qualification — November 3, 2026

Catalog version 1 (`c2763d59-78c4-4338-8ef9-74489c85f5d5`) contains 36 packages (12 per catalog) and 26 add-ons. The original public baseline retains 16 packages and 10 add-ons. PRICING_CATALOG_ENABLED is enabled on staging API and worker. Activation deployments: API `ea6ac7b9-594f-4a10-af59-dd727de56d68`, worker `0939c5db-3106-41fb-ba2e-df5deabf5a8a`, both successful.

The deployed-service check ran inside a deliberately rolled-back transaction: a company celebration uses standard Glam Signature pricing; 500 prints produce $1,124 with inclusion credit; two additional creative designs produce $1,324; editing preserves the enhancement IDs and quantities; a reviewed $1,124 proposal converts to a $1,124 invoice with the approved Printing tax code; repeat conversion returns the existing invoice; stale catalog versions are rejected. Test customers, quotes, proposals, invoices and jobs did not persist. No email, payment, provider tax calculation, or customer acceptance was performed.

Hosted review found repeated legacy package names across experiences. The Admin table and package editor now display the experience so operators can distinguish each package. Published versions remain immutable.

Recovery: the encrypted full staging snapshot from 2026-11-03T12:05 was already decrypted and restore-verified. Attempts to refresh the full snapshot over SSH timed out; those failed attempts are not counted as recovery copies. A broader export was rejected by automatic review because it included potentially customer-specific quotes. No customer quote export was completed. Preparation itself atomically retained the public catalog rollback baseline. Disable the staging pricing flag to restore that baseline; retain catalog versions and existing business records.
