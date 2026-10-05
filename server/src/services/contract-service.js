import crypto from 'node:crypto';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import PDFDocument from 'pdfkit';
import { query, transaction } from '../db/pool.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './audit-service.js';
import { CONTRACT_CONSENT, contractDocument, signingDecision } from '../../../shared/contracts.js';

export const hashContractValue = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(message, code = 'CONTRACT_STATE') { throw new AppError(message, 409, code); }
async function proposalSnapshot(id) {
  const {rows} = await query(`SELECT p.proposal_number,p.status,p.total,c.name AS client_name,c.email AS client_email,
    e.event_name,e.event_type,e.event_date,e.start_time,e.end_time,e.venue_name,
    p.line_items_snapshot AS items FROM proposals p LEFT JOIN clients c ON c.id=p.client_id
    LEFT JOIN events e ON e.id=p.event_id WHERE p.id=$1 AND p.deleted_at IS NULL FOR UPDATE OF p`, [id]);
  const proposal = rows[0];
  if (!proposal) throw new AppError('Proposal not found.',404,'NOT_FOUND');
  if (proposal.status !== 'ACCEPTED') fail('Accept the proposal before creating an agreement.');
  if (!proposal.client_email) fail('Add the client email before creating an agreement.');
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
    const token = crypto.randomBytes(32).toString('hex');
    const digest = hashContractValue(contractDocument(row.title,row.terms,snapshot));
    const updated=(await query(`UPDATE contracts SET status='ISSUED',snapshot=$2,document_hash=$3,token_hash=$4,
      issued_at=now(),expires_at=now()+interval '30 days',updated_at=now() WHERE id=$1 RETURNING *`,[id,snapshot,digest,hashContractValue(token)])).rows[0];
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
  if(row.status!=='SIGNED' && new Date(row.expires_at).getTime()<=Date.now()) throw new AppError('This agreement link has expired. Contact The Lola Booth.',410,'CONTRACT_EXPIRED');
  return row;
}
export async function publicContract(token) { return visible(await tokenContract(token)); }
export async function signContract(token,body,req) {
  return transaction(async()=>{
    const row=await tokenContract(token,true);
    const decision=signingDecision(row,body);
    if(decision.error) throw new AppError(decision.message,decision.error==='SIGNER_EMAIL_MISMATCH'||decision.error==='CONSENT_REQUIRED'?400:409,decision.error);
    if(decision.replay) return visible(row);
    const updated=(await query(`UPDATE contracts SET status='SIGNED',signed_at=now(),signer_name=$2,signer_email=$3,
      consent_text=$4,signer_ip=$5,signer_user_agent=$6,updated_at=now() WHERE id=$1 RETURNING *`,
      [row.id,body.name,body.email.toLowerCase(),CONTRACT_CONSENT,req.ip,String(req.headers?.['user-agent']||'').slice(0,1000)])).rows[0];
    await writeAudit({req,action:'contract_signed',entity:'contract',entityId:row.id,after:{revision:row.revision,documentHash:row.document_hash}});
    return visible(updated);
  });
}
export async function contractPdf(row) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'LETTER',margin:54,bufferPages:true});const chunks=[];
    doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    doc.fillColor('#967039').fontSize(14).text('THE LOLA BOOTH');
    doc.moveDown().fillColor('#171717').fontSize(24).text(row.title);
    doc.moveDown().fontSize(10).text(`${row.snapshot.proposal_number} · Agreement revision ${row.revision} · ${row.status}`);
    doc.moveDown().fontSize(12);
    for(const key of ['client_name','client_email','event_name','event_type','event_date','start_time','end_time','venue_name','total']) {
      if(row.snapshot[key] != null) doc.text(`${key.replaceAll('_',' ')}: ${row.snapshot[key]}`);
    }
    if (Array.isArray(row.snapshot.items) && row.snapshot.items.length) {
      doc.moveDown().fontSize(13).text('Selected services');
      for(const item of row.snapshot.items) doc.fontSize(10).text(`${item.description || item.label || 'Service'} · ${item.quantity ?? 1} × ${item.unit_price ?? item.amount ?? ''}`);
    }
    doc.moveDown().fontSize(11).text(row.terms,{lineGap:4});
    if(row.status==='SIGNED') {
      doc.moveDown().fontSize(14).text('Electronic signature');
      doc.fontSize(10).text(`Signed by ${row.signer_name} (${row.signer_email})\nSigned at ${new Date(row.signed_at).toISOString()}\n${row.consent_text}`);
    }
    doc.moveDown().fontSize(8).text(`Document SHA-256: ${row.document_hash || 'Draft — not issued'}`,{lineBreak:true});
    const pages=doc.bufferedPageRange();
    for(let i=pages.start;i<pages.start+pages.count;i++){doc.switchToPage(i);doc.fontSize(8).text(`The Lola Booth · ${i+1} of ${pages.count}`,54,740,{lineBreak:false});}
    doc.end();
  });
}
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
