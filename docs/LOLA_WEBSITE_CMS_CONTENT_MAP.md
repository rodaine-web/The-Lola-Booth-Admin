# LOLA website → CMS content map

Prepared 2026-09-22. Source: public website repository revision 36a6c20; public API captured 2026-09-22T20:16:54.483Z. This document describes locally validated changes. Production application and deployment are not yet verified.

## Pricing root cause

The homepage has current approved prices in index.html, but app.js asynchronously replaces its package container with the old /api/public/site package records. The Packages page has four experience tabs and lacks the old data-cms-packages hook, so that renderer never updates it. Clearing browser cache cannot reconcile these two sources.

| Source | Glam Essential | Glam Signature | Glam Luxe | Custom |
|---|---:|---:|---:|---|
| A: approved Packages HTML | $599 | $899 | $1,499 | Approved custom copy |
| B: homepage HTML before JavaScript | $599 | $899 | $1,499 | Let’s Create Together |
| C: published API / underlying packages | $499 | $799 | $1,099 | 0.00 in API |
| D: old renderer fallback | API numeric price; no separate fallback price array | Same | Same | Renderer custom text |

The shared renderer now identifies each record by experience:tier. Both pages consume that record. Static HTML remains the offline fallback. API caching changes from max-age=60/stale-while-revalidate=300 to immediate revalidation; app.js also revalidates. Unversioned image assets revalidate after one hour instead of remaining immutable for a year. No service worker or stored price data was found; sessionStorage contains inquiry attribution only.

## Integration and gaps

/connect is a public contact/link hub, not diagnostics, authentication, setup, or sync. Before this change it had no CMS API integration. It now loads the same public site payload for approved copy, contact details, social destinations and the saved contact card. No admin secrets or diagnostics are exposed.

/careers returns 404 and no careers source or navigation link exists in the inspected repository. Search-openings and fraud-alert copy cannot be migrated without an approved source. No content was invented.

About, legal and contact copy use bounded text slots in existing website_content JSON records, preserving layout. SVG icons, interactive forms, tab behavior and page layout stay in source. The existing authenticated Homepage content editor can edit these records as JSON. This is not a visual page builder.

Existing published FAQs are preserved as the current content (production has 40 published and three archived records); the six stale HTML FAQ fallbacks are replaced by the 40 current CMS FAQs. No testimonials are invented or published. Corporate/Digital legacy experiences are hidden from the website only, while internal records remain.

## Content types

| CMS type | Table | Admin UI | Public API | Before published count |
|---|---|---|---|---:|
| Page/Homepage content | website_content | Website → Homepage | /api/public/site, /homepage | 0 |
| Hero | website_hero_slides | Hero Slides | /api/public/hero-slides | 0 (one API fallback) |
| Experiences | experiences | Experiences | /api/public/experiences | 6 |
| Packages | packages | Packages | /api/public/packages | 4 |
| Event types | website_event_types | Event Types | /api/public/events | 0 |
| Gallery | website_gallery_items | Gallery | /api/public/gallery | 0 |
| FAQs | faqs | FAQs | /api/public/faqs | 40 |
| Testimonials | testimonials | Testimonials | /api/public/testimonials | 0 |
| Media | media_library | Media Library | /api/public/media/:id | Requires authenticated inventory |
| Settings/SEO | business_settings + page content | Site Settings + Homepage | /api/public/site | 1 settings object |

## Section mapping

| Live page | Section | Static source | CMS type | Existing CMS record | Action | Notes |
|---|---|---|---|---|---|---|
| /about | We like good events and even better photos. | about.html: section.about-hero | website_content | page.about (new) | CREATE | Preserve layout; copy slots and page SEO |
| /about | More than a booth in the corner. | about.html: section.about-story | website_content | page.about (new) | CREATE | Preserve layout; copy slots and page SEO |
| /about | Good experiences are built on the details.; People First; Beautifully Curated; Easy From Start to Finish; Worth Keeping | about.html: section.about-beliefs | website_content | page.about (new) | CREATE | Preserve layout; copy slots and page SEO |
| /about | What you should expect every time.; A setup that belongs in the room; Flattering, intentional lighting; Attendants who understand hospitality; Creative that feels personal; A clean handoff after the event | about.html: section.about-standard | website_content | page.about (new) | CREATE | Preserve layout; copy slots and page SEO |
| /about | Different ways to create the moment.; The Glam; The 360 Booth; The Vogue; The Audio Guest Book | about.html: section.about-experiences | website_content | page.about (new) | CREATE | Preserve layout; copy slots and page SEO |
| /about | It should look effortless because the work happened before your guests arrived. | about.html: section.behind-scenes | website_content | page.about (new) | CREATE | Preserve layout; copy slots and page SEO |
| /about | Good moments happen everywhere.; Weddings; Celebrations; Corporate Events; Brands | about.html: section.about-who | website_content | page.about (new) | CREATE | Preserve layout; copy slots and page SEO |
| /about | Good people.Better photos. | about.html: section.about-philosophy | website_content | page.about (new) | CREATE | Preserve layout; copy slots and page SEO |
| /about | — | about.html: section.about-gallery-strip | website_content | page.about (new) | CREATE | Preserve layout; copy slots and page SEO |
| /about | Let’s Make It Official. | about.html: section.cta | website_content | page.about (new) | CREATE | Preserve layout; copy slots and page SEO |
| /about | SEO / header / footer / links | about.html | page.about + business_settings | Existing settings; new page record | MERGE | 115 copy slots; 10 referenced media assets; SVG icons KEEP |
| /availability | Your event starts here. | availability.html: section.page-hero.book-hero | website_content | page.availability (new) | CREATE | Preserve layout; copy slots and page SEO |
| /availability | Tell us what you’re planning. | availability.html: section.section.book-section | website_content | page.availability (new) | CREATE | Preserve layout; copy slots and page SEO |
| /availability | Let’s Make It Official. | availability.html: section.cta | website_content | page.availability (new) | CREATE | Preserve layout; copy slots and page SEO |
| /availability | SEO / header / footer / links | availability.html | page.availability + business_settings | Existing settings; new page record | MERGE | 63 copy slots; 2 referenced media assets; SVG icons KEEP |
| /connect | — | connect.html: section.card | website_content | page.connect (new) | CREATE | Preserve layout; copy slots and page SEO |
| /connect | SEO / header / footer / links | connect.html | page.connect + business_settings | Existing settings; new page record | MERGE | 13 copy slots; 2 referenced media assets; SVG icons KEEP |
| /contact | Tell us what you’re planning. | contact.html: section.contact-hero | website_content | page.contact (new) | CREATE | Preserve layout; copy slots and page SEO |
| /contact | General Question; Ready to Book?; Corporate or Brand Activation | contact.html: section.contact-paths | website_content | page.contact (new) | CREATE | Preserve layout; copy slots and page SEO |
| /contact | Tell us enough to get started.; What are we celebrating? | contact.html: section.contact-main | website_content | page.contact (new) | CREATE | Preserve layout; copy slots and page SEO |
| /contact | Simple from inquiry to event day.; You send the details; We review availability; You receive next steps; Your date gets secured | contact.html: section.next-steps | website_content | page.contact (new) | CREATE | Preserve layout; copy slots and page SEO |
| /contact | Need more than a standard booth package? | contact.html: section.corporate-contact | website_content | page.contact (new) | CREATE | Preserve layout; copy slots and page SEO |
| /contact | Looking for pricing?; Not sure which booth?; Have a quick question?; Ready to move? | contact.html: section.contact-help | website_content | page.contact (new) | CREATE | Preserve layout; copy slots and page SEO |
| /contact | Let’s Make It Official. | contact.html: section.cta | website_content | page.contact (new) | CREATE | Preserve layout; copy slots and page SEO |
| /contact | SEO / header / footer / links | contact.html | page.contact + business_settings | Existing settings; new page record | MERGE | 99 copy slots; 2 referenced media assets; SVG icons KEEP |
| /events | The right experience for the right moment. | events.html: section.events-hero | website_content | page.events (new) | CREATE | Preserve layout; copy slots and page SEO |
| /events | Weddings; Birthdays; Corporate Events; Showers; Graduations; Private Events | events.html: section.event-overview | website_content | page.events (new) | CREATE | Preserve layout; copy slots and page SEO |
| /events | For the moments between the moments. | events.html: section.event-section | website_content | page.events (new) | CREATE | Preserve layout; copy slots and page SEO |
| /events | One more photo. Then five more. | events.html: section.event-section.alt.reverse | website_content | page.events (new) | CREATE | Preserve layout; copy slots and page SEO |
| /events | Built for guests. Designed for brands. | events.html: section.event-section | website_content | page.events (new) | CREATE | Preserve layout; copy slots and page SEO |
| /events | Beautiful memories before the next chapter begins. | events.html: section.event-section.alt.reverse | website_content | page.events (new) | CREATE | Preserve layout; copy slots and page SEO |
| /events | You did the work. Now make the memory. | events.html: section.event-section | website_content | page.events (new) | CREATE | Preserve layout; copy slots and page SEO |
| /events | If people are gathering, we can make it memorable. | events.html: section.event-section.alt.reverse | website_content | page.events (new) | CREATE | Preserve layout; copy slots and page SEO |
| /events | Start with the experience.; Build it with LOLA. | events.html: section.events-bottom | website_content | page.events (new) | CREATE | Preserve layout; copy slots and page SEO |
| /events | Let’s Make It Official. | events.html: section.cta | website_content | page.events (new) | CREATE | Preserve layout; copy slots and page SEO |
| /events | SEO / header / footer / links | events.html | page.events + business_settings | Existing settings; new page record | MERGE | 142 copy slots; 12 referenced media assets; SVG icons KEEP |
| /experiences | Four ways to make the moment unforgettable. | experiences.html: section.page-hero | website_content | page.experiences (new) | CREATE | Preserve layout; copy slots and page SEO |
| /experiences | Polished photos. Instant keepsakes.; Motion made for sharing.; Your cover-star moment.; Their voices. Your memories. | experiences.html: section.section | website_content | page.experiences (new) | CREATE | Preserve layout; copy slots and page SEO |
| /experiences | Let’s Make It Official. | experiences.html: section.cta | website_content | page.experiences (new) | CREATE | Preserve layout; copy slots and page SEO |
| /experiences | SEO / header / footer / links | experiences.html | page.experiences + business_settings | Existing settings; new page record | MERGE | 54 copy slots; 6 referenced media assets; SVG icons KEEP |
| /faq | Questions? We probably have an answer. | faq.html: section.page-hero | website_content | page.faq (new) | CREATE | Preserve layout; copy slots and page SEO |
| /faq | — | faq.html: section.section | website_content | page.faq (new) | CREATE | Preserve layout; copy slots and page SEO |
| /faq | Let’s Make It Official. | faq.html: section.cta | website_content | page.faq (new) | CREATE | Preserve layout; copy slots and page SEO |
| /faq | SEO / header / footer / links | faq.html | page.faq + business_settings | Existing settings; new page record | MERGE | 56 copy slots; 2 referenced media assets; SVG icons KEEP |
| /gallery | Real people. Real events. Better memories. | gallery.html: section.gallery-hero | website_content | page.gallery (new) | CREATE | Preserve layout; copy slots and page SEO |
| /gallery | Wedding moments, the LOLA way.; Movement changes everything.; Your cover moment. | gallery.html: section.gallery-featured | website_content | page.gallery (new) | CREATE | Preserve layout; copy slots and page SEO |
| /gallery | Find your kind of moment. | gallery.html: section.gallery-section | website_content | page.gallery (new) | CREATE | Preserve layout; copy slots and page SEO |
| /gallery | Let’s Make It Official. | gallery.html: section.cta | website_content | page.gallery (new) | CREATE | Preserve layout; copy slots and page SEO |
| /gallery | SEO / header / footer / links | gallery.html | page.gallery + business_settings | Existing settings; new page record | MERGE | 62 copy slots; 12 referenced media assets; SVG icons KEEP |
| / | Your event.Their favorite memory. | index.html: section.hero-v2 | website_content | page.home (new) | CREATE | Preserve layout; copy slots and page SEO |
| / | — | index.html: section.hero-marquee | website_content | page.home (new) | CREATE | Preserve layout; copy slots and page SEO |
| / | Choose Your Moment; Lola Glam; Lola 360; Lola Vogue; Lola Audio Guestbook | index.html: section.section | website_content | page.home (new) | CREATE | Preserve layout; copy slots and page SEO |
| / | Made for thecamera roll. | index.html: section.feature-band | website_content | page.home (new) | CREATE | Preserve layout; copy slots and page SEO |
| / | Whatever you’re celebrating,make it memorable.; Weddings; Birthdays; Showers; Graduations; Corporate Events; Private Events | index.html: section.section | website_content | page.home (new) | CREATE | Preserve layout; copy slots and page SEO |
| / | Something for everykind of celebration.; The Essential; The Signature; The Luxe; Custom | index.html: section.section.alt | website_content | page.home (new) | CREATE | Preserve layout; copy slots and page SEO |
| / | Real Moments.Happier People. | index.html: section.section | website_content | page.home (new) | CREATE | Preserve layout; copy slots and page SEO |
| / | Let’s Make It Official. | index.html: section.cta | website_content | page.home (new) | CREATE | Preserve layout; copy slots and page SEO |
| / | SEO / header / footer / links | index.html | page.home + business_settings | Existing settings; new page record | MERGE | 76 copy slots; 21 referenced media assets; SVG icons KEEP |
| /packages | Pick your experience.We’ll handle the details. | packages.html: section.packages-hero | website_content | page.packages (new) | CREATE | Preserve layout; copy slots and page SEO |
| /packages | One event. Four ways to LOLA.; Polished photos. Instant keepsakes.; The Essential; The Signature; The Luxe; Custom; Motion made for sharing.; The Essential; The Signature; The Luxe; Custom; Your cover-star moment.; The Essential; The Signature; The Luxe; Custom; Their voices. Your memories.; The Essential; The Signature; The Luxe; Custom | packages.html: section.pricing-showcase | website_content | page.packages (new) | CREATE | Preserve layout; copy slots and page SEO |
| /packages | Make it even more LOLA. | packages.html: section.section.alt.addons-wrap | website_content | page.packages (new) | CREATE | Preserve layout; copy slots and page SEO |
| /packages | Let’s Make It Official. | packages.html: section.cta | website_content | page.packages (new) | CREATE | Preserve layout; copy slots and page SEO |
| /packages | SEO / header / footer / links | packages.html | page.packages + business_settings | Existing settings; new page record | MERGE | 124 copy slots; 5 referenced media assets; SVG icons KEEP |
| /privacy | Privacy Policy | privacy.html: section.page-hero | website_content | page.privacy (new) | CREATE | Preserve layout; copy slots and page SEO |
| /privacy | SEO / header / footer / links | privacy.html | page.privacy + business_settings | Existing settings; new page record | MERGE | 30 copy slots; 2 referenced media assets; SVG icons KEEP |
| /terms | Terms | terms.html: section.page-hero | website_content | page.terms (new) | CREATE | Preserve layout; copy slots and page SEO |
| /terms | SEO / header / footer / links | terms.html | page.terms + business_settings | Existing settings; new page record | MERGE | 30 copy slots; 2 referenced media assets; SVG icons KEEP |
| /careers | Openings / fraud alert / SEO | Missing (404) | None | None | SKIP | Approved source required |

## Package mapping and evidence

Final prices below are locally verified, not a claim of production deployment. Homepage intentionally features Glam only.

| Package | Old homepage | Final homepage (local) | Packages page (local) | CMS (local; production before) | Status |
|---|---|---|---|---|---|
| glam — The Essential | $599 | $599 | $599 | $599; 599.00 | Local PASS; production pending |
| glam — The Signature | $899 | $899 | $899 | $899; 899.00 | Local PASS; production pending |
| glam — The Luxe | $1,499 | $1,499 | $1,499 | $1,499; 1499.00 | Local PASS; production pending |
| glam — Custom | Custom Pricing | Let’s Create Together | Custom | Custom; 0.00 | Local PASS; production pending |
| 360 — The Essential | Not featured | Not featured | $699 | $699; not present | Local PASS; production pending |
| 360 — The Signature | Not featured | Not featured | $1,099 | $1,099; not present | Local PASS; production pending |
| 360 — The Luxe | Not featured | Not featured | $1,699 | $1,699; not present | Local PASS; production pending |
| 360 — Custom | Not featured | Not featured | Custom | Custom; not present | Local PASS; production pending |
| vogue — The Essential | Not featured | Not featured | $899 | $899; not present | Local PASS; production pending |
| vogue — The Signature | Not featured | Not featured | $1,499 | $1,499; not present | Local PASS; production pending |
| vogue — The Luxe | Not featured | Not featured | $2,299 | $2,299; not present | Local PASS; production pending |
| vogue — Custom | Not featured | Not featured | Custom | Custom; not present | Local PASS; production pending |
| audio — The Essential | Not featured | Not featured | $299 | $299; not present | Local PASS; production pending |
| audio — The Signature | Not featured | Not featured | $449 | $449; not present | Local PASS; production pending |
| audio — The Luxe | Not featured | Not featured | $699 | $699; not present | Local PASS; production pending |
| audio — Custom | Not featured | Not featured | Custom | Custom; not present | Local PASS; production pending |

## Import plan (isolated database simulation)

These are planned counts against a reconstructed baseline, not production migration totals.

| Area | Status | Created | Updated | Skipped | Notes |
|---|---|---:|---:|---:|---|
| Homepage | Local validated / production pending | 10 | 0 | 0 |  |
| Packages | Local validated / production pending | 12 | 4 | 0 |  |
| Experiences | Local validated / production pending | 1 | 6 | 0 |  |
| Hero | Local validated / production pending | 6 | 0 | 0 |  |
| Gallery | Local validated / production pending | 10 | 0 | 0 |  |
| Events | Local validated / production pending | 1 | 6 | 0 |  |
| FAQs | Local validated / production pending | 0 | 0 | 40 |  |
| Testimonials | Local validated / production pending | 0 | 0 | 0 | Preserve all existing records |
| Media | Local validated / production pending | 22 | 0 | 0 | 21 files plus one asset mapping record |
| About | Local validated / production pending | 1 | 0 | 0 |  |
| Careers | GAP | 0 | 0 | 0 | No approved source |
| SEO | Local validated / production pending | 0 | 0 | 0 | Included in page records |
| Site Settings | Local validated / production pending | 0 | 1 | 0 |  |
| Social | Local validated / production pending | 0 | 0 | 0 | Included in Site Settings |
| /connect | Local validated / production pending | 1 | 0 | 0 |  |

Local plan total: 64 created, 17 updated, 40 skipped. Media files: 21. Repeat simulation: all 121 records skipped, no duplicate insertion. Production applied totals: 0 so far.

## Deployment procedure and safety

1. Verify production schema and take a restorable database/content backup. Do not run the blanket migration command: migrations 016–020 are outside this task’s scoped authorization.
2. Review/apply only forward migration 021. It adds package experience relationships, display metadata, nullable Custom pricing, per-experience uniqueness, media checksums and private import state.
3. Run npm run cms:import-live-content -- --dry-run against production. Review CREATE / UPDATE / SKIP / CONFLICT output. Any conflict blocks the whole import.
4. Verify current public asset checksums match the manifest. Apply the import from the API service environment with its persistent media storage. Database writes are transactional; uploaded bytes use content-addressed keys. A rollback may leave unreferenced files, which a retry reuses.
5. Rerun dry-run: expect only SKIP. Test admin editing, publishing, unpublishing, ordering and preview.
6. After tests/build and pricing verification, commit and push both repositories, deploy API and public site, and capture live desktop/mobile evidence.

Manual edit protection compares managed snapshots on reruns; on initial import it checks the captured public baseline and refuses records updated since capture. Existing unknown drafts and deleted records conflict rather than being revived. Existing media is deduplicated by stored or computed SHA-256; private/restricted identical media is never automatically made public.

## Validation evidence

- npm test and npm run build passed before the final validation run; final results recorded in the migration status report.
- Local PostgreSQL tested migration 021 on schema 001–015, import dry-run with READ ONLY transaction, apply, repeat-import SKIP, manual-edit conflict, package publish filtering and draft preview.
- Local CMS services tested edit/save, publish/unpublish, reorder and preview on FAQ records. Browser admin UAT and production UAT remain required.
- Headless Chrome tested 12 routes at 1440px and 390px, images, overflow, page titles, 16 prices, shared API override, unpublish and offline fallback. Evidence: audit-output/website-cms/local/.
- All page headings, text slots, link destinations, assets and SEO values are preserved in server/import-data/live-website.json.
