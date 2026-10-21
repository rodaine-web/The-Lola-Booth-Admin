# V1.2 read-only Dropbox ingestion

Status: implementation under qualification. No production activation authorized.

## Scope and limits

Fiesta exports deliverable captures to an explicitly mapped Dropbox event folder.
The Admin imports the Fiesta sharing CSV first, then binds that folder to the same
LOLA gallery. The account is pinned by both Dropbox account ID and the approved
verified email info@thelolabooth.com. Permissions needed: account_info.read,
files.metadata.read and files.content.read. Do not request write/delete/sharing
permissions. Existing Fiesta exports live outside a new LOLA app folder, so access
to existing files requires Dropbox's Full Dropbox content access; application
sync is restricted to the explicitly selected delivery folder, non-recursive.

No source deletes propagate into LOLA. No filenames, timestamps or face matching
are used to invent guest ownership. The existing sharing CSV maps exact capture
filenames; files without a guest association never appear in a guest gallery.
No publishing, access-key creation or customer messages are performed by sync.
Imports stop after first publication, cancellation or a closed sales record.
Admin reviews all imported content before publication. Do not select an originals
or raw folder. Subfolders are excluded.

Files currently retain the existing 10 MB JPG/PNG/GIF/MP4 limit. Oversized media
stops the import with an explicit error and leaves the cursor unchanged. Larger
video support, Dropbox credentials/folder verification, branded domain and actual
guest delivery remain separate release gates. A Dropbox cursor cannot discover
recipient associations that Fiesta only supplies through a separate sharing CSV.

## Configuration

API and worker need these private Railway variables (never browser/VITE variables):
DROPBOX_GALLERY_APP_KEY, DROPBOX_GALLERY_APP_SECRET.
The staging app key is configured in Dropbox app LOLA Gallery Staging. Register
https://stagingapi.thelolabooth.com/api/integrations/dropbox-gallery/callback
as its exact callback. Production callback is intentionally not registered here.

The refresh token comes from an owner-approved offline OAuth authorization via
Admin Gallery Settings → Connect Dropbox. The connection reuses the encrypted
integration registry, single-use state, HttpOnly browser binding, PKCE and an
active actor permission recheck. No offline token is returned to the UI. The
connection pins the verified provider account ID; it cannot silently switch
accounts later. Disconnect clears encrypted credentials and pauses/fences sources.

The refresh token must come from this owner-approved offline OAuth authorization.
No token is accepted through a public endpoint or stored in the browser. No
credential values are exposed by the Admin status endpoint or error messages.
Do not paste secrets into chat, commit them or print them in logs.

GALLERY_DROPBOX_SYNC_ENABLED defaults OFF. Staging additionally requires
STAGING_EXTERNAL_INTEGRATIONS_ENABLED=true. Workers need the existing isolated
Azure gallery credentials/container. Production gallery gates remain disabled.

## Migration and deployment

067_dropbox_gallery_sources.sql follows 066. It only adds source/checkpoint/import
ledger tables and indexes. No existing customer/financial/gallery data is rewritten.
Before staging merge (API startup runs migrations): verify target project/env/
database identity, current encrypted staging backup, readback and disposable restore.
Rehearse 067 on the restored copy and compare existing counts/totals, then clean up
that disposable database. CI also applies the complete migration chain in an
isolated schema. Never apply 067 to production without the scoped release approval.

Deploy API/worker/frontend with sync OFF. Inspect the new Admin Settings controls,
permissions, safe disconnected state and migration completion. Then store approved
credentials and verify identity; map only a staging QA folder. Import twice and
verify content hashes, exact associations and unchanged counts. Exercise provider
failure/retry, concurrent claims, pause, permission revocation, event cancellation
and publication boundaries. Enable one QA source before enabling periodic polling.
No historical folders are discovered or backfilled automatically.

## Retry and rollback

Each folder has one renewable-by-retry, fenced five-minute lease. File revisions
are persisted independently; the cursor advances only after the page completes.
A failed page replays already committed revisions without new uploads. A changed
file with a conflicting existing filename requires Admin review rather than
silently replacing a delivered capture. Connection/folder swaps are rejected.
Pause invalidates an in-flight lease, preventing subsequent metadata commits.
Global pause is checked before dispatch and before each commit.

Rollback: set GALLERY_DROPBOX_SYNC_ENABLED=false on API and worker, disable folder
sources, and roll back code if necessary. Preserve private uploaded bytes, import
ledger and migration tables. No destructive down migration, object deletion,
credential regeneration, historical resend or production change is required.

## Official provider references

- [OAuth and offline authorization](https://docs.dropboxapi.com/dropbox-api/docs/oauth)
- [Folder pagination](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/list-folder)
- [Revision-pinned downloads](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/download)
- [Dropbox content hash](https://docs.dropboxapi.com/dropbox-api/docs/technical-reference/content-hash)
