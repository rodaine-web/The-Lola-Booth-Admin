# LOLA Website Removal Handoff

## Removed

- Deleted the standalone Phase 11C customer website app at `website/`.
- Removed the nested Next.js package, lockfile, TypeScript config, Next config, pages, components, website-only styles, tests, and local marketing assets contained in that directory.
- Removed root scripts for `website:dev`, `website:build`, and `website:test`.
- Removed Phase 11C-only Vercel/customer website docs.

## Retained

- LOLA Admin frontend.
- Express backend/API.
- PostgreSQL migrations and services.
- Background worker.
- Admin Website CMS.
- Public CMS APIs under `/api/public/*`.
- Public inquiry API at `POST /api/public/inquiries`.
- Proposal, invoice, payment, receipt, and delivery customer transaction routes.
- Phase 5B brand assets used by Admin, documents, email, and transactional pages.
- Existing admin tests, CMS tests, public API tests, inquiry tests, and transaction-flow tests.

## Current Repo Purpose

This repo is the LOLA operating system:

- CRM
- Admin
- Sales
- Documents
- Payments
- Operations
- Website content management
- Public data APIs
- Communications
- Automations
- Client transactional experiences

The external marketing website is separate and should integrate with the retained public APIs.

## External Website Readiness

The integration contract is documented in `docs/LOLA_EXTERNAL_WEBSITE_INTEGRATION.md`. The upcoming external/static HTML site should read published content from the public CMS APIs and submit booking inquiries through `POST /api/public/inquiries`.

## Cleanup Limitations

- No replacement website was built.
- No deployment was performed.
- No public API response shapes were changed.
- No Admin Website CMS functionality was removed.

## Validation Results

- `npm install`: passed.
- `npm test`: passed, 73/73 tests.
- `npm run build`: passed for the LOLA Admin Vite frontend.
- `npm run env:check`: passed with development defaults; `PUBLIC_BASE_URL` and `PUBLIC_APP_URL` remain defaulted in local development.
- Backend startup smoke: passed on `localhost:4000`.
- Worker startup smoke: passed; the automation worker started and processed a queued job.
- Public API smoke: `GET /api/public/site`, `/homepage`, `/hero-slides`, `/packages`, `/experiences`, `/gallery`, `/testimonials`, and `/faqs` returned 200.
- Public inquiry smoke: `POST /api/public/inquiries` returned 201.
- Admin preview smoke: `/` returned 200.
- Transaction route smoke: `/proposal/smoke-token`, `/invoice/smoke-token`, and `/delivery/smoke-token` returned 200 from the built SPA.
