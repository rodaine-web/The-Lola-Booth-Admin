import crypto from 'node:crypto';
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
  const proposal=(await query("SELECT id FROM proposals WHERE id=$1 AND deleted_at IS NULL AND status='ACCEPTED' FOR UPDATE",[proposalId])).rows[0];
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
  await writeAudit({req,action:'workspace_access_revoked',entity:'proposal',entityId:proposalId});
  return {revoked:true};
 });
}
export async function publicWorkspace(token){
 // Lock the access grant while assembling its explicitly scoped records.
 return transaction(async()=>{
  const workspace=(await query('SELECT * FROM client_workspaces WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR SHARE',[hashContractValue(token)])).rows[0];
  if(!workspace)throw new AppError('This client workspace link is unavailable or expired.',404,'NOT_FOUND');
  const proposal=(await query(`SELECT p.id,p.proposal_number,p.status,p.total,p.secure_token,
    c.name AS client_name,e.event_name,e.event_date,e.venue_name FROM proposals p LEFT JOIN clients c ON c.id=p.client_id
    LEFT JOIN events e ON e.id=p.event_id WHERE p.id=$1 AND p.deleted_at IS NULL`,[workspace.proposal_id])).rows[0];
  if(!proposal)throw new AppError('This client workspace is unavailable.',404,'NOT_FOUND');
  const contracts=(await query("SELECT id,proposal_id,title,revision,status,signed_at,signer_name,expires_at FROM contracts WHERE proposal_id=$1 AND (status='SIGNED' OR (status='ISSUED' AND expires_at>now())) ORDER BY revision DESC",[proposal.id])).rows;
  for(const contract of contracts){
   try{contract.url=await contractSigningUrl(contract.id);}catch(error){if(['CONTRACT_ACCESS_UNAVAILABLE','NOT_FOUND','CONTRACT_STATE','CONTRACT_EXPIRED'].includes(error.code))contract.url=null;else throw error;}
  }
  const invoices=(await query("SELECT id,proposal_id,invoice_number,status,total,amount_outstanding,balance_due,amount_paid,due_date,secure_token,token_revoked_at,token_expires_at FROM invoices WHERE proposal_id=$1 AND deleted_at IS NULL AND status NOT IN ('DRAFT','VOID') ORDER BY created_at DESC",[proposal.id])).rows;
  const payments=(await query("SELECT p.id,p.invoice_id,p.amount,p.status,p.payment_date FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.proposal_id=$1 AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') ORDER BY p.payment_date DESC",[proposal.id])).rows;
  return workspaceView({proposal,contracts,invoices,payments,documentOrigin:documentOrigin()});
 });
}
