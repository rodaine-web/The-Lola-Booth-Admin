const money = value => Math.round(Number(value || 0) * 100) / 100;

// Invoices are authoritative once issued. Events created through the proposal
// wizard may never have a legacy bookings row.
export function eventFinanceSummary(event, invoices = []) {
  const active = invoices.filter(i => !i.deleted_at && !['DRAFT','VOID','REFUNDED'].includes(i.status));
  if (!active.length) return event;
  const total = money(active.reduce((sum,i)=>sum+Number(i.total||0),0));
  const paid = money(active.reduce((sum,i)=>sum+Number(i.amount_paid||0),0));
  const stripeTax=money(active.reduce((sum,i)=>sum+Number(i.stripe_tax_amount||0),0));
  const balance = money(active.reduce((sum,i)=>sum+Number(i.amount_outstanding??i.balance_due??0),0));
  const invoiceDeposit = money(active.reduce((sum,i)=>sum+(i.pricing_snapshot?.payment_mode==='DEPOSIT_REQUEST'?Number(i.pricing_snapshot.amount_due_now||0):0),0));
  return {...event, booked_total:total, amount_paid:paid, balance_due:balance,stripe_tax_amount:stripeTax,total_including_collected_tax:money(total+stripeTax),total_received_including_tax:money(paid+stripeTax),
    deposit_required:event.approved_confirmation_minimum != null ? Number(event.approved_confirmation_minimum) : invoiceDeposit || Number(event.deposit_required||0) || Math.ceil(Math.round(total*100)*0.3)/100,
    payment_status:paid>0?(balance<=0?'PAID':'PARTIAL'):'UNPAID'};
}

export function requiredDepositPaid(event) {
  if(event.approved_confirmation_minimum != null && Number(event.approved_confirmation_minimum)===0 && Number(event.booked_total)>0)return true;
  const required = Number(event.deposit_required || 0);
  return required > 0 ? Number(event.amount_paid || 0) >= required : event.payment_status === 'PAID';
}
