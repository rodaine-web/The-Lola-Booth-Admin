# LOLA Admin frontend redesign — staging handoff

Branch: `main-staging`. Deployment is manual. No deployment command was run.

## Result

The combined staging branch uses the approved dark sidebar, cream/white canvas, and gold/black LOLA branding across the dashboard, sales, events, finance, communications, CMS/catalog, roster, analytics, and system workspaces. Existing redesign commits were retained and integrated.

This sprint adds shared page headings, record sections, metrics and section navigation; reachable mobile navigation with Escape dismissal and accessible names; creation-menu dismissal; protection against outdated search responses; clearer event sections and subnavigation; lead/client profile hierarchy; linked client/event context in the three-step proposal wizard; and staging CMS cards with image previews in the editor.

Existing event actions and proposal payload shapes remain in place. Linked-event proposal creation reuses the existing client/event and lets the existing server associate the opportunity. Advanced editors remain available. Duplicate-merge reviews receive the full selected record so their existing handlers submit the correct ID.

No server, database, API contract, payment integration, worker, deployment configuration, or production branch changes were made by this sprint.

## Verification

- `npm test`: 315 tests, 310 passed, 5 intentionally skipped, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- `scripts/frontend-redesign.browser.mjs`: passed against a local preview of the built assets with intercepted mock API responses.
- Browser checks cover desktop/mobile navigation, event section visibility, the existing creative-update request, linked proposal creation without duplicate client/event creation, CMS preview/editor fields, and priority workspace rendering. No browser runtime errors were detected.

Browser verification uses fixtures. It does not certify real staging email delivery, Stripe payments, uploads, CMS publication, or external integrations. Perform a short staging UAT with existing records after your manual deployment.

## Manual staging deployment

1. Select `main-staging` in the staging Vercel project and deploy its latest commit.
2. Keep the project's existing staging environment variables. In particular, use `VITE_APP_ENV=staging` and the staging API URL. Keep the current gallery/CMS feature flags.
3. Verify login, dashboard, mobile menu, lead/client detail, proposal creation from a linked event, event staffing/equipment/checklist actions, accepted-proposal invoicing, communications, gallery, CMS, roster, analytics, and settings with staging data.
4. Do not promote this deployment to production as part of this sprint.

## Repeating the browser check

Serve `dist` with SPA fallback at the root and its assets at `/customer-documents/assets/`, matching the existing application routing. Run:

```sh
FRONTEND_PREVIEW_URL=http://127.0.0.1:4173 node scripts/frontend-redesign.browser.mjs
```

The script uses the installed Playwright browser by default. `BROWSER_EXECUTABLE` can select an existing browser executable, and `SCREENSHOT_DIR` can save desktop/mobile preview images. All API responses are intercepted within the test browser.
