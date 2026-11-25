# Public navigation and package add-ons — staging

- Restored celebration add-ons from the published pricing catalogue, filtered to the selected experience. Published prices and quote-only pricing labels are preserved. Compatible selected extras travel with each package link and remain selected in booking; included package extras are excluded from duplicate selections. Additional hours/travel remain informational under the existing booking rules and are confirmed in the proposal.
- Removed visible Home links from public website navigation and footers. Header/footer logos retain home navigation.
- Added one shared React header/prefooter/footer for Shop, Gallery discovery, photo lookup, gallery-code access, loading/unavailable states and authorized gallery pages. The website's full navigation, contact details, social icons, legal links and booking destination are preserved.
- Updated Privacy, Terms and Connect to use the same marketing header, booking banner and full footer. Legal text and contact-saving behavior are preserved.
- Website and React booking banners now use the same existing event photograph. The previous background contained baked-in copy that competed with live headings.
- Corrected add-on image proportions, narrow website header behavior and the station table's contained horizontal scrolling.

No database migration, CMS publication, pricing-policy change, payment execution or customer email. Production is untouched.

Validation: cross-site browser checks at 1440, 768, 390 and 320 px compare navigation/footer destinations, absence of Home links, booking banner/contact content, mobile menus, overflow and selected-add-on handoff into the booking form. Shop catalogue, secure photo entry and guest-photo previews pass their existing browser checks. The real disposable-database pricing/Admin/website browser regression also passes with the updated navigation expectations.

Follow-up: shared public fonts are served locally with their SIL licenses, removing the external stylesheet import that failed in a live browser. Seven owner-supplied PNGs are copied unchanged as illustrative product examples. Keychain, magnet, premium acrylic, framed-strip and book examples are shared by Shop/Admin/proposal previews and the station catalogue; alternate book/frame examples are available before selecting a personal photo. Personal-photo rendering and product verification remain unchanged.

The follow-up adds a browser regression against the built application chunks with all third-party requests blocked. This catches stylesheet-preload failures that Vite development-mode tests do not exercise. The DM Sans and Playfair Display variable fonts come from the official Google Fonts repository and retain their SIL Open Font License files. Source PNGs are preserved unchanged and loaded lazily; their illustrative status does not verify supplier construction or enable purchasing.

Latest owner edits: Gallery and For Event Clients are removed from Keepsakes header menus, including mobile Gallery navigation. The shared footer retains its sitemap. Two additional supplied examples map explicitly to Metal Photo Prints and Personalized Postcards. Collection-strip disclosures are replaced by one note outside the thumbnails, preventing labels from covering the images. Product examples are contained in their preview bounds so square artwork is not clipped by landscape containers. Built-browser checks verify all 12 previews, seven supplied primary thumbnails, unclipped geometry, matching image mappings and menu removals.
