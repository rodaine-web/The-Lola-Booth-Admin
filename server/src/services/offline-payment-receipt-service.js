import {query} from '../db/pool.js';
import {getInvoice} from './invoice-service.js';
import {getReceiptView} from './receipt-service.js';
import {createCommunicationDraft,brandedEmailHtml} from './automation-service.js';
import {secureDocumentUrl} from '../../../shared/document-access.js';
import {documentOrigin} from '../utils/public-document-url.js';

// Called inside the payment transaction. Dispatch happens later in the existing worker.
export async function queueOfflinePaymentReceipt(payment){
 if(!payment.invoice_id)return {status:'NOT_QUEUED',reason:'No invoice linked'};
 await query('INSERT INTO payment_receipts(payment_id,invoice_id) VALUES($1,$2) ON CONFLICT(payment_id) DO NOTHING',[payment.id,payment.invoice_id]);
 const key='offline-payment-receipt:'+payment.id;
 const prior=(await query('SELECT id,status FROM communications WHERE idempotency_key=$1 AND deleted_at IS NULL',[key])).rows[0];
 if(prior)return prior;
 const invoice=await getInvoice(payment.invoice_id),receipt=await getReceiptView(invoice,payment.id);
 const invoiceUrl=secureDocumentUrl(documentOrigin(),'invoice',invoice),base=secureDocumentUrl(documentOrigin(),'receipt',invoice);
 if(!invoice.client_email||!invoiceUrl||!base)return {status:'NOT_QUEUED',reason:'Client email or secure invoice access is unavailable'};
 const receiptUrl=base+'/'+payment.id,fmt=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:payment.currency||'USD'}).format(n);
 const body=`Hi ${invoice.client_name||'there'},\n\nPayment received — thank you.\nInvoice: ${invoice.invoice_number}${invoice.parent_invoice_number?`\nSupplemental invoice for: ${invoice.parent_invoice_number}`:''}\nService: ${invoice.items.map(x=>x.description).join(', ')}\nPayment method: ${payment.payment_method}\nPayment date: ${payment.payment_date}\nThis payment: ${fmt(receipt.thisPayment)}\nTotal paid: ${fmt(receipt.totalPaid)}\nRemaining balance: ${fmt(receipt.balanceDue)}\n\nView your receipt: ${receiptUrl}\nView your ${receipt.balanceDue===0?'paid ':''}invoice: ${invoiceUrl}\n\nThe LOLA Booth\nGood people. Better photos.`;
 const message=await createCommunicationDraft({client_id:invoice.client_id,event_id:invoice.event_id,invoice_id:invoice.id,payment_id:payment.id,recipient:invoice.client_email,subject:`Payment receipt — ${invoice.invoice_number}`,body,html:brandedEmailHtml(body,{kicker:'Payment received',ctaLabel:'View Your Receipt',ctaUrl:receiptUrl,secondaryCta:{label:'View Invoice',url:invoiceUrl}}),status:'SCHEDULED',send_mode:'SCHEDULED',scheduled_at:new Date().toISOString(),trigger_key:'OFFLINE_PAYMENT_RECEIPT',merge_data:{receipt_invoice_token:invoice.secure_token}});
 await query('UPDATE communications SET idempotency_key=$2 WHERE id=$1',[message.id,key]);
 return {id:message.id,status:message.status};
}
