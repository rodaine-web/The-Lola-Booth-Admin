import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingPaymentPolicy as policy,bookingPaymentLabel as label} from '../shared/booking-payment-policy.js';
const initial={total:1000,paid:0,dueDate:'2030-10-15',businessDate:'2030-10-01'};
test('first payment minimum is 30% in cents, then custom installments and full balance at deadline',()=>{
 assert.equal(policy(initial).minimumAmount,300);assert.equal(policy(initial).depositAvailable,true);
 assert.equal(policy({...initial,total:100.01}).minimumAmount,30.01);
 const partial=policy({...initial,paid:500});assert.equal(partial.minimumAmount,1);assert.equal(partial.fullAmount,500);assert.equal(partial.depositAvailable,false);assert.equal(partial.allowCustomAmount,true);
 for(const businessDate of ['2030-10-15','2030-10-16']){const due=policy({...initial,paid:500,businessDate});assert.equal(due.minimumAmount,500);assert.equal(due.allowCustomAmount,false);assert.equal(due.amountDue,500);}
 const paid=policy({...initial,paid:1000});assert.equal(paid.fullAmount,0);assert.equal(paid.allowCustomAmount,false);assert.equal(paid.allowPayInFull,false);
});
test('net principal status follows posted money, including refunds and cent rounding',()=>{
 for(const [paid,expected] of [[0,'Pending'],[200,'20% Paid'],[300,'Paid'],[400,'40% Paid'],[650,'65% Paid'],[999.99,'99% Paid'],[1000,'Paid in Full']])assert.equal(label(paid,1000),expected);
 assert.equal(label(30.01,100.01),'Paid');
});

test('owner-approved final thirty-minute window permits full balance only',()=>{
 const dueAt='2030-10-15T05:00:00Z';
 const before=policy({...initial,paid:500,dueAt,now:Date.parse('2030-10-15T04:29:59Z')});assert.equal(before.allowCustomAmount,true);
 const cutoff=policy({...initial,paid:500,dueAt,now:Date.parse('2030-10-15T04:30:00Z')});assert.equal(cutoff.allowCustomAmount,false);assert.equal(cutoff.minimumAmount,500);
});
