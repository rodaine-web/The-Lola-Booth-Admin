import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingOverview} from '../src/utils/booking-overview.js';
const proposal={id:'p',status:'ACCEPTED',accepted_version_id:'v2'};
const event={status:'CONFIRMED',booked_total:1000,deposit_required:300,amount_paid:300,balance_due:700,operations:{readiness:{items:[{label:'Event planning approved by LOLA',status:'INCOMPLETE'}]}}};
test('an accepted proposal does not complete payment or agreement',()=>{
 const journey=bookingOverview({proposal});
 assert.equal(journey.steps[1].complete,true);assert.equal(journey.retainerPaid,false);assert.equal(journey.signed,undefined);assert.equal(journey.next.kind,'retainer');
});
test('only the signed agreement for the accepted commercial version counts',()=>{
 const journey=bookingOverview({event,proposal,contracts:[{status:'SIGNED',snapshot:{accepted_version_id:'v1'}}]});
 assert.equal(journey.signed,undefined);assert.equal(journey.next.kind,'agreement');
 const current=bookingOverview({event,proposal,contracts:[{status:'SIGNED',snapshot:{accepted_version_id:'v2'}}]});
 assert.ok(current.signed);assert.equal(current.next.kind,'planning');assert.equal(current.fullyPaid,false);
});
test('readiness and final payment require persisted evidence; refunds reopen payment',()=>{
 const approved={...event,amount_paid:1000,balance_due:0,operations:{readiness:{items:[{label:'Event planning approved by LOLA',status:'COMPLETE'}]}}};
 const journey=bookingOverview({event:approved,proposal,contracts:[{status:'SIGNED',snapshot:{accepted_version_id:'v2'}}]});
 assert.equal(journey.steps[4].complete,true);assert.equal(journey.fullyPaid,true);
 const refunded=bookingOverview({event:{...approved,amount_paid:200,balance_due:800},proposal});assert.equal(refunded.retainerPaid,false);assert.equal(refunded.fullyPaid,false);
});
test('cancelled bookings have no active payment or planning next action',()=>{assert.equal(bookingOverview({event:{...event,status:'CANCELLED'},proposal}).next.kind,'closed');});
