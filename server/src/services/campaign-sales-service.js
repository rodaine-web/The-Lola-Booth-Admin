import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {linkCampaignInterest} from './campaign-lead-service.js';
import {campaignOffers} from './campaign-offers.js';
import {createInvoice,getInvoice} from './invoice-service.js';
import {createProposal,createProposalVersion} from './proposal-service.js';

// Interest is not contractual acceptance. The customer accepts the versioned
// proposal through the existing acceptance journey, including its consent record.
export async function campaignCommercialProposal(campaignId,interestId,req){
 return transaction(async client=>{
  const linked=await linkCampaignInterest(campaignId,interestId,req.user.id);
  const interest=(await query('SELECT * FROM campaign_interests WHERE id=$1 AND campaign_id=$2 FOR UPDATE',[interestId,campaignId])).rows[0];
  const existing=(await query("SELECT * FROM proposals WHERE content->>'campaign_interest_id'=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1",[interestId])).rows[0];
  if(existing)return {proposal:existing};
  if((await query('SELECT id FROM invoices WHERE campaign_interest_id=$1',[interestId])).rows.length)throw new AppError('This interest already has a legacy invoice. Review its payments and commercial terms before linking a proposal.',409,'CAMPAIGN_LEGACY_INVOICE_REVIEW');
  const frozen=interest.offer_snapshot;
  const current=(await campaignOffers(campaignId)).offers.find(o=>o.key===interest.package);
  if(!frozen?.selections?.length||!current||!isDeepStrictEqual(frozen.selections,current.selections)||Number(frozen.discounted)!==Number(current.discounted))throw new AppError('The campaign offer has changed or is unavailable. Review the originally requested commercial terms before preparing a proposal.',409,'CAMPAIGN_OFFER_CHANGED');
  const lead=(await query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[linked.lead_id])).rows[0];
  let customer=lead.converted_client_id?(await query('SELECT * FROM clients WHERE id=$1 AND deleted_at IS NULL',[lead.converted_client_id])).rows[0]:null;
  if(!customer)customer=(await query('SELECT * FROM clients WHERE lower(email)=lower($1) AND deleted_at IS NULL ORDER BY created_at LIMIT 1',[lead.email])).rows[0];
  if(!customer)customer=(await query("INSERT INTO clients(name,email,phone,company,client_type,referral_source) VALUES($1,$2,$3,$4,'CORPORATE','Campaign') RETURNING *",[[lead.first_name,lead.last_name].filter(Boolean).join(' '),lead.email,lead.phone,lead.company])).rows[0];
  let event=lead.converted_event_id?(await query('SELECT * FROM events WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[lead.converted_event_id])).rows[0]:null;
  if(event&&(event.client_id!==customer.id||['CANCELLED','COMPLETED','CONFIRMED','PREPARING','READY','IN_PROGRESS'].includes(event.status)))throw new AppError('Review the existing event before adding this commercial offer.',409,'CAMPAIGN_EVENT_REVIEW');
  if(!event)event=(await query(`INSERT INTO events(client_id,event_name,event_type,event_date,start_time,venue_name,status,experience_id,package_id,client_notes)
   VALUES($1,$2,$3,$4,$5,$6,'PENDING_DEPOSIT',$7,$8,$9) RETURNING *`,[customer.id,`${frozen.campaign_name} — ${customer.name}`,lead.event_type,interest.event_date,interest.event_time,interest.location,frozen.selections[0].experience_id,frozen.selections[0].packages[0]?.package_id||null,lead.message])).rows[0];
  for(const [index,selection] of frozen.selections.entries()){
   await query('INSERT INTO event_experiences(event_id,experience_id,display_order) VALUES($1,$2,$3) ON CONFLICT(event_id,experience_id) DO NOTHING',[event.id,selection.experience_id,index]);
   for(const pkg of selection.packages||[])if(pkg.package_id)await query('INSERT INTO event_packages(event_id,package_id,display_order) VALUES($1,$2,$3) ON CONFLICT(event_id,package_id) DO NOTHING',[event.id,pkg.package_id,index]);
  }
  await query('UPDATE leads SET converted_client_id=$2,converted_event_id=$3,updated_at=now() WHERE id=$1',[lead.id,customer.id,event.id]);
  const proposal=await createProposal({...req,body:{lead_id:lead.id,client_id:customer.id,event_id:event.id,scenario_enabled:true,selected_experiences:frozen.selections,deposit_type:'PERCENTAGE',deposit_value:30,proposal_title:frozen.name}});
  const updated=(await query('UPDATE proposals SET content=content||$2::jsonb WHERE id=$1 RETURNING *',[proposal.id,JSON.stringify({campaign_interest_id:interestId,campaign_id:campaignId,campaign_offer:frozen})])).rows[0];
  await createProposalVersion(client,updated,req.user.id);
  return {proposal:updated};
 });
}

const invoiceInput=z.object({send:z.boolean().default(false)}).strict();
export async function campaignDepositInvoice(campaignId,interestId,input,req){
 const data=invoiceInput.parse(input);
 const proposal=(await query("SELECT p.* FROM proposals p JOIN campaign_interests i ON i.id=(p.content->>'campaign_interest_id')::uuid WHERE i.id=$1 AND i.campaign_id=$2 AND p.deleted_at IS NULL ORDER BY p.created_at LIMIT 1",[interestId,campaignId])).rows[0];
 if(!proposal?.accepted_version_id||!['ACCEPTED','CONVERTED'].includes(proposal.status))throw new AppError('Prepare the campaign proposal and obtain customer acceptance before creating an invoice.',409,'CAMPAIGN_ACCEPTANCE_REQUIRED');
 // Delivery belongs to the dedicated acceptance handoff. This endpoint cannot
 // independently send a second thank-you/payment email or bypass paused workers.
 if(data.send)throw new AppError('Invoice delivery uses the accepted-proposal handoff. Review its communication and worker status instead of sending a separate campaign invoice.',409,'CAMPAIGN_HANDOFF_REQUIRED');
 const invoice=await createInvoice({...req,body:{proposal_id:proposal.id,depositOnly:true}});
 return {invoice:await getInvoice(invoice.id)};
}
