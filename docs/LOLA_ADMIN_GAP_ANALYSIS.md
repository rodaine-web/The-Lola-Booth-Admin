# LOLA Admin Gap Analysis

Phase 1 audit date: 2026-09-12

## Summary

LOLA Admin is a working private React/Vite admin portal backed by an Express REST API and PostgreSQL schema. The current implementation is strongest as an architecture and data foundation: authentication, RBAC, migrations, seeds, core records, public inquiry intake, lead detail/conversion, audit/activity logging, server-side pricing, and availability checks exist.

The primary product gap is that many modules are list/read-only or foundation-only. Phase 2 should focus on full CRUD workflows, event operations, proposal/invoice generation, staff/equipment assignment UI, file uploads, communications, and website CMS management.

## Status Key

- COMPLETE: usable end to end for the intended MVP slice
- PARTIAL: backend and UI exist but important workflow pieces remain
- UI ONLY: screen exists but lacks real backend behavior
- BACKEND ONLY: schema/API exists but no dedicated UI
- MISSING: no meaningful implementation yet
- BROKEN: known defect

## Module Matrix

| Module | Status | Current Implementation | Missing / Required Work | Dependencies |
| --- | --- | --- | --- | --- |
| Dashboard | PARTIAL | KPI cards, upcoming events, recent inquiries, payments due, alerts, overdue tasks. Backend `/dashboard`. Date-range foundation added via `/dashboard/ranges`. | Add range toggles for Today/Week/MTD/YTD, comparisons, richer empty states, drilldowns, timezone-aware SQL reporting throughout. | Business timezone setting, date range utilities. |
| Leads | PARTIAL | Lead list, search, Kanban, lead detail tabs, status update, public inquiry creation, conversion to client/event/booking. | Full create/edit form, notes creation, communications logging UI, proposal creation from lead, duplicate detection. | Clients, proposals, tasks, files. |
| Clients | PARTIAL | Client table and schema; conversion creates or reuses client by email. | Client profile page, full CRUD, upcoming/past events, payments, invoices, files, lifetime value. | Events, invoices, payments, files. |
| Proposals | BACKEND ONLY | Tables for proposals, proposal items, versions, deliveries; list route; seed statuses. | Proposal builder, preview, version history UI, delivery tracking, acceptance workflow. | Packages, experiences, add-ons, document templates, email. |
| Events | PARTIAL | Events table, list route, calendar feed, conversion creates pending event. | Event detail page, status controls, timeline, staff/equipment assignment UI, checklist, notes, gallery, payments tab. | Staff, equipment, payments, files, galleries. |
| Calendar | PARTIAL | Month/week/day display from `/calendar`; status styling. | Real calendar range calculations, filters, click-through event detail, timezone-safe date rendering, Google/Outlook sync hooks. | Business timezone, integrations. |
| Equipment | PARTIAL | Equipment table, seed inventory, list route, assignment endpoint, overlap conflict trigger. | Assignment UI, conflict alert surfacing, maintenance history, availability calendar. | Events, availability service. |
| Staff | PARTIAL | Staff profile/assignment tables, seed staff, conflict trigger, list route. | Staff profile UI, availability editor, assignment UI, attendant-only view. | RBAC, events. |
| Payments | PARTIAL | Payment table, manual record endpoint, server-side booking balance update, audit logging, payment attempts/refunds/gateway event tables. | Payment forms, refunds endpoint/UI, gateway integration adapter, invoice payment reconciliation. | Invoices, integrations. |
| Invoices | BACKEND ONLY | Invoice and invoice item tables, list route, seeded paid/partial/overdue invoices. | Invoice detail, creation from booking, PDF export, send flow, payment status sync. | Document templates, payments, email. |
| Packages | PARTIAL | DB-backed packages, package items, list route, most_popular flag, seed data. | CRUD UI, package item editing, validation around active packages. | Website CMS/public site sync later. |
| Experiences | PARTIAL | DB-backed experiences, list route, seed data. | CRUD UI, equipment/staff requirement editor, public display settings. | Equipment, staff, website CMS. |
| Add-ons | PARTIAL | DB-backed add-ons, pricing types, list route, conversion selection. | CRUD UI, quantity support in conversion UI, package compatibility rules. | Booking pricing service. |
| Tasks | PARTIAL | Task schema, list route, overdue dashboard widget. | Task create/edit, assignment, lead/client/event detail integration, reminders. | Users, automation. |
| Files | BACKEND ONLY | File metadata table with visibility and permission state; storage abstraction for local/S3-compatible. | Upload/download endpoints, file detail, virus scanning hook, client-visible sharing rules. | Storage integration, media library. |
| Galleries | BACKEND ONLY | Gallery records and list route. | Gallery detail, external URL validation, delivery workflow, public/private sharing. | Events, files/media. |
| Communications | BACKEND ONLY | Communications and email_messages tables; lead detail reads communications. | Manual log UI, email composer, provider adapters, delivery webhooks. | Email integrations, templates. |
| Analytics | PARTIAL | Summary metrics and basic charts for revenue, packages, experiences, lead source. | Timezone-aware reporting, filters, comparison ranges, add-on popularity, event type charts. | Date ranges, richer seed/production data. |
| Users | PARTIAL | Users/roles/permissions schema, auth, sessions, list route. | User management UI, invite/reset flows, role editor, security settings. | RBAC policy map, email. |
| Integrations | BACKEND ONLY | Provider-agnostic connections, field maps, webhook events, encrypted secret helper; seeded disconnected providers. | Connection UI, credential save endpoint, provider-specific adapters, webhook validation. | Secret management, audit. |
| Audit Log | PARTIAL | Audit table, shared audit service, sensitive action writes for lead conversion/status/payment/equipment. | Audit every create/update/delete path as CRUD expands, filtering UI, export. | Consistent controllers. |
| Settings | PARTIAL | Business settings table and read UI; timezone/deposit/tax/storage env foundations. | Save endpoint/UI, validation, audit, operational defaults used in every service. | RBAC, audit. |
| Website CMS | BACKEND ONLY | CMS tables for hero slides, gallery items, content, testimonials, FAQ, SEO fields, media library. | CMS UI, publish workflow, media approval, public website read API. | Media library, RBAC publish permissions. |

## Cross-Cutting Gaps

- Forms: Most resource screens are read-only tables with placeholder "New" buttons.
- RBAC UI: Backend permissions exist, but sidebar links are not yet hidden by permission.
- API consistency: List endpoints have pagination/search; filters and sorting are still minimal.
- Timezone: Business timezone is stored and date-range utilities exist, but existing dashboard/analytics SQL still needs full conversion.
- Tests: Foundation tests exist; route-level integration tests need a disposable test database.
- Background jobs: Automation events are logged, but no scheduler/worker exists yet.
- Storage: Abstraction exists, but no upload routes or S3 implementation is active.
- Email: Email tables exist, but no provider adapter or send flow is active.

## RBAC Review

| Capability | OWNER | ADMIN | SALES | EVENT_MANAGER | ATTENDANT |
| --- | --- | --- | --- | --- | --- |
| View financial data | Yes | Yes | No | No | No |
| Record payments | Yes | Yes | No | No | No |
| Issue refunds | Yes | Future policy | No | No | No |
| Send proposals | Yes | Yes | Yes | No | No |
| Publish website content | Yes | Yes | No | No | No |
| Manage integrations | Yes | Yes | No | No | No |
| Assign staff | Yes | Yes | No | Yes | No |
| Assign equipment | Yes | Yes | No | Yes | No |
| Manage users | Yes | Yes, except ownership policy still needed | No | No | No |

Backend permission checks are present on current routes. Future controllers must continue enforcing permissions server-side and not rely on hidden buttons.

## API Conventions

- Auth endpoints use `/api/auth/*`.
- Public unauthenticated inquiry intake uses `/api/public/inquiries`.
- Admin endpoints are under `/api/*` and require `Authorization: Bearer <token>`.
- List responses use `{ data, pagination }` where pagination applies.
- Error responses use `{ error: { code, message, details } }`.
- Validation uses Zod and returns friendly validation messages.
- External credentials must never be returned to frontend APIs; integration list omits encrypted credentials.

## Phase 2 Work

1. Build Event Detail + operational tabs.
2. Add full CRUD forms for leads, clients, events, packages, experiences, add-ons, equipment, payments, tasks, settings.
3. Add proposal builder with versions, preview, and delivery tracking.
4. Add invoice generation and PDF export foundation.
5. Add staff/equipment assignment UI with conflict display.
6. Add file upload endpoints and local storage implementation.
7. Add CMS admin screens for hero slides, gallery, content, testimonials, FAQ, and media approvals.
8. Add integration connection UI with encrypted credential storage.
9. Add route-level integration tests using a dedicated test database.
10. Apply business timezone ranges to dashboard, calendar, reports, invoices, and future jobs.
