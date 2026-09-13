# LOLA Admin Phase 7 Handoff

## Completed

- Added Phase 7 migration `010_phase_7_operational_intelligence.sql`.
- Added business week start, equipment turnaround buffer, and staff travel buffer settings.
- Added event/task/proposal/invoice indexes for dashboard and calendar workloads.
- Added `operational-intelligence-service.js` for dashboard metrics, comparisons, funnel, trends, lead source performance, top performers, attention alerts, event readiness, and calendar filtering.
- Replaced the old `/api/dashboard` implementation with range-aware command-center data.
- Replaced the old `/api/calendar` implementation with month/week/day ranges, combined filters, staff/equipment counts, role-aware attendant filtering, event phases, legend data, and readiness indicators.
- Rebuilt the dashboard screen into a four-range interface: Today, This Week, Month To Date, Year To Date.
- Added grouped KPI sections for Sales, Revenue, Events, and Operations.
- Added comparison labels, sales funnel, revenue trend, needs-attention list, upcoming readiness, lead source table, recent activity, and metric definitions.
- Upgraded the Calendar screen with Today/Previous/Next/date controls, month/week/day view switching, combined filters, clear filters, status legend, clickable event cards, phase timing, and readiness labels.
- Exposed Phase 7 operational settings in System > Settings.

## Metric Definitions

- Booked Revenue: sum of booking totals created in the selected period. Draft proposals are not counted as revenue.
- Collected Revenue: successful net payments minus refunded amounts in the selected period.
- Conversion Rate: bookings won divided by new leads in the selected period.
- Average Booking Value: booked revenue divided by bookings won.
- Outstanding Balance: current unpaid amount on non-void invoices, independent of selected period.

## Dashboard Ranges

- `today`: business-local day.
- `week`: configurable business week start, default Monday.
- `mtd`: first day of current month through current business period.
- `ytd`: January 1 through current business period.

## Calendar Notes

- Calendar filters support status, event type, venue, city, experience ID, package ID, staff ID, and equipment ID.
- Event cards include setup/live/breakdown timing derived from the event record.
- Attendant role views are filtered to assigned events and financial totals are redacted in the service.
- Drag/drop and resize are not introduced because the app does not currently use a production calendar library. Reorder-style controls would not safely model rescheduling without a dedicated event move confirmation flow.

## Known Limitations

- Current implementation uses the existing custom calendar instead of adding FullCalendar.
- Calendar rescheduling by drag/drop and resize should be added in a later focused pass with confirmation and conflict checks.
- Top salesperson is omitted because reliable sales ownership attribution is not yet modeled consistently across leads/proposals/bookings.

## Verification

- Added `test/phase7-static.test.js`.
- Run `npm run db:migrate`.
- Run `npm test`.
- Run `npm run build`.
- Live smoke test `/api/dashboard?range=today`, `/api/dashboard?range=week`, and `/api/calendar?view=week`.

## Phase 8 Readiness

Phase 7 stops here. The operating dashboard and calendar intelligence foundations are ready for Phase 8 without beginning that phase automatically.
