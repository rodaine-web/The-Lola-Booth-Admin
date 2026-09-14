# LOLA Go-Live Checklist

Final Phase 11B recommendation: **NOT READY FOR PRODUCTION** until every P0 row below is PASS or explicitly not applicable to the launch plan.

| Blocker | Current State | Owner / Responsibility | Validation Method | Result | Evidence | Required Follow-Up |
| --- | --- | --- | --- | --- | --- | --- |
| Production secrets | Env checker exists; real production secrets not present here | Technical owner | `npm run env:check` in staging/prod, secret manager review | BLOCKED | Local dev check passes but uses dev env | Create strong production secrets, store in deployment secret manager |
| Production URLs | URL variables documented; local env still uses localhost defaults | Technical owner | `npm run env:check`, generated proposal/invoice/delivery link review | BLOCKED | `PUBLIC_BASE_URL` and `PUBLIC_APP_URL` missing from local `.env` | Set HTTPS admin/API/public base URLs |
| HTTPS | App has security headers; no deployed HTTPS endpoint provided | Deployment owner | Browser and curl checks against deployed domains | BLOCKED | No staging/prod URL available | Deploy behind HTTPS and verify redirects/webhooks |
| CORS | API allow-list logic exists | Technical owner | Confirm admin and website origins only | BLOCKED | Local origin verified | Set production `CLIENT_ORIGIN` and `PUBLIC_INQUIRY_ALLOWED_ORIGINS` |
| Email provider | Microsoft Graph adapter available; production credentials not verified here | Owner + technical owner | `npm run email:test -- recipient@example.com` from Railway with `EMAIL_PROVIDER=microsoft` | BLOCKED | Adapter implemented; live mailbox test still required | Configure Microsoft Entra app, Graph `Mail.Send` application permission, tenant admin consent, and Railway variables |
| Email domain auth | Not externally verifiable here | Owner | Microsoft 365 domain authentication and mailbox send test | BLOCKED | No Microsoft tenant dashboard connected | Verify Microsoft 365 domain DNS and sender mailbox |
| Stripe | Provider code exists, credentials absent | Owner + technical owner | Stripe test checkout, webhook, duplicate webhook, refund | BLOCKED | System Health reports Stripe DISCONNECTED | Configure test keys and webhook secret; run test flow |
| PayPal | Provider code exists, credentials absent | Owner + technical owner | PayPal sandbox order, webhook, duplicate event, refund | BLOCKED | System Health reports PayPal DISCONNECTED | Configure sandbox credentials and webhook ID |
| Worker deployment | Worker command and heartbeat exist | Deployment owner | Run supervised worker and kill/restart test | BLOCKED | Local worker heartbeat verified | Deploy `npm run worker` under platform supervision |
| Database backup | DR procedure documented | Deployment owner | Create backup and record timestamp/location | BLOCKED | No production backup target available | Configure encrypted scheduled backups |
| Restore test | Restore procedure documented | Deployment owner | Restore backup into separate DB and smoke | BLOCKED | Not performed here | Perform staging restore drill |
| Production storage | Local storage active in dev | Owner + technical owner | Upload/download/archive test against durable storage | BLOCKED | System Health reports storage DEGRADED locally | Choose durable volume or implement S3-compatible adapter |
| Demo/test data removal | Seed now requires explicit owner credentials; production QA records still need review | Owner + technical owner | Query production DB for demo users/test records | MANUAL VERIFICATION REQUIRED | Default seed credential removed from active source | Remove or archive only records not needed for audit evidence |
| Owner bootstrap | Seed refuses to create owner without `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` | Owner + technical owner | One-time bootstrap with unique password and optional forced rotation | PASS WITH WARNING | Active login UI ships empty fields | Verify production owner account uses a unique private password |
| QR physical-device testing | QR PDF generation passes locally | Operations owner | Print label, scan iPhone/Android/browser/manual fallback | BLOCKED | Local QR PDF smoke returns `%PDF` | Test physical label size and quiet zone |
| Rollback | Runbook documents rollback | Deployment owner | Deploy A/B rollback drill | BLOCKED | No staging platform available | Perform app rollback test before production |
| Golden-path smoke | Local API smoke passed | Owner + technical owner | Deployed lead/proposal/invoice/payment/operations flow | BLOCKED | Public inquiry local smoke created lead; QR PDF smoke passed | Run full staging smoke with real provider test credentials |

## Final Decision

**SUPERSEDED BY PHASE 14 / FINAL CERTIFICATION.** The codebase now has live deployment evidence for public website/API basics, but provider, worker, database, backup, and authenticated admin checks still require final production verification.
