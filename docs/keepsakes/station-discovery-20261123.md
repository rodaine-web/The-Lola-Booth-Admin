# Keepsake Station discovery and implementation sequence

The 23 November master prompt and optional pricing addendum extend the active
staging photo-access/personalization work; neither cancels it.

## Existing components to reuse

- `shared/keepsakes-core-catalogue.js`: exactly twelve products. Six Everyday
  products are station eligible; six Digital/Signature products stay retail only.
- `server/src/services/public-booking-service.js`: published booking catalogue,
  experience/package validation, current pricing version and inquiry snapshots.
  `/api/public/booking-catalog`, `/api/public/inquiries`, `/api/public/pricing-quotes`.
- `pricing-catalog-service.js`: versioned existing package/add-on pricing quotes.
  Preserve actual package IDs, private business plans and Glam Signature $899.
- `proposal-service.js`, `proposal-edit-input.js`, `ProposalWizard.jsx`,
  `ProposalEditor.jsx`: existing multi-experience builder and quote snapshots.
  `proposal-pdf-layout.js` and `proposal-pdf-images.js`: customer documents.
- `proposal-acceptance-service.js`, booking invoice/payment gates and handoffs:
  preserve acceptance, full balance due fourteen days before the event, Stripe
  idempotence and existing event financial documents.
- `ClientWorkspace.jsx`, `SecureClientWorkspace.jsx` and their services: existing
  event planning/approval interfaces; no separate customer application.
- Private galleries and session source mapping: existing authorization and genuine
  unbranded/branded sources; no new gallery silo.
- Existing Keepsakes Admin, order history, Lob mailing and postcard artwork:
  preserve return addresses and per-recipient mailing records.

## Required additions and safe migrations

- Explicit shared station eligibility and immutable draft commercial policies
  (migration 090). Snapshot the approved version on each accepted configuration.
- Event-level station project/configuration and product commitment snapshots;
  separate free/paid quantities, product variants and commercial revisions.
- Station allocations for staff, printers/equipment, materials and validated
  throughput. Commercial minimums do not establish on-site production capacity.
- Funding/artwork/material/capacity readiness gates before production; Lob tasks
  for postcards, assembly jobs for in-house products.
- Booking Step 4 configuration using the same server pricing result; authorized
  proposal overrides with reason/audit; consistent customer proposal/PDF, invoice,
  Client Workspace and operational quantities.
- Event operations and real metric drilldowns, without fabricated dashboard data.

## Dependencies and migration risks

Public website is the separate `rodaine-web/staging` repository. Its currently
located checkout contains existing uncommitted booking/package changes, so those
must be preserved. Production website remains release-only. No station equipment
photo, stocked variant costs, validated production throughput or staff allocations
are established by the mockups. Mark missing assets/readiness for Admin review.

Draft unit schedules remain internal until explicitly approved for publication.
The $1,672.50 and $2,092.20 Signature examples and every optional tier boundary
are covered by pure pricing tests. Preserve accepted prices when a new policy is
saved. No historical bookings/proposals/invoices/orders are rewritten or deleted.

## Sequencing

1. Ship/test scoped photo lookup and guest-photo previews in staging.
2. Shared eligibility, draft policy administration and exact cents validation.
3. Booking/public package integration and Admin proposal station configuration.
4. Proposal/PDF/invoice/workspace snapshot consistency and acceptance validation.
5. Event commitments, inventory, staff/equipment capacity, Lob readiness and
   operational reporting. Validate complete journeys before production review.
