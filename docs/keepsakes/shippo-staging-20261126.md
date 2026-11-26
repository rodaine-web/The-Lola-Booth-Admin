# Shippo staging shipping

Shippo REST integration, test mode only. No production deployment, live token, real postage purchase, automatic label purchase or customer notification.

## Setup

1. Put `SHIPPO_TEST_API_KEY` (must start with `shippo_test_`) privately in the staging API and staging worker environment. Never put it in frontend variables. The token is never returned to Admin.
2. Open Keepsakes → Shipping. Enter the actual US ship-from/return address, business sender email and phone (with country code), and package profiles: inches, empty package ounces, per-item ounces, item capacity, and compatible products. There are no guessed defaults.
3. Optionally restrict carrier service tokens. Enable Shippo checkout rates after the profiles and account carriers are ready. Configuration changes invalidate unpaid quotes.
4. Complete existing product tax configuration separately. Shippo does not bypass Stripe Tax, inventory, photo permissions or proof approval.

## Checkout

Only IN_HOUSE lines use Shippo. Compatible lines share packages by recipient, complete destination and profile; quantities split at configured capacity. Digital, Lob and premium supplier routes remain separate. Each real parcel is rated once and its shipping charge allocated once before destination-specific Stripe Tax. Choose the lowest valid supported USD rate and show carrier/service/estimate. No rates, missing packaging, invalid addresses, wrong mode, timeout or malformed currency block checkout without a free fallback. Existing manual shipping remains active while Shippo is disabled.

Quotes encrypt shipment addresses and retain package/rate/configuration snapshots; public responses omit supplier credentials, addresses and internal rate IDs. Fifteen-minute quote expiration and immutable configuration checks remain.

## Admin labels and tracking

Paid orders must have every covered line approved for production and still in production before requesting or creating a label. Get a fresh label rate; check the explicit package/service/cost approval; create a reviewed TEST label. Cost is checked server-side against the saved rate, valid for ten minutes. Approval is audited. No shipping label is created by checkout, payment webhooks or the worker.

An order advisory lock serializes labels against refunds and production changes. A durable reservation precedes the transaction POST. Ambiguous outcomes cannot re-post: enter the existing transaction ID in Admin to reconcile; Shippo must confirm matching metadata and test mode. Confirmed transactions can refresh sample PDF and tracking; worker polls active labels periodically. Creating labels never marks products dispatched or delivered. Existing production dispatch confirmation remains separate.

Refunds with purchased/unresolved labels require review first. Void an unused label in Shippo; verify its completed refund ID in Admin. The API verifies test mode, original transaction and SUCCESS before clearing the label. Unknown transaction outcomes require reconciliation. Voided labels cannot be revived by a concurrent tracking refresh.

## Verification and limits

Build and focused unit, isolated database and desktop/mobile browser checks cover exact cents, wrong mode/live-key denial, grouping/capacity/different recipients, stock/payment/production gates, once-only shipping tax allocation, configuration changes, required cost approval, duplicate prevention, ambiguous reservation/reconciliation, verified void and tracking. Provider calls are synthetic fixtures until the private test token and real packaging are supplied. Test labels are not usable for mailing. US destinations only; optional services default to all supported USD rates. Owner-supplied per-item weight applies to all products assigned to that profile; split profiles for products needing different packaging/weights.

References: https://docs.goshippo.com/guides/testing.md ; https://docs.goshippo.com/guides/generate-shipping-label.md ; https://docs.goshippo.com/api-reference/overview ; https://docs.goshippo.com/tracking/tracking.md ; https://docs.goshippo.com/api-reference/refunds/create-a-refund.md


## Actual Shippo test-token check

The owner added the API test token, and the staging worker now references the same private API token. Both resolve as test credentials. Actual Shippo calls returned rates and generated a USPS SUCCESS sample PDF label and tracking number using synthetic addresses, sender email and reserved test phone. No customer communication, live postage or manufacturing was requested. A preceding UPS test transaction failed because UPS registration is incomplete; activate that account before allowing UPS services. USPS also required sender email/phone, now required in Admin and preserved by the API mapping. Existing enabled configurations missing these contacts block checkout until corrected. Provider smoke-test details are kept outside the repository; no token values are recorded.
