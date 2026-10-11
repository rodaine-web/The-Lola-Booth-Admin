import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBookingSelections,bookingAddonEligible} from '../server/src/services/public-booking-service.js';
import {inquirySchema} from '../server/src/services/public-form-schema.js';
import {normalizeWebsiteLead} from '../server/src/services/social-lead-service.js';
import {proposalBookingPrefill} from '../shared/proposal-booking-prefill.js';
const ids=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004'];
const catalog={experiences:[{id:ids[0],slug:'glam',name:'The LOLA Glam'},{id:ids[1],slug:'360',name:'The LOLA 360'}],packages:[{id:ids[2],experience_id:ids[0],name:'Signature',starting_price:899},{id:ids[3],experience_id:ids[1],name:'Luxe',starting_price:1299}],addons:[{id:ids[0],name:'Extra Hour',pricing_type:'PER_HOUR',price:150},{id:ids[1],name:'Travel',pricing_type:'CUSTOM',price:0}]};
const request={selections:[{experienceId:ids[0],packageId:ids[2]},{experienceId:ids[1],packageId:ids[3]}],addons:[{addonId:ids[0],quantity:2},{addonId:ids[1],quantity:1}]};
test('multi-experience inquiry retains authoritative packages, quantities and custom pricing',()=>{
 const result=validateBookingSelections({...request,price:1,selections:request.selections.map(x=>({...x,price:1}))},catalog);
 assert.deepEqual(result.selections.map(x=>x.startingPrice),[899,1299]);assert.equal(result.addons[0].unitPrice,150);assert.equal(result.addons[0].quantity,2);assert.equal(result.addons[1].unitPrice,null);
 const prefill=proposalBookingPrefill({source_details:{bookingInquiry:{...result,eventName:'QA Wedding'}}},catalog.experiences,catalog.packages);
 assert.equal(prefill.selectedExperiences.length,2);assert.deepEqual(prefill.selectedExperiences.map(x=>x.packages[0].package_id),[ids[2],ids[3]]);assert.equal(prefill.selectedAddons[0].quantity,2);assert.equal(prefill.selectedAddons[1].unit_price,null);assert.equal(prefill.fields.event_name,'QA Wedding');
});
test('manipulated relationship, duplicate or unavailable choices and invalid quantities fail closed',()=>{
 for(const input of [{...request,selections:[{experienceId:ids[0],packageId:ids[3]}]},{...request,selections:[request.selections[0],request.selections[0]]},{...request,addons:[{addonId:ids[0],quantity:0}]},{...request,addons:[{addonId:ids[1],quantity:2}]}])assert.throws(()=>validateBookingSelections(input,catalog));
 assert.throws(()=>validateBookingSelections(request,{...catalog,packages:[]}));
 assert.equal(bookingAddonEligible({name:'Additional Prints'},[catalog.experiences[1]]),false);assert.equal(bookingAddonEligible({name:'Audio Guestbook'},[{slug:'audio'}]),false);
});
test('v2 schema rejects impossible dates and strips price/protected fields',()=>{
 const payload={...request,bookingVersion:2,formKind:'BOOKING',submissionId:ids[0],firstName:'QA',lastName:'Only',email:'qa@example.invalid',phone:'3125550100',eventName:'QA Wedding',eventDate:'2030-06-20',eventStartTime:'18:00',eventEndTime:'23:00',guestCount:100,eventType:'Wedding',city:'Chicago',state:'IL',price:1,status:'WON'};
 const parsed=inquirySchema.parse(payload);assert.equal(parsed.status,undefined);assert.equal(parsed.price,undefined);assert.equal(parsed.marketing_email_opt_in,undefined);
 for(const eventDate of ['2030-02-30','2030-99-99','2020-01-01'])assert.equal(inquirySchema.safeParse({...payload,eventDate}).success,false);
 assert.equal(inquirySchema.safeParse({...payload,eventStartTime:'25:00'}).success,false);
 assert.equal(inquirySchema.safeParse({...payload,selections:undefined}).success,false);
 assert.equal(inquirySchema.safeParse({...payload,phone:'abcdefgh'}).success,false);
 const contact=inquirySchema.parse({...payload,formKind:'CONTACT',topic:'General inquiry',message:'Question'});assert.equal(contact.selections,undefined);assert.equal(contact.bookingVersion,undefined);
 const a=normalizeWebsiteLead(payload),b=normalizeWebsiteLead({...payload,eventName:'changed'}),c=normalizeWebsiteLead({...payload,submissionId:ids[1]});assert.equal(a.external_lead_id,b.external_lead_id);assert.notEqual(a.external_lead_id,c.external_lead_id);
});
