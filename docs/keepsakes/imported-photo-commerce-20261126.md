# Imported-photo ordering regression — staging

The reported postcard/keychain Add to Cart failure was reproduced in the existing Chrome guest session. The source Gallery had commerce and branded merchandise enabled but no current core products selected; its catalog references predated the twelve-product migration. Current physical products were selected in that staging Gallery, preserving existing viewing, download, personal/event access and original-sale settings. Synthetic QA Galleries were also configured for current products. No Gallery was republished and no message was sent.

Separately, imported photos without manually configured `gallery_photo_sessions` were unconditionally ineligible for merchandise. Authorized unmapped images now inherit physical eligibility only when their source Gallery explicitly enables both commerce and branded merchandise, and only for its selected products. They remain branded COMPOSITE assets, included/free downloads where already permitted, and never become an unbranded original or eligible digital-edit source. Explicit per-photo merchandise exclusions remain authoritative.

Regression checks use disposable local PostgreSQL schemas and synthetic images: a direct-photo capability remains limited to one authorized imported photo; postcard and variable-size keychain quotes succeed after opt-in; missing opt-in, prohibited original editing, explicit exclusions and unrelated images still fail. Email/phone collection scopes use the same eligibility rule and honor immediate revocation.

Staging release and hosted browser verification are recorded in the final task report. No production deployment or live purchase/mailing is authorized.
