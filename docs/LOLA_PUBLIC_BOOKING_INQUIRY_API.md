# Public multi-experience booking inquiry API

2026-10-08. Implemented locally; not deployed. This endpoint requests a quote; it does not reserve inventory, create a booking hold, confirm an event, or take payment.

GET `/api/public/booking-catalog` returns an explicit public field projection of published active experiences/packages and active add-ons. Packages remain scoped by `experience_id`. It omits customer data, equipment rules, storage keys, internal notes and credentials. Public names map to The LOLA Glam, The LOLA 360, The LOLA Vogue and The LOLA Guestbook.

POST `/api/public/inquiries` accepts the existing contact/legacy booking schema. Version 2 adds:

```json
{
  "formKind": "BOOKING",
  "bookingVersion": 2,
  "submissionId": "UUID",
  "eventName": "Event name",
  "firstName": "First",
  "lastName": "Last",
  "email": "contact@example.com",
  "phone": "3125550100",
  "eventDate": "2030-06-20",
  "eventStartTime": "18:00",
  "eventEndTime": "23:00",
  "eventType": "Wedding",
  "guestCount": 100,
  "city": "Chicago",
  "state": "IL",
  "selections": [{"experienceId": "UUID", "packageId": "UUID", "customNotes": "Optional custom requirements"}],
  "addons": [{"addonId": "UUID", "quantity": 2}],
  "marketing_email_opt_in": false
}
```

Optional venue, message and existing attribution fields remain supported. Maximum four unique experiences; each package must belong to its experience and remain publicly available. Browser prices and protected status fields are stripped. Authoritative prices are read while selected catalog records are share-locked. Custom prices are stored as null and require an agreed price before a customer proposal can be created using existing proposal safeguards.

Version 2 requires a valid non-past Chicago calendar date, valid distinct start/end times, positive guest count and valid phone. An earlier end time means the following day. Venue details can be unconfirmed. Quantities range 1–24; fixed/custom add-ons require quantity 1. Compatibility fallback policy v1 excludes prints/printed guestbooks without Glam, backdrops without Glam/Vogue, and a duplicate audio add-on when the audio experience is selected. This is not a configurable catalog compatibility system.

All selections and add-on quantities persist in `leads.source_details.bookingInquiry` alongside a versioned email consent record and submission fingerprint. Lead Details displays them; the existing proposal wizard prefills every selection and quantity. No parallel lead pipeline or duplicated proposal/invoice system is introduced.

The submission ID plus normalized email forms an opaque external lead ID. A transaction advisory lock serializes retries; unchanged retries return success without another lead/task/automation/email. Changed content with the same ID returns 409. A new ID supports another event for the same email, flagged as a possible duplicate rather than merged.

Errors: 400 invalid JSON object/honeypot; 403 disallowed origin; 413 over 64 KiB parsed payload; 422 validation/catalog mismatch; 409 changed replay; 429 quota exceeded. Existing global JSON parser limits still apply before route validation. Public writes share a PostgreSQL quota, default 20 per configured window (default 15 minutes), configurable through PUBLIC_WRITE_RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS. Network identifiers are HMAC keyed with the existing JWT secret; expired quota rows are removed.

Migration 054 must precede this API version. It creates only the shared quota table and expiry index. Workers are not required by this form change. Do not enable historical queues to qualify it.
