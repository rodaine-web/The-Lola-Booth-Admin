# Payments and wedding planner rates

Stripe uses server-created Checkout sessions and signature-verified webhooks. Invoice totals and deposit requirements come from the saved invoice; payment redirects do not settle invoices. Duplicate webhook/payment IDs reuse existing payment and receipt records. Checkout reuse is scoped to the verified account and test/live mode. Signed events are also verified against the configured Stripe account to reject events from a replaced account.

## Configuration

- `STRIPE_SECRET_KEY`: restricted (`rk_test_` / `rk_live_`) or secret key. Required permissions: account read, Checkout Sessions write/read, events read, PaymentIntents read, and applicable payment/refund reads.
- `STRIPE_WEBHOOK_SECRET`: signing secret for this environment's endpoint, `/api/webhooks/stripe`.
- `STRIPE_ACCOUNT_ID`: expected account identifier. Staging: `acct_1UNbAcCKrqM5vAbK`; live: `acct_1UNbACC7UOE45wwk`. Never mix keys or webhook secrets between them.
- `STRIPE_LIVE_PAYMENTS_ENABLED`: defaults off. Set `true` only in production after qualification and explicit activation approval. Live charges also require the account to report `charges_enabled`.
- Stripe Tax remains deferred. No automatic tax is enabled by this change.

Staging must use sandbox keys. Register success (`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `payment_intent.succeeded`), payment failure and refund events on the correct Stripe account. Verify a new checkout, paid deposit conversion, receipt delivery and a replay without duplicate payment/client/event/receipt before live activation.

## Planner rates

In a Text or HTML campaign, select Glam, 360 and Vogue. For each experience choose **All regular packages · 15% planner rate**. Each active, non-deleted package associated with that experience becomes a distinct selectable offer. Catalog prices supply the original rate; the discount is rounded in cents. Package features and hours are preserved.

The same resolved offer drives email cards, public interest selection, proposal packages and the saved deposit invoice. Existing interest/invoice offer snapshots remain fixed. Packages added to the catalog become available under the rule; packages made inactive are excluded. Custom offers and add-ons retain their own pricing and are not automatically discounted.
