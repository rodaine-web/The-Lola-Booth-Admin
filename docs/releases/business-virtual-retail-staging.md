# Business experiences, Virtual Booth and retail catalog — staging

Scope: Business & Brand Experiences on the existing Packages page and existing internal pricing architecture. Production promotion requires separate owner approval.

## Website

- Five independent selections: Glam, 360, Magic Mirror, Vogue and Virtual Booth. The four-experience cap remains for Celebration booking; it is removed for business requests and staff business quotations.
- Photography reuses the owner's approved corporate reference through SVG viewports. Real form controls cover the reference's checkbox positions; no stock equipment substitutes or sponsor claims were introduced.
- Compatible, active catalog add-ons remain optional. A separate business catalog response omits package names, prices, pricing methods and travel formulas. Retail rates are excluded from public catalogs and ordinary booking add-ons.
- Virtual duration choices: 24 Hours, 3 Days, 1 Week, Monthly Subscription. Experiences, add-ons, duration and business/event details continue through the existing inquiry/CRM flow.
- Celebration cards, prices and booking behavior are preserved.

## Internal catalog

The staging-only, audited `updateStagingBusinessCatalog` operation adds four Virtual Booth packages and six retail rates. It is idempotent, checks database identity and the expected published version, refuses existing drafts/unpublished pricing changes, and preserves other package/add-on rows. It publishes through the existing immutable, effective-dated catalog mechanism. No database schema migration is required.

Virtual starting rates: 24 Hours $349; 3 Days $699; 1 Week $999; Monthly Subscription $499/month. The monthly setup default is $499, with a proposed three-month commitment. A monthly quotation lists the first month and one-time setup separately. Later months are recurring service terms, not an upfront charge for the entire commitment.

Staff can configure allowances, active branded experiences, templates, branding, creative work, support, additional usage charges, start/renewal dates, setup fee and proposed minimum commitment. These terms persist in quote snapshots. Session allowances are unverified by default and require an agreed scope; no Fiesta platform capacity is promised.

Retail defaults: one 2×6 strip $5; two identical strips $8; one 4×6 print $7; two 4×6 prints $12; one US-mailed personalized 4×6 postcard $10; two mailed to different US addresses $18. These are internal catalog rates only. No event is authorized for retail sales by activating a rate, and there is no guest checkout, Twilio upsell or Lob fulfillment change.

Admin pricing supports package status/descriptions, Virtual Booth configuration and a separate retail editor. Changes require reasons and retain audit history; publication affects future quotes. Existing accepted proposals and invoices keep their agreed snapshots.

## Billing boundary

The existing integration does not provide a verified Virtual Booth provisioning/session API or an automatic recurring subscription workflow. This release configures quotation and recurring-service terms; it does not provision Fiesta sessions, start Stripe subscriptions or collect charges. Any automated subscription/provisioning expansion needs a separately scoped implementation and authorization.

## Validation

- Database/API regression: all five experiences in an internal quote and a real CRM inquiry; duration persistence; public price isolation; retail exposure rejection; idempotent catalog preparation; editable rates/status/configuration; monthly first-invoice total; unchanged original package rows and accepted document totals.
- Real local browser/API qualification at desktop, tablet and mobile widths, including experience selection, compatible add-ons, duration transfer, CRM submission, Celebration preservation and Admin persistence.
- Full tracked source tests, build and staging PR checks; hosted staging verification and catalog/document preservation checks recorded with the release.

Staging catalog recovery uses the prior immutable published version. No customer database is exported as part of this release. Do not restore a database or overwrite agreed documents to roll back pricing; publish a reviewed catalog version instead.
