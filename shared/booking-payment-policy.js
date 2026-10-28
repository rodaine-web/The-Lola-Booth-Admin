/** Principal only: Stripe-calculated tax is accounted for separately. */
const cents = value => Math.round(Number(value || 0) * 100);
export function bookingPaymentPolicy({total, paid = 0, balance, dueDate, businessDate, dueAt, now=Date.now()}) {
  const totalCents = cents(total), paidCents = Math.max(0,cents(paid));
  const outstanding = balance == null ? Math.max(0,totalCents-paidCents) : Math.max(0,cents(balance));
  const first = paidCents === 0;
  const deadline=dueAt?Date.parse(dueAt):NaN;
  const finalCheckoutWindow=Number.isFinite(deadline)&&deadline-Number(now)<=30*60000;
  const overdue = Boolean(dueDate && businessDate && String(dueDate).slice(0,10) <= businessDate)||finalCheckoutWindow;
  const minimum = first ? Math.min(outstanding,Math.ceil(totalCents*.3)) : Math.min(100,outstanding);
  const depositAvailable = first && !overdue && minimum > 0 && minimum < outstanding;
  return {fullAmount:outstanding/100,amountDue:depositAvailable?minimum/100:outstanding/100,
    minimumAmount:(overdue?outstanding:minimum)/100,depositAvailable,
    depositRemaining:depositAvailable?minimum/100:0,depositSatisfied:!first,
    allowCustomAmount:outstanding>0&&!overdue,allowPayInFull:outstanding>0,overdue,dueAt:dueAt||null,finalCheckoutWindow};
}
export function bookingPaymentLabel(paid,total){
  const p=Math.max(0,cents(paid)),t=cents(total);
  if(!p||t<=0)return 'Pending';
  if(p>=t)return 'Paid in Full';
  if(p===Math.ceil(t*.3))return 'Paid';
  return `${Math.min(99,Math.round(p/t*100))}% Paid`;
}

export const SHORT_NOTICE_PAYMENT_MESSAGE='Full payment is required because your event is within 14 days.';
export function bookingSchedule({eventDate,businessDate,total=0}){
 const event=String(eventDate||'').slice(0,10),today=String(businessDate||'').slice(0,10);
 const distance=(Date.parse(event+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000;
 const fullPaymentRequired=Number.isFinite(distance)&&distance<=14;
 return {fullPaymentRequired,balanceDueDate:Number.isFinite(distance)?new Date(Date.parse(event+'T00:00:00Z')-14*86400000).toISOString().slice(0,10):null,amountDueNow:fullPaymentRequired?Number(total):null,message:fullPaymentRequired?SHORT_NOTICE_PAYMENT_MESSAGE:null};
}
