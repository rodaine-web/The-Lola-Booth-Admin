# Daily production PostgreSQL backup

Run `daily-production-backup.py` on the isolated Railway backup helper using PostgreSQL 18 clients and Python cryptography/psycopg2. The source connection is read-only; there are no application workers, source writes or schema migrations. The script guards the expected production system identifier and rejects staging.

Schedule: `0 8 * * *` UTC (03:00 Chicago during daylight saving, 02:00 standard time). Restart policy NEVER. A successful run exits; the next cron starts a fresh run. No public domain or TCP endpoint.

Destination: existing configured Azure storage account, existing private production documents container (from `AZURE_DOCUMENTS_CONTAINER`), prefix `production/postgresql/daily/`. Each snapshot has an AES-256-GCM encrypted custom-format dump, RSA-OAEP-SHA256 wrapped per-backup key, and integrity/restore manifest. No encryption private key is stored in Azure backup objects. The owner recovery private key is held separately; protect it and keep an independent secure copy. Its loss makes these encrypted snapshots unrecoverable.

The job exports a PostgreSQL MVCC snapshot, records all public-table row counts and takes the dump against that same snapshot. It restores into a disposable local-only PostgreSQL cluster, compares every table count, encrypts, uploads and reads back all objects. Anonymous blob access must be denied. Only after successful upload/readback does retention delete complete job-owned snapshot triplets older than 30 days. Existing customer documents and unrelated objects are never deleted. Incomplete upload groups require operator review and are not silently deleted.

First qualification temporarily supplies `BACKUP_VERIFY_PRIVATE_KEY_B64`; the uploaded Azure dump is downloaded, authenticated/decrypted and restored again. Remove that variable after qualification. Regular jobs need only the public encryption key. Source credentials and provider errors must never be printed.

Failure notifications use existing Microsoft credentials and send operational-only email to `info@thelolabooth.com`. Graph 202 is provider acceptance, not proof of inbox delivery. A process that never starts cannot send its own email: Railway deployment alerts/external freshness monitoring are still needed to detect scheduler/platform failure.

## Recover

1. Stop application writes/workers if recovering an actual outage; preserve the current database for investigation. Restore initially into a new isolated database.
2. Download a matching `.dump.gcm`, `.key.rsa` and `.manifest.json` triplet from private Azure storage.
3. Confirm the manifest's public-key fingerprint matches the separate owner private key. Unwrap the symmetric key with RSA-OAEP SHA256.
4. Decrypt with AES-256-GCM using the manifest nonce, tag and `aad` string. A bad authentication tag means stop. Verify plaintext SHA256.
5. Restore with PostgreSQL 18 `pg_restore --exit-on-error --no-owner --no-acl` into the isolated target; compare manifest table counts and migration ledger. Recreate production roles/grants separately from the deployment runbook.
6. Qualify the recovered app before changing production connection strings. Avoid replaying historical communications or payment side effects.

Azure account trial expiry remains an independent retention risk; maintain an active subscription for durable storage. This database backup does not itself cover local upload volumes, gallery files, cloud credentials or application configuration.

## Qualification evidence — October 10, 2026 (Chicago)

- Railway isolated helper: `a4223f55-b0ed-41d7-b7d1-100a6d77a543`, production project `071e2ce9-7103-4dce-aec7-b3ddbc1a799e`, explicit environment `e9bcf249-3fd4-4272-a8d3-c7416d513fa8`.
- Qualification deployment `8b89ccfe-b3b3-4251-a1ed-a7051ee459ba` completed successfully. Actual production snapshot: 3,270,097-byte dump, all 115 public-table counts matched after both local and Azure-download/decrypt restores.
- Snapshot prefix: `production/postgresql/daily/20261011T003236Z-9637a06c-df3c-478b-9a83-0cf57bd26da3` (UTC object name). Anonymous GET returned Azure 409 `PublicAccessNotPermitted`.
- Microsoft Graph accepted operational failure alerts during qualification and the successful qualification notice (202). Inbox delivery not independently verified.
- Creating a dedicated container was denied by existing Azure permissions; no permissions were expanded. The existing private production container is used with a dedicated job prefix.
- Corrected container preparation, PostgreSQL executable paths and Azure denial-code handling during qualification. Failed attempts did not mutate source records. They are not counted as successful backup runs.
- Activated cron `0 8 * * *`; temporary verification private key variable cleared before daily-mode deployment. Separate local recovery key: `work/backup-recovery/production-backup-recovery.pem`, permissions 0600, excluded by `.gitignore`. Owner should secure an independent copy outside this checkout; do not commit or email the key.
- Scope is database backup infrastructure only; no production app/worker code rollout, customer charges, application schema migrations or booking mutations.

## Upload recovery — October 20, 2026

The October 20 scheduled job passed its local restore but failed during a single large Azure upload after the 120-second request timeout. The old diagnostic recorded only `URLError`, so the underlying network cause is unconfirmed. Previous private backups remain intact.

Large encrypted dumps now use 4 MiB Azure blocks with per-block transport checksums, followed by a conditional block-list commit. Transient timeouts, connection failures and HTTP 408/429/5xx responses receive up to four attempts with bounded backoff. TLS verification and authorization failures remain fail-closed. Readback retries interrupted downloads. Uncertain successful commits are reconciled against exact stored bytes; existing different blobs are never overwritten. Logs report sanitized error categories and Azure request identifiers, without credentials, URLs or provider bodies.

Encryption format, source read-only snapshot, disposable local restore, exact Azure readback, anonymous denial check, schedule and retention are unchanged. Run `python3 ops/backups/test_backup_transfer.py` for offline failure-injection coverage. The backup helper embeds this script in its Railway start command; committing source alone does not update the running helper. Deploy only that helper and require a fresh successful backup before calling recovery complete.

Azure protocol references: [Put Block](https://learn.microsoft.com/en-us/rest/api/storageservices/put-block), [Put Block List](https://learn.microsoft.com/en-us/rest/api/storageservices/put-block-list).
