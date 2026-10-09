import {assertPlanningPrerequisites} from './event-planning-service.js';
import crypto from 'node:crypto';
import {revokeSecureWorkspace} from './client-session-service.js';
import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {hashContractValue,contractSigningUrl} from './contract-service.js';
import {documentOrigin} from '../utils/public-document-url.js';
import {workspaceView} from '../../../shared/client-workspace.js';
export async function workspaceAccess(proposalId,req){
 return transaction(async()=>{
  const proposal=(await query("SELECT id FROM proposals WHERE id=$1 AND deleted_at IS NULL AND status IN ('ACCEPTED','CONVERTED') FOR UPDATE",[proposalId])).rows[0];
  if(!proposal)throw new AppError('An accepted proposal is required for a client workspace.',409,'WORKSPACE_UNAVAILABLE');
  let row=(await query('SELECT * FROM client_workspaces WHERE proposal_id=$1 AND revoked_at IS NULL FOR UPDATE',[proposalId])).rows[0];
  if(row&&new Date(row.expires_at).getTime()<=Date.now()) {await query('UPDATE client_workspaces SET revoked_at=now() WHERE id=$1',[row.id]);row=null;}
  if(!row){
   const token=crypto.randomBytes(32).toString('hex');
   row=(await query('INSERT INTO client_workspaces(proposal_id,token_hash,token_ciphertext,created_by) VALUES($1,$2,$3,$4) RETURNING *',[proposalId,hashContractValue(token),encryptSecretJson({token}),req.user.id])).rows[0];
   await writeAudit({req,action:'workspace_access_created',entity:'proposal',entityId:proposalId,after:{workspaceId:row.id}});
  }
  const {token}=decryptSecretJson(row.token_ciphertext);
  return {url:`${env.clientOrigin.replace(/\/$/,'')}/client/${token}`,expiresAt:row.expires_at};
 });
}
export async function revokeWorkspace(proposalId,req){
 return transaction(async()=>{
  await query('SELECT id FROM proposals WHERE id=$1 FOR UPDATE',[proposalId]);
  await query('UPDATE client_workspaces SET revoked_at=now() WHERE proposal_id=$1 AND revoked_at IS NULL',[proposalId]);
  await revokeSecureWorkspace(proposalId,req);
  await writeAudit({req,action:'workspace_access_revoked',entity:'proposal',entityId:proposalId});
  return {revoked:true};
 });
}
export async function publicWorkspace(token){
 // Lock the access grant while assembling its explicitly scoped records.
 return transaction(async()=>{
  const workspace=(await query('SELECT * FROM client_workspaces WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR SHARE',[hashContractValue(token)])).rows[0];
  if(!workspace)return planningWorkspace(token);
  const proposal=(await query(`SELECT p.id,p.event_id,p.client_id,p.proposal_number,p.status,p.total,p.secure_token,
    c.name AS client_name,e.event_name,e.event_date,e.venue_name FROM proposals p LEFT JOIN clients c ON c.id=p.client_id
    LEFT JOIN events e ON e.id=p.event_id WHERE p.id=$1 AND p.deleted_at IS NULL`,[workspace.proposal_id])).rows[0];
  if(!proposal)throw new AppError('This client workspace is unavailable.',404,'NOT_FOUND');
  const contracts=(await query("SELECT id,proposal_id,title,revision,status,signed_at,signer_name,expires_at FROM contracts WHERE proposal_id=$1 AND (status='SIGNED' OR (status='ISSUED' AND expires_at>now())) ORDER BY revision DESC",[proposal.id])).rows;
  await addContractLinks(contracts);
  const invoices=(await query("SELECT id,proposal_id,invoice_number,status,total,amount_outstanding,balance_due,amount_paid,due_date,secure_token,token_revoked_at,token_expires_at FROM invoices WHERE proposal_id=$1 AND deleted_at IS NULL AND status NOT IN ('DRAFT','VOID') ORDER BY created_at DESC",[proposal.id])).rows;
  const payments=(await query("SELECT p.id,p.invoice_id,p.amount,p.status,p.payment_date FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.proposal_id=$1 AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') ORDER BY p.payment_date DESC",[proposal.id])).rows;
  return {...workspaceView({proposal,contracts,invoices,payments,documentOrigin:documentOrigin()}),journey:await eventJourney(proposal.event_id,proposal.client_id)};
 });
}

async function eventJourney(eventId,clientId){
 if(!eventId||!clientId)return null;
 try{await assertPlanningPrerequisites(eventId);}catch(error){if(['BOOKING_NOT_CONFIRMED','BOOKING_PREREQUISITES_REQUIRED'].includes(error.code))return {planning:null,creative:[],locked:true,reason:error.message};throw error;}
 const planning=(await query(`SELECT p.status,p.token_ciphertext FROM event_planning p JOIN events e ON e.id=p.event_id
  WHERE p.event_id=$1 AND p.client_id=$2 AND e.client_id=$2 AND e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED')
   AND p.revoked_at IS NULL AND p.expires_at>now() AND p.token_hash IS NOT NULL`,[eventId,clientId])).rows[0];
 const origin=env.clientOrigin.replace(/\/$/,'');
 const proofs=(await query(`SELECT a.id,a.approval_type,a.status,a.version,a.public_token FROM creative_approvals a JOIN events e ON e.id=a.event_id
  WHERE a.event_id=$1 AND a.client_id=$2 AND e.client_id=$2 AND e.deleted_at IS NULL AND e.status NOT IN ('CANCELLED','COMPLETED')
   AND a.deleted_at IS NULL AND a.expires_at>now() AND a.status IN ('PENDING_APPROVAL','VIEWED','APPROVED')`,[eventId,clientId])).rows;
 return {planning:planning?{status:planning.status,url:`${origin}/planning/${decryptSecretJson(planning.token_ciphertext).token}`} : null,
  creative:proofs.map(proof=>({id:proof.id,type:proof.approval_type,status:proof.status,version:proof.version,url:`${origin}/approvals/${proof.public_token}`}))};
}

async function planningWorkspace(token){
 const grant=(await query(`SELECT p.event_id,p.client_id,c.name AS client_name,e.event_name,e.event_date,e.venue_name
  FROM event_planning p JOIN events e ON e.id=p.event_id JOIN clients c ON c.id=p.client_id AND c.id=e.client_id
  WHERE p.token_hash=$1 AND p.revoked_at IS NULL AND p.expires_at>now() AND e.deleted_at IS NULL AND c.deleted_at IS NULL
   AND e.status NOT IN ('CANCELLED','COMPLETED') FOR SHARE OF p`,[hashContractValue(token)])).rows[0];
 if(!grant)throw new AppError('This client workspace link is unavailable or expired.',404,'NOT_FOUND');
 // Campaign bookings can enter without a proposal. Scope every record to this event and client.
 const contracts=(await query(`SELECT c.id,c.proposal_id,c.title,c.revision,c.status,c.signed_at,c.signer_name,c.expires_at,p.event_id,p.client_id
  FROM contracts c JOIN proposals p ON p.id=c.proposal_id
  WHERE p.event_id=$1 AND p.client_id=$2 AND p.deleted_at IS NULL
   AND (c.status='SIGNED' OR (c.status='ISSUED' AND c.expires_at>now()))
  ORDER BY c.created_at DESC,c.revision DESC`,[grant.event_id,grant.client_id])).rows;
 await addContractLinks(contracts);
 const invoices=(await query(`SELECT id,NULL::uuid AS proposal_id,invoice_number,status,total,amount_outstanding,balance_due,amount_paid,due_date,secure_token,token_revoked_at,token_expires_at
  FROM invoices WHERE event_id=$1 AND client_id=$2 AND deleted_at IS NULL AND status NOT IN ('DRAFT','VOID')`,[grant.event_id,grant.client_id])).rows;
 const payments=(await query(`SELECT p.id,p.invoice_id,p.amount,p.status,p.payment_date FROM payments p JOIN invoices i ON i.id=p.invoice_id
  WHERE i.event_id=$1 AND i.client_id=$2 AND i.deleted_at IS NULL AND i.status NOT IN ('DRAFT','VOID') AND p.deleted_at IS NULL
   AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')`,[grant.event_id,grant.client_id])).rows;
 const view=workspaceView({proposal:{...grant,id:null},contracts,invoices,payments,eventScope:{eventId:grant.event_id,clientId:grant.client_id},documentOrigin:documentOrigin()});
 return {...view,proposal:null,journey:await eventJourney(grant.event_id,grant.client_id)};
}

async function addContractLinks(contracts){
 for(const contract of contracts){
  try{contract.url=await contractSigningUrl(contract.id);}catch(error){if(['CONTRACT_ACCESS_UNAVAILABLE','NOT_FOUND','CONTRACT_STATE','CONTRACT_EXPIRED'].includes(error.code))contract.url=null;else throw error;}
 }
}
