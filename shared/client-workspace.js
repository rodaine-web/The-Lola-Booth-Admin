import {secureDocumentUrl} from './document-access.js';
import {invoiceBalance} from './invoice-balance.js';
// This first workspace is scoped to one proposal/event, not every project owned
// by a client. Never serialize full database records into public responses.
export function workspaceView({proposal,contracts=[],invoices=[],payments=[],documentOrigin,now=Date.now()}) {
 const visibleInvoices=invoices.filter(i=>i.proposal_id===proposal.id&&!i.deleted_at&&!['DRAFT','VOID'].includes(i.status));
 const invoiceIds=new Set(visibleInvoices.map(i=>i.id));
 return {
  client:proposal.client_name||'Your event',
  event:{name:proposal.event_name||proposal.proposal_number,date:proposal.event_date,venue:proposal.venue_name},
  proposal:{number:proposal.proposal_number,status:proposal.status,total:proposal.total,url:secureDocumentUrl(documentOrigin,'proposal',proposal)},
  agreements:contracts.filter(c=>c.proposal_id===proposal.id&&['ISSUED','SIGNED'].includes(c.status)&&(c.status==='SIGNED'||new Date(c.expires_at).getTime()>now)).map(c=>({id:c.id,title:c.title,revision:c.revision,status:c.status,signedAt:c.signed_at,signerName:c.signer_name,url:c.url||null})),
  invoices:visibleInvoices.map(i=>({id:i.id,number:i.invoice_number,status:i.status,total:i.total,balance:invoiceBalance(i),dueDate:i.due_date,url:secureDocumentUrl(documentOrigin,'pay',i)})),
  receipts:payments.filter(p=>invoiceIds.has(p.invoice_id)&&!p.deleted_at&&['SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'].includes(p.status)).flatMap(p=>{
   const invoice=visibleInvoices.find(i=>i.id===p.invoice_id);
   const invoiceUrl=secureDocumentUrl(documentOrigin,'pay',invoice);
   return invoiceUrl?[{id:p.id,amount:p.amount,status:p.status,date:p.payment_date,url:`${documentOrigin.replace(/\/$/,'')}/receipt/${encodeURIComponent(invoice.secure_token)}/${p.id}`}]:[];
  })
 };
}
