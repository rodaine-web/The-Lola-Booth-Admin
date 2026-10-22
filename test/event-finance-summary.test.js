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

test('a full paid invoice satisfies readiness even without a legacy booking row',()=>{
 const result=eventFinanceSummary({},[{status:'PAID',total:1000,amount_paid:1000,amount_outstanding:0}]);
 assert.equal(result.deposit_required,300); assert.equal(requiredDepositPaid(result),true);
});
test('a partial accepted-price invoice uses the standard 30 percent minimum',()=>{
 const base={status:'PARTIALLY_PAID',total:999,amount_outstanding:699.3};
 assert.equal(requiredDepositPaid(eventFinanceSummary({},[{...base,amount_paid:299.7}])),true);
 assert.equal(requiredDepositPaid(eventFinanceSummary({},[{...base,amount_paid:299.69}])),false);
});

test('an approved confirmation minimum takes precedence over the standard retainer',()=>{
 const paid={status:'PARTIALLY_PAID',total:1000,amount_paid:100,amount_outstanding:900,pricing_snapshot:{payment_mode:'DEPOSIT_REQUEST',amount_due_now:300}};
 assert.equal(requiredDepositPaid(eventFinanceSummary({approved_confirmation_minimum:100},[paid])),true);
 assert.equal(requiredDepositPaid(eventFinanceSummary({approved_confirmation_minimum:200},[paid])),false);
 assert.equal(requiredDepositPaid(eventFinanceSummary({approved_confirmation_minimum:0},[{...paid,amount_paid:0}])),true);
});
