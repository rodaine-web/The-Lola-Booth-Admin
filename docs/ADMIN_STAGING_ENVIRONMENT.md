# Current deployment is staging

The owner reclassified the existing Admin/API/worker, Railway PostgreSQL and upload volume as STAGING on September 25, 2026. No new staging or production environment is being created.

- Admin: https://admin.thelolabooth.com
- API: https://api.thelolabooth.com
- Railway project: e2c4de11-8494-4f12-8112-5f1b696f9ae4
- Existing Railway environment: df5a961b-5e13-4102-a9b0-97244773b857
- API service: 48ec36e9-924b-4dc6-a8d9-1e3fb2bf3b36
- Worker service: 7b7111c9-3925-4038-926a-ecac913dd9b8

Provider dashboard/deployment slots may retain their historical `production` / `Production` labels. These names do not authorize production use. `APP_ENV=staging` controls the application's purpose; `NODE_ENV=production` retains secure optimized server behavior. The current GitHub-linked main branch deploys to this existing staging target. Production requires a later, separate environment and owner approval.

## Baseline safeguards

Stripe accepts TEST keys only; startup rejects live/malformed keys in staging. PayPal stays disabled. SMS_PROVIDER=none. GA4_ENABLED=false, META_EVENTS_ENABLED=false and TIKTOK_EVENTS_ENABLED=false; dispatch also refuses staging as defense in depth. LinkedIn remains pending/disabled.

STAGING_EMAIL_ENABLED=false prevents email dispatch, including direct Microsoft adapter calls. Microsoft credentials stay in the backend and are configuration-validated only. Future controlled qualification may explicitly enable email with STAGING_EMAIL_ALLOWLIST restricted to the two approved owner inboxes. Every allowed send is prefixed `[LOLA STAGING QA]`, all to/cc/bcc recipients are checked, and at most two recipients are permitted. This baseline does not enable that switch or send any messages.

The staging worker emits a revision-bearing heartbeat but does not claim or process automation/integration jobs. Manual bulk automation processing is blocked too. Existing jobs are preserved, not falsely completed or deleted. This is an intentional pause, not a dead worker. Resuming automatic staging jobs requires a separate controlled design/qualification pass.

## Public website and data boundary

The frozen marketing website V1 still reads this API's published CMS content. Reclassifying the API does not isolate that public content. Do not publish, unpublish or edit public-facing CMS records during baseline qualification. Capture before/after public homepage and CMS fingerprints. Later CMS qualification must use drafts or an explicitly approved isolated public-preview arrangement.

Existing business/QA/seed/legacy records remain in place. UNREVIEWED is a valid conservative classification; do not infer business legitimacy from an old fixture's name or age. Produce aggregate classification counts and a separate cleanup recommendation. Do not run seed scripts, wipe tables, rewrite financial history or reset existing user credentials.

## Deployment and evidence

Only committed, tested source is deployed. Run npm test and npm run build. Determine the latest migration from server/migrations and apply missing files with the existing transactional runner. Compare migration ledger, business counts and invoice aggregates before/after.

`/api/health` exposes environment/revision only. Authenticated System Health shows Admin/API revisions. The Admin build emits `/build-info.json`; worker heartbeat metadata records environment, revision and jobsPaused. No secrets are exposed in these markers.

The API upload volume is mounted at `/app/storage/uploads`. Verify a synthetic file round-trip using the storage provider. Same-volume archives and a successful read/write test do not prove independent backup or disaster recovery. The worker currently has no upload volume mount; attachment processing through that worker is not qualified while jobs are paused.

Baseline evidence lives in audit-output/staging-baseline. Goal 1 excludes actual inbox delivery, hosted Stripe Checkout and external SMS/marketing. Next qualification is Microsoft email + forms; hosted Stripe follows separately. Production deployment is not authorized.
