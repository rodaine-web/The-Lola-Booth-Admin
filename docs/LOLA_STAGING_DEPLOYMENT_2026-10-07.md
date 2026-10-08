# Staging deployment — October 7, 2026

User authorized push and deployment to staging. Production is outside scope.

Release baseline is staging commit 5b3bc239. The previous local HEAD was 17 commits behind with no divergent commits; advancing the branch preserved every working file byte. Existing mobile/layout fixes remain in the release. New sprint source, tests, migrations and documentation are included; scratch files, node_modules, credentials and database backups are excluded.

Before migrations, API and worker runtime were verified with staging email, automation, campaign, owner-form notification and external-integration dispatch disabled. Recurring planning reminders remain disabled. Original nonsecret flag values are retained locally for recovery. Do not automatically replay queued/failed sends when resuming.

A fresh encrypted custom-format staging backup was restored into a disposable database: 115 public tables, 46 recorded migrations and zero unvalidated constraints. Archive SHA-256: 010cf68c131bb0e9a654f2664c159eb1ab4953c3f6d8e4674143756504b8f713. Recovery archive/key are outside the repository under task outputs/staging-backups/lola-staging-20261007-deploy.*. This backup covers PostgreSQL, not Azure blobs.

Final regression: 609 tests, 599 passed, zero failed, ten skipped. Frontend production build passed. Previously recorded nine SQL and twenty service checks passed on isolated restored databases. Migration startup now validates hosted database identity before any schema write.

Staging uses local document storage. Azure staging container names are configured, but this deployment does not enable or certify Azure storage. Full mandatory A–J journeys, provider delivery/payment/refund and mobile/role qualification remain outstanding. A healthy deployment is not production certification.

Deployment and migration evidence will be recorded below after completion. Production remains NO-GO pending mandatory staging gates.

## Migration result

Missing migrations 046 and 048–053 PASS on the application staging database with per-file transactions, a five-second lock timeout, a 45-second statement timeout and explicit system/database identity checks. Already applied migration 047 was retained. Fresh restored legacy reservation preflight checked the one active equipment-reserved event and found no failures. Evidence: docs/qualification/application-staging-migrations.json and staging-legacy-reservation-preflight.json.

The application deployment follows these successful prerequisites; outbound dispatch stays paused for controlled UAT. Production schema and configuration were not changed.
