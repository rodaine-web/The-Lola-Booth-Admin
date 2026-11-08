# Agreement revisions and recipient editing

Sent agreements previously exposed only revocation. Admin can now choose Edit and replace agreement, revise the title, service terms and recipient name/email/company/phone/address, then Save and send revised agreement.

The replacement is a new numbered draft. Replacing an unsigned issued agreement revokes its old signing link atomically with draft creation; old terms, recipients and delivery history remain available. A signed original is immutable and remains in history when a new revision is created. Draft recipient overrides are preserved when issuing, included in the hashed snapshot and PDF, used for delivery, and enforced for the signer email. These edits do not alter the master client profile or historical documents. Existing provider idempotency prevents duplicate revision emails.

No schema migration or changes to payment prerequisites. Invalid recipient input and unauthorized revision requests are rejected.

Validation: 725 tests passed, 34 conditional skips, zero failures; production build passed. Real disposable PostgreSQL service and HTTP tests cover replacement, old-link revocation, revised recipient delivery/signing, unchanged client profile, delivery idempotency and signed history preservation. Local browser journey created a replacement, edited all recipient fields and terms, and used Save and send revised agreement with development-only email; no external customer email was sent.
