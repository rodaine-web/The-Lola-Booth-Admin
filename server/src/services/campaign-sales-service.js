import crypto from 'node:crypto';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {linkCampaignInterest} from './campaign-lead-service.js';
import {campaignOffers} from './campaign-offers.js';
import {calculateInvoiceTotals,getInvoice,publicInvoiceUrl} from './invoice-service.js';
import {nextNumber} from './proposal-service.js';
import {brandedEmailHtml,createCommunicationDraft,sendCommunication} from './automation-service.js';
import {writeAudit} from './audit-service.js';

const inputSchema=z.object({deposit_percent:z.coerce.number().gt(0).max(100).optional(),due_date:z.iso.date().optional(),send:z.boolean().default(false)});
export async function campaignDepositInvoice(campaignId,interestId,input,req){
 const data=inputSchema.parse(input);
 const saved=await transaction(async client=>{
  const linked=await linkCampaignInterest(campaignId,interestId,req.user.id);
  const interest=(await query('SELECT * FROM campaign_interests WHERE id=$1 FOR UPDATE',[interestId])).rows[0];
  const existing=(await query('SELECT * FROM invoices WHERE campaign_interest_id=$1',[interestId])).rows[0];
  if(existing){if(existing.deleted_at||['VOID','REFUNDED'].includes(existing.status))throw new AppError('This campaign invoice was voided or refunded. Review it before replacing it.',409,'CAMPAIGN_INVOICE_CLOSED');return existing;}
  const offer=interest.offer_snapshot||(await campaignOffers(campaignId)).offers.find(o=>o.key===interest.package);
  if(!offer||!(offer.discounted>0))throw new AppError('This interest needs a priced campaign offer before an invoice can be created.',422,'CAMPAIGN_PRICE_REQUIRED');
  const settings=(await query('SELECT * FROM business_settings LIMIT 1')).rows[0];
  const percent=data.deposit_percent??Number(settings.default_deposit_percent||30);
  if(!(percent>0&&percent<=100))throw new AppError('Set a deposit percentage between 0 and 100.',422,'INVALID_DEPOSIT');
  const totals=calculateInvoiceTotals([{description:offer.name,quantity:1,unit_price:offer.original,discount:offer.saving,tax_rate:Number(settings.sales_tax_percent||0)}]);
  const deposit=Math.round(totals.total*percent)/100;
  if(!(deposit>0))throw new AppError('The deposit must be greater than zero.',422,'INVALID_DEPOSIT');
  const number=await nextNumber(client,'next_invoice_number','invoice_prefix','LOLA-INV');
  const invoice=(await query(`INSERT INTO invoices(invoice_number,lead_id,campaign_interest_id,status,subtotal,discount,tax,total,amount_paid,balance_due,amount_outstanding,due_date,notes,terms,secure_token,pricing_snapshot)
   VALUES($1,$2,$3,'DRAFT',$4,$5,$6,$7,0,$7,$7,$8,$9,$10,$11,$12) RETURNING *`,[number,linked.lead_id,interestId,totals.subtotal,totals.discount,totals.tax,totals.total,data.due_date||new Date(Date.now()+Number(settings.invoice_default_due_days||7)*86400000).toISOString().slice(0,10),`Campaign offer: ${offer.campaign_name}. Event: ${interest.event_date} ${interest.event_time}. ${interest.location||''}`,settings.invoice_default_payment_terms,crypto.randomBytes(24).toString('hex'),JSON.stringify({...totals,campaign_id:campaignId,campaign_name:offer.campaign_name,campaign_offer:offer,payment_mode:'DEPOSIT_REQUEST',amount_due_now:deposit,deposit_amount:deposit,deposit_percent:percent,proposal_total:totals.total,allow_pay_in_full:true,allow_custom_amount:false})])).rows[0];
  for(const item of totals.items)await query('INSERT INTO invoice_items(invoice_id,label,description,quantity,unit_price,taxable,tax_rate,discount,total,line_total) VALUES($1,$2,$2,1,$3,true,$4,$5,$6,$6)',[invoice.id,item.description,item.unit_price,item.tax_rate,item.discount,item.line_total]);
  return invoice;
 });
 await writeAudit({req,action:'campaign_deposit_invoice',entity:'invoice',entityId:saved.id,after:saved});
 const invoice=await getInvoice(saved.id);
 if(!data.send)return {invoice};
 if(['PAID','VOID','REFUNDED'].includes(invoice.status)||Number(invoice.amount_paid)>=Number(invoice.pricing_snapshot.amount_due_now))throw new AppError('This invoice does not need a deposit request.',409,'CAMPAIGN_INVOICE_CLOSED');
 const idempotencyKey='campaign-interest-invoice:'+interestId;
 let communication=await transaction(async()=>{
 await query('SELECT pg_advisory_xact_lock(hashtext($1))',[idempotencyKey]);
 let communication=(await query('SELECT * FROM communications WHERE idempotency_key=$1',[idempotencyKey])).rows[0];
 if(!communication){
  const url=publicInvoiceUrl(invoice);
  const body=`Hi ${invoice.client_name||'there'},\n\nThank you for your interest in ${invoice.pricing_snapshot.campaign_name}. Your selected offer is ${invoice.pricing_snapshot.campaign_offer.name}.\n\nYour event: ${invoice.event_date} at ${invoice.venue_name||'your selected location'}.\nOffer total: $${Number(invoice.total).toFixed(2)}.\nDeposit requested: $${Number(invoice.pricing_snapshot.amount_due_now).toFixed(2)}.\n\nView your invoice and pay your deposit securely:\n${url}\n\nWe look forward to celebrating with you.\nThe LOLA Booth`;
  communication=await createCommunicationDraft({lead_id:invoice.lead_id,invoice_id:invoice.id,recipient:invoice.client_email,subject:'Thank you for your interest — your LOLA deposit invoice',body,html:brandedEmailHtml(body,{kicker:'Thank you for your interest',ctaLabel:'View & Pay Deposit',ctaUrl:url})},req.user);
  await query('UPDATE communications SET idempotency_key=$2 WHERE id=$1',[communication.id,idempotencyKey]);
 }
 return communication;
 });
 if(!['SENT','SENT_TO_PROVIDER','DELIVERED'].includes(communication.status)){
  const result=await sendCommunication(communication.id,req.user);
  communication=result.communication;
  if(!['SENT','SENT_TO_PROVIDER','DELIVERED'].includes(communication.status))throw new AppError('The thank-you email was not sent. Review the saved communication.',409,'CAMPAIGN_EMAIL_NOT_SENT');
 }
 await query("UPDATE invoices SET status=CASE WHEN status='DRAFT' THEN 'SENT' ELSE status END,sent_at=COALESCE(sent_at,now()) WHERE id=$1",[invoice.id]);
 return {invoice:await getInvoice(invoice.id),communication};
}
