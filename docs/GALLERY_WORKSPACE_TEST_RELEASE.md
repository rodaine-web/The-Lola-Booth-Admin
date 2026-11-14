# Gallery and workspaces — local test release

Open http://localhost:5173. The API is running on http://localhost:4000. The local development database has migrations 078–081 applied; existing client records were preserved. A schema backup is at `/private/tmp/lola-pre-gallery-release-20261113-schema.sql`.

The dedicated gallery test worker is running. It handles gallery postcard jobs only, with live Lob keys and production dispatch blocked. It does not run email, payment or unrelated automation jobs.

## Test a client event

1. Open the client’s **Client 360 → Gallery**, create or select the event gallery, then open its management page.
2. Import the original Fiesta survey/sharing CSV and map the verified Dropbox event folder or upload the original images. Review unmatched photos and survey errors. Original survey imports remain encrypted and available for audited review.
3. Use the client’s secure workspace to request postcard mailing. Enter quantity, notes, and **the client’s return name/address for this event**. The business sender is not a fallback.
4. In the Admin gallery’s **Postcards** tab, approve the quantity and spending limits. The accepted proposal’s included mailing quantity is available as the starting allowance. Extra quantity needs documented authorization. The proposal editor now has an included postcard quantity field that is retained in the accepted snapshot and client-facing notes.
5. Review the client request and return address, then approve it. Upload and approve the shared postcard back; select eligible guests and prepare drafts. Narrow strips and low-resolution fronts are rejected.
6. Preview each personalized front/back. The back proof shows the recipient and client return address, with reserved postage/barcode areas. Approve the draft and personalized proof, then queue it for Lob TEST. Inspect Lob’s rendered PDF for final placement.
7. Watch the queue, status and history. Status is checked against Lob’s API automatically. Double clicks reuse the same job. Alternate sharing emails with the same normalized name/address cannot silently create another postcard; Admin-approved extras require a reason and remain inside the quantity/cost limits.
8. If a request changes its return address, outstanding jobs pause for review. Queued runs retain their own approved sender snapshot. Rebuild an unsubmitted draft after reviewing corrected answers; draft/proof approval must be renewed. A provider-created postcard is never silently replaced. Unknown outcomes require provider verification or explicit confirmation that no provider postcard was created before a new attempt.

Mailing limits reserve the Admin-entered all-in unit cost; they are not a live Lob pricing quote. Physical mail and live credentials remain disabled in this test release.

## Test the workspaces

- **Client 360:** navigate all ten sections. In Files, upload a private document, share it with the client, then remove access. Counts now reflect explicit sharing grants. Client-wide/event filters retain the correct scope IDs.
- **Client workspace:** sign in with its single-use invitation, reload, download the shared file, request postcards with a client return address, and sign out. Revoked grants, unrelated events, and mutations without the client CSRF token are rejected.
- **Partner workspace:** choose linked events, explicitly share eligible files, create an invitation, and open it in a separate browser profile. Test event details, file download, an event request, reload and sign-out. Changing grants, expiry, archiving, email changes and revocation deny old access. Financial and unshared files are excluded. Admin can resolve partner requests.

## Verification results

154 focused automated checks passed. The full isolated database/API/browser lifecycle suite also passed, covering all ten Client 360 sections, private file sharing and revocation, client sign-in/return-address requests/CSRF, gallery source downloads and proofs, and partner file/request access. The final build and whitespace checks passed. Desktop/mobile screenshots are in `/private/tmp/lola-complete-browser-20261113/`.

## Provider verification

A real Lob TEST postcard (`psc_1840d6c9cc53b54a`) was accepted and rendered using an inline client return address and synthetic artwork. No physical mail was sent. Sensitive proof metadata is stored locally at `/private/tmp/lola-provider-smoke-20261113.json`.

Signed webhook ingestion is implemented with raw-body HMAC verification, timestamp tolerance, deduplication, encrypted event storage and protection against older statuses overwriting newer ones. Local testing works through verified API polling. Receiving actual Lob callbacks later requires a publicly reachable HTTPS callback at `/api/webhooks/lob` and the matching provider webhook secret in `LOB_TEST_WEBHOOK_SECRET`; a localhost URL cannot receive external callbacks.

## Repeat checks / restart

- App: `npm run dev` after stopping the already-running local API/client processes.
- Dedicated gallery worker only: `npm run gallery:mailing-worker -- --watch`.
- `GALLERY_MAILING_WORKER_ENABLED=true` is enabled in the local development `.env`. Keep `LOB_TEST_API_KEY` there. A global `LOB_FROM_ADDRESS_ID` is not used by the new queue: each job uses the approved client return-address object.
- Focused automated checks and the isolated database/browser lifecycle suite live under `test/`. The latter requires `BOOKING_LIFECYCLE_TEST_DATABASE_URL` pointing to the disposable local QA database; never point the QA suite at the working application database.

No production deployment or physical mailing was performed. Existing manual changes remain uncommitted for review; local backup/storage directories are not release artifacts.
