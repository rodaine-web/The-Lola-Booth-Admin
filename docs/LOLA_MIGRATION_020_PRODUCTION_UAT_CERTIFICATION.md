# LOLA Migration 020 Production UAT Certification

Date: 2026-09-14

## Local Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Branch | PASS | `main` |
| Latest commit before this certification commit | PASS | `1caa134 fix: correct Microsoft email health status` |
| Test suite | PASS | `npm test` completed with 142 passing tests, 0 failures |
| Production build | PASS | `npm run build` completed successfully with Vite production output |
| Diff whitespace | PASS | `git diff --check` returned no issues |
| Secret scan | PASS WITH WARNING | No committed live secrets found. Matches were placeholders, historical docs, and test assertions. |

## Migration 020

| Item | Status | Evidence | Blocker? |
| --- | --- | --- | --- |
| Repo migration | PASS | `server/migrations/020_customer_documents_iam_branding.sql` | No |
| Proposal source/type | PASS | Adds `proposal_source` with `GENERATED` / `UPLOADED` check | No |
| Uploaded proposal metadata/versioning | PASS | Adds external document storage, filename, MIME type, size, uploaded-at/by fields; service creates versions | No |
| Email template keys | PASS | Seeds `BOOKING_INQUIRY_CONFIRMATION`, `CONTACT_CONFIRMATION`, `PROPOSAL_DELIVERY`, `INVOICE_DELIVERY`, `PAYMENT_CONFIRMATION`, `GENERIC` | No |
| User profile/invitation fields | PASS | Adds first/last name, phone, business role, invitation status, invited/disabled timestamps | No |
| SUPER_ADMIN | PASS | Adds `SUPER_ADMIN` role and role permissions | No |
| User permissions | PASS | Adds user, invitation, password reset, proposal upload, communication permissions | No |
| One-time setup token | PASS | Adds `user_account_tokens`; auth setup endpoint marks tokens used and rejects expired/used tokens | No |
| Production apply | BLOCKED | `npm run db:migrate` used local `.env` and attempted `localhost:5432`; Railway CLI/config is not present in this workspace | Yes |

REPO MIGRATION: `020_customer_documents_iam_branding.sql`  
APPLIED MIGRATION: BLOCKED, not verifiable from this workspace  
STATUS: CODE READY, RAILWAY APPLY REQUIRED

## Live Evidence

| Area | Status | Live Evidence | Blocker? |
| --- | --- | --- | --- |
| API health | PASS | `GET https://api.thelolabooth.com/api/health` returned HTTP 200 and `{"ok":true,"name":"LOLA Admin API"}` | No |
| CORS allowlist | PASS | `Origin: https://admin.thelolabooth.com` returned `access-control-allow-origin: https://admin.thelolabooth.com` | No |
| CORS wildcard rejection | PASS | `Origin: https://evil.example` returned HTTP 403 `CORS_REJECTED` | No |
| Admin deployment | PASS WITH WARNING | After push, live HTML references new bundle `/assets/index-z3at7RiJ.js` | Confirm next build after final login-title cleanup |
| Credential fix live | PASS | New live bundle has no `owner@lolabooths.com`, `owner@thelolabooth.com`, or `LolaAdmin!2026` strings | No |
| Admin branding live | PASS WITH WARNING | New live bundle has `Admin Portal` and no `Private operations`; login/title copy was further cleaned up locally after this check | Redeploy latest cleanup |
| Email DNS SPF | FAIL | `dig TXT thelolabooth.com` returned no SPF TXT record | Yes |
| Email DNS DKIM | FAIL | Common `selector1` / `selector2` DKIM TXT and CNAME lookups returned no records | Yes |
| Email DNS DMARC | FAIL | `dig TXT _dmarc.thelolabooth.com` returned no DMARC record | Yes |
| Email DNS MX | FAIL | `dig MX thelolabooth.com` returned no MX records | Yes |

## Local Fixes Added During Certification

- Added `POST /api/auth/setup-password` for invitation/password reset token redemption.
- Added `POST /api/users/:id/reactivate`.
- Added `POST /api/users/:id/resend-invitation`.
- Added frontend `/setup-password` route.
- Updated the migration runner to execute each migration inside a single checked-out database client transaction.
- Re-ran `npm test` and `npm run build` after the fixes; both passed.

## Launch Matrix

| Area | Status | Live Evidence | Blocker? |
| --- | --- | --- | --- |
| Migration 020 | BLOCKED | Repo migration verified; Railway apply blocked by absent production DB/CLI context | Yes |
| Admin deployment | PASS WITH WARNING | Live admin updated to bundle `/assets/index-z3at7RiJ.js` after push | Redeploy final cleanup |
| API deployment | PASS | Live health endpoint HTTP 200 | No |
| Credential fix | PASS | New live bundle has no default owner email/password markers | No |
| Owner login | MANUAL VERIFICATION REQUIRED | Requires authorized production session | Yes |
| Super Admin login | MANUAL VERIFICATION REQUIRED | Requires authorized production session/account | Yes |
| Super Admin user creation | PASS WITH WARNING | Server routes and tests pass locally; production UAT pending | Yes |
| Invitation flow | PASS WITH WARNING | Token creation, resend, setup, and single-use behavior implemented; live email/UAT pending | Yes |
| Roles | PASS WITH WARNING | Server-side assignment constraints verified locally | Production spot check pending |
| Privileges | PASS WITH WARNING | Granular permissions and protected routes verified locally | Production spot check pending |
| Privilege escalation protection | PASS WITH WARNING | Root/owner/admin escalation blocks verified locally | Production spot check pending |
| Standard proposal | PASS WITH WARNING | Local implementation verified by tests | Production UAT pending |
| Bespoke proposal | PASS WITH WARNING | Custom sections/services/items implemented | Production UAT pending |
| Uploaded proposal | PASS WITH WARNING | Storage-backed uploaded proposal path implemented | Production storage UAT pending |
| Proposal PDF | PASS WITH WARNING | PDF generator updated to screenshot-derived system | Visual production sample pending |
| Proposal email | PASS WITH WARNING | Branded HTML shell implemented | Controlled inbox/mobile render pending |
| Invoice public page | PASS WITH WARNING | Public token routes and payment session path implemented | Production QA invoice pending |
| Invoice PDF | PASS WITH WARNING | Two-page invoice PDF implemented | Visual production sample pending |
| Invoice QR | PASS WITH WARNING | QR uses stable public invoice URL in code | Production PDF decode pending |
| Invoice email | PASS WITH WARNING | Branded invoice delivery email implemented | Controlled inbox/mobile render pending |
| Booking email | PASS WITH WARNING | Booking confirmation template/render path implemented | Controlled render/send pending |
| Contact email | PASS WITH WARNING | Contact confirmation template/render path implemented | Controlled render/send pending |
| Generic email | PASS WITH WARNING | Manual branded composer/send route implemented | Controlled send pending |
| Communication history | PASS WITH WARNING | Send paths record communications/email messages | Production records pending |
| Stripe Checkout | MANUAL VERIFICATION REQUIRED | Code/test coverage exists | Production test-mode checkout pending |
| Stripe webhook | PASS WITH WARNING | Required events handled in `payment-service` | Deployed webhook smoke pending |
| Stripe idempotency | PASS WITH WARNING | Tests cover duplicate webhook protection | Deployed replay pending |
| Failed payment | PASS WITH WARNING | Tests cover failed payment handling | Deployed decline smoke pending |
| Receipt | PASS WITH WARNING | Receipt generation exists | Production payment receipt pending |
| Worker | MANUAL VERIFICATION REQUIRED | Worker code exists | Railway worker heartbeat/log access required |
| Scheduled communication | MANUAL VERIFICATION REQUIRED | Worker send path exists | Production scheduled email pending |
| System Health | MANUAL VERIFICATION REQUIRED | Protected route exists | Authenticated production check required |
| Storage | MANUAL VERIFICATION REQUIRED | Local abstraction exists | Railway volume persistence check required |
| Backups | BLOCKED | No Railway account/CLI evidence in workspace | Yes |
| Restore drill | BLOCKED | Requires temporary non-production database | Yes |
| SPF | FAIL | No root TXT SPF record returned | Yes |
| DKIM | FAIL | No common DKIM TXT/CNAME selectors returned | Yes |
| DMARC | FAIL | No `_dmarc` TXT record returned | Yes |
| Admin branding | PASS WITH WARNING | Sidebar source uses only `Admin Portal`; live bundle has no `Private operations`; final login/title cleanup pending redeploy | Redeploy final cleanup |

## Final Verdict

NO-GO

Remaining launch blockers:

- Apply the final login/title branding cleanup deployment and confirm the newest live bundle.
- Apply migration 020 to Railway PostgreSQL and verify `schema_migrations`.
- Complete authenticated Owner/Super Admin UAT.
- Complete controlled inbox email UAT after SPF/DKIM/DMARC/MX records are configured.
- Verify Railway worker, storage persistence, backups, and restore drill.
- Complete Stripe TEST-mode checkout/webhook/idempotency/failed-payment UAT against the deployed API.
