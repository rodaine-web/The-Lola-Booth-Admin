> October 8 secure journey checkpoint: [implementation, evidence and NO-GO criteria](LOLA_PHASE1_SECURE_JOURNEY_READINESS_2026-10-08.md). Migration 055 is rehearsed on a restored copy only; this revision is not yet staging-qualified. Historical milestones below do not certify the new revision.

# LOLA BoothBook parity audit

Audit started 2026-10-07. Baseline: existing `work/lola-admin` checkout, including pre-existing uncommitted design and integration changes. This is a source audit, not a production certification. No production migration or customer messages authorized by this sprint are executed as part of the audit.

## Evidence and release gates

Each numbered section below traces to the supplied complete requirement checklist. Acceptance requires every applicable bullet in that section and its related A–J journey, not merely page rendering. COMPLETE requires applicable workflow, persistence, security and failure-handling evidence. PARTIAL means reusable implementation with unresolved gaps. BLOCKED means a required external prerequisite is missing. FAILED means an executed acceptance check failed. Historical gap text below is retained as baseline context; the current implementation/evidence tables supersede it for touched requirements. Dependencies: existing authenticated API, PostgreSQL migrations, private Azure storage, communications/worker, and environment-specific customer origins.

## October 8 staging qualification update

Staging migrations through 053 and release 9f6d127 are deployed. Controlled QA browser evidence now verifies planning save/return/submission and the coherent workspace entry to agreements, invoice, receipt and creative review. Creative upload/download, V1 change request, V2 approval, persisted history and component readiness passed. Real database/service checks rejected stale versions and wrong customer emails, prevented duplicate invitation/approval processing and blocked changes to approved revision data. A 375px approval confirmation smoke check passed. Mandatory A–J gates remain PARTIAL: new-booking handoff, private Azure storage, complete permission matrix, actual email delivery, payment/refund journeys and full mobile journeys are not certified. Production remains NO-GO.

## Current implementation update — local only

Baseline classifications below describe the initial audit. The following supersedes baseline gaps for touched sections; every row is PARTIAL until A–J qualification.

| Sections | Local implementation | Remaining gate / gap |
|---|---|---|
| 11–17, 25–27 | Unique event planning, booking handoff, secure invitation, five-step draft/save/submit, protected change requests, admin progress | DB concurrency, actual delivery, mobile, structured admin acceptance of protected changes |
| 18, 32 | Derived combined experience questions; moods/theme/colors and ordering | Per-experience component scope is enforced locally; configurable production rules and actual proof/browser qualification remain |
| 19–23, 48 | Ten inactive catalog seeds, physical overlap check, collection/own/custom, operator review | Holds, reschedule/quantity protection and accepted quote/payment checks now pass isolated DB checks. Final images/stock, checkout/return and actual staging customer/payment journeys remain |
| 24, 53 | Scoped private assets/proofs; signature/size limits; expiry/revocation; safe public fields and logs | Actual Azure upload/download, cross-role/client denial, orphan cleanup and quotas |
| 28–31 | Row-locked revisions/responses, required comments, identity/version checks, immutable approved revision, history/download/revocation | Immutable trigger/component policy checks pass locally; full browser V1→V2→V3, permissions and delivered emails remain |
| 33–38 | Submitted planning/current proof/backdrop review readiness, timeline, existing worker queues, creative task, acknowledgements, deadline attention/overrides | Per-experience creative/staff denominator and opt-in recurring reminder ledger implemented; actual booking/payment-to-planning and reminder delivery qualification remain |
| 46 | Settings → Appearance & Display; scoped user prefs, background/palettes, Day/Night/Auto, preview/reset | Persisted per-user isolation, live browser/device/contrast checks on every module |
| 54–55 | Local regression/build evidence, workflow docs and deployment runbook | All mandatory staging journeys and release certificate remain unqualified |

Payment/online-booking/installment/travel/marketing/reporting and remaining permission/parity requirements retain their baseline gaps unless explicitly stated here. No full-sprint completion is claimed.

## Priority order

1. Creative access/transition/version security and payment regression qualification.
2. First-class planning record, experience-aware requirements, controlled changes, private uploads and customer/admin UI.
3. Backdrop catalog/inventory, concurrency/temporary holds and creative revision-to-readiness integration.
4. Deadlines/attention/automations and post-event growth/reporting gaps.
5. Per-user Appearance & Display and mobile/full A–J staging qualification.

## Requirement traceability

### 1. PRIMARY PRODUCT OBJECTIVE

**PARTIAL**
- Evidence/files: `src/App.jsx; server/src/routes/admin.js`.
- Relevant tables: `events, leads, clients, proposals, invoices`.
- Gap / proposed handling: Core lifecycle exists; planning-to-creative handoff is incomplete.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 1; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 2. REFERENCE ASSETS

**BLOCKED**
- Evidence/files: `Reference: LOLA Event Planning Experience Board.png`.
- Relevant tables: `—`.
- Gap / proposed handling: Inspected four panels: event planning, email, customer steps and ten backdrops. Use actual data, responsive layouts; final backdrop assets still needed.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 2; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 3. EXECUTION ORDER

**PARTIAL**
- Evidence/files: `docs/LOLA_BOOTHBOOK_PARITY_AUDIT.md`.
- Relevant tables: `—`.
- Gap / proposed handling: Source audit recorded here; deployment evidence and journey qualification remain separate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 3; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 4. REUSE BEFORE BUILDING

**COMPLETE**
- Evidence/files: `server/src/services/{client-workspace,creative-approval,event-operations,automation,storage}-service.js`.
- Relevant tables: `client_workspaces, creative_approvals, activities, files`.
- Gap / proposed handling: Reuse existing tokens, revisions, activity, storage and communications.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 4; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 5. PROTECT WORKING FUNCTIONALITY

**PARTIAL**
- Evidence/files: `server/src/middleware/auth.js; server/src/db/migrate.js`.
- Relevant tables: `users, audit_logs`.
- Gap / proposed handling: Existing RBAC/migrations; new workflow must preserve contracts and public API compatibility.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 5; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 6. PRODUCTION BLOCKERS FIRST

**PARTIAL**
- Evidence/files: `server/src/services/{payment,payment-reconciliation,availability,creative-approval}-service.js`.
- Relevant tables: `payments, invoices, equipment_assignments, creative_approvals`.
- Gap / proposed handling: Existing payment safety needs journey qualification; approval expiry/version/state validation is broken; backdrop conflicts/holds missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 6; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 7. UX PRINCIPLES

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; src/styles/record-workspace.css`.
- Relevant tables: `events`.
- Gap / proposed handling: Existing tabs and feedback; planning/production next actions not integrated.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 7; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 8. EVENT DETAIL BECOMES THE COMMAND CENTER

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx`.
- Relevant tables: `events`.
- Gap / proposed handling: Existing overview/timeline/team/checklist/creative/finance/files/communications; dedicated planning and versioned-design tabs missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 8; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 9. EVENT HEADER

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/event-operations-service.js`.
- Relevant tables: `events, clients`.
- Gap / proposed handling: Header includes event/status/readiness; review full multi-experience/header actions.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 9; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 10. EVENT OVERVIEW

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/event-finance-summary.js`.
- Relevant tables: `bookings, events, invoices`.
- Gap / proposed handling: Operational and financial detail exists; planning/approval summary missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 10; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 11. EVENT PLANNING

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 11; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 12. EVENT PLANNING CREATION

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 12; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 13. CLIENT EVENT PLANNING INVITATION

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 13; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 14. SECURE CLIENT ACCESS

**PARTIAL**
- Evidence/files: `server/src/services/client-workspace-service.js; server/src/services/contract-service.js`.
- Relevant tables: `client_workspaces, contract_access_tokens`.
- Gap / proposed handling: Existing hashed/encrypted/expiring/revocable magic links can be extended; current workspace is accepted-proposal scoped and not a planning flow.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 14; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 15. CLIENT PLANNING PAGE

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 15; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 16. STEP 1 — EVENT DETAILS

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 16; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 17. CONTROLLED CLIENT CHANGES

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 17; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 18. STEP 2 — YOUR STYLE

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 18; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 19. STEP 3 — BACKDROP SELECTION

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 19; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 20. THREE BACKDROP PATHS

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 20; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 21. INITIAL LOLA BACKDROP COLLECTION

**BLOCKED**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 21; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 22. BACKDROP ADMIN

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 22; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 23. BACKDROP INVENTORY & AVAILABILITY

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 23; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 24. STEP 4 — CLIENT ASSETS

**PARTIAL**
- Evidence/files: `server/src/services/storage-service.js; server/src/services/document-access-service.js`.
- Relevant tables: `files`.
- Gap / proposed handling: Private storage exists; client planning upload ownership/type/size/paths and external links need implementation.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 24; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 25. STEP 5 — REVIEW

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 25; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 26. SUBMISSION CONFIRMATION

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 26; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 27. CLIENT PLANNING TAB IN ADMIN

**PARTIAL**
- Evidence/files: `src/pages/EventDetail.jsx; server/src/services/client-workspace-service.js; server/src/services/event-operations-service.js`.
- Relevant tables: `events, client_workspaces, files, event_creative_requirements`.
- Gap / proposed handling: No first-class five-step event planning record or structured backdrop catalog found. Existing event data, token and private file mechanisms are reusable; do not duplicate.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 27; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 28. DESIGN & CREATIVE

**PARTIAL**
- Evidence/files: `server/src/services/creative-approval-service.js; src/pages/EventDetail.jsx`.
- Relevant tables: `creative_approvals, creative_approval_revisions, event_creative_requirements`.
- Gap / proposed handling: Revision service exists alongside text creative form; unify proof UI, private file access and readiness.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 28; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 29. CREATIVE PROOF WORKFLOW

**PARTIAL**
- Evidence/files: `server/src/services/creative-approval-service.js; server/src/routes/public.js`.
- Relevant tables: `creative_approvals, communications`.
- Gap / proposed handling: Public response accepts expired/draft proofs and lacks reviewed-version check; request only creates draft, customer approval route absent in App.jsx.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 29; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 30. CREATIVE VERSION HISTORY

**PARTIAL**
- Evidence/files: `server/src/services/creative-approval-service.js; server/migrations/018_phase_13b_template_communications_completion.sql`.
- Relevant tables: `creative_approval_revisions`.
- Gap / proposed handling: Version rows exist; responses do not update revision status; DB-level approved proof immutability absent.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 30; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 31. FINAL CREATIVE APPROVAL — CONTINUED

**PARTIAL**
- Evidence/files: `server/src/services/creative-approval-service.js`.
- Relevant tables: `creative_approvals, creative_approval_revisions`.
- Gap / proposed handling: Stores approved version/name/email; metadata/audit/readiness, transaction and state protection incomplete.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 31; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 32. EXPERIENCE-AWARE EVENT PLANNING

**PARTIAL**
- Evidence/files: `server/src/services/event-operations-service.js`.
- Relevant tables: `event_creative_requirements, event_services`.
- Gap / proposed handling: Multi-experience selections exist; shared and experience-specific planning requirements missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 32; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 33. EVENT READINESS INTEGRATION

**PARTIAL**
- Evidence/files: `server/src/services/event-operations-service.js; server/src/utils/dashboard-readiness.js`.
- Relevant tables: `event_creative_requirements, events`.
- Gap / proposed handling: Readiness exists, but generic creative/backdrop requirements inflate denominators; planning and approval-version status missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 33; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 34. EVENT TIMELINE / ACTIVITY

**PARTIAL**
- Evidence/files: `server/src/services/activity-service.js; src/pages/EventDetail.jsx`.
- Relevant tables: `activities, audit_logs`.
- Gap / proposed handling: Existing event timeline; new lifecycle actions must use it.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 34; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 35. COMMUNICATIONS INTEGRATION

**PARTIAL**
- Evidence/files: `server/src/services/automation-service.js; src/pages/Communications.jsx`.
- Relevant tables: `communications, communication_attempts`.
- Gap / proposed handling: Existing history/delivery; planning transitions not connected.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 35; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 36. EVENT PLANNING AUTOMATIONS

**PARTIAL**
- Evidence/files: `server/src/services/automation-service.js; server/src/worker.js`.
- Relevant tables: `automation_rules, automation_events, scheduled_jobs`.
- Gap / proposed handling: Existing workers and retry safeguards; planning triggers/deadlines absent.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 36; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 37. PLANNING DEADLINES

**PARTIAL**
- Evidence/files: `src/pages/Settings.jsx; server/src/services/payment-reminder-service.js`.
- Relevant tables: `business_settings, scheduled_jobs`.
- Gap / proposed handling: Payment due defaults exist; planning/creative deadline defaults and event overrides missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 37; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 38. PROPOSAL → BOOKING → PLANNING HANDOFF

**PARTIAL**
- Evidence/files: `server/src/services/proposal-service.js; server/src/services/payment-reconciliation-service.js`.
- Relevant tables: `proposals, bookings, events`.
- Gap / proposed handling: Accepted proposals convert; confirmation policy exists; automatic planning creation/invitation missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 38; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 39. CONTRACTS & E-SIGNATURE

**PARTIAL**
- Evidence/files: `server/src/services/contract-service.js; server/migrations/040_v11_contracts.sql; test/contracts-db.test.js`.
- Relevant tables: `contracts, contract_access_tokens`.
- Gap / proposed handling: Snapshots/signature/immutable signed content/PDF already implemented. Qualify event-variable/clauses/amendment UI rather than replace.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 39; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 40. ONLINE BOOKING

**PARTIAL**
- Evidence/files: `server/src/routes/public.js; server/src/services/public-form-schema.js`.
- Relevant tables: `leads, events, bookings`.
- Gap / proposed handling: Public inquiry/booking request explicitly does not reserve date. Full availability/contract/checkout self-service missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 40; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 41. AVAILABILITY & TEMPORARY HOLDS

**PARTIAL**
- Evidence/files: `server/src/services/availability-service.js; server/migrations/002_assignment_conflict_triggers.sql`.
- Relevant tables: `events, equipment_assignments, staff_assignments`.
- Gap / proposed handling: Assigned overlap guards exist; quantity-based experience/backdrop holds and concurrency qualification missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 41; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 42. TRAVEL FEES

**PARTIAL**
- Evidence/files: `server/src/services/pricing-service.js; server/src/services/proposal-service.js`.
- Relevant tables: `proposals, bookings`.
- Gap / proposed handling: Manual travel charge exists; radius/mileage/provider calculation and overrides missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 42; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 43. PAYMENT HARDENING

**PARTIAL**
- Evidence/files: `server/src/services/{payment,payment-reconciliation,checkout-confirmation,receipt}-service.js; src/pages/PublicInvoice.jsx`.
- Relevant tables: `payments, payment_attempts, invoices, refunds`.
- Gap / proposed handling: Server checkout verification, reconciliation/idempotency/receipts already exist. Need live deposit/balance/replay/refund evidence; no assertion of certification from source alone.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 43; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 44. PAYMENT SCHEDULES

**PARTIAL**
- Evidence/files: `server/src/services/invoice-service.js; server/src/services/payment-reminder-service.js`.
- Relevant tables: `invoices, payments, refunds`.
- Gap / proposed handling: Deposit/balance/custom payment support exists; installment schedule entity/UI not located.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 44; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 45. DASHBOARD — ACTION FIRST

**PARTIAL**
- Evidence/files: `src/pages/Dashboard.jsx; server/src/services/operational-intelligence-service.js`.
- Relevant tables: `events, invoices, tasks`.
- Gap / proposed handling: Attention dashboard exists; planning/approval/backdrop resolution links missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 45; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 46. APPEARANCE & DISPLAY SETTINGS

**PARTIAL**
- Evidence/files: `src/pages/Settings.jsx; src/components/Layout.jsx; src/components/workspace/InsightPanels.jsx`.
- Relevant tables: `users`.
- Gap / proposed handling: No per-user appearance persistence; hardcoded light surfaces/chart palettes. Add self-owned preference column/API, scoped admin theme, previews/modes/reset.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 46; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 47. STAFF & FIELD OPERATIONS

**PARTIAL**
- Evidence/files: `server/src/services/field-operations-service.js; src/pages/MyEvents.jsx; src/utils/offlineQueue.js`.
- Relevant tables: `staff_assignments, event_checklist_items`.
- Gap / proposed handling: Field operations/offline queue exists. Qualify mobile and role restrictions.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 47; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 48. EQUIPMENT & BACKDROP OPERATIONS

**PARTIAL**
- Evidence/files: `server/src/services/event-operations-service.js; server/src/services/field-operations-service.js`.
- Relevant tables: `equipment, equipment_assignments, incidents`.
- Gap / proposed handling: Equipment lifecycle exists; structured physical backdrop inventory missing.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 48; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 49. CAMPAIGNS & POST-EVENT GROWTH

**PARTIAL**
- Evidence/files: `server/src/services/{campaign-service,campaign-sales-service,campaign-contact-import,private-gallery-service}.js`.
- Relevant tables: `campaigns, campaign_contacts, galleries`.
- Gap / proposed handling: Composer/import/tracking/interest/invoice flow exists; event-driven segments, referrals/anniversary lifecycle incomplete.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 49; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 50. WEBSITE & PUBLIC API INTEGRATION

**PARTIAL**
- Evidence/files: `server/src/routes/public.js; server/src/services/website-cms-service.js; docs/LOLA_EXTERNAL_WEBSITE_API_CONTRACT.md`.
- Relevant tables: `website_hero_slides, experiences, packages, media`.
- Gap / proposed handling: External website architecture/public APIs/CMS exists. Regression qualification required; preserve separation.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 50; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 51. REPORTING

**PARTIAL**
- Evidence/files: `src/pages/Analytics.jsx; server/src/services/reporting-query.js; server/src/services/revenue-records-service.js`.
- Relevant tables: `events, invoices, payments, leads, campaigns`.
- Gap / proposed handling: Actual metrics/date ranges exist; backdrop utilization and some owner drilldowns unavailable.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 51; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 52. INTEGRATIONS

**BLOCKED**
- Evidence/files: `server/src/services/external-provider-adapters.js; docs/LOLA_EXTERNAL_INTEGRATIONS_SETUP.md`.
- Relevant tables: `external_connections, external_integration_jobs`.
- Gap / proposed handling: Provider boundaries exist; credentials/provider qualification not implied. Deferred integrations remain roadmap.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 52; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 53. SECURITY & PRIVACY

**PARTIAL**
- Evidence/files: `server/src/middleware/auth.js; server/src/services/{document-access,client-workspace,creative-approval}-service.js`.
- Relevant tables: `users, files, client_workspaces, creative_approvals`.
- Gap / proposed handling: Scoped workspace/document access exists; creative public full-row response and weak transition checks need hardening.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 53; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 54. TESTING & STAGING QUALIFICATION

**BLOCKED**
- Evidence/files: `test/; docs/LOLA_STAGING_QUALIFICATION.md`.
- Relevant tables: `—`.
- Gap / proposed handling: Many regressions exist; required A–J journeys not yet qualified. Skipped DB tests are not passes.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 54; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

### 55. FINAL DOCUMENTATION & DEFINITION OF DONE

**BLOCKED**
- Evidence/files: `docs/`.
- Relevant tables: `—`.
- Gap / proposed handling: Existing runbooks; sprint-specific workflow/qualification documentation must be maintained with actual results.
- Routes: use existing `/api/admin` event/settings/creative/communications APIs and `/api/public` token APIs where present; proposed planning/backdrop routes require access review.
- Dependencies: existing event/client ownership, RBAC, migrations, audit/activity, storage and communications as applicable.
- Acceptance: all requested behavior in section 55; verify using applicable A–J workflow gates in `LOLA_STAGING_QUALIFICATION.md`.

## October 7 qualification update

Current status: **NO-GO for production**. Verified staging DB backup/restore; disposable migration chain 001–053 PASS; restored missing sequence PASS; nine SQL and twenty actual service checks PASS. Full suite 609 tests / 599 PASS / zero FAIL / ten SKIPPED. Frontend build PASS; patched production dependency audit zero known vulnerabilities. Application staging migrations/deployment and mandatory browser/provider A–J qualification have not run.

Sections 19–23, 40–41, 48: resource holds expire, replay does not extend expiry, concurrent holders cannot share a unit, held confirmation assigns resources atomically, manual status change cannot bypass held assignments, cancelled bookings release assignments and inventory/reschedule conflicts are rejected. Resource selection is required before availability can assert capacity. Complete public self-service booking and experience-to-physical-resource mapping remain PARTIAL.

Sections 25–27: a current planning grant opens one customer workspace even without a proposal; workspace and planning links revoke together. Public HTTP ownership/role/mobile qualification remains PARTIAL.

Sections 18, 28–38: each selected experience has explicit required creative components; only its current approved proof completes that component. Recurring reminders use existing communications and a unique per-grant/version/cadence ledger, and submission/revocation cancel dispatch eligibility. Actual delivery and full approval revisions remain PARTIAL.

Sections 22–23, 43: chargeable backdrop work requires accepted immutable terms, a correctly scoped dedicated invoice and required net payment. Refund removes payment qualification. Expired held bookings cannot start a new checkout; payment already received stays posted if confirmation fails and triggers an operator review alert. Real payment/replay/refund/provider receipts remain PARTIAL.

Sections 42, 44, 49, 51 retain gaps: rule-based travel fees; scheduled installments beyond deposit/balance; post-event/referral/anniversary marketing and advanced segment workflows; package/source/lost-reason/resource reporting and drilldowns. They have not been claimed complete or deployed.

Sections 21 and 52 remain BLOCKED on usable individual backdrop files/actual stock and external provider prerequisites. Sections 54–55 remain BLOCKED on mandatory application staging A–J certification. Release details: `LOLA_RELEASE_READINESS_2026-10-07.md`.

## 2026-10-08 — public multi-experience booking inquiry follow-on

Status PARTIAL, local implementation only. Existing parity functionality is reused. New form supports independent published catalog package selections for up to four experiences, compatible add-on quantities, versioned opt-in, structured lead persistence and proposal prefill. Migration 054 qualifies on a fresh restored staging database; no application migration or deployment for this follow-on yet. Real router tests pass for replay/concurrency, size, origin, honeypot and distributed quota. Ten generated representative add-on illustrations plus owner supplied Glam/360 photos are present in the local website.

Hosted browser-to-lead-to-proposal/invoice, actual approved email delivery, specific desktop/mobile breakpoints and complete consent/suppression checks remain PARTIAL/BLOCKED. See LOLA_BOOKING_FORM_TEST_REPORT.md and LOLA_BOOKING_FORM_STAGING_UAT.md. This evidence does not mark production ready.

## 2026-10-08 — staging deployment and remaining-work clarification

Booking follow-on 87a701b is deployed to staging API/worker and staging frontend. Migration 054 applied after fresh verified backup/restore. Hosted assets/API smoke and scoped package/quantity browser interactions PASS; full hosted persistence-to-proposal/provider/mobile A–J certification remains PARTIAL. Owner enabled QA email sending; automatic jobs remain paused, actual delivery still unverified. See LOLA_BOOTHBOOK_REMAINING_WORK_2026-10-08.md for authoritative current implementation gaps versus qualification gaps. Production remains NO-GO.
