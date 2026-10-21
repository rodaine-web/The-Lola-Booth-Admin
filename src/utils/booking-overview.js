import {bookingPaymentLabel} from '../../shared/booking-payment-policy.js';
// Read-only projection; backend guards independently enforce transitions.
export function bookingOverview({event,proposal,lead,contracts=null}){
 const facts=event?.lifecycle;
 proposal=facts?.proposal||proposal;contracts=facts?.contracts||contracts;
 const invoice=facts?.invoice||event?.invoices?.find(i=>i.proposal_id===proposal?.id&&!['VOID','REFUNDED'].includes(i.status));
 const latest=(contracts||[]).filter(c=>['ISSUED','SIGNED'].includes(c.status)).sort((a,b)=>Number(b.revision||0)-Number(a.revision||0))[0];
 const signed=latest?.status==='SIGNED'&&(!proposal?.accepted_version_id||latest.snapshot?.accepted_version_id===proposal.accepted_version_id)?latest:undefined;
 const accepted=['ACCEPTED','CONVERTED'].includes(proposal?.status)||Boolean(proposal?.accepted_at)||Boolean(signed);
 const sent=accepted||['SENT','VIEWED'].includes(proposal?.status);
 const total=Number(invoice?.total??event?.booked_total??proposal?.total??0);
 const paid=Number(invoice?.verified_paid??invoice?.amount_paid??event?.amount_paid??0);
 const retainerPaid=total>0&&Math.round(paid*100)>=Math.ceil(Math.round(total*100)*.3);
 const fullyPaid=total>0&&Math.round(paid*100)>=Math.round(total*100);
 const confirmed=['CONFIRMED','PREPARING','READY','IN_PROGRESS','COMPLETED'].includes(event?.status);
 const planning=event?.operations?.readiness?.items?.find(i=>i.category==='Planning'||/client planning|planning submission|event planning approved/i.test(i.label));
 const planningComplete=['COMPLETE','COMPLETED','READY'].includes(planning?.status);
 const date=value=>value?String(value).slice(0,10):'Complete';
 const steps=[
  {key:'lead',label:'Lead',complete:Boolean(lead||event||proposal),detail:date(lead?.received_at||lead?.created_at||event?.created_at||proposal?.created_at)},
  {key:'proposal',label:'Proposal',complete:sent,detail:accepted?'Accepted':sent?'Sent':proposal?'Draft':'Not created'},
  {key:'accepted',label:'Proposal Accepted / Client',complete:accepted,detail:accepted?'Converted to client':'Awaiting acceptance'},
  {key:'invoice',label:'Invoice',complete:Boolean(invoice),detail:invoice?invoice.invoice_number||'Created':'Not created'},
  {key:'agreement',label:'Agreement',complete:Boolean(signed),detail:signed?date(signed.signed_at):latest?.status==='ISSUED'?'Awaiting signature':accepted?'Preparing':'Not ready'},
  {key:'retainer',label:'Booking Fee / Payment',complete:retainerPaid,detail:paid>0?bookingPaymentLabel(paid,total):signed?'Pending':'After agreement'},
  {key:'workspace',label:'Workspace / Active Event',complete:Boolean(facts?.workspace)&&confirmed&&retainerPaid&&Boolean(signed),detail:confirmed&&retainerPaid&&signed?(facts?.workspace?'Active':'Invitation pending'):signed&&!retainerPaid?'Awaiting payment':'Not active'}
 ];
 let next=!proposal?{title:'Create and Send Proposal',description:'Review the requested services and pricing before sending.',action:'Create Proposal',kind:'proposal'}:
 !accepted?{title:sent?'Follow Up on Proposal':'Complete and Send Proposal',description:'Review commercial details and customer acceptance.',action:'View Proposal',kind:'proposal'}:
 !invoice?{title:'Review Invoice Handoff',description:'The proposal is accepted and the lead is now a client. Review the invoice handoff.',action:'View Proposal & Invoice',kind:'invoice'}:
 !signed?{title:'Complete the Agreement',description:'The current agreement must be signed before the first payment.',action:'View Agreement',kind:'agreement'}:
 !retainerPaid?{title:'Review Booking Fee / Payment',description:'Agreement signed. Review successful payments and the required booking payment.',action:'View Payments',kind:'balance'}:
 !confirmed?{title:'Review Booking Confirmation',description:'Review the commercial and payment prerequisites.',action:'Review Booking',kind:'confirmation'}:
 facts&&!facts.workspace?{title:'Send Client Workspace Invitation',description:'Booking prerequisites are complete. Review secure workspace invitation delivery.',action:'View Proposal & Workspace',kind:'workspace'}:
 !planningComplete?{title:'Complete Event Planning',description:'Review event details and creative requirements.',action:'View Booking',kind:'planning'}:
 !fullyPaid?{title:'Review Final Payment',description:'Review the remaining balance and due date.',action:'View Payments',kind:'balance'}:
 {title:'Prepare for the Event',description:'Review the event checklist and team readiness.',action:'View Booking',kind:'event'};
 if(event?.status==='CANCELLED'||['VOID','REFUNDED'].includes(invoice?.status)||['LOST','ARCHIVED'].includes(lead?.status))next={title:'Booking Closed',description:'Review the recorded history and documents.',action:proposal?'View Proposal':'Create New Proposal',kind:'closed'};
 return {steps,next,proposal,sent,accepted,signed,agreement:signed||latest,retainerPaid,fullyPaid,confirmed,confirmation:{key:'confirmation',label:'Booking Confirmed',complete:confirmed,detail:confirmed?'Confirmed':'Pending prerequisites'}};
}
