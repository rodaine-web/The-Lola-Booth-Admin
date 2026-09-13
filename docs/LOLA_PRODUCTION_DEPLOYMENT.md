# LOLA Production Deployment

## Environment Matrix

| Variable | Classification | Description | Required In Prod | Secret | Source | Validated |
| --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | REQUIRED | Runtime mode, must be `production` | Yes | No | Platform env | `npm run env:check` |
| `DATABASE_URL` | REQUIRED | PostgreSQL connection string | Yes | Yes | Database provider | `npm run env:check`, migration |
| `JWT_SECRET` | REQUIRED | JWT signing secret | Yes | Yes | Secret manager | `npm run env:check` |
| `INTEGRATION_SECRET_KEY` | REQUIRED | Encrypts provider credentials | Yes | Yes | Secret manager | `npm run env:check` |
| `CLIENT_ORIGIN` | REQUIRED | Admin frontend origin | Yes | No | Deployment URL | CORS smoke |
| `PUBLIC_BASE_URL` | REQUIRED | Public proposal/invoice URL base | Yes | No | Deployment URL | Generated link smoke |
| `PUBLIC_APP_URL` | REQUIRED | Public app URL used in field links | Yes | No | Deployment URL | QR/staff brief smoke |
| `PUBLIC_INQUIRY_ALLOWED_ORIGINS` | REQUIRED | Public website inquiry allow-list | Yes | No | Website domain | Public inquiry smoke |
| `STORAGE_PROVIDER` | PROVIDER_SPECIFIC | `local` or object storage adapter | Yes | No | Storage decision | Storage smoke |
| `LOCAL_STORAGE_ROOT` | PROVIDER_SPECIFIC | Persistent local storage path if used | If local | No | Platform volume | Backup check |
| `EMAIL_PROVIDER` | PROVIDER_SPECIFIC | Production email provider | Yes | No | Provider choice | Email smoke |
| `EMAIL_FROM` | PROVIDER_SPECIFIC | Branded sender address | Yes | No | Authenticated domain | Email smoke |
| `SMS_PROVIDER` | PROVIDER_SPECIFIC | SMS provider, or `none` | No | No | Provider choice | Health check |
| `STRIPE_SECRET_KEY` | PROVIDER_SPECIFIC | Stripe secret key | If Stripe enabled | Yes | Stripe dashboard | Checkout/webhook smoke |
| `STRIPE_PUBLISHABLE_KEY` | PROVIDER_SPECIFIC | Stripe publishable key | If Stripe enabled | No | Stripe dashboard | Public invoice smoke |
| `STRIPE_WEBHOOK_SECRET` | PROVIDER_SPECIFIC | Stripe webhook signature secret | If Stripe enabled | Yes | Stripe dashboard | Webhook smoke |
| `PAYPAL_CLIENT_ID` | PROVIDER_SPECIFIC | PayPal app client ID | If PayPal enabled | No | PayPal dashboard | Sandbox smoke |
| `PAYPAL_CLIENT_SECRET` | PROVIDER_SPECIFIC | PayPal app secret | If PayPal enabled | Yes | PayPal dashboard | Sandbox smoke |
| `PAYPAL_WEBHOOK_ID` | PROVIDER_SPECIFIC | PayPal webhook verifier | If PayPal enabled | No | PayPal dashboard | Webhook smoke |
| `PAYPAL_ENVIRONMENT` | PROVIDER_SPECIFIC | `sandbox` or `live` | If PayPal enabled | No | PayPal dashboard | `npm run env:check` |
| `META_WEBHOOK_VERIFY_TOKEN` | PROVIDER_SPECIFIC | Meta webhook verification | If Meta required | Yes | Meta dashboard | Provider smoke |
| `TIKTOK_WEBHOOK_SECRET` | PROVIDER_SPECIFIC | TikTok webhook secret | If TikTok required | Yes | TikTok dashboard | Provider smoke |

## Deployment Order

1. Backup the database and storage.
2. Run `npm ci`.
3. Run `npm run env:check`.
4. Run `npm run db:migrate`.
5. Deploy API.
6. Deploy worker with supervision using `npm run worker`.
7. Deploy frontend production build.
8. Open System Health.
9. Run final smoke.
10. Keep rollback artifact ready through the first live event.

## Worker Supervision

Use the hosting platform’s worker process, Docker restart policy, PM2, or systemd. The worker must restart after crashes and report a fresh heartbeat within 180 seconds.

## Migration Failure Plan

Stop deployment if a migration fails. Do not roll out API/frontend code against a partially migrated schema. Restore from backup only if the failed migration changed state and cannot be safely re-run.

## Go-Live Window

Deploy during a low-risk window, ideally days before the next paid event. For the first event after launch, keep a printed run sheet, equipment manifest, client contact export, payment record export, and backup gallery link available.
