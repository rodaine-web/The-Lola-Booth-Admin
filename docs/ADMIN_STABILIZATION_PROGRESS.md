# Admin product stabilization — local only

Baseline: September 24 audit; branch `codex/admin-product-stabilization`.

## Boundaries

No deployment, push, staging provisioning, live database mutation, real external mail, SMS or payments. Public website V1 remains frozen. Synthetic disposable PostgreSQL fixtures and development email only. Preserve unrelated existing working-tree changes.

## Consolidated work packages

- [ ] Reproduce defects with executable service/browser cases; retain before/after evidence.
- [ ] P0 Communications query, loading/error/retry and complete development-provider lifecycle.
- [ ] P0 date-only vs timestamp semantics; shared money/count/status formatting.
- [ ] P0 authoritative invoice balances and legacy classification without invented line items.
- [ ] P0 Users lifecycle, grouped privileges, server role enforcement and UI UAT.
- [ ] P1 Dashboard operations redesign, real chart links/readiness and consistent Analytics.
- [ ] P1 navigation inventory and finance duplication decisions.
- [ ] P1 complete Leads/Clients/Proposals journeys, calendar and tasks.
- [ ] P1 equipment and staff lifecycle and event operations.
- [ ] P2 complete or intentionally hide Files/Galleries; integration/health accuracy.
- [ ] P2 Audit/Settings and page/section-oriented CMS usability.
- [ ] Full local business journeys, role/retry/concurrency, responsive visual review.
- [ ] Final area matrix, before/after navigation, exact test counts and staging readiness verdict.

Each item requires evidence beyond a rendered table or successful response. Payments excluded from scoring. No staging is created automatically even if the quality gate passes.
