const money = value => Math.round(Number(value || 0) * 100) / 100;

// Invoices are authoritative once issued. Events created through the proposal
// wizard may never have a legacy bookings row.
export function eventFinanceSummary(event, invoices = []) {
  const active = invoices.filter(i => !i.deleted_at && !['DRAFT','VOID','REFUNDED'].includes(i.status));
  if (!active.length) return event;
  const total = money(active.reduce((sum,i)=>sum+Number(i.total||0),0));
  const paid = money(active.reduce((sum,i)=>sum+Number(i.amount_paid||0),0));
  const balance = money(active.reduce((sum,i)=>sum+Number(i.amount_outstanding??i.balance_due??0),0));
  const invoiceDeposit = money(active.reduce((sum,i)=>sum+(i.pricing_snapshot?.payment_mode==='DEPOSIT_REQUEST'?Number(i.pricing_snapshot.amount_due_now||0):0),0));
  return {...event, booked_total:total, amount_paid:paid, balance_due:balance,
    deposit_required:invoiceDeposit || Number(event.deposit_required||0),
    payment_status:paid>0?(balance<=0?'PAID':'PARTIAL'):'UNPAID'};
}

export function requiredDepositPaid(event) {
  const required = Number(event.deposit_required || 0);
  return required > 0 ? Number(event.amount_paid || 0) >= required : event.payment_status === 'PAID';
}
