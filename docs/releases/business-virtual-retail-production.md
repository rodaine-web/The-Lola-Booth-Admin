# Business experience production release — 2026-11-20

Owner approval: after aligning the “Your guests will get” panels, promote the staging-qualified business redesign to production. The owner also requested that Virtual Booth appear in Admin experience/proposal development and that internal retail rates be discoverable.

The release selectively ports the business changes onto current main-prod, preserving newer postcard resend/XML fixes. Shared grid tracks align photos, descriptions and benefit panels within each responsive row. Proposal discovery recognizes Virtual Booth; staff may quote a duration alone or add it separately to an existing staffed business plan. Tier changes retain the virtual selection; its price is not discounted as a staffed booth. Pricing & catalog links directly to the separate retail section.

The explicit production catalog entry point retains database identity, expected published version, unpublished draft/change rejection, transaction locking, audit and idempotency guards. Reviewed production baseline: catalog v7, 48 packages and 28 add-ons, no draft. Four Virtual Booth packages and six internal retail rates are added through the existing immutable publication mechanism; prior catalog entries and agreed document prices are preserved. No guest sales, payment collection, recurring subscription execution, Fiesta provisioning or Lob dispatch is enabled.

The public website release preserves production origins/configuration, analytics, indexing, legal pages and unpublished standalone Events/Gallery. It changes only packages/quote behavior and the approved assets. Hosted verification must use read-only requests, with no customer emails or synthetic inquiries in production.

Qualification includes desktop/tablet/mobile panel alignment and quote transfer, real local CRM/API fixtures, standalone and business-plan Virtual Booth proposal selection, editable Admin terms and retail separation, full source regressions and required PR checks. After deployment verify API/worker/Admin/public-site revisions, published rates, original catalog/document preservation and hosted flow without sending a form.
