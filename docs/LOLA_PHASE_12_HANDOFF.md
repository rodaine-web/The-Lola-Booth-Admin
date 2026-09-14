# LOLA Phase 12 Handoff

## Summary

Phase 12 adds in-repo duplicate hygiene for sales records. Leads and clients can now surface likely duplicates by email, phone, or existing duplicate flags, review how many linked records would move, and merge a duplicate into the current profile.

## What Changed

- Added duplicate candidate APIs:
  - `GET /api/leads/:id/duplicates`
  - `POST /api/leads/:id/merge`
  - `GET /api/clients/:id/duplicates`
  - `POST /api/clients/:id/merge`
- Lead merges move linked bookings, proposals, tasks, files, communications, source events, conversion postbacks, and lead activity to the target lead.
- Client merges move linked events, bookings, proposals, invoices, payments, refunds, payment attempts, tasks, files, communications, gallery deliveries, website gallery items, converted lead references, and client activity to the target client.
- Merge behavior keeps the current profile as the winner, fills blank target fields from the duplicate, unions client tags, writes an internal note, records activity, and writes an audit log.
- Lead and client detail pages now include a **Possible Duplicates** panel with match reason, linked record count, and merge action.

## Verification

- Added `test/phase12-duplicate-merge.test.js`.
- Run `npm test` and `npm run build` after this phase before deploying.

## Remaining Follow-Ups

- Add a dedicated data-quality dashboard for cross-record duplicate queues.
- Add route-level integration tests with a disposable PostgreSQL database.
- Add more conservative fuzzy matching after real data is reviewed.
