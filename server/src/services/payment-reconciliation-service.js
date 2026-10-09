import { queuePaidAgreement } from './booking-agreement-handoff-service.js';
import {autoPlanningInvitation} from "./event-planning-service.js";
import {convertPaidCampaignLead} from './campaign-lead-service.js';
import { query, transaction } from "../db/pool.js";
import { recordActivity } from "./activity-service.js";
import { writeAudit } from "./audit-service.js";
import {lockBookingReservations,confirmHeldBooking} from './booking-hold-service.js';

const money = (value) => Math.round(Number(value || 0) * 100) / 100;

export async function reconcileInvoice(invoiceId, { req = null, actorUserId = null, action = "payment_reconciled" } = {}) {
  const result = await transaction(async (client) => {
    const invoice = await client.query("SELECT * FROM invoices WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [invoiceId]);
    if (!invoice.rows[0]) return null;
    const payments = await client.query(
      "SELECT COALESCE(sum(amount - refunded_amount),0)::numeric AS net_paid FROM payments WHERE invoice_id=$1 AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') AND deleted_at IS NULL",
      [invoiceId]
    );
    const refunded = await client.query(
      "SELECT COALESCE(sum(amount),0)::numeric AS refunded FROM refunds WHERE invoice_id=$1 AND status='SUCCEEDED'",
      [invoiceId]
    );
    const paid = money(payments.rows[0].net_paid);
    const refundedAmount = money(refunded.rows[0].refunded);
    const fullyRefunded = refundedAmount > 0 && paid === 0;
    const outstanding = fullyRefunded ? 0 : money(Math.max(0, Number(invoice.rows[0].total || 0) - paid));
    const previousStatus = invoice.rows[0].status;
    let status = previousStatus;
    if (previousStatus !== "VOID") {
      if (fullyRefunded) status = "REFUNDED";
      else if (outstanding === 0) status = "PAID";
      else if (paid > 0) status = "PARTIALLY_PAID";
      else if (["PAID","PARTIALLY_PAID","PARTIAL","REFUNDED"].includes(previousStatus)) status = "SENT";
    }
    const updated = await client.query(
      "UPDATE invoices SET amount_paid=$1, balance_due=$2, amount_outstanding=$2, status=$3, updated_at=now() WHERE id=$4 RETURNING *",
      [paid, outstanding, status, invoiceId]
    );
    const converted=await convertPaidCampaignLead(client,updated.rows[0]);
    if(converted)Object.assign(updated.rows[0],converted);
    await reconcileEventFinance(client, updated.rows[0].event_id);
    await queuePaidAgreement(client, updated.rows[0]);
    return { before: invoice.rows[0], after: updated.rows[0], refunded: money(refunded.rows[0].refunded) };
  });
  if (!result) return null;
  if (result.after.event_id) {
    await recordActivity({
      actorUserId,
      entityType: "event",
      entityId: result.after.event_id,
      action,
      summary: `Invoice ${result.after.invoice_number} reconciled: $${result.after.amount_outstanding} outstanding`
    });
  }
  if (req) await writeAudit({ req, action, entity: "invoice", entityId: invoiceId, before: result.before, after: result.after });
  return result.after;
}

export async function reconcileEventFinance(client, eventId) {
  if (!eventId) return null;
  const totals = await client.query(
    `SELECT
      COALESCE(sum(i.total),0)::numeric AS total_invoiced,
      COALESCE(sum(i.amount_paid),0)::numeric AS total_paid,
      COALESCE(sum(i.amount_outstanding),0)::numeric AS outstanding
     FROM invoices i
     WHERE i.event_id=$1 AND i.deleted_at IS NULL AND i.status NOT IN ('VOID','REFUNDED')`,
    [eventId]
  );
  const refunded = await client.query("SELECT COALESCE(sum(r.amount),0)::numeric AS refunded FROM refunds r WHERE r.event_id=$1 AND r.status='SUCCEEDED'", [eventId]);
  const t = totals.rows[0];
  let paymentStatus = "UNPAID";
  if (Number(refunded.rows[0].refunded) > 0 && Number(t.outstanding) > 0) paymentStatus = "PARTIAL";
  else if (Number(t.total_paid) > 0 && Number(t.outstanding) === 0) paymentStatus = "PAID";
  else if (Number(t.total_paid) > 0) paymentStatus = "PARTIAL";
  await client.query(
    `UPDATE bookings SET amount_paid=$1, balance_due=$2, payment_status=$3, updated_at=now()
     WHERE event_id=$4 AND deleted_at IS NULL`,
    [money(t.total_paid), money(t.outstanding), paymentStatus, eventId]
  );
  return { ...t, refunded: refunded.rows[0].refunded, payment_status: paymentStatus };
}

export async function applyBookingConfirmationPolicy(eventId) {
  if (!eventId) return null;
  return transaction(async () => {
  await lockBookingReservations();
  const settings = await query("SELECT booking_confirmation_policy FROM business_settings LIMIT 1");
  const policy = settings.rows[0]?.booking_confirmation_policy || "DEPOSIT_PAID";
  if (policy === "MANUAL") return null;
  const event = await query("SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [eventId]);
  if (!event.rows[0] || event.rows[0].status === "CANCELLED") return null;
  const managedJourney=(await query('SELECT booking_journey_managed($1) AS managed',[eventId])).rows[0]?.managed;
  if(managedJourney){
    const missing=(await query('SELECT booking_confirmation_missing($1) AS missing',[eventId])).rows[0]?.missing||[];
    if(missing.length)return null;
  }
  const finance = await query(
    `SELECT
       COALESCE(sum(amount_paid),0)::numeric AS paid,
       COALESCE(sum(amount_outstanding),0)::numeric AS outstanding,
       COALESCE(sum(CASE WHEN pricing_snapshot->>'payment_mode'='DEPOSIT_REQUEST' THEN COALESCE(NULLIF(pricing_snapshot->>'amount_due_now','')::numeric,0) ELSE 0 END),0)::numeric AS invoice_deposit_required
     FROM invoices WHERE event_id=$1 AND deleted_at IS NULL AND status NOT IN ('VOID','REFUNDED')`,
    [eventId]
  );
  const booking = await query(
    `SELECT COALESCE(sum(deposit_required),0)::numeric AS deposit_required
     FROM bookings WHERE event_id=$1 AND deleted_at IS NULL`,
    [eventId]
  );
  const paid = Number(finance.rows[0].paid || 0);
  const outstanding = Number(finance.rows[0].outstanding || 0);
  const invoiceDepositRequired = Number(finance.rows[0].invoice_deposit_required || 0);
  const bookingDepositRequired = Number(booking.rows[0]?.deposit_required || 0);
  const depositRequired = invoiceDepositRequired > 0 ? invoiceDepositRequired : bookingDepositRequired;
  const depositSatisfied = depositRequired > 0 ? paid >= depositRequired : paid > 0;
  const accepted = policy==='PROPOSAL_ACCEPTED' ? (await query("SELECT 1 FROM proposals WHERE event_id=$1 AND status IN ('ACCEPTED','CONVERTED') AND deleted_at IS NULL LIMIT 1",[eventId])).rows.length>0 : false;
  const shouldConfirm = (policy === "PROPOSAL_ACCEPTED" && accepted) || (policy === "DEPOSIT_PAID" && depositSatisfied) || (policy === "FULL_PAYMENT" && paid > 0 && outstanding === 0);
  if (!shouldConfirm || !["TENTATIVE", "PENDING_DEPOSIT", "PENDING_CONTRACT", "INQUIRY"].includes(event.rows[0].status)) return null;
  // Persisted journey checks above apply independently of worker flag changes.
  const held=(await query("SELECT id FROM booking_holds WHERE event_id=$1 ORDER BY (status='ACTIVE') DESC,created_at DESC,id DESC LIMIT 1",[eventId])).rows[0];
  // An expired checkout must not silently consume capacity after someone else reserved it.
  const updated = held ? {rows:[await confirmHeldBooking(eventId,held.id)]} : await query("UPDATE events SET status='CONFIRMED', updated_at=now() WHERE id=$1 RETURNING *", [eventId]);
  await recordActivity({ entityType: "event", entityId: eventId, action: "booking_auto_confirmed", summary: `Booking auto-confirmed by ${policy} policy` });
  await autoPlanningInvitation(eventId);
  return updated.rows[0];
  });
}
