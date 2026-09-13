# LOLA Admin Phase 11 Product Audit

Phase 11 answer: LOLA Admin is **GO WITH CONDITIONS**. The product is broadly functional, but production still depends on real environment secrets, provider credentials, email domain verification, storage choice, backups, HTTPS hosting, physical QR validation, and a running automation worker.

## Executive Summary

- Security readiness: partial. RBAC is enforced on sensitive API routes, public token routes are scoped, and request IDs are returned in errors. Production secrets, demo-user removal, and MFA policy remain launch responsibilities.
- Data safety: partial. PostgreSQL migrations are tracked and repeatable, money fields are numeric, durable jobs use row locks, and audit logs exist. Backup/restore must be tested before real launch.
- Integration readiness: partial. Stripe, PayPal, email, SMS, social, and storage checks honestly report disconnected or misconfigured states when credentials/adapters are absent.
- Operational readiness: strong for admin/event workflows, partial for provider-dependent workflows and physical device validation.
- Deployment readiness: partial. `npm run build`, `npm run db:migrate`, `npm start`, `npm run worker`, and `npm run env:check` are defined, but production infrastructure is not configured inside this repo.

## Audit Matrix

| Module | Status | Production Ready | Blockers | Risks | Recommended Fix | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Authentication | Working JWT and refresh flow | Partial | Production secret rotation and MFA policy not active | Weak secrets or long-lived sessions in production | Use unique JWT/refresh secrets, HTTPS cookies where deployed, add MFA before broad staff access | P0 |
| Users/RBAC | Role-permission model enforced in API | Partial | Need real owner/admin user review before launch | Overbroad permissions if seeded users remain | Remove demo users, verify roles, audit attendant access paths | P0 |
| Dashboard | Operational metrics, attention lists, ranges | Yes | None blocking | Query load as records grow | Add indexes from real usage and monitor slow queries | P2 |
| Calendar | Operational calendar and filters | Yes | None blocking | Limited drag/drop scheduling | Launch as read/inspect calendar; add advanced scheduling later | P3 |
| Leads | CRUD, intake, conversion, source data | Yes | Provider credentials absent for social sync | Incomplete mappings can create review queue | Keep webhook review queue monitored | P1 |
| Clients | CRUD and relationship links | Yes | None blocking | Duplicate hygiene is manual | Add duplicate merge later | P2 |
| Proposals | Branded create/send/accept/PDF/DOCX | Yes | Public HTTPS URL needed | Broken public links if PUBLIC_BASE_URL is wrong | Validate production URL before go-live | P0 |
| Invoices | Branded create/send/public view/PDF | Yes | Payment provider readiness | Misstated payable options if env is wrong | Use system health before enabling online payment | P0 |
| Payments | Manual and provider session foundation | Partial | Live Stripe/PayPal verification absent | Money correctness/webhook mismatch | Verify test-mode sessions and webhooks before live mode | P0 |
| Refunds | Manual refund workflow | Partial | Provider refunds are intentionally blocked | Manual-only refund operations | Keep provider refunds disabled until adapters are verified | P1 |
| Events | CRUD, assignments, readiness, detail ops | Yes | None blocking | Operational state depends on staff discipline | Use live board and alerts on event days | P1 |
| Staff | Profiles, assignment, acknowledgment, briefs | Partial | Real email adapter absent | Briefs do not deliver externally in dev mode | Configure email provider and domain auth | P0 |
| Equipment | Inventory, assignments, lifecycle, QR labels | Yes | Printed QR field test still needed | Physical label damage or scan mismatch | Print test labels and scan with iOS/Android/browser | P1 |
| Tasks | CRUD and dashboard surfacing | Yes | None blocking | No advanced recurrence | Add recurring tasks later | P3 |
| Files | Metadata and local storage provider | Partial | S3-compatible storage not implemented | Local disk backup and scaling burden | Decide local persistent volume vs S3 adapter before production | P1 |
| Communications | Email logs, templates, automations | Partial | Production adapter absent | Dev adapter records success without external delivery | Configure one provider, then test domain/authentication | P0 |
| Automations | Durable jobs, worker, retry/cancel UI | Partial | Worker process must be deployed | Jobs stop if worker is not running | Deploy `npm run worker` with process supervision | P0 |
| Website CMS | Content/media/site settings/public API | Yes | Public website must consume API correctly | Cache invalidation and media URLs | Follow website integration doc and smoke publish flow | P1 |
| Media Library | Upload and metadata management | Partial | Storage provider decision | Local storage backup risk | Use production storage plan and media retention rules | P1 |
| Notifications | Center, preferences, mandatory critical alerts | Yes | Email delivery depends on provider | Users can mute noncritical categories | Keep critical alerts mandatory | P1 |
| Attendant Experience | Mobile event view, checklist, incidents, scan | Partial | Camera support varies by browser | Offline conflicts need review | Manual entry fallback and sync conflict notifications remain required | P1 |
| Offline Replay | Idempotent actions and Blob queue limits | Partial | File upload replay endpoints still depend on upload surfaces | IndexedDB unavailable on some browsers | Use IndexedDB where available, retain manual resync path | P1 |
| QR Equipment | Standards-compliant QR generation and scan route | Partial | Physical device scan validation required | Printed size/contrast issues | Validate labels with iOS, Android, browser scanner, and a standard QR reader | P1 |
| Gallery Delivery | Secure token delivery page and emails | Yes | Production email adapter absent | Wrong gallery URL entered manually | Verify links and expiration before sending | P1 |
| Audit Logs | API audit writes for important changes | Yes | Retention policy must be operationalized | Large table growth | Use configured retention days and backup policy | P2 |
| Integrations | Honest status pages and webhook foundations | Partial | Provider secrets/OAuth not fully configured | Disconnected integrations can be mistaken as live | Keep health page as source of truth | P1 |
| Settings | Business, brand, payments, notifications | Yes | Production env outside UI | Owner can misconfigure provider toggles | Use health checks and launch checklist | P1 |

## Placeholder Review

| Occurrence Type | Classification | Action |
| --- | --- | --- |
| Input placeholders in React forms | Intentional UI copy | Keep |
| Phase handoff docs saying foundation | Historical documentation | Keep and supersede with this audit |
| Storage S3-compatible provider throwing foundation error | Production blocker if `STORAGE_PROVIDER=s3` | Keep honest error; implement S3 before selecting s3 |
| Development email adapter | Production blocker | Keep for local dev; configure a real adapter before production |
| QR matrix foundation | Production blocker, closed in Phase 11 | Replaced with `qrcode` package |
| Camera scanner foundation | Production blocker, closed in Phase 11 | Replaced with real `BarcodeDetector` path and manual fallback |
| Provider refund not configured | Future scope with operational impact | Keep disabled until Stripe/PayPal refund adapters are verified |
| Conversion postbacks | Future scope | Keep disabled; not required for launch |

## P0 Launch Checklist

- Set strong production `JWT_SECRET` and `INTEGRATION_SECRET_KEY`.
- Serve admin and public URLs over HTTPS.
- Configure one real email provider and verify SPF, DKIM, DMARC, and from-address ownership.
- Deploy the API and the `npm run worker` process under supervision.
- Run database migrations and seed only the intended root/admin account.
- Verify Stripe/PayPal in test mode before enabling provider toggles.
- Confirm backups restore into a clean database.
- Print and scan QR labels on iOS Camera, Android camera, browser scanner, and a standard QR reader.

## P1 Risks

- Local storage is acceptable for development only unless backed by a persistent volume and backup policy.
- Provider refunds remain manual-only until Stripe/PayPal refund adapters are completed and reconciled.
- Offline file retry depends on browser IndexedDB Blob support; unsupported devices need manual upload after reconnect.
- Social lead integrations need provider-side OAuth, webhook verification, page/form discovery, and field mapping before being treated as connected.

## P2 Follow-Ups

- Add duplicate merge tooling for leads/clients.
- Add slow-query monitoring after production traffic exists.
- Add richer accessibility testing with a browser automation tool.
- Add recurring task templates.

## RBAC Test Matrix

| Role | Must Access | Must Not Access |
| --- | --- | --- |
| OWNER | All modules, settings, audit, health, job retry | Nothing by role policy |
| ADMIN | Operations, sales, finance, website, integrations | Owner-only policy changes if added later |
| SALES | Leads, clients, proposals, communications | System settings, audit log, unrelated attendant routes |
| EVENT_MANAGER | Events, calendar, live board, staff, equipment, incidents | Payment provider settings and user security controls |
| ATTENDANT | Assigned events, checklist, scanner, incidents | Finance, settings, users, audit logs, unassigned event details |

## Release Checklist

- [ ] production database ready
- [ ] backup tested
- [ ] restore tested
- [ ] production secrets configured
- [ ] admin domain configured
- [ ] API domain configured
- [ ] worker deployed
- [ ] email configured
- [ ] payment configured
- [ ] file storage configured
- [ ] public website connected
- [ ] CORS verified
- [ ] migrations applied
- [ ] health checks green
- [ ] QR tested on real phone
- [ ] attendant mobile tested
- [ ] RBAC tested
- [ ] production owner user created securely
- [ ] demo data absent
- [ ] privacy/terms links valid
- [ ] rollback plan documented

## Final Recommendation

**GO WITH CONDITIONS.** The application code now exposes the right operational controls and honest health signals. Do not treat it as fully production ready until the P0 checklist is completed in the deployment environment and System Health is green or intentionally accepted by the owner.
