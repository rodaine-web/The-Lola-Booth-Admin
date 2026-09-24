# Inquiry email rendering fix — September 24, 2026

Status: implemented locally and verified; production deployment awaits approval.

The delivered screenshots confirmed broken brand assets, a literal name placeholder in owner notifications, escaped line breaks, and machine-formatted dates. Production configuration points PUBLIC_BASE_URL to the website, which returns 404 for /brand assets. Those same PNG assets are publicly available on the Admin domain. The active owner and booking templates contain literal escaped newlines.

Changes:
- Email image origin now uses EMAIL_ASSET_BASE_URL when supplied, then CLIENT_ORIGIN (the Admin host); public website navigation remains separate.
- Normalize escaped newlines in stored template text before merging customer values. User-provided text is not decoded or interpreted as HTML.
- Owner messages greet the LOLA team; missing names safely use “there,” never a template placeholder.
- Dates display as December 16, 2027. Guest counts are labeled Guests, and the customer button correctly describes its destination.
- Smaller body typography, increased line spacing, paragraph breaks, and long-line wrapping improve readability.

Validation: 36 focused tests passed. Six browser previews (contact, booking, owner at 900px and 390px) loaded all 58 image instances without broken images, horizontal overflow, unresolved placeholders, or escaped newline text. Desktop owner and mobile booking screenshots visually reviewed. Browser previews do not substitute for checking the delivered message in the user's mail client.

Previews and results: audit-output/email-format-fix/. No production deployment, database edits, or external email sends were performed for this fix. After approval deploy the API and worker together, then send controlled previews to the approved QA inboxes and confirm rendering in the receiving email client. Previously delivered messages cannot be changed retroactively.
