# LOLA Admin Data Model

Phase 1 model audit date: 2026-09-12

## Core Principles

- PostgreSQL is the source of truth.
- UUID primary keys are used throughout.
- Money is stored with `NUMERIC(12,2)`, never floating point.
- Operational records use `created_at`, `updated_at`, and `deleted_at` where relevant.
- Sensitive workflow changes write to `audit_logs`.
- General timeline activity writes to `activities`; `lead_activities` is a view over `activities`, not a duplicate table.

## Entities And Tables

### Identity And RBAC

- `users`: admin users, password hash, active flag, soft delete.
- `roles`: OWNER, ADMIN, SALES, EVENT_MANAGER, ATTENDANT.
- `permissions`: string permission keys such as `read:sales`, `write:events`, `publish:website`.
- `role_permissions`: role-to-permission join.
- `user_roles`: user-to-role join.
- `user_sessions`: refresh token sessions.

### Sales

- `leads`: inquiry/contact/event fields, preferred package/experience, assigned user, status, conversion links.
- `activities`: generic timeline actions for leads/events/bookings/payments/etc.
- `lead_activities`: view of `activities` where `entity_type = 'lead'`.
- `clients`: client profile records, type, billing address, referral source.
- `proposals`: proposal header linked to lead/client/event.
- `proposal_versions`: immutable proposal snapshots.
- `proposal_items`: line items.
- `proposal_deliveries`: email/link/manual delivery tracking.

### Events And Bookings

- `events`: event schedule, venue, package, experience, status, notes.
- `bookings`: financial summary for an event/client/lead.
- `event_addons`: add-ons selected for an event with unit price at booking time.
- `equipment`: inventory items and operational status.
- `equipment_assignments`: event/equipment join; trigger prevents overlapping assignments.
- `event_equipment`: compatibility view over `equipment_assignments`.
- `staff_profiles`: staff/attendant profile and availability JSON.
- `staff_assignments`: event/staff join; trigger prevents overlapping assignments.
- `event_staff`: compatibility view over `staff_assignments`.
- `event_checklists`: checklist container per event.
- `checklist_items`: operational checklist tasks.

### Finance

- `invoices`: invoice header linked to client/event, totals, due date, status.
- `invoice_items`: invoice line items.
- `payments`: manual payment records linked to event/client.
- `payment_attempts`: future gateway payment attempts.
- `refunds`: refund records linked to payments.
- `payment_gateway_events`: provider webhook events for payment processors.

### Operations

- `tasks`: follow-ups assigned to users and optionally linked to lead/client/event.
- `files`: metadata for client/event/lead files; binary content lives in storage.
- `galleries`: event gallery delivery records.
- `communications`: logged email/SMS/phone/note/system communication events.
- `email_messages`: provider-aware email send/delivery records.

### Website CMS And Media

- `media_library`: uploaded media metadata, storage key, visibility, permission state.
- `website_hero_slides`: homepage hero slides with image/mobile image, copy, CTA, publish windows.
- `website_gallery_items`: public gallery records linked to media.
- `website_content`: structured content blocks and SEO fields.
- `testimonials`: testimonial content with publish status.
- `faqs`: FAQ entries with publish status.

Website content states:

- `DRAFT`
- `PUBLISHED`
- `ARCHIVED`

Media visibility and permission defaults:

- `visibility`: defaults to `PRIVATE`
- `permission_state`: defaults to `UNKNOWN`
- Permission states: `UNKNOWN`, `APPROVED`, `RESTRICTED`, `DO_NOT_PUBLISH`

### Integrations And Automation

- `integration_connections`: provider-agnostic connection status and encrypted credentials.
- `integration_field_maps`: mapping between local and provider fields.
- `webhook_events`: generic inbound webhook event records.
- `automation_events`: internal trigger log for future automation engine.
- `document_templates`: proposal/contract/invoice/email/questionnaire templates.

Integration statuses:

- `DISCONNECTED`
- `CONNECTED`
- `ERROR`
- `NEEDS_REAUTHORIZATION`
- `AWAITING_APPROVAL`

### Business Settings And Audit

- `business_settings`: business profile, deposit/tax defaults, setup/breakdown buffers, timezone, currency, invoice prefix.
- `audit_logs`: sensitive action trail with actor, action, entity, before/after JSON, IP, user agent.

## Important Enums

- Lead status: `NEW`, `CONTACTED`, `QUALIFIED`, `PROPOSAL_SENT`, `FOLLOW_UP`, `WON`, `LOST`
- Event status: `DRAFT`, `PENDING_CONTRACT`, `PENDING_DEPOSIT`, `CONFIRMED`, `READY`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`
- Payment status: `UNPAID`, `PARTIAL`, `PAID`, `REFUNDED`
- Invoice status: `DRAFT`, `SENT`, `PARTIAL`, `PAID`, `VOID`
- Proposal status: `DRAFT`, `SENT`, `VIEWED`, `ACCEPTED`, `DECLINED`, `EXPIRED`
- Equipment status: `AVAILABLE`, `RESERVED`, `IN_USE`, `MAINTENANCE`, `RETIRED`
- Task/checklist status: `OPEN`, `IN_PROGRESS`, `DONE`, `CANCELLED`
- Communication type: `EMAIL`, `SMS`, `PHONE`, `NOTE`, `SYSTEM`

## Indexes

Important indexes currently cover:

- Lead status, email, phone, event date, created date.
- Client email and created date.
- Event date, status, client ID, created date.
- Proposal status and created date.
- Invoice status, client ID, event ID, created date.
- Payment event ID, client ID, created date.
- Booking payment status.
- Task due date/status.
- Activity entity/time.
- Audit entity/time.
- Published website content and display order.
- Media visibility/permission and created date.
- Integration category/provider/status.
- Webhook provider/status/time.

## Relationship Diagram

```text
users
  ├─ user_roles ─ roles ─ role_permissions ─ permissions
  ├─ user_sessions
  ├─ tasks.assigned_user_id
  ├─ staff_profiles.user_id
  ├─ payments.recorded_by
  └─ audit_logs.actor_user_id

leads
  ├─ preferred_package_id ─ packages ─ package_items
  ├─ preferred_experience_id ─ experiences
  ├─ assigned_user_id ─ users
  ├─ converted_client_id ─ clients
  ├─ converted_event_id ─ events
  ├─ proposals ─ proposal_versions / proposal_items / proposal_deliveries
  ├─ communications / email_messages
  ├─ tasks
  ├─ files
  └─ lead_activities view ─ activities

clients
  ├─ events ─ bookings ─ event_addons ─ addons
  ├─ invoices ─ invoice_items
  ├─ payments ─ refunds
  ├─ files
  ├─ communications
  └─ tasks

events
  ├─ packages
  ├─ experiences
  ├─ bookings
  ├─ equipment_assignments ─ equipment
  ├─ staff_assignments ─ staff_profiles
  ├─ event_checklists ─ checklist_items
  ├─ invoices / payments
  ├─ files / galleries
  ├─ communications
  └─ tasks

media_library
  ├─ website_hero_slides.image_media_id
  ├─ website_hero_slides.mobile_image_media_id
  └─ website_gallery_items.media_id

integration_connections
  └─ integration_field_maps

webhook_events / payment_gateway_events / automation_events
  └─ processed later by provider-specific workers
```

## Workflow Support

Current connected-record path:

```text
Lead
  -> Client
  -> Proposal
  -> Event / Booking
  -> Invoice
  -> Payment
```

Operational path:

```text
Event
  <-> Staff Assignments
  <-> Equipment Assignments
  <-> Files
  <-> Gallery
```

Content path:

```text
Website Content
  <-> Media Library
  <-> Hero Slides / Gallery Items / Testimonials / FAQ
```

Social/marketing lead path:

```text
Webhook or integration event
  -> integration_connections / webhook_events
  -> Lead
  -> activities / audit_logs as workflows execute
```
