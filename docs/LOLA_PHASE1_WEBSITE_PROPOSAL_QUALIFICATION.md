# Phase 1 website proposal handoff — qualification in progress

Owner requested closing Phase 1 and staging E2E before a production rollout. Production remains NO-GO.

Owner decision: skip automatic quote service-area configuration for now. Keep `BOOKING_WEBSITE_PROPOSAL_ENABLED` disabled in staging and production. Website inquiries continue through Admin review/send; the later invoice/payment/agreement/workspace handoffs remain the Phase 1 journey. This optional automatic proposal feature is deferred, not activated.

New scope: a website booking inquiry may create and send a proposal through a dedicated durable job. It uses the existing proposal/version, communication and automation ledgers; no schema migration. General staging lead automations remain paused for public inquiries; this named processor alone handles the new trigger.

`BOOKING_WEBSITE_PROPOSAL_ENABLED=true` is required on API (new jobs) and worker (processing). Default disabled. `BOOKING_AUTO_QUOTE_CITIES` explicitly limits service areas where catalogue prices include travel. Do not enable production until those commercial rules are approved. Custom packages/add-ons, missing facts, overnight timing, unapproved areas and changed catalogue prices create one HIGH Admin review task. No guessed custom prices or travel fees. No historical backfill. A manually prepared proposal prevents the automatic path from creating/sending a second document.

Eligibility and catalogue rows are rechecked during transactional preparation; the lead row serializes concurrent generation. Delivery uses a committed communication claim, not direct provider sending. Provider uncertainty or stale claims require operator review; known retryable failures reuse the same proposal/message. Cancelled events, changed commercial snapshots, changed recipients and disabled dispatch flags suppress sending. Accepted version, payment and agreement handoffs remain intact. A proposal/request does not reserve a date or confirm a booking.

Qualification pending:
- New disposable DB regressions: eight concurrent queues/processors, one proposal/message, manual-review routing, catalogue-change stop, disabled-worker stop.
- Hosted website → proposal → acceptance → invoice → Stripe TEST checkout → receipt/agreement → signing → written confirmation → fresh Client Workspace → planning submission/correction/approval.
- Private planning uploads/readbacks, cross-client denial, expired/revoked grants, mobile documents/payment/creative flow.
- Inbox receipt for mandatory handoffs; campaign browser flow; full in-scope permissions.
- Production deployment review, backup/restore, correct live Stripe/webhook/email configuration, rollback and owner approval.

Current local available suite: 640 tests, 628 passed, zero failed, 12 conditional DB skips. These skips are not passes. The dedicated database test must pass in CI before activation. Existing hosted evidence remains in LOLA_PHASE1_RELEASE_READINESS_2026-10-10.md; it does not qualify this new trigger.

## Disposable database qualification

GitHub run `38083449643`, job `114304931084`, commit `2cc91ae1b04fe501b7630ad96162253d56eeefd3`: PASS. Full enabled database suite: 657 passed, zero failed, zero skipped. V1.1 database lifecycle, frontend build and CI browser journey passed. The new concurrent website outbox regression passed. CI delivery is development/simulated, not Microsoft inbox proof.

Qualification found and fixed JSONB key-order comparison, JSON array parameter serialization and proposal delivery state mapping defects. These defects were discovered before flag activation; automatic quoting remains disabled. No schema migration or production changes.
