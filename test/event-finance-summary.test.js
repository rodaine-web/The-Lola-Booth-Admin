import test from 'node:test';
import assert from 'node:assert/strict';
import { eventFinanceSummary, requiredDepositPaid } from '../server/src/services/event-finance-summary.js';
const invoice={status:'PARTIALLY_PAID',total:'1099',amount_paid:'329.70',amount_outstanding:'769.30',pricing_snapshot:{payment_mode:'DEPOSIT_REQUEST',amount_due_now:329.70}};
test('proposal-created event without a booking shows linked invoice finance',()=>{
  const result=eventFinanceSummary({id:'event',status:'CONFIRMED'},[invoice]);
  assert.equal(result.booked_total,1099); assert.equal(result.amount_paid,329.70);
  assert.equal(result.balance_due,769.30); assert.equal(result.payment_status,'PARTIAL');
  assert.equal(requiredDepositPaid(result),true);
});
test('small partial payment and refund do not satisfy a required deposit',()=>{
  assert.equal(requiredDepositPaid({deposit_required:329.70,amount_paid:100,payment_status:'PARTIAL'}),false);
  assert.equal(requiredDepositPaid({deposit_required:329.70,amount_paid:0,payment_status:'REFUNDED'}),false);
});
test('void, draft and refunded invoices do not inflate event finance',()=>{
  const result=eventFinanceSummary({},[invoice,...['DRAFT','VOID','REFUNDED'].map(status=>({...invoice,status}))]);
  assert.equal(result.booked_total,1099);
});
test('legacy booking finance remains available before issuing an invoice',()=>{
  const event={booked_total:500,deposit_required:150,amount_paid:150,payment_status:'PARTIAL'};
  assert.deepEqual(eventFinanceSummary(event,[]),event);
});
