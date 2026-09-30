import { query } from "../db/pool.js";
import { AppError } from "../utils/errors.js";
import { receiptView } from "../../../shared/receipt-view.js";
export async function getReceiptView(invoice, paymentId) {
  const rows = (
    await query(
      `SELECT p.*,(SELECT max(r.refund_date) FROM refunds r WHERE r.payment_id=p.id AND r.status='SUCCEEDED') AS refund_date,c.name AS client_name,e.event_name,e.event_date,e.venue_name FROM payments p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN events e ON e.id=p.event_id WHERE p.invoice_id=$1 AND p.deleted_at IS NULL ORDER BY p.paid_at,p.id`,
      [invoice.id],
    )
  ).rows;
  const payment = rows.find((p) => p.id === paymentId);
  if (
    !payment ||
    !["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)
  )
    throw new AppError("Receipt not found.", 404, "RECEIPT_NOT_FOUND");
  return receiptView(invoice, payment, rows);
}
