# Composable proposals — staging implementation

Event type selects tone, copy defaults and imagery category. Selected experiences inject ordered pages and experience copy. Packages inject authoritative catalog scope, duration and pricing. Six event types × 15 nonempty selections yield 90 combinations from one composition engine, without scenario-specific templates.

Supported event types: Wedding, Birthday, Private Party, Brand Activation, Corporate Event, Other (custom wording). Website CMS labels such as Weddings, Corporate Events and Private Events normalize to these scenarios. Supported experiences: Glam Photo Booth, 360 Video Booth, Vogue Booth, Audio Guestbook. One to four selections retain user ordering.

## Booking handoff
Website inquiry ingestion already preserves contact, company, date, start/end times, guests, venue/address/city/state/zip, referral, message and selected catalog IDs. The proposal wizard hydrates those fields, preselects experience/package by ID, and uses the customer's message as client-facing notes. Internal lead notes remain internal. The lead detail API returns complete catalog records and package items. A mismatched package is not silently attached to a different booth. A missing selection remains visibly incomplete until corrected.

## Editable defaults and snapshots
Settings → Proposal Templates edits global, event, experience and package-description defaults, approved image selections, next steps and terms. Updates use optimistic version checking and existing audit/permissions. Per-proposal overrides never mutate master defaults. Package inclusions/hours/prices remain catalog-controlled; review can explicitly override proposal-specific copy and inclusions. Optional brand scope sections are added individually.

The server builds one frozen content.scenario model with public-safe event/client fields, financials and approved image bytes. HTML preview, public presentation and PDF use that model. Existing tokens, IDs, versions, communications and acceptance services remain in use. Accepted public views retain their accepted snapshot. Composed invoice creation inherits quoted discount, tax, deposit and balance and preserves the existing one-active-invoice rule. Legacy documents retain their existing renderer.

## Deployment prerequisite
Apply server/migrations/036_composable_proposal_templates.sql to the STAGING database before deploying the new backend/frontend. It adds config JSONB and version INTEGER to the existing proposal_document_templates table and seeds the single scenario_composer entry. No production migration or Vercel deployment was performed.

Deploy backend and frontend from the same staging commit. The existing deployed backend does not yet expose /proposals/preview or /proposal-scenario-template; full live creation/send/accept/invoice verification is pending that deployment.

## Verification
Full automated suite and staging-configured production frontend build completed. Tests cover all 90 combinations, catalog inclusions, ordering, copy overrides, missing media, custom event wording, malformed configuration, long PDF prose, HTML/PDF parity, financial adjustments, accepted snapshot immutability and invoice inheritance. Booking regression tests normalize a complete Wedding / 360 / Signature submission and verify prefilled IDs, event fields, customer notes and catalog scope. Browser read-only verification uses an existing website integration lead. Four demonstration PDFs use supplied real Glam/360 photographs; Vogue/Audio use neutral placeholders until approved media is selected. Demonstration prices are fixtures, not live quotes.

## Manual staging UAT
1. Apply migration 036 and deploy matching backend/frontend; confirm template settings and preview load.
2. Submit a Wedding booking with 360 Video Booth / Signature. Open its lead and create a proposal. Verify contact/company, event date/times, guests, venue/full address, customer message and selected IDs.
3. Check package hours, inclusions and amount against catalog; change selection and confirm live preview updates before creation.
4. Review all six event types, Other wording, all four experiences singly and together, selected order and missing optional fields/media.
5. Test add-ons/quantities, travel, custom lines/pricing, discounts, tax, fixed/percentage deposits; compare HTML, downloaded PDF and invoice totals.
6. Edit master defaults; confirm new drafts update and existing/accepted snapshots do not. Test proposal-only overrides, approved imagery and optional brand sections.
7. Send a demo to an authorized test recipient. Verify secure view and PDF links, accept via existing form, create one invoice, confirm inherited deposit/balance and duplicate invoice protection.
8. Verify legacy proposal rendering/acceptance, uploaded documents, permissions, audit and communications. Inspect desktop/mobile HTML and every PDF page. No production rollout until UAT passes.

## October 3 visual correction
The shared HTML/PDF renderer now follows the supplied editorial composition: full-height cover photo rail, embedded Cormorant Garamond and Great Vibes fonts (SIL OFL licenses bundled), gold outline icons and checkmarks, six event fact blocks with complete venue/address/ZIP, portrait experience panels, divided deposit/balance amounts, and shaded next steps/terms. Long content retains measured PDF continuations. Separate event and experience imagery prevents a booth photo from becoming an unrelated event cover fallback. These are rendering changes; catalog pricing, selected packages, tokens, accepted content snapshots and delivery logic are unchanged.

Visual proofs use the customer's supplied wedding and booth photographs. The reference collages include different generated wedding scenes and branded activation scenes; those original image assets have not been supplied as standalone approved CMS media. Brand/event sections without approved images remain visibly neutral. Deploy the staging backend for the new renderer to appear in public HTML/PDF. Demo proofs are review fixtures, not sent proposals or catalog quotes.

### October 4 UAT remediation
Newly generated scenario documents freeze reviewed customer-supplied cover, event, why-LOLA and experience photographs. Wedding imagery is separate from brand/corporate imagery. CMS-approved media takes precedence. The existing Vogue and Audio catalog illustrations are used only when those experiences have no selected approved photos. Existing sent/accepted snapshots remain unchanged: generate a new demo to inspect the corrected design.
Database times containing seconds now render as `5:00 PM`, and the admin heading and email greeting use the frozen proposal identity. Review fixtures can be generated with `LOLA_QA_OUTPUT_DIR=/absolute/review/folder node scripts/proposal-remediation-proof.mjs`.
