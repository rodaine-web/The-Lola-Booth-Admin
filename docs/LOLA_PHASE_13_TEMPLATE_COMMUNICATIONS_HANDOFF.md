# LOLA Phase 13 Template Communications Handoff

## Delivered

- Added migration `017_phase_13_template_communications.sql` to extend existing `email_templates` into a generalized template system while preserving the legacy table and routes.
- Extended `communications` into a richer communication record with template linkage, rendered content, scheduling, status, provider metadata, merge data, idempotency, and proposal/invoice/payment references.
- Added seed templates for lead acknowledgements, follow-ups, proposals, invoices, receipts, booking/event/gallery/review messages, staff/internal alerts, and document-oriented proposal/invoice defaults.
- Added `creative_approvals` as the foundation table for public client approvals.
- Rebuilt the merge renderer to support allowlisted nested variables such as `{{client.first_name}}`, `{{proposal.url}}`, and `{{invoice.amount_due}}` without eval-style execution.
- Added draft, send, schedule, cancel, retry, duplicate, activate, and archive operations for the admin communication center.
- Updated automation processing to support draft creation, scheduled communications, and due scheduled email delivery.
- Updated proposal and invoice delivery to render active templates first and fall back to the previous hardcoded copy if the template is unavailable.
- Expanded the Communications admin page with a communication center table and status tabs for sent, draft, scheduled, failed, and all messages.

## Compatibility Notes

- Existing `/communications/templates`, `/communications/automations`, `/communications/jobs/process`, and `/communications/send` routes remain available.
- Legacy flat variables such as `{{first_name}}` and `{{proposal_url}}` still render for existing templates.
- Seed template inserts use `ON CONFLICT (template_key) DO NOTHING` so edited production templates are not overwritten on future deploys.
- SMS and internal notification templates are seeded, but direct SMS provider sending remains intentionally disabled until a provider is configured.

## Follow-Up Queue

- Add provider-specific SMS sending once Twilio or another SMS provider is configured.
- Add scheduled worker execution outside the manual admin "Process Due Jobs" button if production does not already run the job processor.
- Convert staff brief, gallery delivery, public inquiry notifications, and notification preference emails onto the same template renderer.

## Phase 13B Completion Layer

- Added migration `018_phase_13b_template_communications_completion.sql`.
- Added immutable `rendered_subject` snapshots and `communication_template_versions`.
- Added granular RBAC seed permissions: `templates.view`, `templates.manage`, `communications.view`, `communications.send`, `communications.schedule`, `communications.retry`, `automations.view`, `automations.manage`, and `approvals.manage`.
- Added proposal document template scaffolds for Standard Event, Wedding, Corporate Event, Custom Brand Activation, and Custom Experience proposals.
- Added invoice document template scaffolds for Standard, Corporate, and Brand Activation invoices while keeping all financial calculations in invoice services.
- Added creative approval revision history, public token view/respond endpoints, and immutable approval snapshots.
- Expanded Communications UI into top-level Communications, Templates, and Automations work areas with a template editor, variable picker, preview, template actions, and communication composer.
- Added send-mode behavior for `AUTOMATIC`, `REVIEW_BEFORE_SEND`, `MANUAL`, and `SCHEDULED`.
- Added structured fallback warnings when proposal/invoice delivery templates cannot be rendered.
- Added communication readiness counts to System Health.
