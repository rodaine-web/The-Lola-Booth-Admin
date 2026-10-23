# Production / staging branch reconciliation

The Admin branches had five production-only and four staging-only commits. Their application code was already equal: production included cherry-picked copies of the staging booking-link repair and status-preservation changes. Only release evidence and two environment-specific values in vercel.json differed.

This reconciliation retains both histories and the fuller production qualification report. Both branches can use the same configuration: mutually exclusive hostname conditions select the existing production API policy for admin.thelolabooth.com and gallery.thelolabooth.com; staging and preview hosts retain the existing staging API policy. Each policy retains the same security headers and allows only its own API origin. Both owned gallery root redirects are present. Existing per-project build environment variables still select the API and runtime environment; no credentials, payments, feature flags, data or database migrations change.

Promote tested staging work through a merge into main-prod, preserving ancestry. After release, fast-forward main-staging to the reviewed production merge commit. Avoid cherry-picking the same feature separately into each branch: identical changes then appear as unrelated commits. Branch equality does not mean copying production secrets or data to staging.

Scope: The-Lola-Booth-Admin, the repository matching the reported 4-ahead/5-behind comparison. The independently versioned public website repository is not part of this reconciliation.
