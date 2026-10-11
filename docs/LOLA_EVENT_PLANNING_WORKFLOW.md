# Event planning workflow — implementation and qualification

Status: local implementation, not staging-qualified. Existing events, clients, tasks, communications, activities and private files remain authoritative.

## Booking handoff

Confirmed/preparing/ready/in-progress bookings can create one event_planning record. Event-row locking and a unique event_id protect duplicate creation. Payment reconciliation invokes the handoff in its existing transaction. Admin confirmation also invokes it. Missing client email leaves a planning record without an invitation; an operator must complete the contact details.

An invitation uses a hashed grant, encrypted recoverable token, 120-day expiry and an environment-specific frontend origin. Existing scheduled communications send the invitation. Repeat requests return the existing link. Regeneration cancels eligible old queued messages and creates a new grant; revocation disables the grant and cancels eligible queued invitations. The worker rechecks the exact grant immediately before provider dispatch. A provider request already in flight cannot be recalled.

## Customer planning

The invitation opens /client/:token, including proposal-free campaign bookings, with planning and current creative actions in one workspace. Its planning action opens /planning/:token, which has Event Details, Your Style, Backdrop, Uploads and Review. Save/step navigation persists the draft. Shared questions are collected once; additional instructions derive from attached experiences. Date, time, type and venue differences remain change requests and never update the booking from the public form. Database time values normalize seconds for comparison.

Submission requires applicable client input. The server creates/reopens one creative preparation task, queues one submission acknowledgement and records activity/audit/internal notification. Editing the brief, backdrop or assets invalidates submitted_at and requires resubmission. Approved/complete briefs are locked. Production components are derived per selected experience. Only current approved proof metadata covering an exact experience/component completes that requirement; browser qualification remains outstanding.

## Operator review

Event Detail → Client Planning shows progress, timestamps, brief, changes, backdrop and private assets. Authorized operators can download scoped files, confirm a backdrop and override planning/creative dates. Premium/custom confirmation requires an accepted immutable quote, dedicated scoped invoice and the agreed net payment. A checkbox cannot bypass these checks; refunds invalidate payment qualification. An unlinked quote can be withdrawn and replaced while retaining its terms/history. A linked invoice blocks withdrawal pending explicit financial resolution. Changed backdrop selection hides stale customer quote/payment links and rejects stale acceptance. Requested protected changes are reviewed separately through existing event editing, pricing, availability and agreement rules.

Dashboard attention includes overdue planning/creative dates. Deadline alerts do not cancel a booking. Opt-in recurring planning/creative reminders reuse existing communications; at most three reminders per grant/version, spaced three days apart, with duplicate prevention and dispatch revalidation. Actual delivery remains unqualified and the flag is disabled.

## Routes and permissions

- GET /api/admin/events/:id/planning — read:events + event access.
- POST /api/admin/events/:id/planning/invite or /revoke — write:events + event access.
- PATCH /api/admin/events/:id/planning/review — write:operations + event access; strict permitted payload.
- GET /api/admin/events/:id/planning/assets/:fileId — read:events + event/client/file scope.
- Public GET/PATCH /api/public/planning/:token; POST /submit, /backdrop, /assets; GET /assets/:id — current unexpired grant and matching undeleted event/client.

Required staging evidence: duplicate booking handoff, queue retries/regeneration/revocation, save/return/resubmission, altered protected payload, cancellation and cross-client denial. Isolated DB service checks pass invitation/workspace/revocation, quote/payment/refund, reminder deduplication and submission cancellation. Actual HTTP/browser/provider gates remain unqualified.
