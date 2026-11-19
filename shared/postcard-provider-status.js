const instant=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export function providerMilestones(value,event=null){
 let mailed=null,delivered=null,tracking=null,trackingAt=null;
 const events=[...(value.tracking_events||[])];
 if(event)events.push({name:event.event_type?.id?.replace(/^postcard\./,''),time:event.date_created});
 for(const entry of events.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time))){
  const type=String(entry.name||entry.type||'').toLowerCase().replaceAll(' ','_');
  if(!instant(entry.time))continue;
  if(type==='mailed')mailed=instant(entry.time);
  if(type==='delivered')delivered=instant(entry.time);
  if(['mailed','delivered','in_transit','in_local_area','processed_for_delivery','returned_to_sender','rejected','failed','cancelled','canceled'].includes(type)){tracking=type;trackingAt=instant(entry.time);}
 }
 return {scheduled:instant(value.send_date),expected:/^\d{4}-\d{2}-\d{2}$/.test(value.expected_delivery_date||'')?value.expected_delivery_date:null,mailed,delivered,tracking,trackingAt};
}
