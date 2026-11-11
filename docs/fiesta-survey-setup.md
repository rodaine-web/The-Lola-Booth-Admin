# Fiesta Survey setup for Event Gallery 2.0

Create the survey against the Fiesta event used for the booking. The questions below are the recommended setup; the importer maps actual exported headers explicitly rather than assuming a fixed Fiesta schema.

1. **Full name** — text.
2. **Mailing preference** — “Would you like a photo postcard from this event?” Yes / No.
3. **Address line 1** — text.
4. **Address line 2** — optional text.
5. **City** — text.
6. **State** — two-letter US state or DC code.
7. **ZIP code** — text so leading zeros are retained.
8. **Country** — United States. Include the country in the export; the importer does not infer it from an address.
9. **Consent to postcard mailing** — “May The Lola Booth use your mailing address to send your event photo postcard?” Yes / No.

Show address questions after an affirmative mailing preference if Fiesta supports conditional questions. Keep marketing permissions separate. Export the original questions/answers and available timestamps. Do not use photo-sharing activity as mailing consent.

Do not ask guests to type photo filenames or session IDs. Check whether Fiesta includes those references in the export. If it does not, exact matching cannot be automated from this file alone; staff must verify the relationship using the share summary and photo/session evidence.

## Admin flow

1. Open the event's unpublished gallery and verify its Fiesta event code using the original sharing summary.
2. Verify the Dropbox event-folder mapping. Existing sync imports original files into private gallery storage.
3. Open **Fiesta Survey**, upload the survey CSV and map each exported question or metadata column. CSV is supported in this foundation; XLSX is not yet supported.
4. Enter exact affirmative answer values for preference and consent. Missing/negative/unrecognized answers remain unconfirmed.
5. Check the count preview, then import. Source CSV and answers are encrypted; retries of the same file/mapping do not duplicate responses.
6. Review each response. Exact unique filenames may match before or after photo ingestion. Session-only and ambiguous records require manual verification. Confirm the correct photo or exclude the response with a review note.

Confirmation concerns the photo match only. It neither verifies a postal address nor approves a postcard order. Business request, approved artwork, recipient eligibility, quantity/cost limits, Admin approval and final dispatch remain separate downstream requirements.

Only US 4×6 postcards are in scope. Narrow strips and videos can be gallery content but must not be sent to Lob. No postcards or customer messages are created by importing or reviewing a survey.

## Verification still needed

Run a Fiesta test survey with fictional data and provide its export plus corresponding finished photo filenames. This is needed to verify the actual column names, answer formatting, event/session references and available timestamps. The current implementation does not claim that Fiesta supplies any particular metadata column.

Production cannot enable this survey foundation. Staging requires `GALLERY_V2_ENABLED=true`; existing gallery behavior remains available while it is disabled.
