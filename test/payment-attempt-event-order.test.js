import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Exercise the actual handler with a database boundary stub: Stripe can send
// PaymentIntent success before Checkout success, or deliver them in reverse.
const source=fs.readFileSync(new URL('../server/src/services/payment-service.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('async function recordProviderPayment(input)'),source.indexOf('async function recordProviderPaymentFailure(input)'));
function harness(prior){
  const updates=[];
  const payment={id:'payment',invoice_id:'invoice',amount:10,currency:'USD',client_id:'client'};
  const query=async(sql,args)=>{
    if(sql.startsWith('SELECT * FROM invoices'))return {rows:[{id:'invoice',client_id:'client',balance_due:10}]};
    if(sql.startsWith('SELECT * FROM payments'))return {rows:prior?[payment]:[]};
    if(sql.startsWith('SELECT * FROM payment_attempts'))return {rows:[{id:'correct-checkout-attempt',amount:10,currency:'USD'}]};
    if(sql.includes('INSERT INTO payments'))return {rows:[payment]};
    if(sql.startsWith('SELECT name,email'))return {rows:[]};
    updates.push({sql,args});return {rows:[]};
  };
  const noop=async()=>{};
  const run=new Function('query','transaction','notFound','cents','invoiceBalance','AppError','reconcileInvoice','applyBookingConfirmationPolicy','writeAudit','enqueueLifecycle',`${handler};return recordProviderPayment;`)(query,fn=>fn({query}),()=>Error('missing'),x=>Math.round(x*100),()=>10,Error,noop,noop,noop,noop);
  return {run,updates};
}
const input={invoiceId:'invoice',provider:'STRIPE',providerPaymentId:'pi_test',amount:10,currency:'USD',paymentMethod:'ONLINE'};
test('PaymentIntent-first success completes the validated Checkout attempt by ID',async()=>{
 const h=harness(false);await h.run({...input,providerSessionId:null});
 const update=h.updates.find(x=>x.sql.startsWith('UPDATE payment_attempts'));
 assert.deepEqual(update.args,['correct-checkout-attempt','pi_test']);
 assert.match(update.sql,/WHERE id=\$1/);
});
test('Checkout success after an existing payment repairs its session relation without a new receipt or email',async()=>{
 const h=harness(true);await h.run({...input,providerSessionId:'cs_test'});
 assert.deepEqual(h.updates[0].args,['invoice','STRIPE','cs_test','pi_test']);
 assert.match(h.updates[0].sql,/provider_session_id=\$3/);
 assert.deepEqual(h.updates[1].args,['payment','cs_test']);
 assert.equal(h.updates.length,2);
});
