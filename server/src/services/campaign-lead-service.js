import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {recordActivity} from './activity-service.js';
import {campaignOffers} from './campaign-offers.js';

export async function linkCampaignInterest(campaignId,interestId,actorUserId=null){
 return transaction(async()=>{
  const i=(await query(`SELECT i.*,r.lead_id,r.client_id,r.email,r.first_name,r.last_name,r.phone,r.company,c.name campaign_name,c.created_by
   FROM campaign_interests i JOIN campaign_recipients r ON r.id=i.campaign_recipient_id JOIN campaigns c ON c.id=i.campaign_id
   WHERE i.id=$1 AND i.campaign_id=$2`,[interestId,campaignId])).rows[0];
  if(!i)throw new AppError('Interest not found.',404,'NOT_FOUND');
  await query('SELECT pg_advisory_xact_lock(hashtext($1))',[i.email.toLowerCase()]);
  await query('SELECT id FROM campaign_recipients WHERE id=$1 FOR UPDATE',[i.campaign_recipient_id]);
  await query('SELECT id FROM campaign_interests WHERE id=$1 FOR UPDATE',[i.id]);
  let lead=i.lead_id?(await query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL',[i.lead_id])).rows[0]:null;
  if(lead && lead.event_date!==i.event_date)lead=null;
  if(!lead)lead=(await query("SELECT * FROM leads WHERE lower(email)=lower($1) AND event_date=$2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[i.email,i.event_date])).rows[0];
  const offer=i.offer_snapshot||(await campaignOffers(campaignId)).offers.find(o=>o.key===i.package)||null;
  if(!lead)lead=(await query(`INSERT INTO leads(first_name,last_name,email,phone,event_date,event_start_time,event_type,venue_name,company,lead_source,message,marketing_email_opt_in,assigned_user_id,preferred_experience_id,preferred_package_id,status,converted_client_id)
   VALUES($1,$2,$3,$4,$5,$6,'CORPORATE',$7,$8,'CAMPAIGN',$9,false,$10,$11,$12,'FOLLOW_UP',$13) RETURNING *`,[i.first_name||'Prospect',i.last_name||'',i.email,i.phone||null,i.event_date,i.event_time,i.location,i.company,`Campaign interest: ${i.campaign_name} — ${offer?.name||i.package}`,actorUserId||i.created_by,offer?.selections?.[0]?.experience_id||null,offer?.selections?.[0]?.packages?.[0]?.package_id||null,i.client_id])).rows[0];
  else if(lead.status!=='WON')lead=(await query("UPDATE leads SET status='FOLLOW_UP',updated_at=now() WHERE id=$1 RETURNING *",[lead.id])).rows[0];
  await query('UPDATE campaign_recipients SET lead_id=$2 WHERE id=$1',[i.campaign_recipient_id,lead.id]);
  await query('UPDATE campaign_interests SET offer_snapshot=COALESCE(offer_snapshot,$2::jsonb) WHERE id=$1',[i.id,offer?JSON.stringify(offer):null]);
  if(!i.lead_id)await recordActivity({actorUserId,entityType:'lead',entityId:lead.id,action:'campaign_interest_converted',summary:`Follow up on ${i.campaign_name}`,metadata:{campaign_id:campaignId,interest_id:i.id}});
  return {lead_id:lead.id,lead_status:lead.status,offer};
 });
}

// Called inside invoice reconciliation after verified payments have been posted.
export async function convertPaidCampaignLead(client,invoice){
 if(!invoice.campaign_interest_id||!invoice.lead_id||['VOID','REFUNDED'].includes(invoice.status))return null;
 const required=Number(invoice.pricing_snapshot?.amount_due_now||0);
 if(!(required>0)||Math.round(Number(invoice.amount_paid)*100)<Math.round(required*100))return null;
 const context=(await client.query('SELECT email FROM leads WHERE id=$1 AND deleted_at IS NULL',[invoice.lead_id])).rows[0];
 if(!context)throw new AppError('Campaign lead is unavailable for payment conversion.',409,'LEAD_UNAVAILABLE');
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[context.email.toLowerCase()]);
 const lead=(await client.query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[invoice.lead_id])).rows[0];
 if(!lead)throw new AppError('Campaign lead is unavailable for payment conversion.',409,'LEAD_UNAVAILABLE');
 let customer=lead.converted_client_id?(await client.query('SELECT * FROM clients WHERE id=$1 AND deleted_at IS NULL',[lead.converted_client_id])).rows[0]:null;
 if(!customer)customer=(await client.query('SELECT * FROM clients WHERE lower(email)=lower($1) AND deleted_at IS NULL ORDER BY created_at LIMIT 1',[lead.email])).rows[0];
 if(!customer)customer=(await client.query("INSERT INTO clients(name,email,phone,company,client_type,referral_source) VALUES($1,$2,$3,$4,'CORPORATE','Campaign') RETURNING *",[[lead.first_name,lead.last_name].filter(Boolean).join(' '),lead.email,lead.phone,lead.company])).rows[0];
 let eventId=lead.converted_event_id;
 if(!eventId)eventId=(await client.query(`INSERT INTO events(client_id,event_name,event_type,event_date,start_time,venue_name,status,experience_id,package_id,client_notes)
 VALUES($1,$2,$3,$4,$5,$6,'PENDING_CONTRACT',$7,$8,$9) RETURNING id`,[customer.id,invoice.pricing_snapshot.campaign_name+' — '+[lead.first_name,lead.last_name].filter(Boolean).join(' '),lead.event_type,lead.event_date,lead.event_start_time,lead.venue_name,lead.preferred_experience_id,lead.preferred_package_id,lead.message])).rows[0].id;
 const selections=invoice.pricing_snapshot.campaign_offer?.selections||[];
 for(const [index,selection] of selections.entries()){
  await client.query('INSERT INTO event_experiences(event_id,experience_id,display_order) VALUES($1,$2,$3) ON CONFLICT(event_id,experience_id) DO NOTHING',[eventId,selection.experience_id,index]);
  for(const pkg of selection.packages||[])if(pkg.package_id)await client.query('INSERT INTO event_packages(event_id,package_id,display_order) VALUES($1,$2,$3) ON CONFLICT(event_id,package_id) DO NOTHING',[eventId,pkg.package_id,index]);
 }
 const booking=(await client.query('SELECT id FROM bookings WHERE event_id=$1 AND deleted_at IS NULL',[eventId])).rows[0];
 if(!booking)await client.query('INSERT INTO bookings(event_id,client_id,lead_id,subtotal,discount,total,deposit_required,amount_paid,balance_due,payment_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[eventId,customer.id,lead.id,invoice.subtotal,invoice.discount,invoice.total,required,invoice.amount_paid,invoice.amount_outstanding,Number(invoice.amount_outstanding)>0?'PARTIAL':'PAID']);
 await client.query("UPDATE leads SET status=CASE WHEN status='WON' THEN status ELSE 'FOLLOW_UP' END,converted_client_id=$2,converted_event_id=$3,updated_at=now() WHERE id=$1",[lead.id,customer.id,eventId]);
 await client.query('UPDATE invoices SET client_id=$2,event_id=$3 WHERE lead_id=$1 AND campaign_interest_id IS NOT NULL',[lead.id,customer.id,eventId]);
 await client.query('UPDATE payments SET client_id=$2,event_id=$3 WHERE invoice_id=$1',[invoice.id,customer.id,eventId]);
 await client.query('UPDATE payment_attempts SET client_id=$2,event_id=$3 WHERE invoice_id=$1',[invoice.id,customer.id,eventId]);
 await client.query('UPDATE campaign_recipients SET client_id=$2 WHERE lead_id=$1',[lead.id,customer.id]);
 if(lead.status!=='WON')await recordActivity({entityType:'lead',entityId:lead.id,action:'campaign_deposit_paid',summary:'Booking payment received — client linked; agreement and confirmation remain pending',metadata:{invoice_id:invoice.id,client_id:customer.id}});
 return {client_id:customer.id,event_id:eventId};
}
