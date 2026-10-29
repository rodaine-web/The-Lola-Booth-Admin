import test from 'node:test';import assert from 'node:assert/strict';
import {bookingSchedule} from '../shared/booking-payment-policy.js';
test('full payment begins exactly fourteen calendar days before event, including month/year/leap boundaries',()=>{
 for(const [eventDate,businessDate,expected] of [['2027-06-26','2027-06-11',false],['2027-06-26','2027-06-12',true],['2027-06-26','2027-06-26',true],['2027-01-05','2026-12-22',true],['2028-03-01','2028-02-16',true]]){
 const result=bookingSchedule({eventDate,businessDate,total:999.99});assert.equal(result.fullPaymentRequired,expected);if(expected)assert.equal(result.amountDueNow,999.99);
 }
 assert.equal(bookingSchedule({eventDate:null,businessDate:'2027-01-01'}).fullPaymentRequired,false);
});
