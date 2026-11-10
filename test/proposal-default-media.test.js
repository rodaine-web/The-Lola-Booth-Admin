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
  for(const key of ['glam','360','mirror','vogue'])assert.match(scenario.mediaImages['experience:'+key][0].source,new RegExp('corporate-'+key));
  const issued=structuredClone(scenario);freezeDefaultProposalMedia(scenario);assert.deepEqual(scenario,issued);
 }
 const overridden={eventType:'Corporate Event',experiences:[{key:'glam',experience_id:'g'}],mediaImages:{'experience:g':[{dataUri:'approved-custom'}]}};
 freezeDefaultProposalMedia(overridden);assert.equal(overridden.mediaImages['experience:g'][0].dataUri,'approved-custom');
});
