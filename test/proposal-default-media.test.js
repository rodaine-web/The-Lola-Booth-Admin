import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeDefaultProposalMedia} from '../server/src/services/proposal-default-media.js';
import {composeProposal} from '../shared/proposal-scenario.js';
import {scenarioSectionData} from '../server/src/services/proposal-scenario-document.js';
test('reviewed photographs map wedding and brand separately and preserve approved overrides',()=>{
 for(const eventType of ['Wedding','Brand Activation','Corporate Event','Birthday']){
  const scenario={eventType,mediaImages:{},experiences:[{key:'360',experience_id:'360'}]};freezeDefaultProposalMedia(scenario);
  assert.match(scenario.mediaImages['experience:360'][0].source,/360/);
  assert.equal(scenario.mediaImages.cover[0].source.includes('wedding'),eventType==='Wedding');
  const saved=structuredClone(scenario);freezeDefaultProposalMedia(scenario);assert.deepEqual(scenario,saved);
 }
 const custom={eventType:'Wedding',mediaImages:{cover:[{dataUri:'custom'}]},experiences:[]};freezeDefaultProposalMedia(custom);assert.equal(custom.mediaImages.cover[0].dataUri,'custom');
});
test('database times with seconds render cleanly for HTML and PDF shared event facts',()=>{
 const scenario=composeProposal({input:{event_type:'Wedding',event_details:{start_time:'17:00:00',end_time:'22:30:00'}}});
 assert.equal(scenarioSectionData(scenario,{kind:'event'}).find(([label])=>label==='Time')[1],'5:00 PM – 10:30 PM');
});
test('corporate event categories use experience-specific business photos and freeze overrides',()=>{
 for(const eventType of ['Corporate Event','Brand Activation','Conference','Trade Show','Product Launch','Company Celebration']){
  const scenario={eventType,experiences:['glam','360','mirror','vogue'].map(key=>({key,experience_id:key,visuals:{hero:'legacy-celebration'}}))};
  freezeDefaultProposalMedia(scenario);
  for(const key of ['glam','360','mirror','vogue'])assert.match(scenario.mediaImages['experience:'+key][0].source,new RegExp((['Brand Activation','Product Launch'].includes(eventType)?'activation-':'corporate-')+key));
  const issued=structuredClone(scenario);freezeDefaultProposalMedia(scenario);assert.deepEqual(scenario,issued);
 }
 const overridden={eventType:'Corporate Event',experiences:[{key:'glam',experience_id:'g'}],mediaImages:{'experience:g':[{dataUri:'approved-custom'}]}};
 freezeDefaultProposalMedia(overridden);assert.equal(overridden.mediaImages['experience:g'][0].dataUri,'approved-custom');
});
test('business virtual proposals use virtual examples on every page, not global wedding defaults',()=>{
 const scenario=composeProposal({input:{event_type:'Wedding',customer_type:'BUSINESS'},experiences:[{name:'The Lola Virtual Booth',experience_id:'v'}],config:{global:{media_ids:['wedding-global']},experiences:{virtual:{media_ids:['wedding-legacy']}}}});
 assert.equal(scenario.eventType,'Corporate Event');assert.equal(scenario.audience,'BUSINESS');assert.deepEqual(scenario.media.global,[]);
 freezeDefaultProposalMedia(scenario);
 for(const images of Object.values(scenario.mediaImages))assert.equal(images[0].source,'LOLA approved photo: virtual');
 assert.doesNotMatch(JSON.stringify(scenario.copy),/wedding/i);assert.match(scenario.experiences[0].description,/link or QR/);
});
test('custom business and activation labels select the correct copy and experience examples',()=>{
 for(const label of ['Conference','Trade_Show','Business Event','Professional Networking']){
  const s=composeProposal({input:{event_type:'Other',event_details:{event_type:label}},experiences:[{key:'vogue',experience_id:'v'}]});freezeDefaultProposalMedia(s);
  assert.equal(s.eventType,'Corporate Event');assert.match(s.mediaImages.cover[0].source,/corporate-vogue/);assert.match(s.experiences[0].description,/branded/);
 }
 const s=composeProposal({input:{event_type:'Product Launch'},experiences:[{name:'The Lola Virtual Booth',experience_id:'v'}]});freezeDefaultProposalMedia(s);
 assert.equal(s.eventType,'Brand Activation');assert.match(s.experiences[0].description,/campaign/);assert.match(s.experiences[0].description,/illustrate possibilities/);
});
test('unknown business experiences have no unrelated guessed photo; issued snapshots remain fixed',()=>{
 const s={eventType:'Corporate Event',experiences:[{key:'unknown',experience_id:'u'}]};freezeDefaultProposalMedia(s);
 assert.deepEqual(s.mediaImages,{});
 const saved=structuredClone(freezeDefaultProposalMedia({eventType:'Wedding',experiences:[]}));const original=structuredClone(saved);freezeDefaultProposalMedia(saved);assert.deepEqual(saved,original);
});
