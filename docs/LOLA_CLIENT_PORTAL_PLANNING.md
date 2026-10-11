# Client portal planning and private files

Customer routes /planning/:token and /approvals/:token are outside the authenticated admin appearance wrapper. Admin background/palette/day-night preferences do not alter public pages, website, emails or generated documents.

Planning grants are hashed in database, encrypted only for authorized regeneration/view, expire and can be revoked. Request logs redact public tokens and queries. Responses omit grant hashes/ciphertext. Files require current grant plus event/client ownership; downloads use private no-store caching, attachment and sandbox headers.

Upload limits are 8 MB per file and PNG/JPG/PDF signatures. SVG/HTML and MIME mismatch are rejected. Private storage uses the existing provider. Signatures are not malware scanning. Storage writes and DB transactions are not atomic; review orphan cleanup/provider policy before qualification. Staging must verify Azure access and wrong-client denial rather than only local upload validation.

The client form saves on explicit save/step navigation. Color pickers support HEX and reordering. Backdrop preview uses a native modal dialog. Mobile drag/drop and file picker, keyboard focus, contrast and validation errors require browser qualification at 375, 390 and 768 pixels.

Public planning currently uses a separate event grant to cover bookings without proposals. Existing client workspace magic links remain in place; a unified authenticated workspace entry for these grants is a remaining parity task.
