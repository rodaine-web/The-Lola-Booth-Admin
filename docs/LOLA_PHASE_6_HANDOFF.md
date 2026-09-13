# LOLA Admin Phase 6 Handoff

## Completed

- Added Phase 6 database migration `009_phase_6_website_cms.sql`.
- Added website CMS metadata for media, hero slides, gallery items, homepage content, testimonials, FAQ, site settings, SEO, packages, experiences, and public event types.
- Added `website_event_types` and `website_content_versions` tables.
- Added backend CMS service for media upload validation, publish/unpublish/archive, reorder, media usage checks, public-safe projections, draft preview payloads, and website defaults.
- Added authenticated Admin routes under `/api/website/*`.
- Added read-only public website sync routes under `/api/public/*`.
- Added public media serving that only exposes `PUBLIC` + `APPROVED` media.
- Added a top-level Website section in Admin with Homepage, Hero Slides, Gallery, Packages, Experiences, Events, Testimonials, FAQ, Media Library, and SEO / Site Settings.
- Added a reusable `WebsiteCms` admin screen with draft save, publish, unpublish, archive, reorder controls, authenticated preview, media upload, and site settings editing.
- Extended package and experience admin forms with website visibility/content fields.
- Preserved the Phase 5B stacked-logo rule for public website/customer-facing experiences.

## Public API

- `GET /api/public/site`
- `GET /api/public/homepage`
- `GET /api/public/hero-slides`
- `GET /api/public/packages`
- `GET /api/public/experiences`
- `GET /api/public/events`
- `GET /api/public/gallery`
- `GET /api/public/testimonials`
- `GET /api/public/faqs`
- `GET /api/public/media/:id`

## Admin API

- `GET /api/website/defaults`
- `GET /api/website/preview`
- `GET/PATCH /api/website/site-settings`
- `GET/POST /api/website/media`
- `PATCH/DELETE /api/website/media/:id`
- `GET /api/website/media/:id/file`
- `GET/POST /api/website/:type`
- `PATCH /api/website/:type/:id`
- `POST /api/website/:type/:id/publish`
- `POST /api/website/:type/:id/unpublish`
- `POST /api/website/:type/:id/archive`
- `POST /api/website/:type/reorder`

Supported CMS types: `hero`, `gallery`, `content`, `testimonials`, `faqs`, `eventTypes`.

## Safety Rules

- Media uploads validate MIME and magic bytes.
- Uploads cap at 10 MB.
- Public gallery items require approved public media.
- `DO_NOT_PUBLISH` media is blocked from publishing.
- Hero/gallery publishing requires alt text.
- The final active published hero slide cannot be unpublished.
- Public payload includes a safe fallback hero using the stacked LOLA logo if no published hero exists.
- Authenticated preview returns draft content and sends `X-Robots-Tag: noindex, nofollow`.

## Known Limitations

- The repo does not include the already-designed marketing website app, so Phase 6 provides the CMS/admin/public API sync layer for that website to consume.
- Image optimization is scaffolded through metadata and safe serving, but true resized WebP/AVIF derivative generation needs an image processing dependency such as Sharp.
- Drag-and-drop is represented by explicit move/reorder controls in this phase.
- Event gallery to website publishing is supported through website gallery records referencing media; a richer event-detail multi-select modal can be added in a later workflow pass.

## Verification

- `npm test` covers Phase 6 schema, routes, permissions, media safety, public API exposure, admin Website navigation, and stacked-logo rule.
- `npm run build` passes.
- `npm run db:migrate` applied migration 009 successfully.
- Live smoke tested authenticated `/api/website/preview` and public `/api/public/site`.

## Manual QA

1. Log in as owner.
2. Open Website > Media Library and upload a JPEG, PNG, or WebP.
3. Mark the media `PUBLIC` and `APPROVED`.
4. Open Website > Hero Slides, create a slide with that media ID, add alt text, set focal point, save draft, preview, then publish.
5. Confirm `/api/public/site` returns the published hero instead of the fallback.
6. Open Website > Gallery, create a gallery item using approved public media, publish it, and confirm `/api/public/gallery` returns it.
7. Update Website > Homepage JSON content and confirm authenticated preview shows drafts while public endpoints only show published content.
8. Update Website > SEO / Site Settings and confirm `/api/public/site` reflects the new contact/social/SEO fields.

## Phase 7 Readiness

Phase 6 stops here. The foundation is ready for Phase 7 to connect the separate designed public website frontend, add richer image derivatives, and refine event-gallery publishing UX.
