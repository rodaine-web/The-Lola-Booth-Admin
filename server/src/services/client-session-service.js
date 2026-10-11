import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {createCommunicationDraft,brandedEmailHtml} from './automation-service.js';
import {sendEmail} from './email-service.js';
import {stagingEmailPolicy} from '../config/staging-safety.js';
import {writeAudit} from './audit-service.js';
import {contractDeliveryFailure} from '../../../shared/contract-delivery.js';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const hosted=()=>['staging','production'].includes(process.env.APP_ENV);
export const clientCookieName=()=>hosted()?'__Host-lola_client':'lola_client';
const csrfKey=env.jwtSecret||crypto.randomBytes(32).toString('hex');
const csrfFor=token=>crypto.createHmac('sha256',csrfKey).update('client-csrf:'+token).digest('hex');
export const WORKSPACE_HANDOFF_JOB='BOOKING_SEND_SIGNED_WORKSPACE';
export const workspaceHandoffEnabled=()=>process.env.BOOKING_WORKSPACE_HANDOFF_ENABLED==='true';
const unavailable=()=>new AppError('This sign-in link is unavailable or expired. Request a new link.',401,'CLIENT_ACCESS_UNAVAILABLE');
export function assertClientOrigin(req){
 const expected=new URL(env.clientOrigin).origin;
 if(req.headers.origin!==expected)throw new AppError('Request a new sign-in link from The Client Workspace.',403,'CLIENT_ORIGIN_REJECTED');
}
export function setClientCookie(res,token){res.cookie(clientCookieName(),token,{httpOnly:true,secure:hosted(),sameSite:'strict',path:'/',maxAge:24*60*60*1000});}
export function clearClientCookie(res){res.clearCookie(clientCookieName(),{httpOnly:true,secure:hosted(),sameSite:'strict',path:'/'});}
function cookieToken(req){
 const cookies=String(req.headers.cookie||'').split(';').map(value=>value.trim());
 return cookies.find(value=>value.startsWith(clientCookieName()+'='))?.slice(clientCookieName().length+1)||'';
}
export async function consumeClientInvitation(token){
 if(!/^[a-f0-9]{64}$/.test(token||''))throw unavailable();
 return transaction(async client=>{
  const invitation=(await client.query(`SELECT i.*,g.client_id FROM client_workspace_invitations i
    JOIN client_workspace_grants g ON g.id=i.grant_id JOIN clients c ON c.id=g.client_id
    JOIN proposals p ON p.id=g.proposal_id
    WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
      AND g.revoked_at IS NULL AND c.deleted_at IS NULL AND p.deleted_at IS NULL
      AND lower(c.email)=lower(i.recipient_email) FOR UPDATE OF i`,[hash(token)])).rows[0];
  if(!invitation)throw unavailable();
  const sessionToken=crypto.randomBytes(32).toString('hex');
  await client.query('UPDATE client_workspace_invitations SET used_at=now() WHERE id=$1',[invitation.id]);
  await client.query(`INSERT INTO client_workspace_sessions(invitation_id,client_id,email,token_hash) VALUES($1,$2,$3,$4)`,[invitation.id,invitation.client_id,invitation.recipient_email.toLowerCase(),hash(sessionToken)]);
  return {token:sessionToken,csrfToken:csrfFor(sessionToken)};
 });
}
export async function authenticateClient(req,{mutation=false,fresh=false}={}){
 const token=cookieToken(req);
 if(!/^[a-f0-9]{64}$/.test(token))throw new AppError('Sign in to The Client Workspace to continue.',401,'CLIENT_SESSION_REQUIRED');
 if(mutation){
  assertClientOrigin(req);
  const csrf=String(req.headers['x-client-csrf']||'');
  if(!/^[a-f0-9]{64}$/.test(csrf)||!crypto.timingSafeEqual(Buffer.from(csrf),Buffer.from(csrfFor(token))))throw new AppError('Refresh The Client Workspace and try again.',403,'CLIENT_CSRF_REJECTED');
 }
 const session=(await query(`UPDATE client_workspace_sessions s SET last_seen_at=now()
   FROM client_workspace_invitations i,client_workspace_grants g,clients c
   WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes'
     AND i.id=s.invitation_id AND i.revoked_at IS NULL AND g.id=i.grant_id AND g.revoked_at IS NULL
     AND c.id=s.client_id AND c.deleted_at IS NULL AND lower(c.email)=s.email RETURNING s.*`,[hash(token)])).rows[0];
 if(!session)throw new AppError('Your session has expired. Request a new sign-in link.',401,'CLIENT_SESSION_EXPIRED');
 if(fresh&&Date.now()-new Date(session.verified_at).getTime()>15*60000)throw new AppError('Request a fresh sign-in link before continuing with this action.',403,'CLIENT_STEP_UP_REQUIRED');
 return {...session,csrfToken:csrfFor(token)};
}
export async function endClientSession(req){const session=await authenticateClient(req,{mutation:true});await query('UPDATE client_workspace_sessions SET revoked_at=now() WHERE id=$1',[session.id]);}

export async function queueSignedWorkspace(contract){
 if(!workspaceHandoffEnabled()||contract.status!=='SIGNED')return;
 const key='signed-workspace:'+contract.id;
 await query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
 const exists=await query('SELECT 1 FROM automation_jobs WHERE job_type=$1 AND payload->>\'contractId\'=$2 LIMIT 1',[WORKSPACE_HANDOFF_JOB,contract.id]);
 if(!exists.rowCount)await query(`INSERT INTO automation_jobs(job_type,related_entity_type,related_entity_id,payload,scheduled_for) VALUES($1,'proposal',$2,$3,now())`,[WORKSPACE_HANDOFF_JOB,contract.proposal_id,{contractId:contract.id}]);
}
async function eligibleGrant(proposalId,contractId,{automatic=true}={}){
 const row=(await query(`SELECT p.id,p.client_id,p.event_id,c.email,c.name,e.event_name,k.id AS contract_id
   FROM proposals p JOIN clients c ON c.id=p.client_id JOIN contracts k ON k.proposal_id=p.id
   LEFT JOIN events e ON e.id=p.event_id
   WHERE p.id=$1 AND k.id=$2 AND k.status='SIGNED' AND p.status IN ('ACCEPTED','CONVERTED')
     AND p.deleted_at IS NULL AND c.deleted_at IS NULL AND lower(k.signer_email)=lower(c.email)
     AND k.snapshot->>'accepted_version_id'=p.accepted_version_id::text
     AND NOT EXISTS(SELECT 1 FROM contracts newer WHERE newer.proposal_id=p.id AND newer.revision>k.revision AND newer.status IN ('ISSUED','SIGNED'))
     AND ($3=false OR p.event_id IS NULL OR (e.deleted_at IS NULL AND e.status<>'CANCELLED'))
     AND ($3=false OR EXISTS(SELECT 1 FROM invoices i WHERE i.proposal_id=p.id AND i.deleted_at IS NULL AND i.status NOT IN ('VOID','REFUNDED','DRAFT')
       AND i.total>0 AND round(i.amount_paid*100)>=COALESCE((SELECT round(x.minimum_before_agreement*100) FROM booking_payment_exceptions x WHERE x.event_id=i.event_id AND x.revoked_at IS NULL),ceil(round(i.total*100)*0.3))))
   ORDER BY k.revision DESC`,[proposalId,contractId,automatic])).rows[0];
 if(!row)return null;
 let grant=(await query('SELECT * FROM client_workspace_grants WHERE proposal_id=$1',[proposalId])).rows[0];
 if(grant?.revoked_at)return null; // Revocation needs explicit Admin restoration, never an automatic retry.
 if(!grant&&!automatic)return null;
 if(!grant)grant=(await query('INSERT INTO client_workspace_grants(proposal_id,client_id,signed_contract_id) VALUES($1,$2,$3) RETURNING *',[proposalId,row.client_id,contractId])).rows[0];
 if(grant.signed_contract_id!==contractId){
  await query('UPDATE client_workspace_invitations SET revoked_at=now() WHERE grant_id=$1',[grant.id]);
  await query('UPDATE client_workspace_sessions SET revoked_at=now() WHERE invitation_id IN (SELECT id FROM client_workspace_invitations WHERE grant_id=$1)',[grant.id]);
  await query('UPDATE client_workspace_grants SET signed_contract_id=$2 WHERE id=$1',[grant.id,contractId]);
 }
 return {...row,grantId:grant.id};
}
export async function prepareClientInvitation(proposalId,contractId,{automatic=true}={}){
 return transaction(async()=>{
  await query('SELECT id FROM proposals WHERE id=$1 FOR UPDATE',[proposalId]);
  const recipient=await eligibleGrant(proposalId,contractId,{automatic});if(!recipient)return null;
  const key=automatic?'workspace-invitation:'+contractId:'workspace-sign-in:'+crypto.randomUUID();
  let communication=(await query('SELECT * FROM communications WHERE idempotency_key=$1',[key])).rows[0];
  if(communication)return (await query('SELECT id FROM client_workspace_invitations WHERE communication_id=$1',[communication.id])).rows[0]||null;
  const token=crypto.randomBytes(32).toString('hex');
  // Store only a placeholder in the communication ledger; the encrypted link is rendered at dispatch.
  communication=await createCommunicationDraft({client_id:recipient.client_id,event_id:recipient.event_id,proposal_id:proposalId,
    recipient:recipient.email,subject:'Your secure Client Workspace sign-in link',body:'Your private sign-in link expires in 15 minutes and can be used once.',trigger_key:WORKSPACE_HANDOFF_JOB});
  await query('UPDATE communications SET idempotency_key=$2 WHERE id=$1',[communication.id,key]);
  return (await query(`INSERT INTO client_workspace_invitations(grant_id,token_hash,token_ciphertext,recipient_email,communication_id)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,[recipient.grantId,hash(token),encryptSecretJson({token}),recipient.email,communication.id])).rows[0];
 });
}
export async function deliverClientInvitation(invitationId,{send=sendEmail}={}){
 if(!workspaceHandoffEnabled())throw new AppError('Workspace invitation delivery is paused.',409,'CLIENT_INVITATIONS_PAUSED',{retryable:false});
 const claim=await transaction(async()=>{
  const invitation=(await query(`SELECT i.*,c.status AS delivery_status,c.failure_code FROM client_workspace_invitations i
    JOIN client_workspace_grants g ON g.id=i.grant_id JOIN proposals p ON p.id=g.proposal_id JOIN contracts k ON k.id=g.signed_contract_id JOIN communications c ON c.id=i.communication_id
    JOIN clients customer ON customer.id=g.client_id WHERE i.id=$1 AND g.revoked_at IS NULL
      AND customer.deleted_at IS NULL AND p.deleted_at IS NULL AND k.status='SIGNED'
      AND k.snapshot->>'accepted_version_id'=p.accepted_version_id::text
      AND lower(k.signer_email)=lower(customer.email) AND lower(customer.email)=lower(i.recipient_email)
      AND (c.idempotency_key NOT LIKE 'workspace-invitation:%' OR (
        (p.event_id IS NULL OR EXISTS(SELECT 1 FROM events e WHERE e.id=p.event_id AND e.deleted_at IS NULL AND e.status<>'CANCELLED'))
        AND EXISTS(SELECT 1 FROM invoices bill WHERE bill.proposal_id=p.id AND bill.deleted_at IS NULL
          AND bill.status NOT IN ('DRAFT','VOID','REFUNDED') AND bill.total>0
          AND round(bill.amount_paid*100)>=COALESCE((SELECT round(x.minimum_before_agreement*100) FROM booking_payment_exceptions x WHERE x.event_id=bill.event_id AND x.revoked_at IS NULL),ceil(round(bill.total*100)*.3)))))
      FOR UPDATE OF i,c,g`,[invitationId])).rows[0];
  if(!invitation||invitation.revoked_at||invitation.used_at)return {cancelled:true};
  if(['SENT','SENT_TO_PROVIDER','DELIVERED'].includes(invitation.delivery_status))return {duplicate:true};
  if(invitation.delivery_status==='PROCESSING'||invitation.failure_code==='DELIVERY_OUTCOME_UNKNOWN')throw new AppError('Review invitation delivery history before retrying.',409,'DELIVERY_OUTCOME_UNKNOWN',{retryable:false});
  if(new Date(invitation.expires_at)<=new Date())throw new AppError('This sign-in link expired before delivery. Request a new link.',410,'CLIENT_INVITATION_EXPIRED',{retryable:false});
  const {token}=decryptSecretJson(invitation.token_ciphertext);
  const url=`${env.clientOrigin.replace(/\/$/,'')}/client/access#${token}`;
  const body=`Your Client Workspace is ready.\n\nSign in securely using this single-use link within 15 minutes:\n${url}\n\nYou can review your agreement, payments and booking status. Event planning opens after booking confirmation.\n\nIf the link expires, request a new one from The Client Workspace.\n\nThe LOLA Booth`;
  const message={to:invitation.recipient_email,subject:'Your secure Client Workspace sign-in link',body,html:brandedEmailHtml(body,{kicker:'The Client Workspace',ctaLabel:'Open The Client Workspace',ctaUrl:url})};
  stagingEmailPolicy(message);
  await query("UPDATE communications SET status='PROCESSING',queued_at=now(),updated_at=now() WHERE id=$1",[invitation.communication_id]);
  return {invitation,message};
 });
 if(claim.cancelled||claim.duplicate)return claim;
 try{
  const result=await send(claim.message);
  if(result.status!=='SENT'||!result.provider)throw new AppError('Provider acceptance was not confirmed.',502,'DELIVERY_OUTCOME_UNKNOWN',{outcomeUnknown:true,retryable:false});
  if(result.deliveredExternally===false){await query("UPDATE communications SET status='DRAFT',updated_at=now() WHERE id=$1",[claim.invitation.communication_id]);throw new AppError('No external sign-in email was sent.',409,'CLIENT_INVITATION_NOT_SENT',{retryable:false});}
  await query("UPDATE communications SET status='SENT_TO_PROVIDER',provider=$2,provider_message_id=$3,sent_at=now(),updated_at=now() WHERE id=$1",[claim.invitation.communication_id,result.provider,result.providerMessageId||null]);
  return {status:'SENT_TO_PROVIDER'};
 }catch(error){
  const unknown=contractDeliveryFailure(error).status==='UNKNOWN'&&error.code!=='CLIENT_INVITATION_NOT_SENT';
  await query("UPDATE communications SET status='FAILED',failure_code=$2,failure_message=$3,updated_at=now() WHERE id=$1",[claim.invitation.communication_id,unknown?'DELIVERY_OUTCOME_UNKNOWN':error.code,unknown?'Review provider history before retrying.':'Sign-in email delivery failed.']);
  if(unknown)throw new AppError('Invitation delivery outcome is uncertain. Review provider history before retrying.',502,'DELIVERY_OUTCOME_UNKNOWN',{retryable:false});
  throw error;
 }
}
export async function deliverSignedWorkspace(job){
 if(!workspaceHandoffEnabled())return {cancelled:true};
 const invitation=await prepareClientInvitation(job.related_entity_id,job.payload.contractId);
 if(!invitation)return {cancelled:true};
 const result=await deliverClientInvitation(invitation.id);
 if(!result.cancelled){const {applyBookingConfirmationPolicy}=await import('./payment-reconciliation-service.js');const proposal=(await query('SELECT event_id FROM proposals WHERE id=$1',[job.related_entity_id])).rows[0];if(proposal?.event_id)await applyBookingConfirmationPolicy(proposal.event_id);}
 return result;
}
export async function requestClientSignIn(email){
 const response={message:'If this email has an eligible Client Workspace, a sign-in link will be sent.'};
 if(!workspaceHandoffEnabled())throw new AppError('Workspace invitations are currently paused. Contact LOLA for access.',503,'CLIENT_INVITATIONS_PAUSED');
 const candidate=(await query(`SELECT g.proposal_id,g.signed_contract_id,g.id FROM client_workspace_grants g JOIN clients c ON c.id=g.client_id
  WHERE lower(c.email)=lower($1) AND c.deleted_at IS NULL AND g.revoked_at IS NULL ORDER BY g.created_at DESC LIMIT 1`,[email])).rows[0];
 if(!candidate)return response;
 await transaction(async()=>{
  await query('SELECT pg_advisory_xact_lock(hashtext($1))',['workspace-request:'+email.toLowerCase()]);
  const recent=await query("SELECT 1 FROM client_workspace_invitations WHERE grant_id=$1 AND created_at>now()-interval '2 minutes' LIMIT 1",[candidate.id]);
  if(recent.rowCount)return;
  const invitation=await prepareClientInvitation(candidate.proposal_id,candidate.signed_contract_id,{automatic:false});
  if(invitation)await query(`INSERT INTO automation_jobs(job_type,related_entity_type,related_entity_id,payload,scheduled_for) VALUES($1,'proposal',$2,$3,now())`,['CLIENT_WORKSPACE_SIGN_IN',candidate.proposal_id,{invitationId:invitation.id}]);
 });
 return response;
}
export async function revokeSecureWorkspace(proposalId,req){
 await query('UPDATE client_workspace_grants SET revoked_at=now() WHERE proposal_id=$1',[proposalId]);
 await writeAudit({req,action:'secure_workspace_revoked',entity:'proposal',entityId:proposalId});
}

export async function adminWorkspaceInvitation(proposalId,req){
 if(!workspaceHandoffEnabled())throw new AppError('Secure workspace handoff is paused.',503,'CLIENT_INVITATIONS_PAUSED');
 return transaction(async()=>{
  const contract=(await query("SELECT k.id FROM contracts k JOIN proposals p ON p.id=k.proposal_id WHERE p.id=$1 AND k.status='SIGNED' AND k.snapshot->>'accepted_version_id'=p.accepted_version_id::text ORDER BY k.revision DESC LIMIT 1",[proposalId])).rows[0];
  if(!contract)throw new AppError('A current signed agreement is required for workspace access.',409,'SIGNED_AGREEMENT_REQUIRED');
  const grant=await eligibleGrant(proposalId,contract.id);
  if(!grant)throw new AppError('Access is revoked or booking prerequisites are incomplete. Review the booking before inviting.',409,'WORKSPACE_REVIEW_REQUIRED');
  await requestClientSignIn(grant.email);
  await writeAudit({req,action:'secure_workspace_invitation_requested',entity:'proposal',entityId:proposalId});
  return {queued:true,message:'Secure sign-in invitation requested. Delivery remains subject to worker scope and email policy.'};
 });
}
