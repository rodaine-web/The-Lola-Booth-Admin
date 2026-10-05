// A checkout return is a navigation signal. Only the persisted provider payment
// confirms the transaction; an unpaid balance does not invalidate a deposit.
export function checkoutConfirmation(invoice, sessionId = null) {
  const payments = (invoice.payments || []).filter(p => p.status === "SUCCEEDED");
  const payment = sessionId
    ? payments.find(p => p.provider === "STRIPE" && p.provider_session_id === sessionId)
    : payments[0];
  return payment
    ? { status: sessionId ? "CONFIRMED" : "RECORDED", amount: Number(payment.amount), paymentId: payment.id }
    : { status: "PENDING", amount: null, paymentId: null };
}
