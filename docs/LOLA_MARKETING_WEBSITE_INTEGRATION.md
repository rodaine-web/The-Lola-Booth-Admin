# LOLA Marketing Website Integration

The public LOLA website should consume the Phase 6 CMS/public API without duplicating content in code.

## Branding

- Use the approved vertical/stacked logo as the default website header logo.
- Use the vertical logo for proposal covers, receipts, and invoices where space allows.
- Use the horizontal logo only for compact admin or email headers where the stacked mark would become unreadable.

## Public API Smoke

- Homepage content resolves from `/api/public/site`.
- Inquiry forms post through `POST /api/public/inquiries` with origin allow-listing.
- Package, experience, gallery, event, testimonial, and FAQ sections use published records only.
- Media URLs resolve from the configured storage provider.

## Inquiry Payload

Minimum recommended payload:

```json
{
  "firstName": "Mia",
  "lastName": "Chen",
  "email": "mia@example.com",
  "phone": "555-0100",
  "eventType": "Wedding",
  "eventDate": "2026-10-24",
  "city": "Dallas",
  "state": "TX",
  "message": "Interested in LOLA Booths.",
  "utm_source": "website"
}
```

Expected success behavior: a lead is created or deduplicated, activity is recorded, and enabled lead automations are queued. Failure behavior: the public form should show a polite retry message and avoid duplicate resubmission where possible.

Spam/rate limiting: public API calls are governed by the configured Express rate limit and `PUBLIC_INQUIRY_ALLOWED_ORIGINS`.

## Launch Guardrails

- Confirm `PUBLIC_BASE_URL` and `CLIENT_ORIGIN` use HTTPS.
- Confirm public inquiry rate limits are active.
- Confirm CMS drafts are not shown publicly.
- Confirm favicon/social assets use the approved Phase 5B brand package.
