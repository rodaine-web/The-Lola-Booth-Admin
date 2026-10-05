# LOLA Admin Version 1.1 — staging implementation

Version 1.1 is a staged release program to complete the customer journey and add HoneyBook parity. No production changes or integrations are activated by this milestone.

## Milestone 1: client agreements (implemented and qualified in disposable PostgreSQL/Chromium)

On an accepted or invoice-converted proposal, sales writers can paste approved terms, save/edit a draft, issue a 30-day signing link, revoke an unsigned agreement, and create subsequent revisions. Client signing requires explicit electronic-signature consent, the proposal's client email, the current document fingerprint, and a typed name. The secure link is a bearer credential; matching email is not independent identity verification. Signed content and signature evidence are immutable in PostgreSQL. Repeated identical submissions return the original signature; signing never creates payments or changes booking status.

The snapshot includes proposal reference, client, event details, selected line items and total, refreshed at issuance. It contains no internal notes or proposal credentials. Tokens are generated with 256 bits of randomness, stored as SHA-256 hashes, excluded from public responses; authorized sales writers can recover signing URLs from encrypted credentials, and redacted from API logs. PDF copies render the saved snapshot and signed evidence. Agreement invitation and signed-copy emails are available as explicit admin actions. Delivery honors the existing staging recipient policy. No legal terms are generated: staff must supply their approved agreement text.

Routes require read:sales or write:sales; public access requires the signing token. The module is enabled for APP_ENV=staging or local/test without APP_ENV and unavailable in production. Existing admin routes remain available when the module is disabled.

Migrations: 040_v11_contracts.sql, 041_v11_agreement_delivery.sql, 042_v11_client_workspaces.sql (additive tables and signed-record trigger). Apply through the existing migration runner to the verified staging database only. Do not apply to production for this milestone.

## Qualification

- Existing suite plus new signing policy, production gate, token redaction and multi-page PDF tests.
- Database lifecycle test is opt-in using V11_TEST_DATABASE_URL pointing to a disposable localhost database. It creates its own schema, checks snapshot issuance, signatures, replay, revocation, expiry and database immutability, and drops that schema afterward.
- Run `V11_TEST_DATABASE_URL=<disposable-local-url> node --test test/contracts-db.test.js` in a database-capable environment.
- Apply migration on staging only after checking database identity; use a demo accepted proposal to exercise draft → issue → sign → PDF.
- Exercise read-only and no-sales roles, malformed token, revoked link, expiry, missing consent, changed fingerprint, duplicate submission, and signed modification attempt.
- Verify that existing proposal, invoice, payment and event statuses do not change when signing.
- Browser-check desktop/mobile, label/error accessibility, copy-link behavior and multi-page download.
- Database/API/Chromium qualification passed in GitHub Actions run 37314734554. Staging deployed at 5f8a9c2 with migrations 040–042. Hosted agreement email/signature UAT remains outstanding.

## Remaining release milestones

2. Agreement email delivery and client workspace (foundation qualified in disposable PostgreSQL/Chromium; hosted delivery UAT pending): invitations and signed-copy HTML email with PDF links; recorded sends, bounded retries for confirmed failures, uncertain-outcome holds, provider acceptance versus inbox delivery and development-preview distinctions. The first client workspace is a bearer link scoped to one proposal/event, containing agreements, issued invoices, and successful-payment receipts. Workspace expiry/revocation does not revoke previously shared individual document links. Broader client-account authentication, all-project access, questionnaires, editable templates and automatic signed-copy delivery remain outstanding.
3. Payment/customer communication readiness: qualify live-provider adapter separately; reconcile success/failure/refund/replay; customer reply threading; reminders and campaigns with cancellation, retries, suppression and idempotency. Keep production settings unchanged.
4. Private galleries and permission/recovery qualification: storage delivery, expiry and revocation, all roles, monitoring and backup restoration.
5. Self-service business workflows: combined documents, customizable pipeline/fields, visual automations, calendar scheduling, tasks and reusable checklists.
6. Finance/reporting and mobile: expenses, QuickBooks mapping/sync/reconciliation, profitability and exports, mobile workflows/notifications.
7. Product maturity: multiple brands, AI assistance, native apps and bank-connected expenses. A future SaaS requires separate tenant architecture and subscription/onboarding work.

Each milestone requires real end-to-end evidence before being marked complete. Package version is 1.1.0 to identify development work; it is not a release certification.

## Continued implementation: delivery and event workspace

- Recoverable signing tokens are AES-256-GCM encrypted in a separate credentials table; signed records stay immutable.
- One delivery record per agreement/revision and purpose prevents confirmed sends from being repeated. Each attempt creates a communication record. Three confirmed-failure attempts are allowed. Provider timeouts/unknown outcomes and interrupted PROCESSING claims are held for review; no automatic retry or unverified manual reset is provided. Development previews are not reported as external delivery.
- Client workspace grants have hashed tokens, encrypted recovery credentials, 180-day expiry and explicit revocation. Access queries use the proposal ID from the validated grant, never a caller-supplied client/project ID. Public response fields are explicitly selected. Draft, void, deleted, unrelated and unavailable documents are excluded or have unavailable links.
- Staging CI now includes disposable PostgreSQL 16 and three opt-in DB tests: lifecycle tests with a minimal schema, the entire migration chain against an isolated schema, and an actual Express API journey covering permissions, signing, development-only email and workspace revocation. All three checks passed in GitHub Actions run 37314734554, alongside the browser journey and frontend build.
- Local sandbox database access is still unavailable. CI qualified the migrations, API and Chromium client journey against disposable PostgreSQL. Actual hosted provider delivery and the complete hosted signing journey still require UAT.

## Converted proposal workflow correction

Agreements and client workspace grants remain available after an accepted proposal is converted into an invoice. Creating or issuing an agreement does not change proposal, invoice or payment status. Draft, declined, expired and archived proposals remain ineligible. API regression coverage exercises workspace creation, agreement draft/issuance, and client signing after conversion.

## Campaign lifecycle

Campaigns can be archived from the list or overview, with confirmation. Archived campaigns are omitted from the active list and accessible through the Archived status filter. Sent campaigns cannot be deleted. In staging only, users with campaigns.edit can delete a draft with no recipient or sending history. Deletion removes it from campaign access using an audit-preserving soft deletion; CRM contacts and suppressions stay intact. Mutation eligibility is checked under a row lock so scheduling/sending cannot race deletion. Migration 043 adds deletion timestamps and actor attribution.
