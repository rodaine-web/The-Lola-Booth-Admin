# Creative production and approval

Status: local implementation, staging gates unqualified.

Design & Creative reuses creative_approvals and creative_approval_revisions. Operators upload an event-owned private PNG/JPG/PDF or use an HTTPS proof URL, create a draft and queue review through the existing communications worker. New revisions increment the version under a row lock; previous approved revisions remain unchanged.

Public review requires a live grant, unexpired proof, current event/client ownership and a noncancelled/noncompleted event. Responses carry the displayed version, client name and the event client's email. Change requests require comments. A stale version cannot be approved. Repeated approval of the same version is idempotent. Approval captures response identity, time, version and audit request metadata, records event activity and notifies internal users.

Migration 048 protects approved revision rows against update/delete. The approved version is visible in the admin history and can be downloaded separately from newer drafts. Revoking public access preserves approved history. Queued proof sends are rechecked against their current approval communication, expiry and status.

Readiness uses current proof status instead of a manually typed APPROVED flag. A new draft makes creative readiness incomplete. Required components are derived separately for each selected experience. Proof metadata explicitly identifies its experience/component coverage; only a current approved version completes those components. Legacy generic proofs cannot satisfy every component. Combined proof coverage must be selected explicitly. Local policy tests pass; actual staging approval/mobile/permissions remain required.

Required staging sequence: upload V1 → queue/open → request changes with comment → upload V2 → reject stale V1 response → approve V2 → replay response → reject mutation of approved revision → upload V3 → retain production V2 but make current readiness incomplete → revoke access. Inspect audit, activities, notifications and provider delivery. Run cross-client/cancelled-event/expired-link denial checks.
