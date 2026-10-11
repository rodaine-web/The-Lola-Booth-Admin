// Presentation only. Server-side booking guards remain authoritative.
export function bookingOverview({ event, proposal, lead, contracts = null }) {
  const signed = contracts?.find(c => c.status === 'SIGNED' && (!proposal?.accepted_version_id || c.snapshot?.accepted_version_id === proposal.accepted_version_id));
  const accepted = ['ACCEPTED', 'CONVERTED'].includes(proposal?.status);
  const sent = accepted || ['SENT', 'VIEWED'].includes(proposal?.status);
  const total = Number(event?.booked_total || 0);
  const required = Number(event?.deposit_required || 0);
  const paid = Number(event?.amount_paid || 0);
  const retainerPaid = required > 0 && paid >= required;
  const fullyPaid = total > 0 && Number(event?.balance_due) === 0 && paid >= total;
  const confirmed = ['CONFIRMED', 'PREPARING', 'READY', 'IN_PROGRESS', 'COMPLETED'].includes(event?.status);
  const planning = event?.operations?.readiness?.items?.find(i => i.category === 'Planning' || /client planning|planning submission|event planning approved/i.test(i.label));
  const planningComplete = ['COMPLETE', 'COMPLETED', 'READY'].includes(planning?.status);
  const date = value => value ? String(value).slice(0, 10) : 'Complete';
  const steps = [
    {key:'inquiry',label:'Inquiry',complete:Boolean(lead || event || proposal),detail:date(lead?.received_at || lead?.created_at || event?.created_at || proposal?.created_at)},
    {key:'proposal',label:'Proposal',complete:accepted,detail:accepted ? 'Accepted' : sent ? 'Sent · awaiting acceptance' : proposal ? 'Draft' : 'Not created'},
    {key:'retainer',label:'Booking Retainer Fee',complete:retainerPaid,detail:retainerPaid ? 'Paid' : 'Pending'},
    {key:'agreement',label:'Agreement Signed',complete:Boolean(signed),detail:signed ? date(signed.signed_at) : contracts === null ? 'Not recorded' : 'Pending'},
    {key:'planning',label:'Planning',complete:planningComplete,detail:planningComplete ? 'Complete' : confirmed ? 'Needs attention' : 'Locked until confirmation'},
    {key:'balance',label:'Final Payment',complete:fullyPaid,detail:fullyPaid ? 'Paid' : 'Pending'},
    {key:'event',label:'Event',complete:event?.status === 'COMPLETED',detail:event?.status === 'CANCELLED' ? 'Cancelled' : event?.status === 'COMPLETED' ? 'Completed' : 'Upcoming'}
  ];
  let next = !proposal ? {title:'Create and Send Proposal',description:'Build a proposal with the requested experiences, packages and pricing.',action:'Create Proposal',kind:'proposal'} : !accepted ? {title: sent ? 'Follow Up on Proposal' : 'Complete and Send Proposal',description:sent ? 'Review the proposal and follow up on client acceptance.' : 'Review the commercial details before sending the proposal.',action:'View Proposal',kind:'proposal'} : !retainerPaid ? {title:'Review Booking Retainer Fee Invoice',description:'The proposal is accepted. Review the linked invoice and payment handoff.',action:'View Proposal & Invoice',kind:'retainer'} : !signed ? {title:'Complete the Agreement',description:'Review the agreement and signing status before confirming the booking.',action:'View Agreement',kind:'agreement'} : !confirmed ? {title:'Review Booking Confirmation',description:'Check payment, agreement and availability prerequisites before confirmation.',action:'Review Booking',kind:'confirmation'} : !planningComplete ? {title:'Complete Event Planning',description:'Review event details, client submissions and creative requirements.',action:'View Booking',kind:'planning'} : !fullyPaid ? {title:'Review Final Payment',description:'Check the remaining balance and payment due date.',action:'View Booking',kind:'balance'} : {title:'Prepare for the Event',description:'Review the event checklist and team readiness.',action:'View Booking',kind:'event'};
  if (event?.status === 'CANCELLED' || ['LOST','ARCHIVED'].includes(lead?.status)) next = {title:'Booking Closed',description:'Review the recorded history and commercial documents.',action:proposal ? 'View Proposal' : 'Create New Proposal',kind:'closed'};
  return {steps, next, proposal, sent, accepted, signed, agreement:signed || contracts?.find(contract=>contract.status==='ISSUED'), retainerPaid, fullyPaid, confirmed, confirmation:{key:'confirmation',label:'Booking Confirmed',complete:confirmed,detail:confirmed?'Confirmed':'Pending prerequisites'}};
}
