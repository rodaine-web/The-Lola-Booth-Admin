# Automatic reminder qualification

The previous worker always paused staging automations, while reminder creation skipped every NODE_ENV=production server. Those checks have been corrected. The production automation flag remains an explicit deployment setting; no production settings are changed by this sprint.

For staging API and worker, set STAGING_AUTOMATIONS_ENABLED=true, STAGING_EMAIL_ENABLED=true, STAGING_EMAIL_ALLOWLIST to the existing approved QA mailbox, and STAGING_AUTOMATIONS_SINCE to a fresh UTC timestamp. All four are required. Staging generates reminders only for fresh QA-owned events/invoices and dispatches only scheduled emails created after that timestamp to the allowlist. Historical automation jobs, inquiry recovery and external integration processing stay paused during this controlled qualification. Explicit email qualification jobs continue to work when automatic processing is paused.

Create a fresh synthetic confirmed event within 24 hours and a fresh sent overdue invoice with a positive outstanding balance. Verify exactly one reminder each after the worker tick, communication/provider history, mailbox receipt and no second delivery on subsequent ticks. Pay/void the invoice or cancel/complete/reschedule the event before dispatch to verify cancellation. Idempotency keys, claim locking and unknown-delivery outcome review are retained. Worker ticks cannot overlap.

After qualification, pause staging automations or move the cutoff forward for each new test run. Do not enable the production worker until its recipient, payment mode, deployment and reminder behavior have been separately checked. The automatic-reminder API preview reports PAUSED when a current worker heartbeat has jobsPaused=true.

API reads, images, health, authentication writes and other writes now use independent bounded rate-limit stores. Navigation no longer drains booking/login quotas. No route authentication is bypassed.

Only CONFIRMED, PREPARING, READY and IN_PROGRESS events qualify for the 24-hour event reminder. Tentative, inquiry and contract/deposit-pending events never enter this queue.
