# LOLA External Website Integration

The customer-facing marketing website now lives outside this repository. This repository remains the LOLA operating system: Admin, backend/API, PostgreSQL migrations, worker, Website CMS, public data APIs, public inquiry intake, and secure customer transaction pages.

The external HTML/CSS/JS website should consume the public API routes documented below. Do not duplicate CMS data in the website frontend.

## Public Read APIs

- `GET /api/public/site`: complete public website payload with settings, defaults, hero slides, packages, experiences, event types, gallery, testimonials, and FAQs.
- `GET /api/public/homepage`: homepage-focused public content.
- `GET /api/public/hero-slides`: published homepage hero slides.
- `GET /api/public/packages`: public package cards and pricing display data.
- `GET /api/public/experiences`: public booth/experience records.
- `GET /api/public/events`: public event type records.
- `GET /api/public/gallery`: public gallery media. Supports category filtering where enabled by the API.
- `GET /api/public/testimonials`: public testimonials.
- `GET /api/public/faqs`: public FAQs.
- `GET /api/public/media/:id`: public media delivery where configured.

## Public Inquiry API

- `POST /api/public/inquiries`

Expected customer inquiry fields include:

- `firstName`
- `lastName`
- `email`
- `phone`
- `eventDate`
- `eventStartTime`
- `eventEndTime`
- `eventType`
- `guestCount`
- `venueName`
- `venueAddress`
- `city`
- `state`
- `zip`
- `preferredExperienceId`
- `preferredPackageId`
- `referralSource`
- `message`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `landing_page_url`
- `referrer_url`
- `marketing_email_opt_in`
- `website`

The `website` field is a honeypot and should be left empty by real users.

## CORS

The backend should allow the real external website origin through environment-driven CORS configuration. Do not hardcode a placeholder future production domain.

## Retained Admin Controls

The Admin Website CMS remains the source of truth for:

- Homepage
- Hero Slides
- Gallery
- Packages
- Experiences
- Events
- Testimonials
- FAQ
- Media Library
- SEO / Site Settings

## Transactional Customer Pages

The public proposal, invoice, payment, receipt, and delivery token pages remain part of this repository. They are operational customer flows, not the removed marketing website.
