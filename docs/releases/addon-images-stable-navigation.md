# Add-on illustrations and stable packages navigation

Configured add-on policy keys and legacy names resolve to bundled illustrative assets, with category-based fallback for new names. Booking add-ons no longer show empty image placeholders; business offerings on the packages page use the same illustrations. No external image requests or generated product photos are introduced.

The packages-page desktop and mobile menus retain their intended static order and omit the redundant Home link (the logo still links home). CMS copy/ordering no longer mutates these fixed menus, so the audience-specific Book Now / Request a Quote CTA remains last and cannot be moved by a late CMS response. Other pages retain existing CMS behavior.

Validation: bundled-image coverage test across configured and legacy add-ons; real PostgreSQL/API desktop/mobile regressions verifying populated image cards, stable navigation after CMS loading, no extra Home item and CTA-last ordering after Business selection. Build and full regression suite passed. Staging only; no production changes.
