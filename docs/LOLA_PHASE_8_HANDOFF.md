# LOLA Admin Phase 8 Handoff

## Summary

Phase 8 adds the social lead intake and communications automation foundation without rebuilding the existing CRM, payments, website CMS, dashboard, or document modules.

Implemented:

- Shared lead normalization for Website, Meta, TikTok, and LinkedIn.
- Retry-safe webhook persistence and idempotency by provider plus external lead ID.
- Duplicate safety using normalized email and phone.
- Lead attribution fields for source subtype, forms, campaigns, ads, UTMs, landing/referrer URLs, and consent references.
- Follow-up task creation for inbound leads.
- Lead activity timeline entries for provider-sourced leads.
- Integration overview cards for lead sources, email, and payments.
- Field map storage and validation per provider form.
- Failed inbound lead queue with retry/resolve API support.
- Email templates with Phase 5B branded copy and safe merge variables.
- Lightweight PostgreSQL-backed automation jobs and run history.
- Initial default automations for inquiry acknowledgement, proposal reminders, invoice reminders, event reminders, and review requests.
- Lead list source/campaign filters.
- Lead detail source details, advanced provider IDs, duplicate state, and response SLA display.
- Dashboard metrics for social leads, awaiting response, average first response time, and failed integration events.
- Analytics source quality and campaign performance API payloads.

## Database

Migration:

- `server/migrations/011_phase_8_social_leads_communications.sql`

Important tables/fields:

- `leads`: normalized identity, provider metadata, UTMs, duplicate state, response timer, consent fields, marketing opt-in.
- `lead_source_events`: provider lead receipt and audit trail.
- `email_templates`: editable branded email templates.
- `automations`: constrained trigger/condition/action records.
- `automation_jobs`: durable scheduled work, retry count, errors, completion status.
- `automation_runs`: run/debug history.
- `conversion_postbacks`: future ad-platform conversion feedback foundation, disabled until explicitly configured.

## Provider Setup

Webhook URLs:

- Meta: `/api/webhooks/meta`
- TikTok: `/api/webhooks/tiktok`
- LinkedIn: `/api/webhooks/linkedin`
- Website inquiry API: `/api/public/inquiries`

Environment variables:

- `META_WEBHOOK_VERIFY_TOKEN`
- `TIKTOK_WEBHOOK_SECRET`
- `LINKEDIN_API_VERSION`
- `EMAIL_PROVIDER`
- `EMAIL_FROM`
- Existing encrypted secret storage uses `INTEGRATION_SECRET_KEY`.

Meta:

- Supports Facebook Lead Ads and Instagram lead forms surfaced through Meta lead workflows.
- No scraping or browser automation.
- `CONNECTED` should only be set after provider verification succeeds.

TikTok:

- Prepared for TikTok Lead Generation webhook delivery through the official Business API workflow.
- The endpoint persists events before processing and uses the shared normalization/dedupe pipeline.
- Live signing details must match the current TikTok app configuration before enabling production.

LinkedIn:

- Default state is `AWAITING_APPROVAL`.
- LinkedIn Lead Sync requires approved API access.
- `LINKEDIN_API_VERSION` is configurable so the app is not pinned to a deprecated version.
- The app must not show LinkedIn as connected until approval and verification are complete.

## Automation Worker

Phase 8 uses PostgreSQL-backed durable jobs instead of BullMQ/Redis to avoid adding infrastructure to the current stack.

Manual processing endpoint:

- `POST /api/communications/jobs/process`

Production recommendation:

- Run the same job processor from a small scheduled worker every minute.
- Jobs are persisted in `automation_jobs`, survive restarts, and retry with bounded backoff.

## Email

Templates included:

- New inquiry acknowledgement
- Lead follow-up
- Proposal sent
- Proposal reminder
- Proposal expiring
- Proposal accepted
- Deposit invoice sent
- Deposit reminder
- Payment received
- Balance reminder
- Booking confirmation
- Event reminder
- Gallery ready
- Review request
- Refund processed

Template variables are validated against an allowlist. Unknown variables fail validation and are not executed as code.

## Known Limitations

- Live OAuth connect/reconnect flows are prepared at the data/API/UI layer but still need provider app credentials and approval to complete.
- TikTok and LinkedIn verification details should be confirmed against each provider dashboard before production enablement.
- Email provider adapters beyond development mode still need final Resend or Postmark credentials.
- Review request automation remains disabled by default until review URLs are configured.
- The conversion postback table is foundation only; no ad-platform conversions are sent in Phase 8.

## Manual QA

Website lead:

1. Submit `/api/public/inquiries` with contact, event details, and UTMs.
2. Confirm a lead is created with `lead_source=WEBSITE`.
3. Confirm `lead_source_events` row exists.
4. Confirm follow-up task and lead activity are created.
5. Confirm acknowledgement job is scheduled when enabled.

Social fixtures:

1. Use System > Integrations > Test Lead for Meta, TikTok, or LinkedIn.
2. Confirm test lead is clearly marked `test_mode=true`.
3. Replay the same external lead ID and confirm idempotent replay behavior.
4. Confirm same email/phone creates a possible duplicate flag instead of silent merge.

Automations:

1. Open Sales > Communications.
2. Preview templates.
3. Toggle an automation.
4. Process due jobs.
5. Confirm email message and communication rows are logged.

## Phase 9 Readiness

Phase 8 stops before Phase 9. Suggested next work:

- Production OAuth flows and token refresh per provider.
- Provider-specific webhook signature verification once credentials exist.
- Background worker command/runtime packaging.
- Real Resend or Postmark adapter.
- Notification center for internal alerts.
