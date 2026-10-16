# Integrations marketplace redesign

Scope: System → Integrations only. Single continuous page following the three approved references; the existing sidebar, global header and routes remain intact. Built from the production branch so unfinished V1.2 gallery work is excluded.

## Implementation

- Central 35-application catalog with categories, recommendations, official websites, local logo provenance and letter fallback.
- Read-only `/api/integrations/marketplace` under `read:integrations`: actual recorded connection/payment/email evidence, unique-provider metrics, date-filtered lead counts and payload-free activity. No provider calls or synchronization run when loading the page.
- Shared management dialog with existing external OAuth, account selection, verification, sync, reports and logs. Planned apps cannot connect. Existing native provider settings and disable controls remain permission guarded.
- Microsoft discovery keeps its existing connection, source/date/exclusion filters, CC/BCC, incremental discovery, cancellation, retry, selection and import-review flow. History now reports actual candidate counts. New/existing columns describe current CRM matches rather than claiming historical imports.
- No new tables, migrations, packages, environment variables, permissions, scopes, worker flags or payment/marketing dispatch changes.

## Qualification

Local available suite: 677 tests; 656 passed; zero failed; 21 conditional skips. Production build and syntax/diff checks pass. No lint/type-check scripts exist in this JavaScript repository. The two legacy text-based integration assertions were updated for controls moved into the shared management component; the underlying behaviors remain checked.

Local native Chromium launch was blocked by host sandbox permissions. The full browser suite is included in CI rather than recorded as locally passing. An in-app browser visual preview uses explicitly synthetic local fixtures, not staging provider evidence. First pass found shell heading precedence; second pass corrected typography. DOM overflow checks pass at 1920, 1440, 1280, 1024, 768 and 390px.

CI must qualify the disposable PostgreSQL marketplace query and the complete browser flow before staging promotion. Hosted staging must then verify actual state, permissions and discovery controls without sending payments, campaigns or SMS. No new OAuth grants or real discovery jobs are required for this visual release.

## Inventory and logos

All providers and implementation states: `shared/integration-marketplace-catalog.json`. Runtime connection states are derived separately. `docs/INTEGRATION_LOGO_VERIFICATION.md` lists checked official sources and fallback limitations. Recommendations are editorial catalog metadata, not connection states or implied vendor partnerships.

## Release / rollback

Promote the isolated change to main-staging, inspect API/frontend revisions and actual screenshots, then promote the same scoped change to main-prod only after checks pass. Owner previously authorized production promotion contingent on passing staging. No database backup/migration is introduced by this release; existing schema/data/configuration remain untouched. Rollback API and frontend together to their immediately previous deployment; preserve connections and audit/history records. Staging-only gallery code must not be included in production promotion.

Status: implementation complete locally; CI, hosted staging and production promotion pending.
