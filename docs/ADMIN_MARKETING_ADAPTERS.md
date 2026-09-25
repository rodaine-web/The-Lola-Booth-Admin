# Disabled-by-default marketing adapters

GA4, Meta/Instagram and TikTok have backend-only enable flags and credentials. Local payload-test buttons validate and record synthetic payloads without dispatch. No external events are required for this pass.

Approved CRM lifecycle mapping uses generate_lead, proposal_sent, proposal_accepted, booking_created, booking_confirmed, invoice_issued, payment_completed and event_completed. Every provider event derives a stable ID from the durable job idempotency key. Payloads exclude names, email, phone, IP and arbitrary URLs. Only provider click/client identifiers, vetted campaign tokens and numeric monetary values/currency are considered. Missing matching attribution fails closed. Meta email/phone matching is deliberately not enabled.

Explicit flags: GA4_ENABLED=false, META_EVENTS_ENABLED=false, TIKTOK_EVENTS_ENABLED=false. Credentials belong only in backend environment configuration. Meta also requires an explicitly selected supported META_GRAPH_VERSION. Provider account approval, attribution/reporting and hosted payload acceptance still require staging qualification.

Queue vocabulary maps PENDING/RETRY to QUEUED (attempt count distinguishes retry), COMPLETED to SUCCEEDED; PROCESSING and FAILED are stored directly. Each dispatch attempt records provider, lifecycle event, attempt, mode, result, sanitized HTTP/error summary and timestamp. Local payload tests, mock acceptance and provider acceptance are separate evidence.

Provider timeouts and stale external claims are held FAILED with PROVIDER_OUTCOME_UNKNOWN. They are not blindly retried: GA4 cannot guarantee exactly-once collection after an ambiguous response. Meta/TikTok rate-limit rejection may retry with the same event ID. Three attempts maximum. Local mocks may recover stale jobs safely using their dispatch ledger. This prioritizes avoiding duplicate/billable events over pretending uncertain delivery succeeded.

References checked for implementation:

- [GA4 Measurement Protocol reference](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference)
- [GA4 validation endpoint limitations](https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events)
- [Meta official Conversions API tag source](https://github.com/facebookincubator/ConversionsAPI-Tag-for-GoogleTagManager/blob/main/template.tpl)
- [TikTok official Events payload helper](https://business-api.tiktok.com/payload_helper/)

An HTTP success from GA4 indicates request receipt, not verified ingestion/reporting. The UI labels this as HTTP acceptance; no credential-only “connected” claim is made.
