import {recordActivity} from './activity-service.js';
import {AppError} from '../utils/errors.js';

// Classification follows posted money, not proposal acceptance or booking confirmation.
// Called inside the locked invoice reconciliation transaction; never creates an event.
export async function convertPaidLead(client,invoice) {
 if(!(Number(invoice.amount_paid)>0)||['VOID','REFUNDED'].includes(invoice.status))return null;
 const context=(await client.query(`SELECT l.id,l.email FROM leads l WHERE l.deleted_at IS NULL
  AND l.id=COALESCE($1::uuid,(SELECT lead_id FROM proposals WHERE id=$2 AND deleted_at IS NULL))`,[invoice.lead_id||null,invoice.proposal_id||null])).rows[0];
 if(!context)return null;
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[String(context.email||context.id).toLowerCase()]);
 const lead=(await client.query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[context.id])).rows[0];
 let clientId=invoice.client_id||lead.converted_client_id;
 if(clientId&&!(await client.query('SELECT id FROM clients WHERE id=$1 AND deleted_at IS NULL',[clientId])).rows.length)throw new AppError('The paid booking client needs Admin review.',409,'PAID_CLIENT_UNAVAILABLE');
 if(!clientId){
  clientId=(await client.query('SELECT id FROM clients WHERE lower(email)=lower($1) AND deleted_at IS NULL ORDER BY created_at,id LIMIT 1',[lead.email])).rows[0]?.id;
  if(!clientId)clientId=(await client.query('INSERT INTO clients(name,email,phone,company,referral_source) VALUES($1,$2,$3,$4,$5) RETURNING id',[[lead.first_name,lead.last_name].filter(Boolean).join(' ')||'Client',lead.email,lead.phone,lead.company,lead.lead_source])).rows[0].id;
 }
 if(lead.converted_client_id&&lead.converted_client_id!==clientId)throw new AppError('This lead is linked to a different client. Review the billing linkage.',409,'PAID_CLIENT_CONFLICT');
 await client.query("UPDATE leads SET status='WON',converted_client_id=$2,converted_event_id=COALESCE($3,converted_event_id),updated_at=now() WHERE id=$1",[lead.id,clientId,invoice.event_id||null]);
 await client.query('UPDATE invoices SET client_id=$2 WHERE id=$1',[invoice.id,clientId]);
 await client.query('UPDATE payments SET client_id=$2 WHERE invoice_id=$1',[invoice.id,clientId]);
 await client.query('UPDATE payment_attempts SET client_id=$2 WHERE invoice_id=$1',[invoice.id,clientId]);
 if(invoice.proposal_id)await client.query('UPDATE proposals SET client_id=$2 WHERE id=$1 AND client_id IS NULL',[invoice.proposal_id,clientId]);
 if(lead.status!=='WON')await recordActivity({entityType:'lead',entityId:lead.id,action:'lead_payment_converted',summary:'Payment received — lead converted to client',metadata:{invoice_id:invoice.id,client_id:clientId}});
 return {client_id:clientId};
}
