# LOLA Deployment Runbook

## Required Processes

- API/web server: `npm start`
- Automation worker: `npm run worker`
- Migration command: `npm run db:migrate`
- Frontend build: `npm run build`
- Environment validation: `npm run env:check`

## Production Environment

Required for launch:

- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET`
- `INTEGRATION_SECRET_KEY`
- `CLIENT_ORIGIN=https://...`
- `PUBLIC_BASE_URL=https://...`
- `PUBLIC_APP_URL=https://...`
- `EMAIL_PROVIDER` set to an active adapter

Provider-specific:

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENVIRONMENT`
- Social providers: Meta/TikTok/LinkedIn credentials and webhook secrets as enabled

## Launch Steps

1. Build with `npm run build`.
2. Validate environment with `npm run env:check`.
3. Run migrations with `npm run db:migrate`.
4. Start API and worker processes.
5. Open System Health and resolve any `DOWN`, `ERROR`, `MISCONFIGURED`, or stale worker checks.
6. Send a test proposal and invoice using test credentials.
7. Generate equipment QR labels and scan physical labels.
8. Confirm backup job completion after launch.

## Rollback

- Keep the previous build artifact and deployed commit available.
- Stop the worker before rolling back schema-sensitive code.
- Restore the previous API/frontend release.
- Do not roll back database migrations unless a tested reverse migration or database restore plan exists.
- Re-run System Health and a smoke test after rollback.

## Post-Deploy Smoke Test

- Login as the production owner.
- Open dashboard, live operations, system health, integrations, settings, audit log.
- Create a public inquiry from the website and confirm a lead and activity record appear.
- Generate a proposal and invoice public link.
- Verify configured payment provider in test mode.
- Retry or cancel a nonproduction failed job from System Health.
- Scan a printed equipment QR label.
- Confirm notification preferences save.

## Email Domain Checklist

- SPF includes the selected sending provider.
- DKIM records are verified by the provider.
- DMARC exists, initially `p=none` or a policy chosen by the owner.
- `EMAIL_FROM` uses a verified domain mailbox.

## Provider Notes

- Do not enable Stripe live mode until test-mode checkout and webhook reconciliation pass.
- Do not enable PayPal live mode until sandbox order creation, capture webhook, and refund policy are verified.
- Provider BNPL, Pay Later, Venmo, Apple Pay, and Google Pay remain controlled by provider eligibility and dashboard settings.
