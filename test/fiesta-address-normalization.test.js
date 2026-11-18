import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFiestaPostalAnswers as parse} from '../shared/fiesta-postal-survey.js';
const base=[['First Name','Synthetic'],['Last Name','Guest'],['Address','100 QA Ave'],['Apartment/Suite','Unit 2'],['City','Chicago'],['State','Illinois'],['Zip Code','60601']];
test('original Fiesta address headings and full US state names normalize without inferring consent',()=>{
 const original=JSON.stringify(base),p=parse(base,{defaultCountry:'US'});
 assert.equal(p.complete,true);assert.equal(p.recipient.address_line1,'100 QA Ave');assert.equal(p.recipient.address_line2,'Unit 2');assert.equal(p.recipient.address_state,'IL');assert.equal(p.consent,false);assert.equal(p.consentRecorded,false);assert.deepEqual(p.issues,['MAILING_PREFERENCE_UNCONFIRMED','PHYSICAL_MAIL_CONSENT_UNCONFIRMED']);assert.equal(JSON.stringify(base),original);
 for(const state of ['Texas','New York','District of Columbia','  new   hampshire  '])assert.equal(parse(base.map(([q,v])=>[q,q==='State'?state:v]),{defaultCountry:'US'}).complete,true);
});
test('ambiguous state values, foreign locations, incomplete ZIPs and missing addresses stay in review',()=>{
 for(const state of ['Man','Canada','Ticino','T','I’ll'])assert.equal(parse(base.map(([q,v])=>[q,q==='State'?state:v]),{defaultCountry:'US'}).complete,false);
 for(const zip of ['6900','1234',''])assert.equal(parse(base.map(([q,v])=>[q,q==='Zip Code'?zip:v]),{defaultCountry:'US'}).complete,false);
 assert.equal(parse(base.filter(([q])=>q!=='Address'),{defaultCountry:'US'}).complete,false);
 assert.equal(parse([...base,['Country','Canada']],{defaultCountry:'US'}).complete,false);
});
test('recognizing address aliases preserves conflict detection and negative consent',()=>{
 const conflicted=parse([...base,['Street Address','200 Different QA Ave']],{defaultCountry:'US'});assert.equal(conflicted.complete,false);assert.ok(conflicted.issues.includes('CONFLICTING_SURVEY_ANSWERS'));
 const no=parse([...base,['Mailing preference','Yes'],['Physical mail consent','No']],{defaultCountry:'US'});assert.equal(no.complete,true);assert.equal(no.consent,false);assert.equal(no.consentRecorded,true);
});
