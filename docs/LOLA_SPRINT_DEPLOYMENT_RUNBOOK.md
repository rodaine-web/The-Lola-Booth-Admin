# Staging deployment runbook

This sprint has not been deployed and is not a production certificate.

1. Review this sprint separately from the substantial pre-existing uncommitted design/integration changes. Review environment configuration without printing secrets. Verify the target is staging.
2. Verified encrypted staging backup and restore evidence is recorded in LOLA_STAGING_MIGRATION_PLAN.md. Confirm freshness for the migration window. Review missing 046, then ordered 048 (proof protection), 049 (appearance), 050 (planning), 051 (holds/resources), 052 (reminders), 053 (quotes).
3. Stop or safely pause all staging dispatch paths first. Automation pause alone leaves campaign/owner notification processing running; account for email/campaign flags and API-triggered sends. Existing queue inventory: five scheduled communications and 72 queued integration jobs. Run migrations on staging before starting the updated API or worker. Code now queries new tables from event operations, dashboard and planning handoff; deploying code first breaks those routes. Do not use production to discover migration errors.
4. The API startup automatically runs db:migrate: do not push main-staging before prerequisites pass. Reconcile the working tree against newer origin/main-staging; never overwrite newer staging fixes. Deploy API, frontend and worker from the same reviewed revision. Confirm clientOrigin/API origins and encryption key persistence. The worker may send queued transactional messages: inventory the queue and use approved UAT recipients before activation. Keep PLANNING_REMINDERS_ENABLED disabled until approved fixture reminders pass delivery and cancellation checks.
5. Existing confirmed events are not automatically bulk-invited. Open an approved test event and create its invitation explicitly. Add final backdrop images and realistic inventory to approved staging fixtures only.
6. Complete all A–J gates in LOLA_STAGING_QUALIFICATION.md with actual database, browser, email and approved Stripe test evidence. Verify provider replay and unknown-send-outcome handling. Do not mark skipped tests as passes.
7. Record migration/deployment IDs, tested revision, recipients/fixture IDs, timestamps and evidence. Keep production unchanged until a separate release decision.

Rollback: stop affected worker delivery, revert to the previous application revision, retain additive schema and audit/history. Never drop planning/proof/customer records to undo a UI release. Restore a database only through an explicitly approved recovery procedure.
