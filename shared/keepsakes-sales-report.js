// All amounts are integer cents. Paid-order cohorts include confirmed refunds to date.
export function summarizeKeepsakesSales(orders){
 const totals={paidOrders:0,chargedCents:0,refundedCents:0,netReceiptsCents:0,merchandiseCents:0,discountCents:0,shippingCents:0,taxCents:0,heldCents:0,additionalCollectedCents:0,units:0};
 const products=new Map();
 for(const order of orders){
  if(!order.paid_at)continue;
  const charged=Number(order.total_cents),refund=Number(order.refunded_cents||0),net=Math.max(0,charged-refund);
  totals.paidOrders++;totals.chargedCents+=charged;totals.refundedCents+=refund;totals.netReceiptsCents+=net;
  totals.merchandiseCents+=Number(order.subtotal_cents)-Number(order.discount_cents||0);totals.discountCents+=Number(order.discount_cents||0);
  totals.shippingCents+=Number(order.shipping_cents);totals.taxCents+=Number(order.tax_cents);
  // Unresolved refunds/disputes cannot be represented as available receipts.
  const held=['REFUND_PENDING','CANCELLED','REFUNDED'].includes(order.status)||/dispute|refund|payment/i.test(order.last_error||'')&&order.status==='REQUIRES_REVIEW';
  if(held)totals.heldCents+=net;
  if(!held&&!order.already_reported)totals.additionalCollectedCents+=net;
  for(const item of order.items||[]){
   const units=order.status==='CANCELLED'||refund>=charged?0:Math.max(0,Number(item.units||0)-Number(item.cancelledUnits||0));
   totals.units+=units;
   const key=item.key||item.title||'Unknown product';
   const row=products.get(key)||{key,title:item.title||key,units:0};row.units+=units;products.set(key,row);
  }
 }
 return {totals,products:[...products.values()].sort((a,b)=>b.units-a.units||a.title.localeCompare(b.title))};
}
