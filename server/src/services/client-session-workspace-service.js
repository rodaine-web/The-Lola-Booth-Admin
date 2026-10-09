import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {invoiceBalance} from '../../../shared/invoice-balance.js';

// Sessions identify a client. Every event/document query also checks an active,
// signed commercial grant; knowing another event UUID never grants access.
export async function clientEvents(session){
 return (await query(`SELECT DISTINCT ON (p.event_id) p.event_id AS id,e.event_name AS name,e.event_date AS date,e.status,p.id AS proposal_id
  FROM client_workspace_grants g JOIN proposals p ON p.id=g.proposal_id JOIN events e ON e.id=p.event_id
  JOIN contracts k ON k.id=g.signed_contract_id JOIN clients c ON c.id=g.client_id
  WHERE g.client_id=$1 AND g.revoked_at IS NULL AND p.client_id=$1 AND e.client_id=$1
   AND p.deleted_at IS NULL AND e.deleted_at IS NULL AND c.deleted_at IS NULL AND lower(c.email)=$2
   AND k.status='SIGNED' AND lower(k.signer_email)=$2 AND k.snapshot->>'accepted_version_id'=p.accepted_version_id::text
  ORDER BY p.event_id,p.created_at DESC`,[session.client_id,session.email])).rows;
}
export async function clientEventGrant(session,eventId){
 const events=await clientEvents(session);const grant=events.find(event=>event.id===eventId);
 if(!grant)throw new AppError('This event is unavailable in your workspace.',404,'NOT_FOUND');
 return grant;
}
export async function sessionWorkspace(session,eventId){
 return transaction(async()=>{
  const grant=await clientEventGrant(session,eventId);
  const proposal=(await query(`SELECT p.id,p.proposal_number,p.status,p.total,c.name AS client_name,
   e.event_name,e.event_date,e.venue_name,e.status AS event_status,e.start_time,e.end_time
   FROM proposals p JOIN clients c ON c.id=p.client_id JOIN events e ON e.id=p.event_id
   WHERE p.id=$1`,[grant.proposal_id])).rows[0];
  const agreements=(await query("SELECT id,title,revision,status,signed_at,signer_name FROM contracts WHERE proposal_id=$1 AND status='SIGNED' ORDER BY revision DESC",[proposal.id])).rows;
  const invoices=(await query("SELECT id,invoice_number,status,total,amount_paid,amount_outstanding,balance_due,due_date FROM invoices WHERE (proposal_id=$1 OR EXISTS(SELECT 1 FROM backdrop_quotes q WHERE q.invoice_id=invoices.id AND q.event_id=$3 AND q.client_id=$2 AND q.status='ACCEPTED')) AND client_id=$2 AND event_id=$3 AND deleted_at IS NULL AND status NOT IN ('DRAFT','VOID') ORDER BY created_at DESC",[proposal.id,session.client_id,eventId])).rows;
  const receipts=(await query(`SELECT pay.id,pay.invoice_id,pay.amount,pay.refunded_amount,pay.status,pay.payment_date FROM payments pay
   JOIN invoices i ON i.id=pay.invoice_id WHERE (i.proposal_id=$1 OR EXISTS(SELECT 1 FROM backdrop_quotes q WHERE q.invoice_id=i.id AND q.event_id=$3 AND q.client_id=$2 AND q.status='ACCEPTED')) AND i.client_id=$2 AND i.event_id=$3
    AND i.deleted_at IS NULL AND i.status NOT IN ('DRAFT','VOID') AND pay.deleted_at IS NULL
    AND pay.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') ORDER BY pay.payment_date DESC`,[proposal.id,session.client_id,eventId])).rows;
  const creative=(await query("SELECT id,approval_type,version,status FROM creative_approvals WHERE event_id=$1 AND client_id=$2 AND deleted_at IS NULL AND status IN ('PENDING_APPROVAL','VIEWED','APPROVED','CHANGES_REQUESTED') ORDER BY requested_at DESC NULLS LAST,id DESC",[eventId,session.client_id])).rows;
  return {creative:creative.map(row=>({id:row.id,type:row.approval_type,version:row.version,status:row.status})),client:proposal.client_name,event:{id:eventId,name:proposal.event_name,date:proposal.event_date,venue:proposal.venue_name,status:proposal.event_status,start:proposal.start_time,end:proposal.end_time},
   proposal:{number:proposal.proposal_number,status:proposal.status,total:proposal.total},
   agreements:agreements.map(row=>({id:row.id,title:row.title,revision:row.revision,status:row.status,signedAt:row.signed_at,signerName:row.signer_name})),
   invoices:invoices.map(row=>({id:row.id,number:row.invoice_number,status:row.status,total:row.total,paid:row.amount_paid,balance:invoiceBalance(row),dueDate:row.due_date})),
   receipts:receipts.map(row=>({id:row.id,invoiceId:row.invoice_id,amount:row.amount,refundedAmount:row.refunded_amount,status:row.status,date:row.payment_date}))};
 });
}
export async function sessionInvoice(session,eventId,invoiceId){
 const grant=await clientEventGrant(session,eventId);
 const row=(await query(`SELECT id FROM invoices WHERE id=$1 AND (proposal_id=$2 OR EXISTS(SELECT 1 FROM backdrop_quotes q WHERE q.invoice_id=invoices.id AND q.event_id=$4 AND q.client_id=$3 AND q.status='ACCEPTED')) AND client_id=$3 AND event_id=$4
   AND deleted_at IS NULL AND status NOT IN ('DRAFT','VOID')`,[invoiceId,grant.proposal_id,session.client_id,eventId])).rows[0];
 if(!row)throw new AppError('Invoice unavailable.',404,'NOT_FOUND');return row;
}
export async function sessionContract(session,eventId,contractId){
 const grant=await clientEventGrant(session,eventId);
 const row=(await query("SELECT * FROM contracts WHERE id=$1 AND proposal_id=$2 AND status='SIGNED'",[contractId,grant.proposal_id])).rows[0];
 if(!row)throw new AppError('Agreement unavailable.',404,'NOT_FOUND');return row;
}

export async function sessionPlanningToken(session,eventId){
 await clientEventGrant(session,eventId);
 const {assertPlanningPrerequisites,ensureEventPlanning}=await import('./event-planning-service.js');
 const {encryptSecretJson,decryptSecretJson}=await import('./integration-secrets.js');
 const crypto=await import('node:crypto');
 return transaction(async()=>{
  await assertPlanningPrerequisites(eventId);await ensureEventPlanning(eventId);
  const row=(await query('SELECT * FROM event_planning WHERE event_id=$1 AND client_id=$2 FOR UPDATE',[eventId,session.client_id])).rows[0];
  if(!row||row.revoked_at)throw new AppError('Planning access is unavailable. Contact LOLA.',403,'PLANNING_UNAVAILABLE');
  if(row.token_ciphertext&&new Date(row.expires_at)>new Date())return decryptSecretJson(row.token_ciphertext).token;
  const token=crypto.randomBytes(32).toString('hex');
  await query("UPDATE event_planning SET token_hash=$2,token_ciphertext=$3,expires_at=now()+interval '120 days' WHERE id=$1",[row.id,crypto.createHash('sha256').update(token).digest('hex'),encryptSecretJson({token})]);
  // Internal credential adapts the existing planning service. It is never sent to the browser.
  return token;
 });
}

export async function sessionCreativeToken(session,eventId,approvalId){
 await clientEventGrant(session,eventId);
 const {assertPlanningPrerequisites}=await import('./event-planning-service.js');await assertPlanningPrerequisites(eventId);
 const row=(await query('SELECT public_token FROM creative_approvals WHERE id=$1 AND event_id=$2 AND client_id=$3 AND deleted_at IS NULL',[approvalId,eventId,session.client_id])).rows[0];
 if(!row?.public_token)throw new AppError('Creative proof unavailable.',404,'NOT_FOUND');return row.public_token;
}
