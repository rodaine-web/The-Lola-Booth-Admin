import test from 'node:test';
import assert from 'node:assert/strict';
import {disputeFundsWithheld} from '../shared/payment-dispute.js';
import {receiptView} from '../shared/receipt-view.js';
const row=(amount,id='txn_debit')=>({id,amount,currency:'usd',fee:1500,net:amount-1500});
const dispute=(status,balance_transactions=[])=>({status,amount:10000,currency:'usd',balance_transactions});
test('dispute principal excludes fees and does not confuse an inquiry with withdrawn funds',()=>{
 assert.equal(disputeFundsWithheld(dispute('warning_needs_response')),0);
 assert.equal(disputeFundsWithheld(dispute('needs_response',[row(-10000)])),10000);
 assert.equal(disputeFundsWithheld(dispute('lost',[row(-10000)])),10000);
 assert.equal(disputeFundsWithheld(dispute('won',[row(-10000),row(10000,'txn_credit')])),0);
 assert.equal(disputeFundsWithheld(dispute('under_review',[row(-4000)])),4000);
});
test('invalid or incomplete dispute movement fails closed',()=>{
 assert.throws(()=>disputeFundsWithheld(dispute('needs_response')));
 assert.throws(()=>disputeFundsWithheld(dispute('needs_response',[row(-11000)])));
 assert.throws(()=>disputeFundsWithheld(dispute('needs_response',[row(-5000),row(-5000)])));
 assert.throws(()=>disputeFundsWithheld(dispute('won',[{...row(-10000),currency:'eur'}])));
});
test('receipt retains original payment and separately reports disputed funds',()=>{
 const view=receiptView({total:100,amount_paid:60,balance_due:40,status:'PARTIALLY_PAID'},{id:'p1',amount:100,refunded_amount:0,disputed_amount:40,status:'SUCCEEDED'});
 assert.equal(view.thisPayment,100);assert.equal(view.refunded,0);assert.equal(view.disputed,40);assert.equal(view.netPayment,60);assert.equal(view.status,'DISPUTED');
});
