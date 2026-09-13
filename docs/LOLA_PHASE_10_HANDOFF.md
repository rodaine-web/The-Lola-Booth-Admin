# LOLA Admin Phase 10 Handoff

## Summary

Phase 10 hardens field operations for real event execution without rebuilding Phase 9 or changing the approved LOLA brand system.

Implemented:

- Persistent in-app notifications with severity, category, entity links, read/dismiss, unread count, role/user targeting, and preferences.
- Notification bell in the admin top bar with lightweight polling.
- Operational notifications for staff decline, high/critical incidents, equipment damage/maintenance, gallery readiness, reschedule, and cancellation.
- IndexedDB-backed attendant offline action queue with ordered replay and visible sync status.
- Idempotency receipt foundation for replayed offline actions.
- Attendant logout cleanup for sensitive cached event data.
- Equipment scan lookup by opaque QR token, asset UID, or equipment ID.
- Printable branded QR label sheet PDF for equipment.
- Scan page with camera capability detection and manual fallback.
- Staff brief email delivery from Event Detail.
- Secure gallery/client delivery token model and public `/delivery/:token` page.
- Gallery lifecycle expansion through delivered/viewed/archive states.
- Delivery token revoke support.
- Dashboard counters for critical operational alerts, staff declines, critical incidents, and equipment return issues.
- Settings foundation for setup delay, start delay, equipment return delay, and delivery expiration.

## Database

Migration:

- `server/migrations/013_phase_10_field_hardening.sql`

Important tables/fields:

- `notifications`: persistent in-app notification records.
- `notification_preferences`: per-user in-app/email/category preferences.
- `offline_action_receipts`: idempotency and conflict/failed replay history.
- `staff_brief_deliveries`: staff brief delivery status and snapshots.
- `gallery_deliveries`: secure delivery token, expiration, revoke/archive, and view tracking.
- `gallery_delivery_items`: explicitly attached delivery links/files only.
- `galleries`: expanded lifecycle and view metadata.
- `business_settings`: operational delay thresholds and default delivery expiration.

## API

Notifications:

- `GET /api/notifications`
- `GET /api/notifications/count`
- `POST /api/notifications/mark-all-read`
- `PATCH /api/notifications/:id/read`
- `DELETE /api/notifications/:id`
- `GET /api/notifications/preferences`
- `PATCH /api/notifications/preferences`

Field operations:

- `POST /api/offline-actions/replay`
- `GET /api/scan/equipment/:token`
- `POST /api/equipment/qr-labels.pdf`

Event delivery:

- `POST /api/events/:id/staff-briefs/send`
- `POST /api/events/:id/gallery-delivery/send`
- `POST /api/events/:id/gallery-delivery/revoke`

Public:

- `GET /api/public/delivery/:token`
- Frontend route: `/delivery/:token`

## Frontend

Admin:

- Top bar notification bell shows unread count and opens a notification drawer.
- Event Detail Operations tab can send staff briefs and gallery deliveries.
- Event Equipment tab can download QR labels and open scanner.
- Settings includes Phase 10 delay/expiry controls.

Attendant:

- Failed safe operational actions queue locally and replay when the browser comes back online.
- Visible sync state shows offline, syncing, waiting changes, synced, and failures.
- Queued actions include checklist updates, status changes, equipment lifecycle, notes, and incidents.
- Finance/admin/payment/user-management actions are not queued.

Client:

- Delivery page uses stacked LOLA logo, ivory/charcoal/gold styling, Playfair headings, thank-you copy, delivery links, optional review CTA, and support contact.
- The public payload excludes internal notes, staff, incidents, payments, and CRM details.

## Known Limitations

- QR label PDFs include an opaque scan URL and deterministic QR-style matrix, but a production scannable QR encoder package should replace the matrix before printing real labels at scale.
- Camera scanning is feature-detected and represented as a foundation; manual token/asset lookup is the reliable fallback.
- Offline replay handles text/status/lifecycle actions; offline file/photo upload retry is still future work.
- Notification email preference support exists, but operational notifications currently prioritize in-app delivery unless a feature sends email directly.
- Delivery item support is link/file-record based; no image hosting or gallery replacement is attempted.

## Manual QA

1. Trigger a staff decline and confirm Event Manager notifications.
2. Trigger a high/critical incident and confirm manager critical/high alerting.
3. Mark notifications read, mark all read, dismiss, and filter unread/category.
4. Open an attendant event, disable network, update checklist/status/note/incident, restore network, and confirm replay.
5. Download QR labels from Event Detail and confirm LOLA label content.
6. Open `/scan`, search by asset UID/token, and confirm wrong-event warnings.
7. Send Staff Brief and confirm communication/development email delivery behavior.
8. Send Gallery and open `/delivery/:token`.
9. Confirm delivery view tracking increments and expired/revoked links show the generic unavailable message.
10. Confirm no staff, incident, payment, or internal event data appears on delivery pages.

## Phase 11 Readiness

Suggested next work:

- Replace QR-style matrix with a true QR encoder dependency.
- Add camera decode loop for browsers with stable BarcodeDetector support.
- Add operational photo upload retry.
- Add notification preference UI in Settings.
- Add a dedicated event manager live operations board if dashboard density grows.
