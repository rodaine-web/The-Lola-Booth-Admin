# Staging gallery and postcard production parity

The staging application now includes the reviewed production gallery controls and postcard workflow fixes from API release `b528afdc-0ebc-462b-978a-ad77dc796981`: album/photo deletion and recreation, Dropbox folder editing, artwork preparation independent from dispatch, postal normalization and leading-zero ZIP editing, preserved survey evidence and opt-outs, reviewed placeholder-contact identities, scoped proof approval, trusted Lob PDF checks, explicit additional-photo copies and authenticated status polling.

The earlier deployed Client 360, partner workspace and postcard sources are persisted in Git so a subsequent branch deployment retains them. The current hosted staging homepage is preserved. No production event records, photos, recipient addresses, mailing approvals or API keys are imported into staging.

Staging target: Railway project `e2c4de11-8494-4f12-8112-5f1b696f9ae4`, environment `df5a961b-5e13-4102-a9b0-97244773b857`, database system ID `7685003242386444353`; Vercel project `prj_A9TVWxwVxQnaYWJdKp2dcYZ7YXdJ`. Staging keeps its own database, storage and test credentials. Live mail remains disabled and there is no live Lob key in staging.

An encrypted staging snapshot was decrypted, restored into a disposable database, and migrations `083_gallery_delete_controls.sql` and `084_gallery_live_status_and_copies.sql` were rehearsed successfully. Existing table row counts were unchanged; the disposable database was removed. The encrypted backup and separately protected recovery key are retained privately outside this commit.

Validation covers repository tests, disposable database checks for gallery deletion, survey evidence/opt-outs, identity separation, address corrections, artwork preparation and duplicate dispatch protection, plus desktop/mobile controls and ZIP/state editing. New fixtures support macOS and Linux and the gallery browser checks run in staging CI.
