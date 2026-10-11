# Phase 1 items 1, 3 and 4 — implementation checkpoint

Production remains NO-GO. These changes are local and have not been deployed to the customer application.

## Item 1 — Stripe and payment recovery: PARTIAL

The Stripe connector now exposes the LOLA sandbox and live account `acct_1UNbACC7UOE45wwk`. Read-only live `GET /v1/webhook_endpoints` returned an empty list on October 10. Production API still runs its October 8 main-prod deployment. Its variable inventory includes a Stripe key and signing secret, but not STRIPE_ACCOUNT_ID or STRIPE_LIVE_PAYMENTS_ENABLED. OAuth redacts values: key mode, account identity and signing-secret validity have not been verified.

Added `server/src/scripts/stripe-launch-preflight.js`. Run in the production service environment after approved live configuration is prepared. It checks the key/account identity, charges_enabled, an enabled live endpoint at `https://api.thelolabooth.com/api/webhooks/stripe`, and the implemented payment/refund subscriptions. It performs GET requests only and changes no flags. Passing this script does not prove signing-secret match, inbox delivery or a customer transaction. Chargeback handling remains outstanding; do not subscribe and silently treat it as qualified.

Existing exact-checkout decline/expiry/replay handling passed another disposable PostgreSQL integration run. Stripe responses were simulated. Real Sandbox failure/retry and live delivery qualification remain open. No live endpoint, live charge, refund or activation was made in this checkpoint.

## Item 3 — mobile and access qualification: PARTIAL

Fixed long filename/text wrapping, constrained form controls, and single-column backdrop cards below 380px. The backdrop quote card now reloads when the selection changes, preventing stale price/acceptance presentation. Unavailable backdrop previews cannot be selected through the preview dialog.

The existing staging customer session opened the submitted planning page, which measured clientWidth=390 and scrollWidth=390. Its planning form is already submitted and locked. This is only evidence for the existing submitted page: it does not qualify the new CSS, mobile upload, editable backdrop selection or proof approval. Returning to The Client Workspace succeeded after session hydration. The temporary viewport override was reset.

Remaining: deploy scoped changes to staging, use an editable synthetic QA fixture for mobile upload/style/backdrop/proof approval, and complete the remaining role/expired/revoked-access matrix. Existing prior evidence remains in the main release-readiness report.

## Item 4 — backdrop/custom work: PARTIAL

Owner confirmed ten seeds stay INACTIVE until final images and real stock counts are supplied. Own-artwork uploads and quoted custom requests remain available. No assets or stock quantities were invented.

Invoice linkage now locks the planning selection first and verifies that the accepted quote still matches that selection, event and client. Cancelled/completed/deleted events cannot receive this linkage. Once invoiced, changing the client selection is blocked until Admin resolves the work. Quote withdrawal is permitted only after the linked invoice is VOID/REFUNDED and authoritative net money held is zero; commercial history and invoice linkage are preserved. This does not initiate any refund or change the owner’s cancellation policy. Removed a duplicate custom-payment check.

Added `test/backdrop-quote-db.test.js`: real migrations, quote acceptance, immutable terms, stale selection rejection, mismatched invoice rejection, invoiced selection protection, pending-payment rejection, full payment, partial refund stop, and safe withdrawal with retained history. Ten inactive image-less zero-stock seeds are asserted.

## Validation

- Available local suite before adding the new conditional integration test: 643 tests, 630 passed, zero failed, 13 skipped.
- Frontend production build passed; syntax and diff checks passed.
- New disposable PostgreSQL quote test and existing payment-failure test: two passed, zero failed, zero skipped on Railway deployment `202bea0b-308f-42c7-b486-bb44b2045f30`.
- The initial combined runner failed because concurrent schemas raced while installing pgcrypto. Corrected the isolated runner to execute these tests sequentially; the corrected run passed. Source staging/production databases were never connected.
- Hosted npm audit --omit=dev: zero vulnerabilities. Local npm audit could not reach the package registry (DNS restriction), so it is not counted as a pass.
- Dedicated `test-runner-validation` service only; no app, worker, production migrations or backup service changes. Restart policy NEVER.

## Next qualification

Register and securely configure the production webhook as part of the coordinated release, validate the actual live key/account with read-only preflight, then verify signed delivery. Finish real Sandbox failed-payment recovery and chargeback integrity. Deploy the scoped changes to staging and complete editable customer/mobile and custom-quote invoice/payment/approval browser journeys. Reconcile evidence into the canonical readiness report before production activation.

## Live webhook provisioned — October 10 evening (Chicago)

Created live endpoint `we_1UPBsuC7UOE45wwkoOVPPShg` on account `acct_1UNbACC7UOE45wwk`, URL `https://api.thelolabooth.com/api/webhooks/stripe`, API version `2026-08-26.dahlia`, ten implemented payment/refund events. Verified its status DISABLED. Its one-time signing secret was passed directly to Railway's staged production variables without logs or source files; no production application redeploy or flag activation occurred. Production patch `1197ef35-0500-4864-94aa-3ffcf9040735` contains four pending variables.

Read-only production-key preflight ran on isolated helper `4736a293-f347-4c39-9a5e-dfc7ded857af`, deployment `290b3e24-fd58-442d-8d21-c3a95c385c5a`. Result FAILED: the currently configured production Stripe key is not live. No Stripe charge, refund, Checkout session or source database write was made. Owner must securely set the live key in Railway before account/charges-enabled/delivery verification can finish. Container deployment SUCCESS is not a passed preflight.
