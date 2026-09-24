# LOLA Admin — local stabilization report

Sprint: September 24, 2026. Branch: `codex/admin-product-stabilization`. Baseline: `8b37d49` and the September 24 Admin audit. This report describes local changes, not the deployed Admin.

**ADMIN NEEDS ANOTHER DEVELOPMENT PASS**

**PAYMENTS: DEFERRED**  
**PRODUCTION DEPLOYMENT: NOT AUTHORIZED**

The P0 defects have verified fixes and the core sales/document and event-operations paths execute against a real disposable database. The portal has a more coherent operations dashboard, navigation, resource management and CMS organization. Full product acceptance remains incomplete. No staging environment was created, no changes were pushed, no production records were edited, no real external mail or SMS was sent, and the public website V1 remains frozen.

## Assessment

These are engineering/design judgments of the local build, not measured acceptance scores or a production certification. Payments are excluded.

| Dimension | Current rating | Reason |
|---|---:|---|
| Design | 7/10 | Clearer hierarchy, restrained brand palette and meaningful status accents; some dense tables and native-looking controls still need polish. |
| Functionality | 7/10 | Real core workflows pass; complete role, retry, conflict and secondary lifecycle coverage is not yet established. |
| Formatting | 8/10 | Shared date, currency, boolean and status formatting fixes reproduced defects. Some secondary time/label presentations still need review. |
| Overall completion | 7/10 | Usable local foundation with important verified improvements; historical data and remaining acceptance gates prevent staging recommendation. |

## Evidence and exact counts

| Check | Result | Scope |
|---|---|---|
| `npm test` | 169 passed, 0 failed, 0 skipped | Baseline 159; ten additional regression tests, including four timezone environments within the date test. |
| `npm run build` | PASS | Current client production build, executed locally; not deployed. |
| Real service regression suite | 7 groups passed | Actual Communications SQL/lifecycle, DATE typing and legacy/zero invoice balances. |
| Disposable DB integration suite | 25 groups passed | Full migration chain through 024, authentication/authorization, CRM, documents, CMS, operations, classification and continuous journey. |
| Targeted browser regression suite | 6 passed | Before/after error recovery, dates, money, precision, fake filters and Calendar selectors. |
| Responsive browser suite | 45 screen/width combinations passed | 15 screens × 1440, 820, 390; 0 page overflows and 0 captured browser errors. Also exercises actual browser compose/send, create user/invitation, equipment and staff. |
| Diff whitespace check | PASS | No whitespace errors. |

Counts are not additive: responsive checks are included in the 25th integration group. Passing these checks does not establish every field/action/role combination. The targeted six browser regressions use synthetic responses; the 45-screen suite uses the real local API and disposable database. Email delivery means development-provider handling, not inbox delivery or external provider certification.

Committed machine-readable results: [ADMIN_STABILIZATION_TEST_RESULTS.json](ADMIN_STABILIZATION_TEST_RESULTS.json). Detailed local logs/screenshots are under `audit-output/admin-stabilization/`; they are ignored artifacts, not part of deployment.

Re-run entry points:

- `npm test` and `npm run build`
- `node server/src/scripts/verify-admin-stabilization-services.js`
- `node server/src/scripts/verify-platform-hardening.js --visual`
- `node server/src/scripts/verify-admin-stabilization-browser.js`

The database suites require the local PostgreSQL test instance and disposable-database privileges. The browser scripts currently use the installed macOS Chrome executable. Do not run these suites against production. Browser assets are copied to an immutable temporary snapshot to prevent concurrent builds changing a running test.

## Area report

PASS applies to the stated bounded requirement. PARTIAL means useful implementation and verification exist, but the full module lifecycle from the brief has not passed.

| Area | Before | After | Status | Evidence | Remaining work |
|---|---|---|---|---|---|
| Dashboard | Equally weighted cards, formatting defects, long mobile layout | Six executive KPIs, revenue series controls, interactive funnel/source charts, real readiness, actionable attention, collapsed secondary content | PARTIAL | Real date-range queries; funnel/list parity; three-width screenshots | Complete exact period/point drilldowns; richer-data visual review and owner approval |
| Communications | SQL 42702; error hidden behind loading | Qualified queries, search/sort/pagination, retry, compose/edit/preview, development send, schedule/cancel/retry safeguards | PARTIAL | 7 service groups include lifecycle/concurrent send; real browser compose/send; forced-error recovery | Complete Templates/Automations and all relationship permutations in browser; restart/replay qualification |
| Date handling | December 16 displayed December 15 | Shared calendar-date/timestamp helpers; PostgreSQL DATE remains a string | PASS | Four timezones; Chicago browser regression; actual DATE/timestamp types | Broader Calendar DST interaction coverage is listed separately |
| Currency formatting | Missing cents/excess decimal precision | Shared money/count/percent/boolean formatting | PASS | Unit, Dashboard/Analytics browser assertions and invoice PDF text | Continue using shared formatter in future screens |
| Leads | Core CRM existed; date/relationship usability defects | Correct dates, named relationships, continuous conversion verified | PARTIAL | Create/update/assign; concurrent conversion creates one result; inquiry journey | Exhaustive restricted-role and refresh-during-save UI UAT |
| Clients | Existing generic list/detail | Real controls, recovery state and consistent related-document display | PARTIAL | Create/update/detail and related event/document journey | Full ownership/permission and all empty/error-state matrix |
| Proposals | Core document service; blank legacy labels | Readable legacy labels, formatted totals/dates, guarded editor, standard/bespoke document paths verified | PARTIAL | Numbering; PDF/public link/version/development send/acceptance; uploaded retrieval | Full uploaded proposal version/acceptance browser journey; historical identifier review |
| Invoices | Legacy list/detail balance divergence; missing history | Authoritative zero/null balance handling, incomplete-history warning, normalized non-taxable rate | PARTIAL | SQL/detail/public balance; actual tax/discount PDF text; sent-edit denial | Review historical inconsistencies without inventing items; broader retry UI UAT |
| Calendar | Raw ID inputs; 30-day month shifts | Named searchable relationships, calendar month arithmetic, date semantics | PARTIAL | Selector regression; calendar API and three-width checks | DST/boundary and all role/view interaction matrix |
| Events | Existing operational detail | Shared display/recovery; real resource and readiness integration | PARTIAL | Create, assignments, status progression and run-sheet PDF | Incident/reschedule and full conflict/race UI scenarios |
| Tasks | Raw owner IDs; generic controls | Named owner picker, related labels, status/priority controls and overdue filter | PARTIAL | Picker/API and shared resource implementation; dashboard task retrieval | Complete/reopen, ownership and failed-save browser journey |
| Equipment | List-only top-level UI | Create/edit, asset code, status, history, assignments and checkout/return context | PARTIAL | Actual CRUD, maintenance denial, checkout/on-site/return, browser create/history | Concurrent assignments and repeated damaged-return safety; full operator-role UAT |
| Staff | Placeholder scheduling UI | Create/edit/contact/status, unavailable dates, assignments and history | PARTIAL | CRUD, availability denial, acknowledgment, browser create/history | Decline/reassignment/conflict and restricted-role full journey |
| Files | Standalone placeholder | Hidden from primary navigation; contextual document/event files retained | DEFERRED | Navigation decision; private media denial | Standalone lifecycle before returning to navigation |
| Client Galleries | Incomplete primary module | Hidden from primary navigation; contextual delivery functions retained | DEFERRED | Navigation inventory | Complete secure-link/revoke/expiry lifecycle before restoring |
| Live Operations | Horizontal overflow | Responsive seven-stage board with counts and semantic statuses | PARTIAL | Three widths; all seven real status transitions | Incident and refresh/retry behavior across operator roles |
| Users | Ungrouped privilege selection and weaker feedback | Grouped privileges, view/create/edit, recoverable loading, development invitation | PARTIAL | CRUD, deactivate/reactivate, invitation/session invalidation; actual browser creation | Full role-by-role UI UAT, including restricted operational users |
| Roles/Privileges | Server foundation existed | Grantable groups exclude elevated authority; existing server hierarchy maintained | PARTIAL | Unauthenticated/restricted denials; Super Admin escalation denied; single-use token concurrency | Complete OWNER/SUPER_ADMIN/ADMIN/operational UI/API matrix |
| Integrations | Stale connection status disagreed with runtime | Provider-derived Email state and semantic disabled/error/ready labels | PASS WITH MINOR ISSUE | Runtime-provider mapping regression; actual local integration endpoint | External connection/delivery qualification belongs to later authorized environment testing |
| System Health | LOCAL storage called misconfigured generically | Actual path/read/write checks; durability warning separated | PASS WITH MINOR ISSUE | Local health checks in integration run; code path inspection | Infrastructure durability and backup/restore exercise later |
| Audit Log | Raw technical table | Actor/action/entity/target/time with filters | PARTIAL | Real audit records and filtered API; screenshots | Detail metadata and consistent target links; paging beyond latest 200 matches |
| Settings | Flat technical fields, incorrect default email | Business/brand/document/email/operations/website/system groups; typed controls; canonical local form default | PARTIAL | Three-width screenshots; server enum alignment | Full save/reload/validation UAT; approved historical config reconciliation |
| CMS Admin UX | Giant slot tables, raw mapping IDs | Page/section grouping, search/status filters, private thumbnails, pickers and duplicate-order warning | PARTIAL | Major CMS lifecycle/replacement/publish permissions and private-media denial; screenshots | Media usage/archive and bulk UX; richer labels/reorder; production source parity remains separate frozen-website work |
| Navigation | Excess destinations and redundant finance grouping | Collapsible functional groups; Invoices under Sales; placeholders hidden; unique routes retained | PASS | Before/after inventory and explicit action table | Owner usability review |
| Responsive UI | Dashboard/Live/tablet overflow and mobile header collisions | Wrapping toolbars, compact mobile hierarchy, responsive operations and grids | PASS WITH MINOR ISSUE | 45 checks; 0 page overflows/browser errors | Some tables intentionally scroll internally; comprehensive modal/editor and visual approval remain |
| Business Journey E2E | Disconnected checks could miss actual query defects | Continuous inquiry→assigned lead→client/event→proposal→development send→acceptance→draft invoice | PARTIAL | Real DB relationships, numbered documents, PDF, communication and audit; selected actual browser operations | Every transition through UI, all roles and deliberate failure recovery not yet exhaustive |

## Defect reproduction and fix record

| Defect | Reproduced? | Root cause | Test added? | Fix status |
|---|---|---|---|---|
| Communications list SQL failure | YES, actual DB: 42702 | Unqualified `deleted_at` in joined query | Real list/status queries | Fixed and passing |
| Communications stuck loading | YES, forced browser failure | Loading branch hid error | Browser error→retry→empty | Fixed and passing |
| December 16→15 | YES, browser before | Calendar date parsed as timezone-sensitive timestamp | Four offsets, browser and DB type | Fixed and passing |
| `$2,877.6` | YES, Dashboard before | Local/ad-hoc formatting | Formatter and browser | Fixed and passing |
| `999.2000000000000000` | YES, Analytics before | Raw numeric string display | Formatter and browser | Fixed and passing |
| Calendar raw IDs | YES, four inputs | Generic ID input fields | Browser absence plus real named pickers | Fixed for Calendar; broader role UX pending |
| Blank proposal identifier | Baseline/code confirmed; no independent failing DB reproduction saved | Nullable historical number rendered directly | Null display test; real new-number journey | Readable fallback; historical reconciliation pending |
| Invoice list/detail mismatch | YES, legacy fixture | Multiple balance fallbacks; zero/null conflation | Actual service/SQL plus PDF totals | Fixed; no historical amounts invented |
| Fake status/sort filters | YES, two one-option controls | Decorative generic selects | Browser regression | Removed or wired to real choices/query |
| Integration status mismatch | Baseline plus isolated config reproduction | Stale connection row instead of runtime provider | Provider mapping and local API | Fixed locally; real provider connectivity untested |
| Dashboard formatting | YES | Inconsistent formatting/aggregation | Browser money and actual Analytics parity | Fixed core values; full dashboard acceptance pending |
| Non-taxable invoice creation error | YES, actual integration run | Omitted tax rate reached NOT NULL column | Calculation regression and real create/PDF | Fixed |
| Equipment on-site SQL error | YES, actual lifecycle run | Skipped SQL parameter positions had unresolved types | Real checkout/on-site/return integration | Fixed |
| Tablet toolbar/settings and mobile header overflow | YES, browser/screenshots | Fixed-width grid and fixed header height | 45 responsive checks | Fixed in tested screens |

The initial six targeted browser failures and two Communications SQL failures are preserved in the committed results. Some baseline issues have code/config evidence rather than a saved failing end-to-end reproduction; they are not represented as fully reproduced.

## Navigation before and after

Before: Dashboard; Sales (Leads, Clients, Proposals, Communications); Events (Events, Calendar, Equipment, Staff); Finance (Payments, Invoices); Website (13 destinations); Catalog (Add-ons); Operations (Live, Tasks, Files, Client Galleries); Insights; System.

After:

- Dashboard
- Sales: Leads, Clients, Proposals, Invoices, Add-ons
- Events: Events, Calendar, Tasks
- Operations: Live Board, Staff, Equipment
- Communications: history/composer, Templates and Automations tabs
- Website: unique CMS destinations in a collapsible group
- Reporting: Analytics
- System: Users, Integrations, Health, Audit Log, Settings

[Navigation decisions](ADMIN_NAVIGATION_DECISIONS.md) explains each move, rename, nesting and hidden destination, including Invoices, Payments, Receipts and Reconciliation. Existing routes are retained. No unique finance function was silently deleted; payment execution remains deferred.

## Visual evidence

Screenshots use synthetic local data, not actual business totals. Generated views: Dashboard, Users, Communications, Leads, Proposal detail, Invoice detail, Event operations, Live Operations, Equipment, Staff, CMS, Settings, Audit Log, Calendar and Analytics at all three widths.

Local previews:

- [Dashboard desktop](../audit-output/admin-stabilization/visual/dashboard-1440.png)
- [Dashboard mobile](../audit-output/admin-stabilization/visual/dashboard-390.png)
- [Communications mobile](../audit-output/admin-stabilization/visual/communications-390.png)
- [Staff desktop](../audit-output/admin-stabilization/visual/staff-1440.png)
- [Equipment desktop](../audit-output/admin-stabilization/visual/equipment-1440.png)

The dashboard now prioritizes business KPIs and attention/readiness on mobile. Colors carry labels/icons. Remaining visual weaknesses include dense tables, some plain buttons and a long dashboard even after secondary sections collapse. The screenshots are review evidence; owner visual approval has not been given.

## Completion approach and staging gates

1. **Finish role and recovery qualification first.** Exercise OWNER, SUPER_ADMIN, ADMIN and an assigned operational user through each intended UI/API action. Cover permissions on named pickers, failed saves, double submit, refresh during save, worker restart/replay and concurrent resource changes. Fix failures as they appear.
2. **Close module lifecycle gaps.** Complete uploaded-proposal version/acceptance UAT, staff decline/reassign, equipment conflict/maintenance return replay, tasks complete/reopen, incident/reschedule and calendar boundary cases. Keep Files/Galleries hidden until their own lifecycles qualify.
3. **Make reporting trustworthy.** Finish reviewed historical classification and a permissioned classification workflow. Explicit QA/SEED/LEGACY_FIXTURE records are excluded; existing records remain UNREVIEWED. Related records must be reviewed/classified together. No current production totals are certified clean. See [data strategy](ADMIN_DATA_CLASSIFICATION.md).
4. **Complete product polish and acceptance.** Finish exact chart drilldowns, audit details and remaining CMS/media usability. Run the complete editor/modal/error-state matrix, then obtain owner visual approval using realistic synthetic volumes.
5. **Re-run the local gate.** Keep all automated and actual-service tests green and record completed end-to-end role/failure cases. Only after these gates pass should a report recommend creating isolated staging as a separate authorized next step.

This pass materially improves the local product but does not complete every phase in the brief. Staging creation and any production deployment remain outside the work performed.
