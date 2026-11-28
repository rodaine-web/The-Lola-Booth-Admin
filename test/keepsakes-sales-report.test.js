import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeKeepsakesSales} from '../shared/keepsakes-sales-report.js';
const paid=(overrides={})=>({paid_at:'2035-01-01',status:'PAID',subtotal_cents:1000,discount_cents:100,shipping_cents:500,tax_cents:90,total_cents:1490,refunded_cents:0,items:[{key:'magnet',title:'Photo Magnet',units:2}],...overrides});
test('sales distinguish discounted merchandise, shipping, tax and confirmed refunds',()=>{
 const {totals,products}=summarizeKeepsakesSales([paid({refunded_cents:450,items:[{key:'magnet',title:'Photo Magnet',units:2,cancelledUnits:1}]}),paid({paid_at:null})]);
 assert.deepEqual(totals,{paidOrders:1,chargedCents:1490,refundedCents:450,netReceiptsCents:1040,merchandiseCents:900,discountCents:100,shippingCents:500,taxCents:90,heldCents:0,additionalCollectedCents:1040,units:1});
 assert.deepEqual(products,[{key:'magnet',title:'Photo Magnet',units:1}]);
});
test('already reported payment intents and financial holds never inflate combined collections',()=>{
 const {totals}=summarizeKeepsakesSales([paid({already_reported:true}),paid({status:'REQUIRES_REVIEW',last_error:'Payment dispute'}),paid({status:'REFUND_PENDING'}),paid({status:'REQUIRES_REVIEW',last_error:'Artwork needs review'})]);
 assert.equal(totals.netReceiptsCents,5960);assert.equal(totals.heldCents,2980);assert.equal(totals.additionalCollectedCents,1490);
});
test('fully refunded and canceled orders retain monetary history without units sold',()=>{
 const {totals}=summarizeKeepsakesSales([paid({refunded_cents:1490,status:'REFUNDED'}),paid({status:'CANCELLED'})]);
 assert.equal(totals.units,0);assert.equal(totals.refundedCents,1490);assert.equal(totals.paidOrders,2);
});
