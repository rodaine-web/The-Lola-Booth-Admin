# LOLA Stripe Test Payments + CSP Production Sprint

## Scope

This pass covered the Admin/API repo in this workspace. The separate public website repo was not present here, so public website CSP must still be verified in that repo or production console.

Production targets from the sprint:

- Public website: `https://thelolabooth.com`
- Admin: `https://admin.thelolabooth.com`
- API: `https://api.thelolabooth.com`

## Feature Audit

| Feature | Status | Location | Gap |
| --- | --- | --- | --- |
| Provider-neutral payments | PASS | `server/src/services/payment-service.js` | None for hosted test checkout |
| Stripe hosted Checkout | PASS WITH WARNING | `createStripeCheckout` | Needs Railway test secrets and business setting enabled |
| Public invoice payment flow | PASS WITH WARNING | `src/pages/PublicInvoice.jsx`, `server/src/routes/public.js` | Needs deployed test payment smoke |
| Webhook route | PASS | `POST /api/webhooks/stripe` | Configure Stripe Dashboard URL below |
| Raw body signature verification | PASS | `server/src/index.js`, `handleStripeWebhook` | None |
| Idempotency | PASS | `webhook_events`, `payments`, `payment_attempts` unique keys | Needs deployed duplicate webhook smoke |
| Failed payment handling | PASS WITH WARNING | `payment_intent.payment_failed` | Needs Stripe test decline smoke |
| Refund webhook handling | PASS WITH WARNING | `charge.refunded` | Provider-initiated webhook supported; Admin-initiated provider refund remains future scope |
| Admin finance/RBAC | PASS | `server/src/routes/admin.js` | Refund requires `issue:refunds` |
| Admin CSP | PASS | `vercel.json` | Production redeploy required |
| Public website CSP | NOT TESTABLE | Separate repo/environment | Verify Google Font/Tag blocks in production console |

## Security Findings

- No `sk_test_`, `sk_live_`, or `whsec_` values were found in this repo.
- Stripe secret values are server-side only.
- `STRIPE_PUBLISHABLE_KEY` is not used by this hosted Checkout implementation and was removed from active config/docs.
- Card data never touches LOLA servers; customers are sent to Stripe-hosted Checkout.
- Checkout amount and currency are derived from the trusted invoice record, not browser input.
- Secure invoice token is required before a payment session can be created.
- Stripe signature verification uses the raw request body and timing-safe comparison.

## Railway Variables To Add

Required for Stripe test-mode checkout:

- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...`

Also required for production links/CORS outside this Stripe slice:

- `PUBLIC_BASE_URL=https://thelolabooth.com`
- `CLIENT_ORIGIN=https://admin.thelolabooth.com`
- `PUBLIC_INQUIRY_ALLOWED_ORIGINS=https://thelolabooth.com`

Do not enable SMS in this sprint. Leave `SMS_PROVIDER=none`.

## Vercel Variables

Keep for Admin frontend:

- `VITE_API_URL=https://api.thelolabooth.com/api`

Remove from Vercel/Admin frontend if present:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY`

## Stripe Webhook

Production webhook URL:

```text
https://api.thelolabooth.com/api/webhooks/stripe
```

Minimum Stripe events:

- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`

## Stripe Test Payment Steps

1. In Railway API env, add Stripe test `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
2. In Admin Settings, enable Stripe payments.
3. Create a clearly labeled QA invoice with a secure public invoice link.
4. Open the invoice link on `https://thelolabooth.com`.
5. Click card/wallet checkout.
6. Pay in Stripe test mode with a Stripe test card.
7. Confirm Stripe redirects back to the invoice.
8. Confirm the Stripe webhook reaches `https://api.thelolabooth.com/api/webhooks/stripe`.
9. Confirm LOLA creates one payment, updates invoice balance/status, and shows provider/reference in Admin.
10. Repeat/replay the same webhook once and confirm no duplicate payment appears.
11. Run one declined test payment and confirm the invoice remains outstanding.
12. If testing refunds from Stripe Dashboard, issue one test refund and confirm LOLA updates refund/payment totals.

## Final Matrix

| Area | Status | Evidence | Action |
| --- | --- | --- | --- |
| Stripe architecture | PASS | Provider-neutral service preserved | None |
| Railway config | BLOCKED | Variables cannot be verified locally | Add test secrets in Railway |
| Vercel config | PASS WITH WARNING | Admin uses only API URL; no Stripe frontend env needed | Remove stale Stripe env if present |
| Checkout | PASS WITH WARNING | Hosted Checkout server call implemented | Run deployed test payment |
| Payment session | PASS | Token-scoped, invoice-derived amount/currency | None |
| Webhook URL | PASS | `/api/webhooks/stripe` | Configure Stripe Dashboard URL |
| Signature verification | PASS | Raw body before JSON parser, timing-safe HMAC | None |
| Successful test payment | NOT TESTABLE | Requires Stripe/Railway env | Run manual smoke |
| Failed test payment | NOT TESTABLE | Code handles failed intent | Run manual smoke |
| Refund | PASS WITH WARNING | Stripe refund webhook handled; Admin provider refund call still future scope | Run dashboard refund smoke if needed |
| Invoice update | PASS WITH WARNING | `reconcileInvoice` called after provider payment/refund | Verify in staging/prod |
| Admin payment status | PASS | Payments screens show provider/reference/status | None |
| Receipt | PASS WITH WARNING | Receipt PDF exists | Verify email/receipt behavior after live Microsoft Graph smoke |
| Idempotency | PASS | Webhook/payment unique constraints and scoped session idempotency | Run duplicate webhook smoke |
| RBAC | PASS | Finance routes require finance permissions; refunds require `issue:refunds` | None |
| Secret scan | PASS | No real Stripe secret values found | Keep secrets in Railway only |
| Public CSP | NOT TESTABLE | Public website repo not present | Audit production console in public site repo |
| Admin CSP | PASS | No Google/Stripe browser hosts; no unsafe inline/eval in CSP | Redeploy Admin |
| Google fonts | NOT TESTABLE | Admin has no Google Font network request | Verify public website usage |
| Google Tag | NOT TESTABLE | Admin has no Google Tag snippet | Verify public website usage |
| Stripe CSP | PASS | No browser-side Stripe resources used | None |

## Final Verdict

STRIPE INTEGRATED — MANUAL CONFIGURATION REMAINS
