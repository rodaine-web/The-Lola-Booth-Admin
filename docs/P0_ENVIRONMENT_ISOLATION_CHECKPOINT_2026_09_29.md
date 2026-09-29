# P0 environment isolation checkpoint — 2026-09-29

## Critical blocker: production DNS handoff is incomplete

**ENVIRONMENT ISOLATION FAILED** — qualification is incomplete, not a release acceptance.

Railway now assigns `api.thelolabooth.com` to the production API, but Vercel refused to overwrite its live DNS records without human terminal confirmation. The production API hostname currently fails TLS validation. Production website submissions and the newly deployed Admin's API requests must not be described as working until DNS and HTTPS are verified.

The production API remains healthy at `https://lola-api-production-production.up.railway.app`. Staging is healthy at `https://stagingapi.thelolabooth.com`.

Owner action in Vercel DNS for `thelolabooth.com`:

| Type | Name | Required value |
|---|---|---|
| CNAME | api | hpxsvq99.up.railway.app |
| TXT | _railway-verify.api | railway-verify=a4314dafd5ea01eb90223af6f9da8d40cde25710fddf17143355f0750648ca0c |

Alternatively run these commands in a human-controlled terminal and confirm each prompt:

```sh
vercel dns update rec_5b5367df5b301bc98b137b8d --value hpxsvq99.up.railway.app --scope rodaine-web
vercel dns update rec_fa60dfd1e8a54b6bbd3f6042 --value railway-verify=a4314dafd5ea01eb90223af6f9da8d40cde25710fddf17143355f0750648ca0c --scope rodaine-web
```

The Vercel CLI explicitly returned `interactive_confirmation_required` and stated the confirmation cannot be automated. It was not bypassed. No production form tests were attempted through an invalid certificate.

## Verified cause and original environment map

| Environment | Website | Admin | Actual API before changes | Database | Worker |
|---|---|---|---|---|---|
| Production | https://thelolabooth.com | https://admin.thelolabooth.com | Website used https://api.thelolabooth.com (staging); Admin used https://lola-api-production-production.up.railway.app | Separate production Postgres | None |
| Staging | https://staging.thelolabooth.com | https://stagingadmin.thelolabooth.com | https://api.thelolabooth.com | Separate staging Postgres | Staging worker |

The live website's `config.js` pointed to the staging-owned hostname. Staging's CORS configuration also permitted the production website. This explains the misplaced inquiry; the databases themselves were not shared.

Evidence: `audit-output/p0-isolation/before-environments.json`, `before-vercel.json`, physical database inventories.

## Current status

| AREA | PRODUCTION | STAGING | STATUS |
|---|---|---|---|
| Website | Approved HTML unchanged; API TLS blocked | Dedicated staging API configured and forms tested | BLOCKED for production |
| Admin | New production CMS editor deployed; API TLS blocked | Dedicated API build deployed | Authenticated acceptance pending |
| API | Healthy generated host; stable hostname awaiting DNS | Healthy dedicated HTTPS hostname | Production DNS blocked |
| Database | Physical ID 7691050600059834430 | Physical ID 7685003242386444353 | PASS: distinct databases |
| CMS | Current live copy/catalog/media initialized | Existing STAGING records preserved | Publish/edit isolation tests pending |
| Forms | Not tested after cutover; TLS failure | Booking and Contact returned 201 and persisted only here | PARTIAL |
| Dashboard | No synthetic production records created | Two synthetic form records created | Authenticated UI checks pending |
| Catalog | Approved business references imported | Existing catalog retained | API/DB verified; UI pending |
| Experiences | Four public experiences | Six active catalog experiences | Intentional: two staging internal experiences not copied |
| Packages | 16 current public packages | 17 total catalog rows | Production prices verified against live snapshot |
| Pricing | Custom price NULL; current approved prices imported | Existing values preserved | No Custom-as-zero import |
| Event Types | Six published names; seven total rows including existing defaults | Six published; seven total | Human-readable picker implemented; UI acceptance pending |
| Add-ons | Ten active add-ons | Ten add-ons | Imported active reference catalog |
| Proposal Builder | Catalog available; event selectors added | Existing catalog preserved | Manual draft smoke pending |
| Documents | Production website origin configured; website proxy changes prepared | Staging website origin configured | Token-based end-to-end QA pending |
| QR | Production document origin configured | Staging document origin configured | Render/scan qualification pending |
| Email links | Production URLs configured; email disabled | Staging URLs configured; email disabled/allowlist retained | Template end-to-end QA pending |
| CORS | Accepts production website/Admin; rejects staging | Accepts staging website/Admin; rejects production | PASS on working API hosts |
| Auth | Separate DB/JWT configuration; origin-local token storage | Separate DB/JWT configuration | Cross-session runtime tests pending |
| Worker | Not created/enabled | Database identity matches staging; automatic jobs remain paused | Isolation guards deployed |
| Storage | Separate volume; 11 approved media files copied with hashes | Existing staging volume retained | No operational file copy |
| System Health | API health verified at generated hostname | API health verified at staging hostname | Authenticated health screens pending |

Temporary QA accounts have **not** been created. Owner approval was requested because the isolated test browser cannot access the owner's existing session. No owner password was read or changed.

## Current environment matrix

| Component | Production | Staging |
|---|---|---|
| Website | https://thelolabooth.com | https://staging.thelolabooth.com |
| Admin | https://admin.thelolabooth.com | https://stagingadmin.thelolabooth.com |
| Intended API | https://api.thelolabooth.com — DNS/TLS incomplete | https://stagingapi.thelolabooth.com — HTTPS verified |
| Temporary existing API | https://lola-api-production-production.up.railway.app | Not needed |
| Railway project | 071e2ce9-7103-4dce-aec7-b3ddbc1a799e | e2c4de11-8494-4f12-8112-5f1b696f9ae4 |
| Railway environment | e9bcf249-3fd4-4272-a8d3-c7416d513fa8 | df5a961b-5e13-4102-a9b0-97244773b857 |
| Database service | 6f89c4c9-1b84-40a0-9963-cb4230567521 | 68289f07-f2b2-4ea5-9637-2acc2dca16d9 |
| Worker | None | 7b7111c9-3925-4038-926a-ecac913dd9b8; paused except heartbeat/previous bounded qualification mechanism |
| Storage | Own Railway volume at /app/storage/uploads | Own Railway volume at /app/storage/uploads |
| CMS | Production classic CMS tables; published records | STAGING channel in its separate DB |
| Stripe | Unconfigured; live not enabled | TEST only |
| Email | EMAIL_PROVIDER=disabled | Microsoft configured; STAGING_EMAIL_ENABLED=false |
| SMS | none | none |
| GA4 / Meta / TikTok | false / false / false | false / false / false |

Matching private hostname/path strings do not mean a shared database or volume. PostgreSQL physical system identifiers differ, and the staging worker's physical identifier matches staging only. API/worker startup now checks `EXPECTED_DATABASE_SYSTEM_ID` before accepting requests or processing jobs.

The existing Stripe TEST webhook `we_1UFQWrIwnRmNAOz5fgR50drG` now targets `https://stagingapi.thelolabooth.com/api/webhooks/stripe`; `livemode=false` was checked. No Checkout session, charge, or payment event was created.

## Data policy and counts

Production already contained **one lead and two users before this work**. They were preserved. It would be false to report a zero-lead production baseline.

| Operational table | Before bootstrap | After bootstrap |
|---|---:|---:|
| leads | 1 | 1 |
| clients | 0 | 0 |
| events | 0 | 0 |
| bookings | 0 | 0 |
| proposals | 0 | 0 |
| invoices | 0 | 0 |
| payments | 0 | 0 |

No staging operational/customer tables, user records, audit history, communications, or payment records were imported. An initial broad reference export was rejected by automatic approval review; the successful replacement used explicit catalog/published-content field allowlists, and publicly visible settings. No broad settings/templates/automation export was performed.

| Reference | Production | Staging | Explanation |
|---|---:|---:|---|
| Experiences | 4 | 6 | Approved public set copied; staging internal entries retained there |
| Packages | 16 | 17 | Current published set copied |
| Add-ons | 10 | 10 | Active catalog copied |
| Event Types | 7 total / 6 published | 7 total / 6 published | Existing default record retained |
| Email templates | 52 | 52 | Existing migration-created definitions retained; content parity not fully audited |
| Roles | 6 | 6 | Existing production roles retained; no staging user grants copied |
| Permissions | 58 | 58 | Existing production definitions retained |

Other production bootstrap: 22 package items, 40 FAQs, one currently published hero, eight currently published gallery entries, 11 referenced approved media files, ten page SEO/content records and 581 existing live text/link slots. All ten source HTML hashes matched the approved live snapshot before extracting text. No Events/Gallery standalone route was republished. The public business contact email is info@thelolabooth.com; the internal business_email was initialized to that same owner-approved address rather than the old hello@lolabooths.com seed value.

## Form isolation evidence

| Marker / form | Production DB | Production Admin | Staging DB | Staging Admin |
|---|---|---|---|---|
| PROD-ENV-ISOLATION-QA | Not created | Pending | Absent | Pending |
| STAGING-ENV-ISOLATION-QA / availability | Absent | Pending | 48f68c74-a1d6-4304-86f1-462548a7c509 | Authenticated UI pending |
| STAGING-ENV-ISOLATION-QA / contact | Absent | Pending | 8c643186-ecf9-41d3-83ad-49000dda65de | Authenticated UI pending |

Both staging forms were submitted through the visible website using isolated Chrome. Each returned HTTP 201 from stagingapi. Contact was flagged POSSIBLE_DUPLICATE because the two synthetic submissions deliberately shared a phone number, but has its own record. Neither marker exists in production. Communications stayed at 34 in staging and 0 in production: disabled email did not enqueue a new delivery backlog.

## Code, deployments, and checks

Branch: `codex/p0-environment-isolation`.

- `e2b63b4`: environment-specific API/CORS, CMS routing, forms, delivery links, event-type selectors and database identity checks.
- `a697da7`: customer-document asset path support.
- `0b34d3e`: published CMS slots projected into the existing live website payload.
- 214 tests passed; `npm run build` passed; `git diff --check` passed.
- Changed-source credential-pattern scan passed. This is a bounded pattern scan, not a claim of a full external security audit.
- Existing unrelated documentation changes were preserved.

| Component | Revision | Deployment |
|---|---|---|
| Production API | 0b34d3e | 1641ca52-5982-4c01-baa6-c74bdc508623; health verified |
| Staging API | 0b34d3e | 14b76f4f-6493-4edb-b469-664523435bdb; health verified |
| Staging worker | 0b34d3e | 3757f2b0-fea8-4f86-b6f9-d6943e085df5 |
| Production Admin | a697da7 | dpl_Bc6qZperZXi3RJaipDs1HQwkdvCE; READY |
| Staging Admin/site | a697da7 | dpl_EaeEtsLgp6VxrRyJtU65EXDdAwvi |
| Database migrations | 001–028 | No new schema migration required; historical migrations unchanged |

The later 0b34d3e change is backend-only. Final UI revision metadata alignment remains to be completed. The first prebuilt staging upload failed because Vercel inherited the Vite build preset; explicit static build settings corrected the subsequent upload.

Production website routing candidate is prepared at `/private/tmp/lola-p0-isolation/website-live`, based on the deployed 9063010 website revision. It adds document route proxies only and has not been deployed. Do not deploy repository main blindly: main contains an unrelated index.html change. Existing draft website PR #1 also needs its final diff/description updated before promotion.

## Remaining work after DNS confirmation

1. Verify both DNS records and production HTTPS; confirm `/api/health` reports production at the stable hostname.
2. Finish production website document-route deployment from the approved live baseline; preserve its HTML/CSS and unpublished routes.
3. If authorized, create narrowly scoped temporary QA accounts, verify real login and cross-environment session rejection, then disable accounts/revoke sessions.
4. Submit production booking and Contact forms, record IDs, and verify absence in staging plus visibility in production Admin.
5. Verify both Admin dashboards, selectors/pricing, manual production Lead/Event/Proposal draft, and safe draft archival. Do not send documents.
6. Perform reversible production/staging CMS edits and restoration, confirming each changes only its own website.
7. Verify public document tokens, stable payment CTA, QR scan destination, receipt/delivery paths and email preview origins.
8. Complete desktop/mobile visual parity and authenticated browser network audit. Current public/login-page captures do not substitute for authenticated qualification.
9. Finish exhaustive hard-coded URL classification; production compiled assets were checked for opposite-environment hostnames, but the full repository classification remains incomplete. Staging metadata still contains some production brand/SEO URLs that need explicit review.
10. Align final revision metadata, rerun checks after any further fixes, and issue the final acceptance report. Keep all outbound integrations disabled.

Evidence directory: `audit-output/p0-isolation/`. Temporary scripts and data exports there are ignored by Git and were not included in deployment packages.

## Approved package prices imported

| Experience | Package | Price / display | Public | Status |
|---|---|---|---|---|
| Lola 360 | The Essential | $699.00 | Yes | PUBLISHED |
| Lola 360 | The Signature | $1,099.00 | Yes | PUBLISHED |
| Lola 360 | The Luxe | $1,699.00 | Yes | PUBLISHED |
| Lola 360 | Custom | Custom / Request Pricing | Yes | PUBLISHED |
| Lola Audio Guestbook | The Essential | $299.00 | Yes | PUBLISHED |
| Lola Audio Guestbook | The Signature | $449.00 | Yes | PUBLISHED |
| Lola Audio Guestbook | The Luxe | $699.00 | Yes | PUBLISHED |
| Lola Audio Guestbook | Custom | Custom / Request Pricing | Yes | PUBLISHED |
| Lola Glam | The Essential | $599.00 | Yes | PUBLISHED |
| Lola Glam | The Signature | $899.00 | Yes | PUBLISHED |
| Lola Glam | The Luxe | $1,499.00 | Yes | PUBLISHED |
| Lola Glam | Custom | Custom / Request Pricing | Yes | PUBLISHED |
| Lola Vogue | The Essential | $899.00 | Yes | PUBLISHED |
| Lola Vogue | The Signature | $1,499.00 | Yes | PUBLISHED |
| Lola Vogue | The Luxe | $2,299.00 | Yes | PUBLISHED |
| Lola Vogue | Custom | Custom / Request Pricing | Yes | PUBLISHED |

## Add-on catalog imported

| Add-on | Pricing model | Price | Active |
|---|---|---:|---|
| Extra Hour | PER_HOUR | $150.00 | Yes |
| Premium Backdrop | FIXED | $250.00 | Yes |
| Additional Prints | FIXED | $100.00 | Yes |
| Guestbook | FIXED | $175.00 | Yes |
| Audio Guestbook | FIXED | $299.00 | Yes |
| Custom Signage | FIXED | $200.00 | Yes |
| Branding | FIXED | $300.00 | Yes |
| Data Capture | FIXED | $350.00 | Yes |
| Rush Delivery | FIXED | $125.00 | Yes |
| Travel | CUSTOM | $0.00 | Yes |

## Temporary SSH access cleanup

The task key `lola-p0-isolation-2026-09-29` was removed from Railway and its absence was verified by listing registered keys. Its local private/public key files were deleted. An unrelated pre-existing key was left untouched. Evidence: `audit-output/p0-isolation/ssh-keys-after.txt`.

## Final public/login browser checkpoint

All four surfaces were opened at 390px in isolated Chrome. No opposite-environment host requests were observed. This is **not** an authenticated acceptance pass: production website/Admin calls to api.thelolabooth.com failed with `ERR_CERT_COMMON_NAME_INVALID`. Existing public-site Google tag and Google Fonts requests were blocked by CSP; no new analytics enablement was performed. Staging Admin had no failed requests in this login-page capture. Staging API deployment subsequently reported SUCCESS.

Evidence: `audit-output/p0-isolation/browser-network-checkpoint.json` and matching PNG files.
