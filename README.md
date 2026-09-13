# LOLA Admin

Private backend/admin portal for LOLA Booths.

## Stack

- React + Vite frontend
- Node.js + Express REST API
- PostgreSQL source of truth
- Email/password auth with bcrypt + JWT refresh-token sessions
- RBAC, audit logs, migrations, seeds, structured logging, validation, public inquiry endpoint
- Storage and integration foundations for later S3-compatible storage, email, payments, marketing, and calendar providers

## Local Setup

1. Copy `.env.example` to `.env` and update `DATABASE_URL` and `JWT_SECRET`.
2. Create a PostgreSQL database named `lola_admin`.
3. Install dependencies with `npm install`.
4. Run migrations and seeds:

```bash
npm run db:migrate
npm run db:seed
```

5. Start the admin app:

```bash
npm run dev
```

Seed login:

- Email: `owner@lolabooths.com`
- Password: `LolaAdmin!2026`

## Environment Notes

- `STORAGE_PROVIDER=local` stores uploaded development files outside PostgreSQL.
- `LOCAL_STORAGE_ROOT` controls the local upload folder.
- `INTEGRATION_SECRET_KEY` encrypts provider credentials before they are stored.
- `business_settings.timezone` controls business reporting ranges and defaults to `America/Chicago`.

## Public Website Form

Submit Book Now inquiries to:

```http
POST /api/public/inquiries
```

The endpoint validates and rate-limits submissions, creates a lead, records activity, and never creates a confirmed event automatically.
