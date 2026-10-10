import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function source(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("October UAT: proposals use HTML-first preview with PDF as download fallback", () => {
  const detail = source("src/pages/ProposalDetail.jsx");
  assert.match(detail, /AdminProposalPreview/);
  assert.match(detail, /HTML Proposal Preview/);
  assert.match(detail, /\/proposals\/\$\{id\}\/pdf/);
  assert.doesNotMatch(detail, /DocumentPreview path=\{\`\/proposals\/\$\{id\}\/pdf/);
});

test("October UAT: proposal workflow hydrates leads and synchronizes proposal stages", () => {
  const editor = source("src/pages/ProposalEditor.jsx");
  const service = source("server/src/services/proposal-service.js");
  assert.match(editor, /hydrateFromLead/);
  assert.match(editor, /hydrateProposalFromLead/);
  assert.match(service, /ensureProposalLead/);
  assert.match(service, /PROPOSAL_DRAFT/);
  assert.match(service, /PROPOSAL_SENT/);
  assert.match(service, /syncLeadProposalStage/);
});

test("October UAT: proposal acceptance applies the configured booking confirmation policy", () => {
  const publicRoutes = source("server/src/routes/public.js");
  assert.match(publicRoutes, /applyBookingConfirmationPolicy/);
  assert.match(publicRoutes, /proposal\.event_id\) await applyBookingConfirmationPolicy\(proposal\.event_id\)/);
});

test("October UAT: proposal primary service IDs follow multi-service selections", () => {
  const editor = source("src/pages/ProposalEditor.jsx");
  assert.match(editor, /experience_id: next\[0\]\?\.experience_id \|\| ""/);
  assert.match(editor, /package_id: next\.flatMap\(\(item\) => item\.packages \|\| \[\]\)\[0\]\?\.package_id \|\| ""/);
  assert.match(editor, /package_id: selected_experiences\.flatMap\(\(item\) => item\.packages \|\| \[\]\)\[0\]\?\.package_id \|\| ""/);
});

test("October UAT: inline proposal event creation validates time and duplicate review", () => {
  const editor = source("src/pages/ProposalEditor.jsx");
  assert.match(editor, /End time must be after start time/);
  assert.match(editor, /POSSIBLE_DUPLICATE/);
  assert.match(editor, /Use existing event/);
  assert.match(editor, /Create separate event anyway/);
  assert.match(editor, /events\?continueAnyway=true/);
});

test("October UAT: event workflow supports inline client creation and multi-service selections", () => {
  const resource = source("src/pages/ResourcePage.jsx");
  const admin = source("server/src/routes/admin.js");
  const migration = source("server/migrations/033_event_multi_service_selections.sql");
  assert.match(resource, /createInlineClient/);
  assert.match(resource, /experience_ids/);
  assert.match(resource, /package_ids/);
  assert.match(admin, /event_packages/);
  assert.match(admin, /event_experiences/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_packages/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_experiences/);
});

test("October UAT: partial event edits validate against existing event times", () => {
  const admin = source("server/src/routes/admin.js");
  assert.match(admin, /validateEventTimes\(\{ \.\.\.before\.rows\[0\], \.\.\.req\.body \}\)/);
  assert.doesNotMatch(admin, /patch\("\/events\/:id"[\s\S]{0,220}validateEventTimes\(req\.body\)/);
});

test("October UAT: duplicate events require review before an explicit override", () => {
  const resource = source("src/pages/ResourcePage.jsx");
  const admin = source("server/src/routes/admin.js");
  assert.match(admin, /req\.query\.continueAnyway/);
  assert.match(admin, /CLIENT_DATE_TIME_TITLE_MATCH/);
  assert.match(resource, /Possible duplicate event/);
  assert.match(resource, /Open existing event/);
  assert.match(resource, /Create anyway/);
  assert.match(resource, /events\?continueAnyway=true/);
});

test("October UAT: new users require explicit role selection", () => {
  const users = source("src/pages/Users.jsx");
  assert.match(users, /roles:\s*\[\]/);
  assert.doesNotMatch(users, /roles:\s*\["ATTENDANT"\]/);
  assert.match(users, /!form\.roles\.length/);
});

test("October UAT: event package and experience filters include multi-service selections", () => {
  const admin = source("server/src/routes/admin.js");
  assert.match(admin, /event_experiences ee WHERE ee\.event_id=/);
  assert.match(admin, /ee\.experience_id=\$" \+ params\.length/);
  assert.match(admin, /event_packages ep WHERE ep\.event_id=/);
  assert.match(admin, /ep\.package_id=\$" \+ params\.length/);
});

test("October UAT: readiness drilldowns use a bounded upcoming-event window", () => {
  const admin = source("server/src/routes/admin.js");
  const staffStart = admin.indexOf('req.query.readiness === "staff"');
  const equipmentStart = admin.indexOf('req.query.readiness === "equipment"');
  const tasksStart = admin.indexOf('if (table === "tasks")');
  const staff = admin.slice(staffStart, equipmentStart);
  const equipment = admin.slice(equipmentStart, tasksStart);
  assert.ok(staff.includes("event_date >= current_date"));
  assert.ok(staff.includes("current_date + interval"));
  assert.ok(equipment.includes("event_date >= current_date"));
  assert.ok(equipment.includes("current_date + interval"));
});

test("October UAT: dashboard event drilldowns preserve exact query filters", () => {
  const resource = source("src/pages/ResourcePage.jsx");
  const links = source("src/utils/dashboard-links.js");
  const admin = source("server/src/routes/admin.js");
  assert.match(resource, /useSearchParams/);
  assert.match(resource, /new URLSearchParams\(routeParams\)/);
  assert.match(links, /booking_from/);
  assert.match(links, /upcoming/);
  assert.match(admin, /status IN \('CONFIRMED','PREPARING','READY','IN_PROGRESS'\)/);
});

test("October UAT: dynamic list filters keep PostgreSQL parameter placeholders", () => {
  const admin = source("server/src/routes/admin.js");
  assert.ok(admin.includes('where.push("due_date >= $"+params.length+"::date")'));
  assert.ok(admin.includes('where.push("due_date < $"+params.length+"::date")'));
  assert.ok(admin.includes('where.push(paymentTime+">=$"+params.length+"::timestamptz")'));
  assert.ok(admin.includes('where.push(paymentTime+"<$"+params.length+"::timestamptz")'));
  assert.ok(admin.includes('ee.experience_id=$" + params.length'));
  assert.ok(admin.includes('ep.package_id=$" + params.length'));
});

test("October UAT: booking deposit confirmation prefers the invoice deposit threshold", () => {
  const reconciliation = source("server/src/services/payment-reconciliation-service.js");
  assert.match(reconciliation, /invoice_deposit_required/);
  assert.match(reconciliation, /invoiceDepositRequired > 0 \? invoiceDepositRequired : bookingDepositRequired/);
  assert.match(reconciliation, /depositRequired > 0 \? paid >= depositRequired : paid > 0/);
});

test("October UAT: proposal range filters use proposal activity timestamps", () => {
  const admin = source("server/src/routes/admin.js");
  const start = admin.indexOf('adminRouter.get("/proposals"');
  const end = admin.indexOf('adminRouter.post("/proposals"', start);
  const proposalRoute = admin.slice(start, end);
  assert.match(proposalRoute, /accepted_at/);
  assert.match(proposalRoute, /sent_at/);
  assert.match(proposalRoute, /created_at/);
  assert.doesNotMatch(proposalRoute, /paymentTime|paid_at|payment_date/);
});

test("October UAT: payment search and date drilldowns use consistent joins and timestamps", () => {
  const admin = source("server/src/routes/admin.js");
  assert.match(admin, /const paymentTime="COALESCE\(p\.paid_at,p\.payment_date::timestamptz,p\.created_at\)"/);
  assert.match(admin, /FROM payments p LEFT JOIN clients c ON c\.id=p\.client_id LEFT JOIN events e ON e\.id=p\.event_id LEFT JOIN invoices i ON i\.id=p\.invoice_id/);
});

test("October UAT: Payments page preserves dashboard URL filters", () => {
  const payments = source("src/pages/Payments.jsx");
  assert.match(payments, /useSearchParams/);
  assert.match(payments, /new URLSearchParams\(urlParams\)/);
  assert.match(payments, /setFilter\("provider"/);
  assert.match(payments, /setFilter\("status"/);
});

test("October UAT: accepted proposals reuse one active invoice", () => {
  const invoice = source("server/src/services/invoice-service.js");
  assert.match(invoice, /SELECT \* FROM invoices WHERE proposal_id=\$1 AND deleted_at IS NULL AND status NOT IN \('VOID','REFUNDED'\) ORDER BY created_at DESC LIMIT 1/);
  assert.doesNotMatch(invoice, /pricing_snapshot->>'payment_mode'.*proposal_id/s);
});

test("October UAT: fully refunded invoices stay closed and can be rebilled intentionally", () => {
  const reconciliation = source("server/src/services/payment-reconciliation-service.js");
  const invoice = source("server/src/services/invoice-service.js");
  assert.match(reconciliation, /const fullyRefunded = refundedAmount > 0 && paid === 0/);
  assert.match(reconciliation, /const outstanding = fullyRefunded \? 0/);
  assert.match(reconciliation, /if \(fullyRefunded\) status = "REFUNDED"/);
  assert.match(reconciliation, /status NOT IN \('VOID','REFUNDED'\)/);
  assert.match(invoice, /status NOT IN \('VOID','REFUNDED'\) ORDER BY created_at DESC LIMIT 1/);
});

test("October UAT: draft invoice edits preserve deposit and payment-choice metadata", () => {
  const invoice = source("server/src/services/invoice-service.js");
  const slice = invoice.slice(invoice.indexOf("export async function updateDraftInvoice"), invoice.indexOf("export function calculateInvoiceTotals"));
  assert.match(slice, /previousPricing = before\.pricing_snapshot/);
  assert.match(slice, /amount_due_now: preservedMinimum/);
  assert.match(slice, /payment_mode: previousPricing\.payment_mode \|\| "BALANCE_DUE"/);
  assert.match(slice, /allow_pay_in_full: previousPricing\.allow_pay_in_full !== false/);
  assert.match(slice, /allow_custom_amount: previousPricing\.allow_custom_amount !== false/);
});

test("October UAT: payment page honors allowed checkout choices and completion state", () => {
  const pay = source("public/staging-site/pay.html") + source("public/staging-site/payment-viewer.js");
  assert.match(pay, /id="customChoice"/);
  assert.match(pay, /fullChoice\.style\.display=o\.allowPayInFull\?"flex":"none"/);
  assert.match(pay, /customChoice\.style\.display=o\.allowCustomAmount\?"flex":"none"/);
  assert.match(pay, /depositChoice\.style\.display=o\.depositAvailable\?"flex":"none"/);
  assert.match(pay, /checkoutConfirmation/);
  assert.match(pay, /Confirmation is still being applied to this invoice/);
  assert.match(pay, /Thank you\. Your payment is recorded/);
  assert.match(pay, /No further payment is due on this invoice/);
  assert.match(pay, /No online payment amount is currently available for this invoice/);
  assert.match(pay, /const hasChoice=Boolean\(first\)/);
});

test("October UAT: payment notifications are immediate, recorded, idempotent, and non-fatal after payment posting", () => {
  const payment = source("server/src/services/payment-service.js");
  assert.match(payment, /sendRecordedPaymentEmail/);
  assert.match(payment, /payment-confirmation:/);
  assert.match(payment, /payment-owner-notification:/);
  assert.match(payment, /await sendCommunication\(communication.id\)/, "Payment notifications use the shared committed delivery claim");
  assert.match(payment, /Customer payment confirmation email failed after payment posting/);
  assert.match(payment, /Owner payment notification email failed after payment posting/);
});

test("October UAT: invitation delivery outcomes are visible and retryable", () => {
  const users = source("src/pages/Users.jsx");
  const admin = source("server/src/routes/admin.js");
  assert.match(users, /invitation_status/);
  assert.match(users, /Resend invitation/);
  assert.match(admin, /deliveryErrorCode|deliveryError/);
});

test("October UAT: controlled client and event values and actionable validation remain present", () => {
  const app = source("src/App.jsx");
  const resource = source("src/pages/ResourcePage.jsx");
  assert.match(app, /Preferred contact method/);
  assert.match(app, /EMAIL.*PHONE.*TEXT/s);
  assert.match(app, /State.*select/s);
  assert.match(resource, /End time must be after start time/);
  assert.match(resource, /scrollIntoView/);
});


test("October UAT: integrations expose actionable setup and lifecycle controls", () => {
  const integrations = source("src/pages/Integrations.jsx");
  assert.match(integrations, /Reconnect \/ Configure/);
  assert.match(integrations, /Recheck status/);
  assert.match(integrations, /[\"']Disable[\"']/);
  assert.match(integrations, /Configuration guidance/);
});

test("October UAT: enabled payment providers remain required in every health state", () => {
  const health = source("server/src/services/system-health-service.js");
  assert.match(health, /businessEnabled = provider\.provider === "STRIPE"/);
  assert.match(health, /\{ \.\.\.provider, businessEnabled \}/);
  assert.match(health, /item\.name\.startsWith\("payments\."\)/);
  assert.match(health, /!item\.details\?\.businessEnabled/);
});

test("October UAT: System Health refresh shows progress, completion, and timestamp", () => {
  const health = source("src/pages/SystemHealth.jsx");
  assert.match(health, /refreshing/);
  assert.match(health, /Refreshing…/);
  assert.match(health, /System health refreshed/);
  assert.match(health, /Last refreshed/);
});

test("October UAT: Communications uses Templates terminology and responsive template UI", () => {
  const communications = source("src/pages/Communications.jsx");
  const css = source("src/styles/global.css");
  assert.match(communications, /"Templates"/);
  assert.doesNotMatch(communications, /<h[12][^>]*>Email Templates<\/h[12]>/);
  assert.match(css, /template-(card-list|admin-card|card-actions)/i);
});

test("October UAT: failed payments and refunds notify both customer and owner paths", () => {
  const payment = source("server/src/services/payment-service.js");
  assert.match(payment, /payment-failed:/);
  assert.match(payment, /payment-failed-owner:/);
  assert.match(payment, /refund-confirmation:/);
  assert.match(payment, /refund-owner-notification:/);
  assert.match(payment, /PAYMENT_FAILED_INTERNAL/);
  assert.match(payment, /REFUND_INTERNAL/);
});
