# LOLA Admin Phase 4 Handoff

## Completed

- Added provider-neutral payment schema for Stripe, PayPal, and manual payments.
- Added payment attempts, idempotency keys, provider references, refund metadata, payment schedules, webhook metadata, and payment settings.
- Added server-side payment services for provider status, public checkout session creation, webhook processing, manual payment recording, refunds, receipt PDFs, reminders, and reconciliation.
- Public invoice now shows Pay Now only when a configured/enabled provider exists; otherwise it displays offline instructions.
- Manual payments now reject overpayments and reconcile invoice/event totals through one shared service.
- Added payment list/detail UI, refund UI, receipt PDF downloads, invoice payment history, integrations health view, and payment settings.

## Important Notes

- Stripe and PayPal checkout adapters are ready but require real environment credentials plus settings enablement.
- Webhooks are idempotent and are the authority for online payment success.
- PayPal webhook authenticity verification is structurally prepared; production should complete provider-side verification using `PAYPAL_WEBHOOK_ID`.
- No card, CVV, banking, or PayPal password data is stored.
- BNPL is intentionally exposed only as neutral checkout copy: flexible payment options may be available at checkout.

## Verified

- Provider status API works without credentials.
- Public invoice returns payable state with zero provider buttons when Stripe/PayPal are not configured.
- Manual overpayment is blocked.
- Manual payment records as `SUCCEEDED` and reconciles invoice balances.
- Manual refund records as `SUCCEEDED` and reconciles balances.
- Receipt PDF generation works.
