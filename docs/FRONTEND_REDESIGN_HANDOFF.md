# LOLA Admin — supplied-design implementation

Branch: `main-staging`. User deploys staging manually. No production changes or deployment commands.

## Visual reference

This revision follows the two images supplied by the user: **LOLA Photo Booth Dashboard.png** and **LOLA Booth Admin Dashboard Showcase.png**. These supersede the earlier interpretation based only on the written conversation.

The admin now has the gold LOLA wordmark, black sidebar, white canvas, compact borders and spacing, serif page headings, understated tables, gold tabs, and consistent reusable controls. The dashboard uses the reference's four KPIs, greeting and script lettering, photographic banner, grouped bars, central-total doughnut, three-column cards, experience photographs, and proposal call to action.

Page changes include combined lead names and compact tables; a contact-led Lead Detail with quick actions and expandable advanced fields; calendar-first Events; compact Event Command Center with tabbed operations, selected-experience images and expandable venue/creative notes; simpler proposal steps with editable contact and optional fields folded away; compact invoice creation; photo-led catalog rows; table-based Staff/Equipment and System Health; CMS page navigation and large image previews; analytics report tabs and revenue line chart; and consistent finance, communications, gallery, settings and system presentation.

## Preserved behavior

Existing API endpoints, payloads, backend services, database schema, financial calculations, approval/sending behavior, duplicate handling, permissions and advanced editors remain in place. New calendar cells respect the API's business week range and use date-only UTC arithmetic. List requests and linked proposal creation continue using existing contracts.

The charts use **booked and collected revenue**, which the existing API provides. The reference's mixed revenue/proposal/booking chart was not populated with invented series. The reference testimonial is replaced with brand copy because no authenticated testimonial data is available on the dashboard. Existing approved experience photos are reused. Invoice creation retains the existing deposit-request behavior rather than introducing different payment rules.

## Verification

- Final `npm test`: **319 tests; 314 passed; 5 intentionally skipped; 0 failed**.
- Final staging frontend build: **passed** (`npm run build -- --configLoader runner`; runner avoids writing through the existing dependency symlink).
- `git diff --check`: passed.
- Browser checks of the built local preview: dashboard at 1536×1024, calendar month navigation, all seven Event Command Center operation sections, linked proposal client/event prefill, service/package selection and review, priority page rendering, and mobile menu opening/Escape dismissal at 390×844. Mobile document width remained 390px.
- New calendar tests cover leap day, six-week months, API-specified Monday weeks, and date-only day selection.
- Historical logo-text tests were updated for the supplied gold wordmark direction. Public document logo assertions remain in place.

Browser verification uses local sample data and blocks every non-GET API request. It does not certify real staging email delivery, payments, uploads, or publication. After manual deployment, verify these with existing staging records. The reusable browser regression script has been updated for the new headings and folded contact section; this revision's interactive checks used the Codex browser.

## Generated banner asset

Saved project asset: `public/brand/admin/dashboard-banner.png`. Created with the built-in image-generation tool from the supplied full-dashboard reference. It recreates the photograph; the headline and button are HTML.

Prompt: “Extract/recreate ONLY the photograph inside the top-right black banner of this dashboard reference. Show the same glamorous Black woman wearing black oversized sunglasses, gold hoop earrings, black jacket, warm skin, facing slightly left looking up, positioned in right half of a wide landscape frame. Black studio background, entire left half pure dark black negative space for HTML text. Preserve closely her appearance, composition and lighting from the reference photograph. Remove ALL existing headline, button, UI borders and dashboard elements. Output just the clean photograph, landscape aspect about 2:1. No letters, no words, no buttons, no watermark.”

## Manual deployment

Use the staging Vercel project and `main-staging`; retain its current staging API URL and feature flags. Verify dashboard, leads/clients, proposal creation from a linked event, event actions, accepted-proposal invoicing, communications, galleries, CMS, staff/equipment, analytics and settings. Do not promote to production as part of this sprint.

## Proposal email link and PDF follow-up (October 2, 2026)

The delivered demo HTML email's secure link reached an older staging website proposal page with a hardcoded production API origin, resulting in `Failed to fetch`. The current `public/staging-site/proposal.html` reads `/config.js`, whose staging configuration points at `https://stagingapi.thelolabooth.com`. Host-scoped Vercel rewrites serve this page at `/proposal/:token`. Deploy the staging website as well as the admin and staging backend; deploying only the admin will not replace the hosted public page or PDF renderer. Do not alter production routing or configuration.

The corrected local `/proposal/:token` route was verified against the real staging API with TLBP-1005: proposal details and HTML preview loaded, with a PDF download URL targeting the staging proxy. The hosted correction remains pending the user's manual deployment. After deployment, open the existing emailed link, confirm TLBP-1005 loads, download its PDF, and check the email's separate `?download=pdf` action. Do not accept or pay the demonstration proposal.

The PDF renderer now uses consistent measured headings, shared margins and numbered footers, readable date/time, selected package labels, compressed experience photos, a deduplicated supporting photo gallery, and pagination for scope rows and saved terms. It preserves saved totals and zero deposits and displays subtotal/discount/tax when supplied. The proposal query now includes the linked event's guest count, avoiding a missing guest count in generated documents. No financial calculations or proposal lifecycle changes were made.

A six-page representative TLBP-1005 demo PDF using the supplied Glam photographs was generated and visually reviewed. Size: 669,116 bytes (approximately 0.67 MB). It is a local preview of the updated renderer, not a replacement of the hosted download before deployment.

Verification: 336 tests, 331 passed, 5 skipped, zero failures; staging frontend build passed. Added regressions check long pricing/terms pagination, continuous page numbering, zero deposit retention, and staging website route/config isolation.
