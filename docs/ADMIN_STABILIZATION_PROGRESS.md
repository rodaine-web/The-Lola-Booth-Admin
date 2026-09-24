# Admin product stabilization — local only

Branch: `codex/admin-product-stabilization`. See [final report](ADMIN_STABILIZATION_REPORT_2026_09_24.md) for scope, evidence and remaining acceptance gates.

No deployment, push, staging provisioning, live database mutation, real external mail, SMS or payments. Public website V1 remains frozen. Disposable PostgreSQL and isolated browser fixtures only.

## Completed and verified in this pass

- [x] Reproduce real Communications SQL, browser error-state, date/format and invoice balance defects; preserve before/after evidence.
- [x] Repair Communications query and recovery; implement compose, search/sort/pagination and lifecycle guards.
- [x] Preserve DATE-only values at database and display boundaries; share money/count/status formatting.
- [x] Reconcile zero/null invoice balance reads and normalize non-taxable invoice rates without inventing historical lines.
- [x] Group grantable user privileges and exercise real account/invitation/session lifecycle.
- [x] Redesign Dashboard, add real readiness, unify primary Analytics metrics and explicitly exclude classified QA records.
- [x] Inventory and simplify navigation; intentionally hide standalone Files/Galleries.
- [x] Add Staff/Equipment create/edit/history UI and exercise actual assignment and equipment lifecycle.
- [x] Add named Calendar/Task selectors, real controls and responsive layout fixes.
- [x] Improve Integrations/Health accuracy, Audit/Settings presentation and CMS grouping/thumbnails.
- [x] Verify continuous local inquiry-to-invoice journey and selected real browser CRUD/send flows.
- [x] Record 169 automated tests, 7 service groups, 6 browser regressions, 25 integration groups including 45 responsive checks.
- [x] Produce module matrix, defect matrix, navigation decisions and staging readiness report.

## Remaining acceptance gates — not completed

- [ ] Full four-role UI/API matrix and intended-user lifecycle for every module.
- [ ] Full failure/retry/restart/concurrent update and operational conflict/incident qualification.
- [ ] Uploaded-proposal full version/acceptance UAT and remaining task/calendar/staff flows.
- [ ] Historical classification review and authorized classification workflow.
- [ ] Exact chart drilldowns, remaining CMS/media and audit-detail usability.
- [ ] Complete editor/modal/error-state responsive review and owner visual approval.

ADMIN NEEDS ANOTHER DEVELOPMENT PASS

PAYMENTS: DEFERRED

PRODUCTION DEPLOYMENT: NOT AUTHORIZED
