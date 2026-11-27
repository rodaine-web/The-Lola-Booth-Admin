# Keepsakes Admin fulfillment and customer milestones — staging

Paid retail orders now appear in a pending-fulfillment view with actionable production controls on each order. The Fulfillment tab exposes production and editing work independently of product configuration. Pending counts exclude unpaid checkouts; operations permissions permit fulfillment without granting integration or refund permissions.

The in-house flow is artwork/stock/capacity approval → production → fulfilled and packed → reviewed Shippo labels → carrier handoff/shipped → carrier-confirmed delivery. A shared parcel cannot be marked shipped until every covered item is packed. Existing Shippo tracking is reused, with no manual replacement of its tracking identity. Label creation alone does not mark dispatch. The worker no longer reprocesses dispatched in-house jobs as new production.

Shippo transaction tracking is polled using the authenticated test API about every 15 minutes and can be refreshed from Admin. All expected parcels must have confirmed delivery before the covered item completes. Completed delivery does not regress on a stale carrier response. A delivered order generates a deduplicated in-app Admin notification linking to the order; payment and shipment milestones also create Admin notices.

Three durable email milestones are independent of the current order label: order confirmation, order shipped, and order delivered. Each sends once through the existing transactional communications system, preserves failure/unknown-outcome handling, and keeps confirmation before dispatch and dispatch before delivery. Messages include products, total, a secure order link, and shipment tracking where applicable. Packing does not send a shipped message. Existing terminal refund/cancellation/failure updates are retained. Staging only sends to the existing approved test inbox allowlist and does not create marketing consent. Order details expose email acceptance/failure status and explain blocked test recipients.

Shippo's documented Sandbox tracking tokens support an explicit Admin-only simulation on TEST labels after packing. The simulation retrieves a real Shippo test tracking response, records that it is simulated, and exercises the same delivery reducer. It cannot run on a live order, bypass production approval, or turn test labels into live postage.

Validation: production build; eight focused unit/database/desktop/mobile checks; a further database regression verifies that a worker pass preserves shipped in-house jobs. Tests cover exact state transitions, shared-package readiness, partial delivery, milestone ordering, deduplication, approved recipients, no marketing changes, and roles. Full staging CI is required before merge. Provider preflight confirmed HTTP 200, test=true, carrier=shippo, tracking_status=DELIVERED for Shippo's documented test tracking endpoint. Hosted release and synthetic-order/email checks are recorded separately after deployment.

References: https://docs.goshippo.com/tracking/tracking (transaction tracking and Sandbox tracking tokens).

Production is unchanged. No existing customer Gallery publication, live charge, live label or manufacturing is performed by this change.
