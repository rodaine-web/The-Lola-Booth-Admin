import {agreementPaymentQualified} from './booking-payment-exceptions.js';
import crypto from 'node:crypto';
import {queueSignedWorkspace} from './client-session-service.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {renderContractPdf} from './contract-pdf.js';
import {validDrawnSignature,DRAWN_CONTRACT_CONSENT} from '../../../shared/signature.js';
import { query, transaction } from '../db/pool.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit-service.js';
import { CONTRACT_CONSENT, contractDocument, signingDecision, proposalAllowsAgreement } from '../../../shared/contracts.js';

export const hashContractValue = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(message, code = 'CONTRACT_STATE') { throw new AppError(message, 409, code); }
async function proposalSnapshot(id) {
  const {rows} = await query(`SELECT p.proposal_number,p.status,p.total,c.name AS client_name,c.email AS client_email,
    e.event_name,e.event_type,e.event_date,e.start_time,e.end_time,e.venue_name,
    p.line_items_snapshot AS items,p.accepted_version_id,v.snapshot AS accepted_snapshot FROM proposals p
    LEFT JOIN proposal_versions v ON v.id=p.accepted_version_id AND v.proposal_id=p.id
    LEFT JOIN clients c ON c.id=p.client_id
    LEFT JOIN events e ON e.id=p.event_id WHERE p.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF p`, [id]);
  const proposal = rows[0];
  if (!proposal) throw new AppError('Proposal not found.',404,'NOT_FOUND');
  if (!proposalAllowsAgreement(proposal.status)) fail('Accept the proposal before creating an agreement.');
  if (!proposal.client_email) fail('Add the client email before creating an agreement.');
  if (proposal.accepted_version_id) {
    if (!proposal.accepted_snapshot) fail('The accepted proposal version is unavailable. Review it before issuing an agreement.');
    const accepted = proposal.accepted_snapshot.proposal_snapshot || proposal.accepted_snapshot;
    proposal.total = accepted.total ?? accepted.pricing_snapshot?.total;
    proposal.items = accepted.line_items_snapshot;
  }
  proposal.payment_exception=(await query(`SELECT x.id,x.minimum_before_agreement,x.minimum_before_confirmation,x.balance_due_date::text AS balance_due_date,x.reason FROM booking_payment_exceptions x JOIN proposals p ON p.event_id=x.event_id WHERE p.id=$1 AND x.revoked_at IS NULL`,[id])).rows[0]||null;
  delete proposal.accepted_snapshot;
  delete proposal.status;
  return proposal;
}
function visible(row) {
  const {token_hash, signer_ip, signer_user_agent, created_by, ...safe} = row;
  return safe;
}
export async function listContracts(proposalId) {
  return (await query(`SELECT c.*,COALESCE((SELECT json_agg(json_build_object('purpose',d.purpose,'status',d.status,'attempt_count',d.attempt_count,'failure_code',d.failure_code,'completed_at',d.completed_at)) FROM contract_deliveries d WHERE d.contract_id=c.id),'[]') AS deliveries FROM contracts c WHERE c.proposal_id=$1 ORDER BY c.revision DESC`,[proposalId])).rows.map(visible);
}
export async function createContract(proposalId, body, req) {
  return transaction(async () => {
    const snapshot = await proposalSnapshot(proposalId);
    const active = (await query("SELECT * FROM contracts WHERE proposal_id=$1 AND status IN ('DRAFT','ISSUED')",[proposalId])).rows[0];
    if (active) return visible(active);
    const {rows} = await query(`INSERT INTO contracts(proposal_id,revision,title,terms,snapshot,created_by)
      SELECT $1,COALESCE(MAX(revision),0)+1,$2,$3,$4,$5 FROM contracts WHERE proposal_id=$1 RETURNING *`,
      [proposalId,body.title,body.terms,snapshot,req.user.id]);
    await writeAudit({req,action:'contract_created',entity:'contract',entityId:rows[0].id,after:{revision:rows[0].revision,proposalId}});
    return visible(rows[0]);
  });
}
async function lockedContract(id) {
  const row = (await query('SELECT * FROM contracts WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if (!row) throw new AppError('Agreement not found.',404,'NOT_FOUND');
  return row;
}
export async function updateContract(id, body, req) {
  return transaction(async () => {
    const old = await lockedContract(id);
    if (old.status !== 'DRAFT') fail('Only draft agreements can be edited. Create a new revision for changed terms.');
    const row=(await query('UPDATE contracts SET title=$2,terms=$3,updated_at=now() WHERE id=$1 RETURNING *',[id,body.title,body.terms])).rows[0];
    await writeAudit({req,action:'contract_edited',entity:'contract',entityId:id,after:{revision:row.revision}});
    return visible(row);
  });
}
export async function issueContract(id, req) {
  return transaction(async () => {
    const row = await lockedContract(id);
    if (row.status !== 'DRAFT') fail('This agreement is already issued. Revoke it before creating a replacement.');
    const snapshot = await proposalSnapshot(row.proposal_id);
    await assertAgreementPrerequisites(row.proposal_id,snapshot.accepted_version_id);
    if(snapshot.payment_exception&&!row.terms.includes(snapshot.payment_exception.id))fail('Include the approved written payment exception in these agreement terms before issuing.','AGREEMENT_EXCEPTION_REVIEW');
    const token = crypto.randomBytes(32).toString('hex');
    const digest = hashContractValue(contractDocument(row.title,row.terms,snapshot));
    const updated=(await query(`UPDATE contracts SET status='ISSUED',snapshot=$2,document_hash=$3,token_hash=$4,
      issued_at=now(),expires_at=now()+interval '30 days',
      signing_due_at=((now() AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))+interval '5 days') AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'),
      signing_grace_until=((now() AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'))+interval '12 days') AT TIME ZONE COALESCE((SELECT timezone FROM business_settings LIMIT 1),'America/Chicago'),updated_at=now() WHERE id=$1 RETURNING *`,[id,snapshot,digest,hashContractValue(token)])).rows[0];
    await query('INSERT INTO contract_access_credentials(contract_id,token_ciphertext) VALUES($1,$2)',[id,encryptSecretJson({token})]);
    await writeAudit({req,action:'contract_issued',entity:'contract',entityId:id,after:{documentHash:digest,revision:row.revision}});
    // The admin app serves the signing route; the marketing website does not.
    return {...visible(updated),signing_url:`${env.clientOrigin.replace(/\/$/,'')}/contract/${token}`};
  });
}
export async function revokeContract(id,req) {
  return transaction(async()=>{
    const row=await lockedContract(id);
    if (row.status === 'SIGNED') fail('A signed agreement cannot be revoked or changed. Create a new revision.');
    if(row.status==='REVOKED') return visible(row);
    const updated=(await query("UPDATE contracts SET status='REVOKED',updated_at=now() WHERE id=$1 RETURNING *",[id])).rows[0];
    await writeAudit({req,action:'contract_revoked',entity:'contract',entityId:id,after:{revision:row.revision}});
    return visible(updated);
  });
}
async function tokenContract(token,lock=false) {
  const row=(await query(`SELECT * FROM contracts WHERE token_hash=$1 ${lock?'FOR UPDATE':''}`,[hashContractValue(token)])).rows[0];
  if(!row || row.status==='REVOKED' || row.status==='DRAFT') throw new AppError('This agreement link is unavailable.',404,'NOT_FOUND');
  if(new Date(row.expires_at).getTime()<=Date.now()) throw new AppError('This agreement link has expired. Contact The Lola Booth.',410,'CONTRACT_EXPIRED');
  return row;
}
export async function publicContract(token) { const {signing_grace_until,...contract}=visible(await tokenContract(token));return contract; }
export async function signContract(token,body,req) {
  const signed=await transaction(async()=>{
    const row=await tokenContract(token,true);
    const decision=signingDecision(row,body);
    if(decision.error) throw new AppError(decision.message,decision.error==='SIGNER_EMAIL_MISMATCH'||decision.error==='CONSENT_REQUIRED'?400:409,decision.error);
    if(decision.replay) {const {signing_grace_until,...signed}=visible(row);return signed;}
    if(row.signing_grace_until&&new Date(row.signing_grace_until)<=new Date())fail('This agreement needs LOLA review before signing. Contact us for help.','CONTRACT_SIGNING_REVIEW');
    await assertAgreementPrerequisites(row.proposal_id,row.snapshot.accepted_version_id);
    const method=body.signatureMethod||'TYPED';
    if(method==='DRAWN'&&!validDrawnSignature(body.signatureStrokes))throw new AppError('Draw your signature or choose Type.',422,'SIGNATURE_REQUIRED');
    if(!['TYPED','DRAWN'].includes(method))throw new AppError('Select a valid signature method.',422,'SIGNATURE_METHOD_INVALID');
    const strokes=method==='DRAWN'?body.signatureStrokes:null;
    const signatureHash=hashContractValue(JSON.stringify({documentHash:row.document_hash,name:body.name,method,strokes}));
    const updated=(await query(`UPDATE contracts SET status='SIGNED',signed_at=now(),signer_name=$2,signer_email=$3,
      consent_text=$4,signer_ip=$5,signer_user_agent=$6,signature_method=$7,signature_strokes=$8,signature_hash=$9,updated_at=now() WHERE id=$1 RETURNING *`,
      [row.id,body.name,body.email.toLowerCase(),method==='DRAWN'?DRAWN_CONTRACT_CONSENT:CONTRACT_CONSENT,req.ip,String(req.headers?.['user-agent']||'').slice(0,1000),method,strokes?JSON.stringify(strokes):null,signatureHash])).rows[0];
    await writeAudit({req,action:'contract_signed',entity:'contract',entityId:row.id,after:{revision:row.revision,documentHash:row.document_hash}});
    await query("UPDATE tasks SET status='DONE',updated_at=now() WHERE lifecycle_key IN ($1,$2) AND status IN ('OPEN','IN_PROGRESS')",['agreement-sign:'+row.id,'agreement-escalation:'+row.id]);
    await queueSignedWorkspace(updated);
    const {signing_grace_until,...signed}=visible(updated);return signed;
  });
  // A valid signature stays recorded even when availability needs operator review.
  const proposal=(await query('SELECT event_id FROM proposals WHERE id=$1',[signed.proposal_id])).rows[0];
  if(proposal?.event_id){
   try {const {applyBookingConfirmationPolicy}=await import('./payment-reconciliation-service.js');
    const event=await applyBookingConfirmationPolicy(proposal.event_id,{signedAgreement:true});
    signed.booking_confirmation={status:event?.status||'PENDING'};
    if(event)await query("UPDATE tasks SET status='DONE',updated_at=now() WHERE lifecycle_key=$1",['booking-confirmation:'+proposal.event_id]);
   } catch(error) {
    signed.booking_confirmation={status:'PENDING',message:'Agreement signed. LOLA must review booking confirmation before planning opens.'};
    await query(`INSERT INTO tasks(lifecycle_key,title,description,event_id,priority) VALUES($1,'Review signed booking confirmation',$2,$3,'HIGH')
     ON CONFLICT(lifecycle_key) WHERE lifecycle_key IS NOT NULL DO UPDATE SET description=EXCLUDED.description,status='OPEN',updated_at=now()`,['booking-confirmation:'+proposal.event_id,String(error.message).slice(0,3000),proposal.event_id]);
   }
  }
  return signed;
}
export async function contractPdf(row) { return renderContractPdf(row); }
export async function getContract(id) { const row=(await query('SELECT * FROM contracts WHERE id=$1',[id])).rows[0];if(!row)throw new AppError('Agreement not found.',404,'NOT_FOUND');return visible(row); }

export async function contractSigningUrl(id) {
 const row=await getContract(id);
 if(!['ISSUED','SIGNED'].includes(row.status)) fail('This agreement has no active signing link.');
 if(row.status==='ISSUED' && new Date(row.expires_at).getTime()<=Date.now()) throw new AppError('Agreement expired. Revoke it and create a new revision.',410,'CONTRACT_EXPIRED');
 const credential=(await query('SELECT token_ciphertext FROM contract_access_credentials WHERE contract_id=$1',[id])).rows[0];
 if(!credential) fail('This older agreement has no recoverable credential. Revoke it and create a new revision.','CONTRACT_ACCESS_UNAVAILABLE');
 const {token}=decryptSecretJson(credential.token_ciphertext);
 if((await publicContract(token)).id!==id) fail('Agreement credential is invalid.');
 return `${env.clientOrigin.replace(/\/$/,'')}/contract/${token}`;
}

export async function extendSigningDeadline(id,body,req){
 if(!req.user?.roles?.some(role=>['OWNER','ADMIN'].includes(role)))throw new AppError('An Admin must approve signing extensions.',403,'FORBIDDEN');
 return transaction(async()=>{
  const before=await lockedContract(id);
  if(before.status!=='ISSUED')fail('Only an unsigned, issued agreement can receive an extension.');
  const row=(await query(`UPDATE contracts SET signing_due_at=$2,signing_grace_until=$2::timestamptz+interval '7 days',
   expires_at=GREATEST(expires_at,$2::timestamptz+interval '7 days'),updated_at=now() WHERE id=$1 RETURNING *`,[id,body.dueAt])).rows[0];
  await writeAudit({req,action:'contract_signing_extended',entity:'contract',entityId:id,before:{dueAt:before.signing_due_at},after:{dueAt:row.signing_due_at,reason:body.reason}});
  return visible(row);
 });
}

async function assertAgreementPrerequisites(proposalId,versionId){
 const proposal=(await query('SELECT event_id,accepted_version_id,status FROM proposals WHERE id=$1 AND deleted_at IS NULL',[proposalId])).rows[0];
 if(!proposal||!['ACCEPTED','CONVERTED'].includes(proposal.status)||proposal.accepted_version_id!==versionId)fail('Review the current accepted proposal before signing or issuing an agreement.','AGREEMENT_VERSION_CHANGED');
 if(!proposal.event_id||!(await query('SELECT booking_journey_managed($1) AS managed',[proposal.event_id])).rows[0]?.managed)return;
 const invoice=(await query("SELECT * FROM invoices WHERE proposal_id=$1 AND pricing_snapshot->>'accepted_version_id'=$2 AND deleted_at IS NULL AND status NOT IN ('DRAFT','VOID','REFUNDED') ORDER BY created_at DESC LIMIT 1",[proposalId,versionId])).rows[0];
 if(!await agreementPaymentQualified(invoice))fail('Verify the required booking payment before issuing or signing this agreement.','AGREEMENT_PAYMENT_REQUIRED');
}

// Bounded Admin index; signing credentials and signature evidence never enter list responses.
export async function searchContracts({search='',status,clientId,eventId,page=1,pageSize=25}) {
 const values=[],where=['p.deleted_at IS NULL'];
 const bind=value=>{values.push(value);return '$'+values.length;};
 if(search){const key=bind('%'+search+'%');where.push(`(k.title ILIKE ${key} OR p.proposal_number ILIKE ${key} OR c.name ILIKE ${key} OR e.event_name ILIKE ${key} OR k.id::text ILIKE ${key})`);}
 if(status)where.push(`k.status=${bind(status)}`);
 if(clientId)where.push(`p.client_id=${bind(clientId)}`);
 if(eventId)where.push(`p.event_id=${bind(eventId)}`);
 const from=`FROM contracts k JOIN proposals p ON p.id=k.proposal_id LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN events e ON e.id=p.event_id WHERE ${where.join(' AND ')}`;
 const total=Number((await query(`SELECT count(*) AS total ${from}`,values)).rows[0].total);
 const rows=(await query(`SELECT k.id,k.title,k.revision,k.status,k.created_at,k.issued_at,k.signed_at,k.signing_due_at,k.signer_name,p.id AS proposal_id,p.proposal_number,p.client_id,p.event_id,c.name AS client_name,e.event_name ${from} ORDER BY k.created_at DESC,k.id LIMIT ${bind(pageSize)} OFFSET ${bind((page-1)*pageSize)}`,values)).rows;
 return {rows,total,page,pageSize};
}
