# Fiesta photo lookup — staging qualification, November 25, 2026

The owner approved matching email or phone against imported Fiesta sharing records across authorized galleries. Phone lookup accepts a delivery email that need not already be present in Fiesta. The association is recorded UNVERIFIED; it is not merged into a CRM customer or used as proof for other photo access. This supersedes the prior same-photo/email restriction in the November 24 staging correction notes. Twilio/OTP remains deferred.

The existing Fiesta sharing CSV import and media reconciliation connect contacts to exact filenames and guest assignments. Image folders alone do not supply contact metadata. Published/delivered galleries, active identities, unexpired grants and retention remain required and are rechecked on every access. No CRM client record is required for the guest.

Both matched and unmatched valid requests receive the same neutral response. Unmatched requests enqueue no email and create no phone/email association; only a short-lived lookup request/cooldown record is stored. Matching requests queue a one-use, 30-minute email link. The resulting session can last up to seven days but never bypasses source access revocation.

The memory page offers downloads of included event photos when existing gallery download settings permit them, and native file sharing with a download fallback. Premium/unincluded source assets cannot be downloaded through this route. Product previews continue using the selected guest photo. Check Email offers retry, photo-link and support recovery.

Qualification uses actual Fiesta CSV imports in a disposable local database, scheduled email dispatch through the development transport, unmatched phone/email cases, new delivery email, multiple galleries, one-use links, cooldown, unauthorized/premium downloads and revoked permissions. Desktop/mobile browser fixtures verify lookup, native sharing, file download and guest photo previews. No customer emails, paid orders, production CMS publication or production release are part of this staging increment.
