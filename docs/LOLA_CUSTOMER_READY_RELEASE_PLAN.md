# LOLA customer-ready release plan

Updated 2026-10-08 following owner scope decision. This plan supersedes the earlier requirement to complete galleries and broader event operations before the first customer-ready release. Production deployment still requires explicit owner approval after the in-scope staging gates pass.

## Phase 1: booking clients

Deliver a connected, reliable customer acquisition and booking workflow:

1. Leads and booking inquiries: capture, deduplicate, assign and show the next required action.
2. Proposals: draft, prefill, send, accept/decline and expire immutable accepted versions. Accepted campaign offers serve as accepted commercial snapshots and proceed directly to invoicing.
3. Invoicing: automatically generate and send the 30% Non-Refundable Booking Retainer Fee invoice after valid proposal acceptance or campaign-offer acceptance; issue balance invoices and approved payment schedules without duplicate creation. The fee is credited toward the total. Default balance due 14 days before the event; bookings made fewer than 14 days beforehand require full payment unless a written exception applies.
4. Payments and receipts: authoritative provider verification, ledger reconciliation, partial payments, no overpayment, duplicate/replay protection and downloadable receipts. Verify refund/chargeback integrity even though customer-change workflows are deferred.
5. Agreements: automatically prepare and send the agreement after authoritative payment verification confirms the required minimum payment; client signature sufficient by default; immutable accepted commercial snapshot, approved agreement text, typed/drawn signing, signed PDF, issuance deadline and escalation.
6. Booking confirmation: commit only after accepted commercial terms, required payment, signature and deliverable resource availability; generate written confirmation. Agreement signing triggers the secure workspace invitation automatically; workspace access must not itself confirm the booking.
7. Client Workspace: automatically send a secure invitation once all required agreement signatures are verified and committed. Use the approved design, independent state indicators, next action and outstanding To-dos, secure single-use magic links and revocable sessions, returning-client access, event/proposal/agreement/invoice/receipt links. If booking confirmation is pending, show its actual pending status and keep planning, backdrop selection and creative uploads locked. Defer unfinished gallery, customer-change and event-day features rather than show actionable broken controls.
8. Event details and planning: mandatory-field markers, conditional requirements, specific missing-field errors, saved drafts, submission, Admin review/approval/corrections and consistent status. Lock submission/backdrop selection/creative uploads until confirmed. Protect changes to accepted date, time and venue; do not silently mutate the booking.
9. Automated reminders: proposal follow-up, payment, signing and event-detail submission/review reminders using existing workers, completion conditions, configured deadlines, escalation, idempotent sends and cancellation of obsolete jobs. Inspect historical queues before controlled activation.
10. Campaigns: portal-generated campaign creation, reusable preloaded templates, HTML/template/text formats as supported, preview/test/send/schedule, eligible audience and consent/suppression handling, sender configuration, tracking and accepted-offer-to-invoice journey. Qualify real approved-recipient delivery and document provider tracking limits.

## Phase 1 automated handoffs

- Accepted valid proposal/campaign offer → create one correctly scoped invoice → queue/send invoice to the booking contact.
- Verified net payments meet the required minimum → create one agreement from the accepted immutable commercial snapshot and approved terms → queue/send agreement. Default threshold is at least 30% of the accepted total; approved schedules govern exceptions. Bookings fewer than 14 days before the event require full payment before confirmation; show the outstanding requirement clearly even if the agreement has already been issued after the 30% minimum.
- All required agreement signatures verified → create one eligible secure workspace invitation → queue/send it. Default requires the client signature only. Workspace access can show pending confirmation; planning remains locked until confirmation prerequisites are committed.
- Successful transitions close completed To-dos and create the next eligible action automatically. Failed generation/delivery creates an actionable Admin retry/review task; do not report delivery success from queue creation.
- Dispatch through existing communication workers only after the state transaction commits; use stable idempotency keys and recheck eligibility before sending. Repeated acceptance, payments, webhook deliveries and signatures cannot produce duplicate invoices, agreements or invitations.
- Refunds/chargebacks, revoked commercial versions, cancelled bookings and superseded agreements must invalidate obsolete next actions and queued messages. Preserve signed documents and posted financial history.
- Owner's latest instruction supersedes the earlier mandatory manual Admin invoice issuance/agreement sending steps. Admin retains visibility, authorized exception handling and safe retries. Booking confirmation requirements are unchanged.

## Phase 1 staging release gates

- Normal lead → proposal → invoice → verified payment/receipt → agreement signature → written confirmation → secure workspace → event details submission → Admin approval/correction.
- Campaign/template → controlled delivery → accepted offer/lead → invoice → same verified booking lifecycle.
- Wrong-owner/expired/replayed access denial, session revocation, required fields and mobile completion.
- Proposal acceptance automatically delivers one invoice; verified required payment automatically delivers one agreement; signing automatically delivers one secure workspace invitation. Verify the recipient and usable links for every handoff.
- Payment retries and repeated webhooks do not duplicate charges, invoices, receipts, agreements, invitations or tasks; refunds/chargebacks correctly recalculate the ledger.
- Required signatures and payment cannot be bypassed; confirmation rejects unavailable capacity. Minimal booking reservation/conflict checks remain in scope even though broader event operations are deferred.
- Actual reminders deliver to approved recipients, stop after completion and remain safe under retries. Historical queued messages must not be blindly resumed.
- Campaign preview, generated content and preloaded templates render correctly; accepted prices/discounts persist server-side and consent rules hold.
- Backup/restore, migration ordering, rollback plan and focused production smoke checks are documented. Report failures/skips explicitly; no production-ready claim from rendering or code presence alone.

## Phase 2: subsequent parity release

- Event-day files and gallery upload, storage, delivery and retention.
- Expanded event operations: staff workflows, field execution, equipment/backdrop checkout/return, operational readiness and calendar synchronization.
- Customer changes: full rescheduling, cancellation, credit wallet/100% credit redemption and amendments.
- Growth and integrations: inbox sync, Meta lead capture, broader providers, post-event reviews/referrals/anniversary/reactivation.
- Business intelligence: profitability, acquisition/package performance, resource utilization and owner drilldowns.
- Remaining self-service booking/pricing parity: complete unattended availability-to-checkout, automated travel rules and installment schedule management beyond the approved Phase 1 payment path.

Planning uploads needed to submit the creative brief remain part of the existing planning journey if enabled; verify their private access. This is distinct from the deferred event-day file/gallery release. Do not activate inactive backdrop seeds without usable assets and actual stock.

## Rollout

Implement Phase 1 within existing records/APIs/workers; derive logical lifecycle next actions across independent states. Deploy and qualify staging first. Produce an in-scope GO/NO-GO report and request owner approval for a concrete production release. Phase 2 development continues in staging while the verified Phase 1 production flow is in use. Phase 2 gaps no longer block Phase 1 unless they compromise an in-scope workflow, payment integrity, privacy or booking availability.
