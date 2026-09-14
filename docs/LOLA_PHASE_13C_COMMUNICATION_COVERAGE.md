# LOLA Phase 13C Communication Coverage

## Coverage Matrix

| Communication | Trigger | Channel | Template Key | Send Mode | Provider | Status | Hardcoded Fallback? | Automated? | Stop Condition |
|---|---|---|---|---|---|---|---|---|---|
| New inquiry customer confirmation | Public inquiry | Email | `public_inquiry_customer_confirmation` | `AUTOMATIC` | Email adapter | Template-rendered | Yes, logged | Yes | Duplicate lead identity/idempotency |
| New inquiry owner notification | Public inquiry | Email | `public_inquiry_owner_notification` | `AUTOMATIC` | Email adapter | Template-rendered | Yes, logged | Yes | Duplicate lead identity/idempotency |
| Website lead acknowledgement | `LEAD_CREATED` | Email | `email_new_inquiry_ack` / legacy `NEW_INQUIRY_ACKNOWLEDGEMENT` | Template default | Email adapter | Template-rendered | No | Yes | None |
| Lead follow-up | Admin/automation | Email | `lead_follow_up_general` | `REVIEW_BEFORE_SEND` | Email adapter | Draft first | No | Optional | Lead won/lost/manual pause |
| Proposal sent email | Proposal send | Email | `proposal_sent` | `SEND_NOW` | Email adapter | Template-rendered | Yes, logged | User action | Proposal accepted/declined/expired/cancelled |
| Proposal reminder | `PROPOSAL_SENT` | Email | `proposal_reminder` | Template default | Email adapter | Template-rendered | No | Yes | Accepted, declined, expired, cancelled |
| Invoice sent email | Invoice send | Email | `deposit_invoice_sent` | `SEND_NOW` | Email adapter | Template-rendered | Yes, logged | User action | Void/cancelled/paid |
| Balance reminder | `INVOICE_DUE_SOON` | Email | `balance_due_reminder` | Template default | Email adapter | Template-rendered | No | Yes | Balance <= 0, void, cancelled |
| Booking confirmation | Booking confirmation | Email | `booking_confirmation` | Template default | Email adapter | Template-ready | No | Optional | Cancelled |
| Event week reminder | `EVENT_UPCOMING` | Email | `event_week_reminder` | Template default | Email adapter | Template-ready | No | Yes | Cancelled, postponed, completed |
| Staff brief | Admin staff brief send | Email | `staff_brief_email` | `AUTOMATIC` | Email adapter | Template-rendered | Yes, logged | User action | Assignment released/cancelled event |
| Gallery delivery | Admin gallery delivery send | Email | `gallery_delivery_email` | `AUTOMATIC` | Email adapter | Template-rendered | Yes, logged | User action | Archived/revoked |
| Review request | `EVENT_COMPLETED` | Email | `review_request` | Template default | Email adapter | Template-ready | No | Optional | Missing review URL/cancelled |
| Creative proof ready | Approval request | Email | `creative_proof_ready` | `REVIEW_BEFORE_SEND` | Email adapter | Draft first | No | User action | Approved, cancelled, superseded |
| Creative approved notice | Public approval response | Internal | `creative_proof_approved` | `AUTOMATIC` | In-app/internal | Template-ready | No | Yes | Repeat submission no-op |
| Creative revision requested | Public approval response | Internal | `creative_revision_requested` | `AUTOMATIC` | In-app/internal | Template-ready | No | Yes | Superseded/cancelled |
| SMS inquiry acknowledgement | Future SMS automation | SMS | `sms_new_inquiry_ack` | `CREATE_DRAFT` | SMS adapter | Draft/preview only | No | Draft only | SMS provider and consent required |
| Notification email | Notification email preference | Email | `notification_email_default` | `AUTOMATIC` | Email adapter | Template-rendered | Yes, logged | Optional | User email preference |

## Remaining Hardcoded Communications

- Technical/provider messages remain hardcoded intentionally: auth errors, provider errors, system health summaries, webhook diagnostics, validation messages, and test fixtures.
- PDF/DOCX document layout text remains in `document-service.js`; proposal/invoice document template scaffolds now select and store editable sections or metadata, while financial calculations remain service-owned.
- In-app notification titles and bodies remain system messages. Optional email delivery of notifications now uses `notification_email_default`.

## Production Smoke Test

1. Create a test client.
2. Create a test event.
3. Generate a proposal using `custom_brand_activation_proposal`.
4. Confirm editable proposal sections were generated.
5. Send proposal email.
6. Open the public proposal link.
7. Accept the proposal.
8. Generate an invoice with `corporate_invoice` or `brand_activation_invoice`.
9. Send invoice email.
10. Schedule a reminder communication.
11. Confirm the automation worker processes the scheduled communication without the manual admin button.
12. Create a creative approval.
13. Send the approval request and review the generated draft.
14. Open the public approval link.
15. Request changes.
16. Create a revised approval version.
17. Open the revised link and approve.
18. Confirm activity timeline entries exist for sends, schedules, approval viewed, changes requested, and approval approved.
19. Confirm audit logs and fallback events have no unexpected production warnings.
20. Confirm no duplicate messages are sent after repeat clicks, worker restarts, or manual retry after provider success.
21. If SMS is configured, send one test SMS only after verifying server-side credentials and consent.

## Go / No-Go

Current Phase 13C status is **GO with SMS disabled** for email/template/scheduled/approval production readiness, assuming the production worker process is deployed and monitored. SMS remains **NO-GO for live sending** until a real provider adapter, credentials, and consent enforcement are configured and smoke-tested.
