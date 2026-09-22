# LOLA resumption status — September 21, 2026

## Current decision

Local document/email fixes are verified. Production remains NO-GO pending migration recovery and the remaining launch checks. This report supersedes earlier assumptions that only migration 020 needed verification.

## Completed locally

Proposal PDF pagination preserves every section and bullet. Invoice pagination preserves rows and terms and displays discount/tax and zero balances correctly. The invoice QR is decodable from the generated PDF. Email previews use PNG feature icons, readable hero contrast, responsive layout, and consistent public-document URLs. The QA generator now captures full pages, renders the actual PDF page count, validates images/overflow, and records QR decoding.

Validation: `npm run check` passed all 146 tests and the Vite production build. `git diff --check` passed. Five email templates passed at 1000px and 390px; screenshots and seven PDF-page renders are in `qa-output/screenshots`.

## Live read-only findings

| Area | Evidence | Result |
| --- | --- | --- |
| Public website, admin, API | All three returned HTTP 200 on September 21 | Reachable |
| Existing Owner session | Chrome showed LOLA Owner in the authenticated admin shell | Session available; complete role/login lifecycle still untested |
| System Health | Authenticated `/system/health` displayed “Something went wrong. Please try again.” | Failing; generic error alone does not identify root cause |
| Database migrations | Railway `schema_migrations` table has 15 rows, 001–015; final entry `015_phase_11_health_and_notification_edges.sql`, applied September 13 | **016–020 missing** |
| Worker | Railway service Online; `worker_heartbeats` shows `automation-worker`, `HEALTHY`, last update displayed as September 21 15:09:41 | Process heartbeat evidence available; scheduled delivery/restart behavior still untested |
| API storage | Railway architecture shows an attached admin volume | Mount exists; file recovery/backup not demonstrated |
| Database backups | Railway Backups tab states backups and PITR are only available on Pro | Built-in backups unavailable on the current plan; external backup status unknown |
| Email DNS | Resolver returned ENODATA for root MX/TXT, `_dmarc` TXT, and Microsoft `selector1`/`selector2` DKIM CNAMEs | Public mail routing/authentication still unresolved; other DKIM selectors were not exhaustively checked |

Railway project: `The-Lola-Booth-API`, production. No production credentials were copied or exposed. No production database migration, payment, email send, subscription upgrade, or customer-data change was performed in this pass.

## Next production action

1. Establish and verify a recoverable database backup. Either use an existing external PostgreSQL backup/export process, or have the owner choose a paid Railway plan supporting backups. Do not change billing without that decision.
2. Review and apply pending migrations 016, 017, 018, 019, and 020 in order with the repository runner (`npm run db:migrate`) against the production database. The runner uses one transaction per migration. Migration 020 adds the Super Admin role and role permissions; this is a security-sensitive production change and needs explicit confirmation if applied through the browser console.
3. Verify all 20 entries in `schema_migrations`; check System Health and Communications again. Missing communication/worker schema is consistent with the observed errors, but server logs are needed to confirm the specific failing query.
4. Deploy the verified code and public PNG icon assets together; confirm admin/API/worker versions and generated document URLs.
5. Complete Owner/Super Admin invitations/permissions checks, controlled inbox delivery, Stripe test-mode success/failure/replay, worker scheduling/restart, backup restore drill, and physical QR/offline/upload checks.

Keep SMS disabled until its separate verification is complete. Approved hero-photo and signature assets are still needed for exact mockup matching.

## Access blocker

The official Railway CLI is available through `npx @railway/cli`, and local `pg_dump` 18.3 is installed, so a subscription upgrade may be avoidable by creating a private external export. No Railway CLI session or token was available. Automatic approval review rejected `railway login --browserless` because account access and production mutations (including migrations that add roles/permissions) require more specific user authorization. No login was completed and no production mutation was attempted. Explicit approval is needed to authenticate the CLI, create a private backup, and apply migrations 016–020. A separate paid plan change is not proposed.
