# LOLA — Environment isolation and production bootstrap qualification

Updated September 29, 2026. This report supersedes the earlier TLS-pending checkpoint.

**Verdict: ENVIRONMENT ISOLATION READY WITH CONDITIONS**

The tested production/staging boundaries pass. Production TLS is valid; forms, Owner sessions, catalog selection, CMS lifecycle, public documents and QR destinations were exercised. This is not a certification of payment processing, email delivery, or storage backup restoration. Outbound email remains disabled; no payment was executed.

## Conditions retained

- Storage is readable/writable on separate environment volumes, but a backup/restore drill was not performed. Health explicitly reports durability as unverified.
- Production Health reports the intentionally disabled email adapter as MISCONFIGURED and the intentionally absent worker as UNKNOWN. Staging reports two previously scheduled communications overdue while jobs remain paused. These states were not hidden or bypassed.
- Stripe is unconfigured in production and TEST-only in staging; hosted Checkout/provider acceptance remains a separate qualification. Inbox and Message Trace are outside this sprint.

## Environment matrix

| Environment | Website | Admin | API | Database | Worker | Storage | CMS | Email | Stripe | SMS |
|---|---|---|---|---|---|---|---|---|---|---|
| Production | https://thelolabooth.com | https://admin.thelolabooth.com | https://api.thelolabooth.com | system ID 7691050600059834430 | Absent | Own Railway volume | Production tables | Disabled | Unconfigured; no live payments | Disabled |
| Staging | https://staging.thelolabooth.com | https://stagingadmin.thelolabooth.com | https://stagingapi.thelolabooth.com | system ID 7685003242386444353 | Heartbeat; automatic jobs paused | Own Railway volume | STAGING channel in staging DB | STAGING_EMAIL_ENABLED=false | TEST only | Disabled |

GA4, Meta and TikTok dispatch remain disabled. No production worker was created. Database identity guards reject an unexpected physical PostgreSQL system identifier before processing work.

## Acceptance

| Area | Production | Staging | Status | Evidence |
|---|---|---|---|---|
| Website | Approved live pages retained | Own staged pages | PASS | public-final-qa.json; public-targeted-final.json |
| Admin | Owner smoke passed | Owner smoke passed | PASS | owner-final-targeted.json |
| API / TLS | HTTP 200; valid HTTPS | HTTP 200; valid HTTPS | PASS | Final health and deployment checks |
| Database | Separate physical identity | Separate physical identity | PASS | db-production-before.json; db-staging-before.json; db-worker-before.json |
| CMS | FAQ edit/publish/unpublish restored | FAQ lifecycle and image replacement restored | PASS | cms-owner-qa.json; media-final.json |
| Forms | 2 production-only leads | 2 staging-only leads | PASS | production-form-qa.json; staging-form-qa.json; owner-read-audit.json; Owner lead screenshots |
| Catalog / Experiences | 4 approved public experiences | 6 catalog experiences retained | PASS | owner-read-audit.json; proposal builder screenshots |
| Packages / Pricing | 16 approved packages | 17 existing packages | PASS | pricing-final.json; document-qa-records.json |
| Add-ons | 10; custom Travel guarded | 10; custom Travel guarded | PASS | document-qa-records.json |
| Event Types | 6 published readable labels | 6 published readable labels | PASS | owner-read-audit.json |
| Proposal Builder | Glam Essential selects $599 | Glam Essential selects $599 | PASS | Changing experience clears stale price/package; custom Travel blocks missing price |
| Documents | Public proposal/invoice rendered; PDFs downloaded | Same | PASS | documents-final.json; token-recheck.json; PDF artifacts |
| QR | thelolabooth.com/pay/{token} | staging.thelolabooth.com/pay/{token} | PASS | Both downloaded invoice PDF QR codes decoded and matched |
| Email links | Preview-only qualification | Preview-only qualification | PASS | email-preview-final.json; no messages sent |
| CORS | Accepts own origins; rejects staging403 | Accepts own origins; rejects production403 | PASS | cors.json |
| Auth / Sessions | Opposite access+refresh rejected401 | Opposite access+refresh rejected401 | PASS | owner-final-targeted.json; origin-local storage; no shared auth cookie |
| Storage | QA PDFs and metadata production only | QA PDFs and metadata staging only | PASS isolation; CONDITION durability | storage-final.json; backup restore not certified |
| Worker | Absent as requested | Heartbeat current; jobsPaused=true | PASS | Health evidence and physical DB identity guard |
| Health | Own API/DB/storage/integrations | Own API/DB/storage/worker | PASS isolation; health conditions retained | health-final.json |
| Dashboard | Production records only | Staging records only | PASS | Owner dashboard/lead evidence; no opposite API calls |

## Browser network audit

| Surface | Expected API | Opposite-environment requests | Result |
|---|---|---:|---|
| Production website | api.thelolabooth.com | 0 | PASS |
| Production Admin | api.thelolabooth.com | 0 | PASS |
| Staging website | stagingapi.thelolabooth.com | 0 | PASS |
| Staging Admin | stagingapi.thelolabooth.com | 0 | PASS |

Evidence: public-final-qa.json, documents-final.json, owner-final-targeted.json. Earlier interrupted/rate-limited attempts are retained and superseded by the targeted repeat; 429/502 were never treated as successful token isolation. Final token recheck returned 404 in all four opposite-environment cases.

## Form markers

| Marker | Production API / DB / Admin | Staging API / DB / Admin |
|---|---|---|
| PROD-ENV-ISOLATION-QA availability + contact | YES / YES / YES | NO / NO / NO |
| STAGING-ENV-ISOLATION-QA availability + contact | NO / NO / NO | YES / YES / YES |

Owner authenticated queries and visible lead screens agree. No staging operational tables were copied.

## Catalog and pricing

| Package | Production CMS | Home | Packages page | Match |
|---|---|---|---|---|
| glam:essential | $599 | $599 | $599 | YES |
| glam:signature | $899 | $899 | $899 | YES |
| glam:luxe | $1,499 | $1,499 | $1,499 | YES |
| glam:custom | Custom / Request Pricing | Custom / Request Pricing | Custom / Request Pricing | YES |
| 360:essential | $699 | Not featured in approved homepage | $699 | YES |
| 360:signature | $1,099 | Not featured in approved homepage | $1,099 | YES |
| 360:luxe | $1,699 | Not featured in approved homepage | $1,699 | YES |
| 360:custom | Custom / Request Pricing | Not featured in approved homepage | Custom / Request Pricing | YES |
| vogue:essential | $899 | Not featured in approved homepage | $899 | YES |
| vogue:signature | $1,499 | Not featured in approved homepage | $1,499 | YES |
| vogue:luxe | $2,299 | Not featured in approved homepage | $2,299 | YES |
| vogue:custom | Custom / Request Pricing | Not featured in approved homepage | Custom / Request Pricing | YES |
| audio:essential | $299 | Not featured in approved homepage | $299 | YES |
| audio:signature | $449 | Not featured in approved homepage | $449 | YES |
| audio:luxe | $699 | Not featured in approved homepage | $699 | YES |
| audio:custom | Custom / Request Pricing | Not featured in approved homepage | Custom / Request Pricing | YES |

The homepage intentionally features four Glam packages. All 16 package page cards match the current CMS; Custom has no zero price. Four experience images load, including the Vogue mapping by explicit media ID; the homepage has no broken images after lazy-loading. Production Careers/Gallery/Events remain unpublished (404), matching the approved live baseline. No redesign or unrelated main-branch website content was released.

| Experience | Active / Public | Sort | Media ID |
|---|---|---:|---|
| Lola 360 | Yes / Yes | 2 | 9059dbc0-0e75-4ad5-b6ed-f9efa4e03759 |
| Lola Glam | Yes / Yes | 1 | 662855e4-a3b5-4c01-a38f-c6a3a005232d |
| Lola Audio Guestbook | Yes / Yes | 4 | 6bbbf541-c2b5-4b27-983b-5653bc7c7b49 |
| Lola Vogue | Yes / Yes | 3 | a8d16ae0-e05e-4640-8d2e-37e783b03df3 |

| Add-on | Price | Model |
|---|---:|---|
| Extra Hour | $150 | PER_HOUR |
| Premium Backdrop | $250 | FIXED |
| Additional Prints | $100 | FIXED |
| Guestbook | $175 | FIXED |
| Audio Guestbook | $299 | FIXED |
| Custom Signage | $200 | FIXED |
| Branding | $300 | FIXED |
| Data Capture | $350 | FIXED |
| Rush Delivery | $125 | FIXED |
| Travel | Request Pricing | CUSTOM |

## Reference counts

| Reference | Production | Staging | Intentional difference |
|---|---:|---:|---|
| Experiences | 4 | 6 | Internal staging experiences not copied |
| Packages | 16 | 17 | Only current approved public catalog imported |
| Add-ons | 10 | 10 | Approved active set |
| Event types | 6 published / 7 total | 6 published / 7 total | Existing draft default retained |
| Roles | 6 | 6 | Definitions only; no user grants copied |
| Permissions | 58 DB / 57 Owner-visible | 58 DB / 57 Owner-visible | Internal definition excluded from picker |
| Email templates | 52 | 52 | Migration definitions retained |
| Proposal / invoice template definitions | 5 / 3 | 5 / 3 | Specialized tables; generic document_templates is empty |
| CMS page copy | 581 approved slots; 10 page/SEO records | 904 existing page items; 849 channel records | Different approved publication states; not mirrored |
| Media library | 11 approved files | 22 existing records | Only approved public media copied |
| FAQs / hero / gallery | 40 / 1 / 8 published | Existing channel retained | Staging-only content not copied |

Production canonical settings verified: https://thelolabooth.com; info@thelolabooth.com; 773-240-2744; https://www.instagram.com/thelolabooth/; https://www.tiktok.com/@thelolabooth.

## Operational counts and cleanup

| Type | Production before | QA added | Production final | Staging final |
|---|---:|---:|---:|---:|
| leads | 1 | 2 | 3 | 29 |
| clients | 0 | 0 | 0 | 9 |
| events | 0 | 0 | 0 | 5 |
| proposals | 0 | 1 | 1 | 8 |
| invoices | 0 | 1 | 1 | 7 |
| payments | 0 | 0 | 0 | 5 |
| communications | 0 | 0 | 0 | 34 |
| bookings | 0 | 0 | 0 (baseline; no conversion/booking operation performed) | 5 baseline retained |

Two pre-existing production users and the pre-existing production lead were preserved. QA proposal rows are ARCHIVED; QA invoice rows are VOID with access REVOKED. No payments or communications were added. Synthetic form leads remain clearly marked as qualification evidence; audit history is retained.

| Environment | Synthetic record | ID |
|---|---|---|
| Production | Booking inquiry | 1fb28367-75b3-4ee6-9c7a-b925a3cc0e94 |
| Production | Contact inquiry | cbce4365-e1fa-4f90-a087-4f6aac90ad73 |
| Staging | Booking inquiry | 48f68c74-a1d6-4304-86f1-462548a7c509 |
| Staging | Contact inquiry | 8c643186-ecf9-41d3-83ad-49000dda65de |
| production | Archived proposal PROP-1001 | d561aefe-b856-47f3-880f-2610c3ad32bb |
| production | Voided invoice LOLA-1001 | 878ae121-43eb-4a55-a4b1-6b5d7290bded |
| staging | Archived proposal TLBP-1002 | 0ffdd687-85de-4710-a18b-bc497e0c5e2c |
| staging | Voided invoice TLBI-1003 | 990351ae-d559-44c0-9d3e-c5f7666fb109 |

## Release and validation

Application candidate: `431e69f3b57a2fd61ed9785f1622b2690deb9e7d` on `codex/p0-environment-isolation`. Final deployment IDs/status are recorded in `final-deployment-status.json` and `deploy-final-fixes.log`. No migrations were added or historical migrations edited; the existing 28-migration baseline remains.

Public website deployment `dpl_4SfpscMhU51vAoxihzEd9z6KFGYP` uses approved live baseline `9063010` with only `vercel.json` changed. Scoped routes: /pay, /pay/:token, /invoice/:token, /proposal/:token, /customer-documents/:path*. Website PR: https://github.com/rodaine-web/The-Lola-Booth-Website/pull/1.

Fixes qualified: package/experience mapping and price selection; agreed-price guards for custom catalog entries; unpublished managed copy suppresses static fallback; public invoice logo loads through scoped assets; transient failures preserve sessions and provide retry; email preview sample fields use environment-specific public routes.

`npm test`: 224 passed. `npm run build`: passed. `git diff --check`: passed. Targeted regression tests cover environment/API/CORS/DB identity guards, catalog pricing, session recovery, and email preview origins. Browser session recovery uses simulated 429 responses and succeeds in both deployed Admin builds. No rate limits were weakened.

Tracked-source high-confidence credential pattern scan: no findings. This was a targeted scan, not a claim of exhaustive secret-history certification. Production/staging compiled asset scans found zero opposite API host references. Temporary Railway SSH key for this task was removed and absence verified; unrelated pre-existing SSH keys were untouched.

Evidence directory: `audit-output/p0-isolation/` (local, ignored by Git; contains QA artifacts). Full reports do not expose Owner credentials or customer document tokens.

## Final deployment alignment

| Component | Revision | Deployment | Status |
|---|---|---|---|
| production-api | 431e69f | fe529721-a4d3-477d-ab3a-8894f1ce4cc2 | SUCCESS |
| staging-api | 431e69f | 1cbf452f-57ea-47f0-a467-af3a67c97a09 | SUCCESS |
| staging-worker | 431e69f | ee3a7cf7-505b-4564-ad35-808872ef0b82 | SUCCESS |
| Production Admin | 431e69f | dpl_CfT3KpsUV85o8wrE3BMxCgAGKKVU | Ready; build-info verified |
| Staging Admin | 431e69f | dpl_HDK4j4dumsCKT2MSGzRTBFW2YUY6 | Ready; build-info verified |
| Database migrations | Existing 28-migration baseline | No new migration | Historical migrations unchanged |

## Retained QA file evidence

Generated files are retained with archived/voided QA documents. Opposite-environment file IDs were absent.

| Environment | File ID | Filename |
|---|---|---|
| production | b72444c7-bfab-4fd0-8146-c49961458ba5 | LOLA-Invoice-LOLA-1001.pdf |
| production | 93c34011-ca21-4de8-89bb-4e4e0d859630 | LOLA-Invoice-LOLA-1001.pdf |
| production | 4020310d-586d-49e9-8e80-68ad936e778c | LOLA-Invoice-LOLA-1001.pdf |
| staging | 179d676d-d6fa-4d52-b6ae-6979c658cae5 | LOLA-Invoice-TLBI-1003.pdf |
| staging | f9af865c-81d2-4b31-bbc7-b24c0dd37ed7 | LOLA-Invoice-TLBI-1003.pdf |
| staging | ef7fef77-ec42-4adc-8db6-1e8b8467d93e | LOLA-Invoice-TLBI-1003.pdf |

Final email preview qualification: all six templates render in each environment with no unresolved fields. Proposal, invoice/payment and payment-detail CTA URLs use the corresponding public website. Invoice email mobile width is 390/390 pixels in both environments, with no broken images. Evidence: email-preview-final.json and email-visual-final.json. No external messages were sent.
