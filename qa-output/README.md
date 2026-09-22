# LOLA customer document and email QA

Verified September 21, 2026. This supersedes the earlier September 15 visual-QA claim.

## Result

Local PDF and browser visual QA passed. Production launch certification is still blocked by database migrations, email DNS/delivery, backup/restore evidence, and payment UAT. Local previews do not prove Outlook/Gmail rendering or inbox delivery.

## What changed

- Proposal PDFs retain all custom sections and bullet lists. Long content continues on numbered pages instead of clipping into fixed boxes or disappearing after section seven.
- The compact three-column summary is used only when all content fits. The standard fixture has 3 pages; the corporate fixture has 2. Page count is intentionally driven by content.
- Invoice rows use measured heights and continuation pages. Long terms wrap and paginate. Payment details include discount, tax, amount paid, and a correctly preserved zero balance. The fixture has 2 pages.
- QR modules now use exact sizing and a four-module quiet zone. The QR was actually decoded from the rasterized invoice PDF to the expected stable invoice URL.
- Emails fit desktop and 390px mobile layouts, use hosted PNG feature icons, have centered mobile logos, a legible hero overlay, and text labels instead of ambiguous footer symbols.
- Sample email links and PDF QR links consistently use the admin domain's public document routes.

## Evidence

- `manifest.json`: artifact inventory, page counts, browser and QR results.
- `mobile-overflow-report.json`: all five emails at desktop and mobile widths; no horizontal overflow, missing image, or invisible hero background.
- `qr-verification.json`: actual decoded invoice QR value and source image.
- `screenshots/`: 10 full-page email screenshots plus every PDF page. All seven PDF pages and the email layouts were visually reviewed.
- Regression suite: 146 tests passed, including long custom proposals, late bullet lists, 35-row invoices, zero outstanding balance, and rendered-PDF QR decoding. Production build passed.

The sample client is fictional Avery Johnson / Northstar Events Group. The proposal/invoice fixture tokens do not identify live customer records. HTML previews use relative `../public` brand assets so the preview folder works alongside the repository's `public` directory; production emails use configured HTTPS asset URLs.

## Reproduce

Install development dependencies with `npm ci`. Chrome must be installed, or set `LOLA_CHROME_PATH` to a Chrome executable. Poppler (`pdftoppm` and `pdfinfo`) is required for PDF screenshots.

```sh
npm run check
LOLA_CAPTURE_SCREENSHOTS=1 npm run qa:documents
```

Set `PDFTOPPM` and `PDFINFO` if Poppler is not on PATH. Set `FONTCONFIG_FILE` if a bundled Poppler needs a system font configuration. `LOLA_SKIP_BROWSER_QA=1` generates samples without browser verification and records `NOT_RUN`; do not treat that as a full pass.

## Remaining visual / delivery work

The approved booth hero photograph and handwritten signature asset are not in `public/brand`. The existing logo photograph and italic signature remain as fallbacks. Hosted PNG assets must be deployed alongside the email renderer. Real inbox/mobile email-client checks and a physical-phone QR scan are still required; no customer emails were sent during this QA.
