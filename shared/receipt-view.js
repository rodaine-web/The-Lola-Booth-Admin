import { invoiceBalance } from "./invoice-balance.js";
const dateOnly = (value) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value
      ? String(value).slice(0, 10)
      : null;
const amount = (v) => Math.round(Number(v || 0) * 100) / 100;
// Presentation only: the reconciled invoice remains the authority for current totals.
export function receiptView(invoice, payment, payments = []) {
  const paid = amount(invoice.amount_paid),
    balance = invoiceBalance(invoice),
    refunded = amount(payment.refunded_amount);
  const timestamp = (p) =>
    new Date(p.paid_at || p.payment_date || p.created_at || 0).getTime();
  const previous =
    payments
      .filter(
        (p) =>
          p.id !== payment.id &&
          ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status) &&
          (timestamp(p) < timestamp(payment) ||
            (timestamp(p) === timestamp(payment) &&
              String(p.id) < String(payment.id))),
      )
      .reduce(
        (n, p) =>
          n +
          Math.round((Number(p.amount) - Number(p.refunded_amount || 0)) * 100),
        0,
      ) / 100;
  return {
    id: payment.id,
    number:
      payment.receipt_number || `R-${payment.id.slice(0, 8).toUpperCase()}`,
    invoiceNumber: invoice.invoice_number,
    client: payment.client_name || invoice.client_name || "",
    event: payment.event_name || invoice.event_name || "",
    eventDate: payment.event_date || invoice.event_date || null,
    paymentDate: dateOnly(payment.payment_date || payment.paid_at),
    method: payment.payment_method || payment.provider || "Payment",
    reference:
      payment.provider_payment_id ||
      payment.reference_number ||
      "Manual payment",
    currency: payment.currency || invoice.currency || "USD",
    provider: payment.provider || "MANUAL",
    paymentStatus: payment.status,
    dueDate: invoice.due_date || null,
    venue: invoice.venue_name || payment.venue_name || null,
    invoiceTotal: amount(invoice.total),
    previouslyPaid: amount(previous),
    thisPayment: amount(payment.amount),
    refunded,
    netPayment: amount(Number(payment.amount) - refunded),
    refundDate: payment.refund_date || null,
    totalPaid: paid,
    balanceDue: balance,
    status:
      refunded > 0
        ? refunded >= Number(payment.amount)
          ? "REFUNDED"
          : "PARTIALLY_REFUNDED"
        : invoice.status === "VOID"
          ? "VOID"
          : balance === 0
            ? "PAID"
            : "PARTIALLY_PAID",
  };
}
