import {query} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {contractSigningUrl} from './contract-service.js';
export async function invoiceAgreementState(invoice,{includeUrl=false}={}){
 const row=(await query(`SELECT p.accepted_version_id,k.id,k.status,k.expires_at,k.snapshot FROM proposals p
  LEFT JOIN LATERAL(SELECT * FROM contracts WHERE proposal_id=p.id AND status IN ('ISSUED','SIGNED') ORDER BY revision DESC LIMIT 1) k ON true
  WHERE (p.id=$1 OR ($1::uuid IS NULL AND p.event_id=$2)) AND p.deleted_at IS NULL
  ORDER BY (p.status IN ('ACCEPTED','CONVERTED')) DESC,p.accepted_at DESC NULLS LAST,p.created_at DESC LIMIT 1`,[invoice.proposal_id||null,invoice.event_id||null])).rows[0];
 if(!row&&!invoice.proposal_id)return {required:false,signed:false};
 const signed=Boolean(row?.id && row.status==='SIGNED' && (!row.accepted_version_id || row.snapshot?.accepted_version_id===row.accepted_version_id));
 const result={required:!signed,signed,contractId:row?.id||null};
 if(includeUrl&&!signed&&row?.status==='ISSUED'&&new Date(row.expires_at)>new Date())result.signingUrl=await contractSigningUrl(row.id);
 return result;
}
export async function assertInvoiceAgreement(invoice){
 const state=await invoiceAgreementState(invoice);
 if(state.required)throw new AppError('Review and sign your current agreement before making a payment.',409,'SIGNED_AGREEMENT_REQUIRED');
 return state;
}
