# Lead selection actions

Adds Archive selected and Delete selected to the existing Leads table selection, plus board selection, an Archived leads view, and Restore selected. Changing filters clears selection. Table pagination and selected-row CSV export continue to share the same selection. Confirmation dialogs show the number of affected leads; failures retain the dialog and selection for retry.

Archive records `archived_at` and retains sales status. The ordinary Leads list excludes archives; the archive view can filter by status. Delete is a soft deletion through `deleted_at`; linked proposals, bookings and audit history remain intact. Deleted leads cannot be restored from this screen.

`POST /api/leads/bulk-action` requires `write:sales`, validates action and up to 100 UUIDs, deduplicates IDs, locks the selected rows in deterministic order, and updates them with per-lead audit records in one transaction. If any selected lead is missing/deleted, no rows change. Audit failure rolls the whole batch back.

Migration `073_lead_archiving.sql` adds a nullable timestamp and an active-leads index. It does not delete, archive, reprice, or otherwise modify existing business rows. Application rollback can retain the additive column and index. Retain archive/delete audit records; do not restore a database backup as a routine application rollback.

Validation: focused transaction/permission/rollback tests, an isolated local database with all migrations and authenticated HTTP actions, and an isolated browser check of table/board selection, cancel, archive, restore, delete, failure/retry and refreshed lists. The database check runs when `LEAD_ACTIONS_TEST_DATABASE_URL` or the CI's existing `CRM_TEST_DATABASE_URL` is present, and refuses nonlocal/non-test database URLs. Browser responses are synthetic and cannot change hosted leads.

This change is based on current staging revision `9f8f2aa9d8167102e8a3b864223f6e750a1f7924`. It does not authorize production promotion of the separate pricing-catalog release.
