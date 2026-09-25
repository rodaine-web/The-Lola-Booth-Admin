import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {brandedEmailHtml} from './automation-service.js';

// Matching never returns invoice existence or a bearer token to the requester.
// Access is delivered only to the address already attached to the invoice.
export async function requestInvoiceAccess({invoiceNumber,email}) {
  await transaction(async client=>{
    const invoice=(await client.query(`SELECT i.id,i.secure_token,c.email FROM invoices i JOIN clients c ON c.id=i.client_id
      WHERE lower(i.invoice_number)=lower($1) AND lower(c.email)=lower($2) AND i.deleted_at IS NULL
      AND i.token_revoked_at IS NULL AND (i.token_expires_at IS NULL OR i.token_expires_at>now())`,[invoiceNumber,email])).rows[0];
    if(!invoice)return;
    const claimed=await client.query(`INSERT INTO invoice_access_requests(invoice_id) VALUES($1)
      ON CONFLICT(invoice_id) DO UPDATE SET requested_at=now()
      WHERE invoice_access_requests.requested_at < now()-interval '15 minutes' RETURNING invoice_id`,[invoice.id]);
    if(!claimed.rowCount)return;
    const body=`Use this secure link to view your invoice and payment options:\n${env.publicBaseUrl}/pay/${invoice.secure_token}\nIf you did not request this email, no action is required.`;
    await query(`INSERT INTO communications(invoice_id,type,channel,direction,recipient,subject,rendered_subject,rendered_body,rendered_html,status,send_mode,scheduled_at,trigger_key)
      VALUES($1,'EMAIL','EMAIL','OUTBOUND',$2,'Your secure invoice link','Your secure invoice link',$3,$4,'SCHEDULED','SCHEDULED',now(),'INVOICE_ACCESS')`,[invoice.id,invoice.email,body,brandedEmailHtml(body)]);
  });
  return {message:'If those details match an invoice, a secure link will be emailed to its billing address.'};
}

export function publicInvoiceSummary(invoice){
 const fields=['invoice_number','client_name','event_name','due_date','status','subtotal','discount','tax','total','amount_paid','amount_outstanding','balance_due','currency','data_quality'];
 const result=Object.fromEntries(fields.map(k=>[k,invoice[k]]));
 result.items=invoice.items.map(({description,quantity,unit_price,line_total})=>({description,quantity,unit_price,line_total}));
 result.payments=invoice.payments.filter(p=>['SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED'].includes(p.status)).map(({id,amount,currency,payment_date,provider,status,receipt_available})=>({id,amount,currency,payment_date,provider,status,receipt_available:Boolean(receipt_available)}));
 return result;
}
