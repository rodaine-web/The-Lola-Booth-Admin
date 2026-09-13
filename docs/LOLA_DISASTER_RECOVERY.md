# LOLA Disaster Recovery

## Recovery Targets

- RPO: 24 hours or better until a hosting provider supplies point-in-time recovery.
- RTO: 4 hours for API/admin restoration after credentials and backups are available.
- Database restore target: latest successful daily backup plus point-in-time WAL if the hosting provider supports it.
- Storage restore target: all uploaded files, generated PDFs/DOCX files, media library assets, and gallery delivery assets.
- Application restore target: last deployed commit, environment variables, and migration history.

## Backup Plan

- PostgreSQL: schedule daily encrypted backups and retain at least 30 daily, 12 monthly, and 7 yearly snapshots.
- Files/media: back up the production storage root or object bucket daily; enable bucket versioning when using S3-compatible storage.
- Secrets: keep production env values in the deployment secret manager, not in git or exported spreadsheets.

## Restore Drill

1. Restore the latest database backup into a clean database.
2. Restore storage files or point the environment at the restored object bucket.
3. Set production-like environment variables with test provider credentials.
4. Run `npm run db:migrate`.
5. Start `npm start` and `npm run worker`.
6. Verify `/api/health`, `/api/system/health`, login, proposal PDF generation, invoice public link, and QR label generation.

## Incident Response

- Freeze provider webhooks if duplicate money movement is suspected.
- Export audit logs, payment attempts, payments, refunds, and webhook events before manual repair.
- Rotate `JWT_SECRET`, `INTEGRATION_SECRET_KEY`, provider API keys, and webhook secrets after any credential exposure.
- Keep public proposal, invoice, delivery, and QR token URLs treated as revocable sensitive links.

## Failure Playbooks

- Database failure: fail closed, restore latest backup, run migrations, verify health.
- Worker failure: restart `npm run worker`, inspect failed jobs in System Health, retry safe failed jobs.
- API failure: roll back the API release or restore environment variables, then smoke login and health.
- Admin frontend failure: roll back the static build while keeping API/worker running.
- Storage failure: pause uploads, preserve metadata, restore storage backup or switch provider only after URL checks.
- Payment outage: disable provider toggle, accept documented offline payment instructions, reconcile manually.
- Email/SMS outage: keep in-app notifications, retry provider sends after adapter recovery.
- Accidental deletion: restore from backup or use audit history to reconstruct where feasible.
- Bad deployment: stop worker, roll back app release, then verify System Health.
