// Stored outstanding is authoritative; legacy records fall back without altering history.
// A zero balance must never fall through to an older balance_due value.
export function invoiceBalance(invoice) {
 if(['VOID','REFUNDED'].includes(invoice.status))return 0;
 const value=invoice.amount_outstanding ?? invoice.balance_due ?? Math.max(0,Number(invoice.total||0)-Number(invoice.amount_paid||0));
 return Math.max(0,Math.round(Number(value)*100)/100);
}
export function normalizeInvoice(invoice) {
 const balance=invoiceBalance(invoice);
 const incomplete=invoice.items ? invoice.items.length===0 : invoice.item_count!==undefined ? Number(invoice.item_count)===0 : false;
 return {...invoice,amount_outstanding:balance,balance_due:balance,...(incomplete?{data_quality:'INCOMPLETE_HISTORICAL'}:{data_quality:'CURRENT'})};
}
// Only use trusted internal aliases, never request input.
export function invoiceBalanceSql(alias='i') {
 if(!/^[a-z]+$/.test(alias))throw new Error('Invalid internal invoice alias');
 return `CASE WHEN ${alias}.status IN ('VOID','REFUNDED') THEN 0 ELSE GREATEST(0,COALESCE(${alias}.amount_outstanding,${alias}.balance_due,${alias}.total-COALESCE(${alias}.amount_paid,0))) END`;
}
