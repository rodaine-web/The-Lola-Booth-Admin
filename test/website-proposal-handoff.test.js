import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticWebsiteQuoteDecision } from '../server/src/services/website-proposal-handoff-service.js';
const booking={selections:[{pricingMode:'FIXED',startingPrice:599}],addons:[]};
const input={eventDate:'2030-12-01',eventStartTime:'18:00',eventEndTime:'22:00',venueAddress:'QA venue',city:'Chicago'};
const config={BOOKING_AUTO_QUOTE_CITIES:'Chicago'};
test('website auto quote requires a configured fixed-price service area and complete facts',()=>{
 assert.equal(automaticWebsiteQuoteDecision(booking,input,config),null);
 assert.match(automaticWebsiteQuoteDecision(booking,input,{}),/travel/);
 assert.match(automaticWebsiteQuoteDecision(booking,{...input,city:'New York'},config),/travel/);
 assert.match(automaticWebsiteQuoteDecision(booking,{...input,venueAddress:''},config),/address/);
 assert.match(automaticWebsiteQuoteDecision(booking,{...input,eventEndTime:'02:00'},config),/overnight/);
});
test('website auto quote cannot invent custom commercial amounts',()=>{
 assert.match(automaticWebsiteQuoteDecision({...booking,selections:[{pricingMode:'CUSTOM',startingPrice:null}]},input,config),/custom/);
 assert.match(automaticWebsiteQuoteDecision({...booking,addons:[{pricingType:'CUSTOM',name:'Travel',unitPrice:null}]},input,config),/custom/);
 assert.match(automaticWebsiteQuoteDecision({...booking,addons:[{pricingType:'FIXED',name:'Custom signage',unitPrice:200}]},input,config),/custom/);
});
