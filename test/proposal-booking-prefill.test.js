import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWebsiteLead} from '../server/src/services/social-lead-service.js';
import {proposalBookingPrefill} from '../shared/proposal-booking-prefill.js';
import {composeProposal} from '../shared/proposal-scenario.js';

const experience={id:'360-id',name:'360 Video Booth',base_price:600};
const pkg={id:'signature-360-id',experience_id:experience.id,name:'Signature',starting_price:899,included_hours:3,items:['Unlimited video sessions','Custom overlay']};
test('website Wedding / 360 / Signature booking transfers every event field and preselects catalog IDs',()=>{
  const lead=normalizeWebsiteLead({formKind:'BOOKING',firstName:'Sarah',lastName:'Adams',email:'sarah@example.invalid',phone:'3125550199',company:'Wedding planner',eventDate:'2027-05-17',eventStartTime:'18:00',eventEndTime:'23:00',eventType:'Wedding',guestCount:200,venueName:'The Harper',venueAddress:'123 Main St',city:'Austin',state:'TX',zip:'78701',preferredExperienceId:experience.id,preferredPackageId:pkg.id,referralSource:'Instagram',message:'Gold backdrop and custom names overlay.'});
  const {fields,selectedExperiences}=proposalBookingPrefill({...lead,notes:'Private staff instructions'},[experience],[pkg]);
  assert.equal(fields.event_type,'Wedding');assert.equal(fields.first_name,'Sarah');assert.equal(fields.email,'sarah@example.invalid');assert.equal(fields.phone,'3125550199');assert.equal(fields.company,'Wedding planner');
  for(const [key,value] of Object.entries({event_date:'2027-05-17',start_time:'18:00',end_time:'23:00',guest_count:200,venue_name:'The Harper',venue_address:'123 Main St',city:'Austin',state:'TX',zip:'78701',source:'Instagram',customer_notes:'Gold backdrop and custom names overlay.'}))assert.equal(fields[key],value,key);
  assert.equal(selectedExperiences[0].experience_id,experience.id);assert.equal(selectedExperiences[0].packages[0].package_id,pkg.id);assert.equal(selectedExperiences[0].price,899);
  const scenario=composeProposal({input:{event_type:fields.event_type,event_details:fields,client_details:fields,customer_notes:fields.customer_notes},experiences:selectedExperiences,pricing:{total:899}});
  assert.equal(scenario.details.event_type,'Wedding');assert.equal(scenario.experiences[0].name,'360 Video Booth');assert.equal(scenario.experiences[0].packages[0].name,'Signature');assert.deepEqual(scenario.experiences[0].features,pkg.items);assert.ok(JSON.stringify(scenario).includes(fields.customer_notes));assert.ok(!JSON.stringify(scenario).includes('Private staff instructions'));
});
test('hydrated preferred objects preselect without catalog fetch and mismatched package never moves to a different booth',()=>{
 const lead={event_type:'WEDDING',preferred_experience_id:experience.id,preferredExperience:experience,preferredPackage:pkg};
 assert.equal(proposalBookingPrefill(lead).selectedExperiences[0].packages[0].package_id,pkg.id);
 assert.equal(proposalBookingPrefill({...lead,preferredPackage:{...pkg,experience_id:'glam-id'}}).selectedExperiences[0].packages.length,0);
 assert.equal(proposalBookingPrefill({preferredPackage:pkg}).selectedExperiences[0].experience_id,experience.id);
});

test('website CMS event labels map to their proposal scenario while custom names stay Other',()=>{
 for(const [value,type] of [['Weddings','Wedding'],['Corporate Events','Corporate Event'],['Private Events','Private Party'],['Birthdays','Birthday'],['Brand Activations','Brand Activation'],['Awards Gala','Other']])assert.equal(proposalBookingPrefill({event_type:value}).fields.event_type,type);
});
