# LOLA Admin Phase 9 Handoff

## Summary

Phase 9 adds the event execution layer for LOLA Booths: day-of operations, attendant workflows, readiness, checklists, equipment lifecycle, incidents, gallery handoff, and branded run sheets.

Implemented:

- Separate `events.operational_status` from commercial booking status.
- Operations tab on Event Detail for readiness, timeline, contacts, checklists, creative, incidents, gallery, and completion.
- Readiness scoring from required checklist items, staff acknowledgement, equipment lifecycle, creative approval, and event logistics.
- Checklist template foundation with event-specific snapshot instances.
- Attendant mobile routes at `/my-events` and `/my-events/:eventId`.
- Attendant-only event access controls based on assigned staff profiles.
- Staff acknowledgement/decline, call time, instructions, and lead attendant flag.
- Equipment checkout, on-site, return, condition, accessory, and maintenance flow foundation.
- Incident reporting with high/critical escalation into operational status and follow-up tasks.
- Event completion guardrails with override reason support.
- Gallery processing/ready handoff with automation trigger support.
- Branded event run sheet PDF using the vertical LOLA mark.
- Dashboard attention items and analytics hooks for live operations, incidents, and equipment usage.

## Database

Migration:

- `server/migrations/012_phase_9_event_execution.sql`

Important additions:

- `events`: operational status/timestamps, logistics/access fields, completion metadata, gallery status/url.
- `staff_assignments`: acknowledgement status, call time, decline reason, lead attendant, instructions.
- `equipment`: asset UID, QR token, accessories.
- `equipment_assignments`: lifecycle status, checkout/return timestamps, condition before/after, accessory issues.
- `checklist_templates` and `checklist_template_items`: reusable operational templates.
- `event_checklists` and `checklist_items`: template links, snapshots, required flags, severity-friendly status.
- `event_contacts`: day-of contact, planner, venue contact, client contact.
- `event_incidents`: type, severity, quick issue, resolution tracking.
- `event_creative_requirements`: backdrop, overlay/template, approval status, creative instructions.
- `event_notes`: setup, client, internal, post-event, and pinned notes.
- `equipment_kits` and `equipment_kit_items`: future kit bundle support.

## API

Event operations:

- `GET /api/events/:id/operations`
- `POST /api/events/:id/operations/status`
- `POST /api/events/:id/operations/complete`
- `POST /api/events/:id/operations/reschedule`
- `POST /api/events/:id/operations/cancel`
- `GET /api/events/:id/run-sheet.pdf`

Checklists:

- `GET /api/events/checklist-templates`
- `POST /api/events/checklist-templates`
- `POST /api/events/:id/checklists/instantiate`
- `PATCH /api/events/:id/checklist-items/:itemId`

Day-of operations:

- `POST /api/events/:id/contacts`
- `POST /api/events/:id/notes`
- `PATCH /api/events/:id/creative`
- `POST /api/events/:id/incidents`
- `PATCH /api/events/:id/incidents/:incidentId`
- `PATCH /api/events/:id/gallery`

Attendant:

- `GET /api/my-events`
- `GET /api/my-events/:id`
- `POST /api/events/:id/staff/:assignmentId/acknowledge`
- `POST /api/events/:id/staff/:assignmentId/decline`

Equipment:

- `POST /api/events/:id/equipment/:assignmentId/checkout`
- `POST /api/events/:id/equipment/:assignmentId/onsite`
- `POST /api/events/:id/equipment/:assignmentId/return`

## Frontend

Admin:

- Event Detail now includes an Operations tab.
- Staff assignment supports call time, instructions, and lead attendant.
- Equipment assignment table shows asset UID, lifecycle status, and condition fields.
- Event summary shows both commercial status and readiness/operational state.

Attendant:

- Pure attendant users are redirected to `/my-events`.
- Mobile-first attendant pages show assigned events only.
- Attendants can advance status, view timeline, call/email contacts, open maps, check equipment out/in, complete checklist items, add notes, report incidents, and download authenticated run sheets.
- Finance, invoices, payments, and booking totals are not exposed in the attendant UI.

## Branding

- The attendant shell uses the approved vertical/stacked LOLA logo.
- Run sheet PDFs use the vertical/stacked LOLA logo.
- The Phase 5B document branding rule remains intact for proposals, invoices, receipts, and emails.

## Known Limitations

- Offline attendant actions are cached locally for retry visibility, but automatic background replay is not yet implemented.
- QR token fields are generated and stored, but scanning UI/hardware pairing is future work.
- Staff brief generation is represented by the run-sheet foundation, not a separate email/package flow.
- Reschedule/cancel operations support preview/confirm patterns at the service layer; richer UI controls can be added in a later phase.
- Live push notifications are not implemented; dashboard attention items are polling/API-driven.

## Manual QA

1. Open an event detail page and confirm the Operations tab loads.
2. Apply a checklist template and complete/block at least one item.
3. Add a day-of contact and confirm it appears in the attendant view.
4. Move operational status through at least one day-of transition.
5. Assign staff with a call time and lead attendant flag.
6. Check equipment out and return it with condition values.
7. Report a low incident and a high/critical incident; confirm escalation behavior.
8. Download the event run sheet PDF and confirm LOLA branding appears.
9. Open `/my-events` as an assigned attendant and confirm no financial fields are visible.
10. Mark gallery processing/ready and confirm activity/automation hooks are created.

## Phase 10 Readiness

Phase 9 stops before deeper production operations. Suggested Phase 10 work:

- Notification center and real-time operational alerts.
- Automatic offline action replay for attendant devices.
- QR scanner UI for equipment checkout/return.
- Staff brief delivery workflows.
- Post-event gallery publishing workflow and client delivery portal enhancements.
- More granular role/permission UI for field staff.
