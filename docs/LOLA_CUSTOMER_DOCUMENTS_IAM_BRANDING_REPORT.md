# LOLA Customer Documents, HTML Emails, IAM + Admin Branding Report

AREA | STATUS | EVIDENCE | ACTION
--- | --- | --- | ---
Link-first proposals | PASS | Secure public proposal token route is preserved. Generated and uploaded proposals download through the public token PDF endpoint with `LOLA-Proposal-*` filenames. | Deploy migration 020 before production smoke.
Create in LOLA proposals | PASS | `src/pages/ProposalEditor.jsx` now supports proposal title/date, content sections, reusable corporate sections, custom sections, custom services, add-ons, pricing, terms, draft/ready save, and standard lifecycle creation. | Business UAT should create one standard proposal and one bespoke brand activation proposal.
Uploaded external proposals | PASS | `server/src/services/proposal-service.js` adds `createUploadedProposal`, storage abstraction use, external PDF metadata, proposal version creation, audit, and shared secure-token lifecycle. | Configure production storage retention/backups.
Proposal PDF visual system | PASS WITH CONFIGURATION | `server/src/services/document-service.js` now renders an ivory/gold stationery cover and overview pages using LB monogram, LOLA wordmark, gold rules, side summary card, custom sections, flowing pages, and branded footer. | Visual QA should compare sample rendered PDFs against the supplied mockups after production fonts/assets are confirmed.
Invoice public/PDF flow | PASS | Public invoice route is preserved, invoice PDF now includes the stable invoice token URL and QR code to the invoice page, not a checkout-only URL. | Run a live test invoice payment smoke with Stripe/PayPal production credentials.
Branded HTML emails | PASS WITH CONFIGURATION | `brandedEmailHtml` now provides the shared mockup-style top nav, tagline, monogram/wordmark/contact header, hero band, CTA, summary/value bands, script-style team signature, and Instagram/TikTok/YouTube-style footer without Facebook/Pinterest. | Replace the placeholder hero source with the final approved banner asset if marketing supplies it.
Template key normalization | PASS | Migration 020 seeds `BOOKING_INQUIRY_CONFIRMATION`, `CONTACT_CONFIRMATION`, `PROPOSAL_DELIVERY`, `INVOICE_DELIVERY`, `PAYMENT_CONFIRMATION`, and `GENERIC`; proposal/invoice sends try uppercase keys first. | Review final copy in Admin templates.
Manual communications | PASS | `/communications/send` now accepts BCC, CTA, proposal/invoice/payment relations, and uses the `GENERIC` branded HTML shell. | UAT a manual email send from Communications.
User/RBAC | PASS WITH CONFIGURATION | Migration 020 adds user profile/invitation fields, `SUPER_ADMIN`, granular user permissions, and one-time token table. Admin routes now support user create, edit, deactivate, role assignment, and password-reset emails with owner/root escalation blocks. | Add the first production super admin via owner account after migration.
Credential safety | PASS | Existing Phase 14/final certification changes keep login fields empty and seed owner credentials explicit through env only. | Do not reintroduce defaults in production seed data.
Admin branding | PASS | Sidebar uses the existing approved LOLA logo and the text `Admin Portal`; `LOLA Admin` and `Private operations` were removed. | None.
Automated coverage | PASS | `npm test` passed before this report; new `test/customer-documents-iam-branding.test.js` covers migration, proposal modes, PDFs, emails, RBAC, and branding. | Re-run `npm test` and `npm run build` after final patch set.

Verdict: CUSTOMER DOCUMENTS + IAM READY WITH CONFIGURATION
