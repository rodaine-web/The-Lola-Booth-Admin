# LOLA Admin 1.0.0

Production release of tested staging revision efee227. Includes the admin redesign, composable proposals, guided campaigns, contact import, suppression and interest forms, reminder retry safeguards, gallery delivery safeguards, and permission fixes.

Production CSP retains the production API origin. No staging database or demo content is copied.

This is a conditional, owner-operated functionality release. Private galleries remain disabled in production. Live Stripe, unrestricted customer email, automated customer reminders, and other deferred integrations remain disabled pending qualification. Limited staff roles require account-level checks before rollout.

Apply migrations through 039 before the new worker starts. Preserve a pre-release database backup and prior application deployment for rollback. Unknown provider outcomes require manual reconciliation before retry.

Validation: 512 tests passed, zero failed, five database-backed checks skipped; frontend build passed at the source revision. Production packaging is verified separately.
