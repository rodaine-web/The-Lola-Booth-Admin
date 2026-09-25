# Controlled Microsoft email qualification for staging

Run only after staging is separately authorized. Keep the development provider active during this local completion pass. Hosted Stripe remains deferred until staging.

Use only the approved owner inboxes: funmimasha@gmail.com and olawandeadams@gmail.com. Prefix subjects `[LOLA STAGING QA]`. Use synthetic client/event records, staging CTA destinations, test Stripe, and one unique test-run ID. Do not select existing customer records.

| Message | Browser action | Subject to capture | Template to capture | CTA expectation |
|---|---|---|---|---|
| Contact acknowledgment | Submit staging contact form once | Actual rendered acknowledgment subject | Actual public inquiry confirmation template/key | Staging website, valid links |
| Booking acknowledgment | Submit staging booking inquiry once | Actual rendered booking acknowledgment | Actual inquiry acknowledgment template/key | Staging website, no promise of confirmed booking |
| Proposal delivery | Preview then send synthetic proposal | Actual proposal subject/number | Actual proposal delivery key/version | Staging public proposal token |
| Invoice delivery | Send related synthetic invoice | Actual invoice subject/number | Actual invoice delivery key/version | Staging `/pay/{token}`, matching QR |
| Payment confirmation | Complete separately authorized Stripe-hosted TEST payment | Actual receipt/payment subject | Actual receipt/confirmation template/key | Staging invoice/receipt; reconciled amount |
| Generic email | Compose, preview, send once | `[LOLA STAGING QA] Generic email — RUN_ID` | Manual branded email | Staging URL, if supplied |

For each row record: run ID, UTC time, subject, recipient, template ID/key/version, CTA destination, provider result and reference, communication ID/status, sender/reply-to, and owner inbox receipt time. Save desktop/mobile screenshots of the received message. Confirm images, line breaks, readable dates/currency, no unresolved tokens, CTA behavior and no horizontal overflow. Provider acceptance alone is not inbox delivery evidence.

Verify each send produces one communication record and one inbox message. For controlled failure tests use a staging-only provider stub; do not intentionally resend messages with unknown provider outcomes. Check Microsoft delivery history before authorizing a retry. Record failures separately from delivery proof.

Never place credentials, full provider access tokens or customer data in screenshots/reports. Leave external SMS, PayPal and marketing dispatch disabled. This checklist does not authorize creating staging or sending messages now.
