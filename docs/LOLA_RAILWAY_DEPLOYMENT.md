# LOLA Railway Deployment

This document prepares the existing LOLA Admin backend stack for Railway and connects the already-deployed static HTML/CSS/JavaScript marketing website to the deployed API. Do not rebuild the public website, move it into this repository, or change public API response shapes.

## Current Repo Inspection

- Package manager: npm, with `package-lock.json`.
- Backend entry point: `server/src/index.js`.
- Admin frontend entry point: `src/main.jsx`; build output goes to `dist/`.
- Worker entry point: `server/src/worker.js`.
- API local dev command: `npm run dev:server`.
- Admin local dev command: `npm run dev:client`.
- Full local dev command: `npm run dev`.
- Admin frontend build command: `npm run build`.
- API start command: `npm start`, which runs `node server/src/index.js`.
- Worker start command: `npm run worker`, which runs `node server/src/worker.js`.
- Test command: `npm test`.
- Combined check command: `npm run check`.
- Migration command: `npm run db:migrate`.
- Seed command: `npm run db:seed`.
- Env validation command: `npm run env:check`.
- Health endpoint: `GET /api/health`.
- Authenticated system health: `GET /api/system/health`, requires admin auth and `read:settings`.
- Database config: `server/src/db/pool.js` uses `new pg.Pool({ connectionString: env.databaseUrl, max: 10 })`.
- Port behavior: `server/src/index.js` listens on `env.port`, which resolves to `Number(process.env.PORT || 4000)`.
- Storage behavior: `STORAGE_PROVIDER=local` writes files under `LOCAL_STORAGE_ROOT`; `STORAGE_PROVIDER=s3` exists as a stub and throws because the S3-compatible adapter is not active.
- Email behavior: `EMAIL_PROVIDER=development` returns a dev result and does not deliver externally; `EMAIL_PROVIDER=microsoft` sends through Microsoft Graph when Microsoft 365 variables and tenant admin consent are configured.
- Payment behavior: Stripe and PayPal session/webhook foundations exist and are controlled by env plus business settings. Credentials are optional for API deployment.

## Railway Project Structure

Create one Railway project with three services:

| Service | Type | Purpose |
| --- | --- | --- |
| LOLA API | Node app from this repo | Express API, public APIs, admin APIs, webhooks, customer proposal/invoice/delivery routes |
| LOLA WORKER | Node app from this repo | Automation worker heartbeat and queued job processing |
| PostgreSQL | Railway managed database | Primary app database via `DATABASE_URL` |

The admin frontend can remain separate and be deployed later. The current Express API does not serve `dist/`, so deploying the API service does not automatically host the admin SPA.

## API Service Config

Railway service name: `LOLA API`

| Setting | Value |
| --- | --- |
| Root Directory | `/` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Start Command | `npm start` |
| Healthcheck Path | `/api/health` |
| Public Port | Railway-provided `PORT` |

Notes:

- `npm run build` validates/builds the admin SPA but is not required to compile the Express API.
- Do not set `PORT=4000` in Railway. Let Railway inject `PORT`.
- `GET /api/health` returns JSON shaped like `{ "ok": true, "name": "LOLA Admin API" }`.

## Worker Service Config

Railway service name: `LOLA WORKER`

| Setting | Value |
| --- | --- |
| Root Directory | `/` |
| Install Command | `npm ci` |
| Build Command | blank, or `npm run build` if the service template requires one |
| Start Command | `npm run worker` |
| Public Networking | Disabled/not needed |
| Database Dependency | Railway PostgreSQL `DATABASE_URL` |

Worker behavior:

- Starts with `LOLA automation worker started`.
- Runs `tick()` immediately, then every 30 seconds.
- Writes heartbeat through `recordWorkerHeartbeat("automation-worker", { pid })`.
- Processes due automation jobs with `processDueJobs({ limit: 25 })`.
- Failed jobs are retried by the automation engine up to each job's `max_attempts`.
- Gracefully closes the PostgreSQL pool on `SIGINT` and `SIGTERM`.

## PostgreSQL

Use Railway managed PostgreSQL and attach it to both `LOLA API` and `LOLA WORKER`.

`DATABASE_URL` behavior:

- The app reads `process.env.DATABASE_URL`.
- Local default is `postgres://postgres:postgres@localhost:5432/lola_admin`.
- Railway should provide the production value from the managed PostgreSQL service.
- The code does not create a second database implementation.

SSL and pool behavior:

- The current pool config uses only `connectionString` and `max: 10`.
- No explicit SSL object is configured in code.
- Prefer Railway's internal/private `DATABASE_URL` for same-project services.
- If using an external PostgreSQL URL that requires SSL, validate whether the connection string needs `sslmode=require`; the code does not currently force SSL itself.

## Migrations

Safest production migration process:

1. Deploy or connect Railway PostgreSQL.
2. Set production env vars on the API service.
3. Run migrations once:

```bash
npm run db:migrate
```

Do not run migrations automatically on every worker restart. The migration runner is idempotent via the `schema_migrations` table, but keeping it as an explicit release action avoids coupling schema changes to worker restarts.

Only run seed data intentionally:

```bash
npm run db:seed
```

## Environment Variables

| Variable | Service | Required? | Value Source | Secret? | Notes |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | API, Worker | Yes | Set to `production` | No | Production readiness checks depend on this. |
| `PORT` | API | Railway-provided | Railway | No | Do not hardcode. Worker does not need a port. |
| `DATABASE_URL` | API, Worker | Yes | Railway PostgreSQL | Yes | Used by `pg.Pool`. |
| `JWT_SECRET` | API | Yes | Generate 32+ chars | Yes | Required for admin auth. |
| `JWT_EXPIRES_IN` | API | Optional | Default `15m` | No | Access token TTL. |
| `REFRESH_TOKEN_EXPIRES_IN_DAYS` | API | Optional | Default `14` | No | Refresh token TTL. |
| `CLIENT_ORIGIN` | API | Yes | Actual admin frontend origin | No | Global CORS allowed origin. Must be HTTPS in production. |
| `PUBLIC_INQUIRY_ALLOWED_ORIGINS` | API | Yes for website form | Actual live website origin(s) | No | Comma-separated. Required for browser inquiry POST. No wildcard. |
| `PUBLIC_BASE_URL` | API | Yes | Customer-facing app/API flow origin | No | Used for payment return URLs; must be HTTPS in production. |
| `PUBLIC_APP_URL` | API | Yes | Public customer page origin | No | Used for delivery QR/customer links. |
| `RATE_LIMIT_WINDOW_MS` | API | Optional | Default `900000` | No | Global and public route window. |
| `RATE_LIMIT_MAX` | API | Optional | Default `120` | No | Global API limiter max. Public router also has hardcoded `20`. |
| `INTEGRATION_SECRET_KEY` | API, Worker | Yes | Generate 32+ chars | Yes | Encrypts provider credentials. |
| `STORAGE_PROVIDER` | API, Worker | Optional | Default `local` | No | `local` works only with durable volume/backup plan; `s3` stub is not active. |
| `LOCAL_STORAGE_ROOT` | API, Worker | Required if local storage | Railway volume path or `storage/uploads` | No | Must be persistent in production if uploads/documents/media are used. |
| `EMAIL_PROVIDER` | API, Worker | Optional | Default `development` | No | Use `microsoft` for Microsoft 365 / Outlook delivery. |
| `EMAIL_FROM` | API, Worker | Optional | `LOLA Booths <hello@lolabooths.com>` | No | Display sender used by email service. |
| `MICROSOFT_TENANT_ID` | API, Worker | Required when `EMAIL_PROVIDER=microsoft` | Microsoft Entra tenant ID or tenant domain | No | Used for Graph client-credentials token acquisition. |
| `MICROSOFT_CLIENT_ID` | API, Worker | Required when `EMAIL_PROVIDER=microsoft` | Microsoft Entra app registration | No | Application/client ID for Graph token acquisition. |
| `MICROSOFT_CLIENT_SECRET` | API, Worker | Required when `EMAIL_PROVIDER=microsoft` | Microsoft Entra app registration secret | Yes | Do not commit. Rotate from Microsoft Entra. |
| `MICROSOFT_SENDER_EMAIL` | API, Worker | Required when `EMAIL_PROVIDER=microsoft` | Microsoft 365 mailbox | No | Mailbox used in `/users/{sender}/sendMail`. |
| `SMS_PROVIDER` | API, Worker | Optional | Default `none` | No | No active SMS adapter. |
| `STRIPE_SECRET_KEY` | API | Optional | Stripe Dashboard | Yes | Needed only for Stripe checkout. |
| `STRIPE_PUBLISHABLE_KEY` | API | Optional | Stripe Dashboard | No | Returned to public invoice page when enabled. |
| `STRIPE_WEBHOOK_SECRET` | API | Required if Stripe configured | Stripe webhook endpoint secret | Yes | Required for `/api/webhooks/stripe`. |
| `PAYPAL_CLIENT_ID` | API | Optional | PayPal app | No | Needed only for PayPal checkout. |
| `PAYPAL_CLIENT_SECRET` | API | Optional | PayPal app | Yes | Needed only for PayPal checkout. |
| `PAYPAL_WEBHOOK_ID` | API | Required if PayPal configured | PayPal dashboard | No | Health check expects it for configured PayPal. |
| `PAYPAL_ENVIRONMENT` | API | Optional | `sandbox` or `live` | No | Default `sandbox`. |
| `META_WEBHOOK_VERIFY_TOKEN` | API | Required if Meta webhook active | Generate/provider config | Yes | Used by `GET /api/webhooks/meta` challenge. |
| `TIKTOK_WEBHOOK_SECRET` | API | Optional in code | Provider config | Yes | Loaded by env but not currently enforced in webhook route. |
| `LINKEDIN_API_VERSION` | API | Optional | Default `202609` | No | Loaded by env for LinkedIn integration foundation. |

No worker-specific env vars are present in current code beyond shared database, env, storage, email, and integration settings.

## Live Website Connection

The deployed static website should define:

```js
window.LOLA_API_BASE = "https://<real-railway-api-domain>";
```

Use the real Railway API origin after Railway creates the public API domain. Do not invent the domain.

The local external website copy inspected during this handoff did not contain `window.LOLA_API_BASE`, so if that is the source copy, add or update `config.js` and load it before the integration script.

## CORS

Set production CORS values exactly:

```text
CLIENT_ORIGIN=<actual Admin frontend origin>
PUBLIC_INQUIRY_ALLOWED_ORIGINS=<actual live public website origin>
```

If both `https://lolabooths.com` and `https://www.lolabooths.com` serve the static website, use:

```text
PUBLIC_INQUIRY_ALLOWED_ORIGINS=https://lolabooths.com,https://www.lolabooths.com
```

Do not use wildcard. Global CORS uses `credentials: true`, and inquiry POST has an extra origin check against `PUBLIC_INQUIRY_ALLOWED_ORIGINS`.

## Public API Verification

After Railway deploys, run:

```bash
API_BASE=https://<real-railway-api-domain>
curl "$API_BASE/api/health"
curl "$API_BASE/api/public/site"
curl "$API_BASE/api/public/homepage"
curl "$API_BASE/api/public/hero-slides"
curl "$API_BASE/api/public/packages"
curl "$API_BASE/api/public/experiences"
curl "$API_BASE/api/public/events"
curl "$API_BASE/api/public/gallery"
curl "$API_BASE/api/public/testimonials"
curl "$API_BASE/api/public/faqs"
```

Expected result: HTTP `200` for each endpoint while healthy.

Inquiry smoke with the real deployed website origin:

```bash
curl -i -X POST "$API_BASE/api/public/inquiries" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://<real-public-website-origin>' \
  -d '{
    "firstName":"Railway",
    "lastName":"Smoke",
    "email":"railway-smoke@example.com",
    "phone":"555-0100",
    "eventDate":"2026-12-12",
    "eventType":"Private Event",
    "guestCount":50,
    "city":"Dallas",
    "state":"TX",
    "message":"Railway deployment smoke test.",
    "utm_source":"railway-smoke",
    "landing_page_url":"https://<real-public-website-origin>",
    "website":""
  }'
```

Expected success:

```json
{
  "message": "Thank you. Your inquiry was received and the LOLA team will be in touch soon.",
  "inquiryStatus": "CREATED_LEAD"
}
```

`POSSIBLE_DUPLICATE` is also a successful website submission when email or phone matches an existing lead.

## Admin Verification

After the inquiry smoke test, sign in to LOLA Admin and verify the lead:

- Name
- Email
- Phone
- Event date
- Event type
- City/state
- Preferred experience
- Preferred package
- Referral source
- Message
- UTM values
- Source/provider equals `WEBSITE`

## Storage Status

Current production storage readiness:

- `local`: available in code, but production needs a persistent Railway volume and backup plan.
- `s3`: present as a class, but both `put()` and `get()` throw because the adapter is not active.

If `STORAGE_PROVIDER=local` is used on Railway without a persistent volume, uploaded media, generated PDFs, and delivery assets are not production-safe. This is a production readiness blocker for any workflow that depends on durable uploaded/generated files.

## Email Status

Current production email readiness:

- `EMAIL_PROVIDER=development`: not production ready; returns a dev result with `deliveredExternally: false`.
- `EMAIL_PROVIDER=microsoft`: production-capable after Microsoft Entra app registration, `Mail.Send` application permission, tenant admin consent, and a successful live `npm run email:test -- recipient@example.com`.
- Other `EMAIL_PROVIDER` values: not production ready; throw because no adapter is active.

Do not claim customer acknowledgements, proposal emails, invoice emails, or staff brief emails are live until the Microsoft Graph adapter is configured and tested against the production mailbox.

Microsoft 365 setup:

1. Create or use a Microsoft Entra app registration.
2. Add Microsoft Graph Application permission `Mail.Send`.
3. Grant tenant admin consent.
4. Set Railway API and worker variables:
   - `EMAIL_PROVIDER=microsoft`
   - `EMAIL_FROM=LOLA Booths <hello@thelolabooth.com>`
   - `MICROSOFT_TENANT_ID=<tenant-id-or-domain>`
   - `MICROSOFT_CLIENT_ID=<app-client-id>`
   - `MICROSOFT_CLIENT_SECRET=<app-client-secret>`
   - `MICROSOFT_SENDER_EMAIL=<licensed-mailbox>`
5. Redeploy, then run `npm run email:test -- recipient@example.com` from the configured environment.

## Payments Status

Stripe classification:

- Not configured when `STRIPE_SECRET_KEY` or `STRIPE_PUBLISHABLE_KEY` is missing.
- Test-mode ready only when test credentials exist, `STRIPE_WEBHOOK_SECRET` is set, and business settings enable Stripe.
- Live-mode ready only when live credentials start with `sk_live_`, `STRIPE_WEBHOOK_SECRET` is set, provider webhook is configured, and business settings enable Stripe.

PayPal classification:

- Not configured when `PAYPAL_CLIENT_ID` or `PAYPAL_CLIENT_SECRET` is missing.
- Sandbox-ready when credentials exist, `PAYPAL_ENVIRONMENT=sandbox`, `PAYPAL_WEBHOOK_ID` is set, and business settings enable PayPal.
- Live-ready when credentials exist, `PAYPAL_ENVIRONMENT=live`, `PAYPAL_WEBHOOK_ID` is set, provider webhook is configured, and business settings enable PayPal.

Live payment credentials are not required just to deploy the API.

## Webhook Setup

Externally reachable webhook routes after API deployment:

- Stripe: `POST https://<real-railway-api-domain>/api/webhooks/stripe`
- PayPal: `POST https://<real-railway-api-domain>/api/webhooks/paypal`
- Meta challenge: `GET https://<real-railway-api-domain>/api/webhooks/meta`
- Meta leads: `POST https://<real-railway-api-domain>/api/webhooks/meta`
- TikTok leads: `POST https://<real-railway-api-domain>/api/webhooks/tiktok`
- LinkedIn leads: `POST https://<real-railway-api-domain>/api/webhooks/linkedin`

Provider dashboard work required after Railway deploy:

- Stripe: configure endpoint and set `STRIPE_WEBHOOK_SECRET`.
- PayPal: configure endpoint and set `PAYPAL_WEBHOOK_ID`.
- Meta: configure callback URL and verify token via `META_WEBHOOK_VERIFY_TOKEN`.
- TikTok: configure endpoint; note that `TIKTOK_WEBHOOK_SECRET` is loaded but not currently verified by the route.
- LinkedIn: configure endpoint only after LinkedIn approval; current service blocks LinkedIn processing while connection status is `AWAITING_APPROVAL`.

Security note: Stripe signature verification exists. Meta challenge verification exists. PayPal, TikTok, and LinkedIn routes currently do not verify provider signatures in this code and should not be treated as hardened live webhooks until verification is added or confirmed safe by provider configuration.

## Worker Health

Verify worker after deployment:

1. Open Railway logs for `LOLA WORKER`; confirm `LOLA automation worker started`.
2. In Admin, open System Health and confirm worker heartbeat is current.
3. Confirm `automation_jobs` health is `HEALTHY`, or inspect failed jobs if not.
4. Confirm queued jobs process or retry according to `attempt_count` and `max_attempts`.

The worker does not expose HTTP health. Its health is database-backed through `worker_heartbeats`.

## Health Checks

Public health:

```bash
curl https://<real-railway-api-domain>/api/health
```

Admin system health:

- Route: `GET /api/system/health`
- Requires admin JWT and `read:settings`.
- Checks API, database, environment, payments, email, SMS, storage, website integration, worker heartbeat, automation job backlog, integrations, and retention.

## Security

Observed repo state:

- `.env` is ignored by `.gitignore`.
- `git ls-files .env .env.example` returned no tracked `.env` file in the current local git state.
- Public marketing APIs need no secret.
- Admin APIs are mounted under `/api` and use auth/permissions.
- Customer proposal/invoice/delivery routes use secure tokens.
- No wildcard CORS should be configured.

Production security blockers to address before enabling optional integrations:

- Local storage needs a persistent Railway volume and backup plan, or a real object storage adapter.
- Non-development email provider is not active.
- PayPal/TikTok/LinkedIn webhook signature verification is not currently implemented.

## Rollback

Recommended rollback:

1. Keep the previous Railway deployment available.
2. If API deploy fails, roll back `LOLA API` to the prior successful deployment.
3. If worker deploy fails, roll back `LOLA WORKER` or stop it temporarily while preserving the API.
4. Do not roll back PostgreSQL migrations blindly. If a schema migration caused an issue, restore from Railway PostgreSQL backup or apply a reviewed forward-fix migration.
5. Revert `window.LOLA_API_BASE` on the static website only if the new API domain is unusable.

## Local Verification Completed

Commands run locally:

- `npm run env:check`: passed in development. It reported `PUBLIC_BASE_URL` and `PUBLIC_APP_URL` missing but defaulted locally; these must be set in production.
- `npm test`: passed, 73/73 tests.
- `npm run build`: passed.
- `npm run db:migrate`: passed; migrations complete.
- `GET /api/health`: `200`.
- `GET /api/public/site`: `200`.
- `GET /api/public/homepage`: `200`.
- `GET /api/public/hero-slides`: `200`, `data.length=1`.
- `GET /api/public/packages`: `200`, `data.length=4`.
- `GET /api/public/experiences`: `200`, `data.length=6`.
- `GET /api/public/events`: `200`, `data.length=0`.
- `GET /api/public/gallery`: `200`, `data.length=0`.
- `GET /api/public/testimonials`: `200`, `data.length=0`.
- `GET /api/public/faqs`: `200`, `data.length=0`.
- `npm run worker`: verified with database access; worker started and processed one queued job.

## Deployment Stop Point

Railway deployment was not completed from this environment because:

- The Railway CLI is not installed locally: `railway --version` returned `command not found`.
- No Railway account/project authorization is available in this Codex session.
- No real Railway API domain or live external website origin was provided.

Exact next user action:

1. Open Railway.
2. Create a new project.
3. Add Railway PostgreSQL.
4. Add a GitHub/repo service named `LOLA API` using the API service config above.
5. Add a second GitHub/repo service named `LOLA WORKER` using the worker service config above.
6. Add the env vars from this document.
7. Run `npm run db:migrate` once against the Railway PostgreSQL database.
8. Copy the Railway API public domain into the external website:

```js
window.LOLA_API_BASE = "https://<real-railway-api-domain>";
```

9. Set `PUBLIC_INQUIRY_ALLOWED_ORIGINS` to the live external website origin and rerun the live smoke tests.

## Go-Live Checklist

- Railway PostgreSQL provisioned.
- API service deployed and `/api/health` returns `200`.
- Worker service deployed and heartbeat is current.
- `npm run db:migrate` completed once against production.
- `NODE_ENV=production`.
- `DATABASE_URL`, `JWT_SECRET`, and `INTEGRATION_SECRET_KEY` set with production values.
- `CLIENT_ORIGIN` set to real admin frontend origin.
- `PUBLIC_INQUIRY_ALLOWED_ORIGINS` set to real public website origin(s).
- `PUBLIC_BASE_URL` and `PUBLIC_APP_URL` set to HTTPS production origins.
- External website `config.js` points `window.LOLA_API_BASE` at the Railway API domain.
- Public CMS endpoints return `200`.
- Live website inquiry POST returns `201`.
- Smoke lead appears in Admin with source `WEBSITE`.
- Storage is either backed by a persistent Railway volume with backup plan or blocked from production media/doc workflows.
- Email is either intentionally disabled/dev-only or `EMAIL_PROVIDER=microsoft` has been configured and tested.
- Stripe/PayPal remain disabled unless real/test credentials and webhooks are configured.
- Optional social/payment webhook dashboards are configured only when verification readiness is acceptable.

## Production Readiness Verdict

The API and worker are structurally ready for Railway deployment after env vars and Railway services are created.

The live marketing website requires a healthy Railway API origin and an allow-listed public website origin. Production is not fully ready for file/media/document durability or external email delivery until storage is durable and Microsoft 365 email has passed a live smoke test.
