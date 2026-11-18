import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFiestaShares} from '../shared/fiesta-gallery.js';
import {lobPrintTestEnabled,postcardFrontProfile} from '../shared/postcard-print-policy.js';

const answers=[['Full name','Synthetic Guest'],['Address line 1','100 QA Example Ave'],['City','Chicago'],['State','IL'],['ZIP code','60601'],['Country','US'],['Would you like a photo postcard from this event?','Yes'],['May The Lola Booth use your mailing address to send your event photo postcard?','Yes']];
function parse(pairs=answers){
 const quote=x=>'"'+String(x).replaceAll('"','""')+'"';
 const columns=['Shared via','Email Address','Phone Number','Content Link','File Name','Share Time',...pairs.flatMap((_,i)=>[i?`Question ${i+1}`:'Question',i?`Answer ${i+1}`:'Answer'])];
 const row=['E-mail','synthetic@example.invalid','','https://boothpics.com/QAONLY/capture1','QA_ONLY.png','2026-11-12 10:00 CST',...pairs.flat()];
 return parseFiestaShares(columns.map(quote).join(',')+'\n'+row.map(quote).join(','),'QAONLY').records[0].postal;
}
test('recommended Fiesta questions establish explicit preference and postal permission',()=>{
 const p=parse();assert.equal(p.complete,true);assert.equal(p.consent,true);assert.equal(p.consentRecorded,true);assert.equal(p.recipient.name,'Synthetic Guest');assert.equal(p.recipient.address_country,'US');assert.deepEqual(p.issues,[]);
});
test('declined or missing mailing preference cannot be overridden by a Yes consent answer',()=>{
 const no=answers.map(([q,a])=>[q,q.startsWith('Would')?'No':a]);assert.equal(parse(no).consent,false);assert.equal(parse(no).consentRecorded,true);
 const missing=parse(answers.filter(([q])=>!q.startsWith('Would')));assert.equal(missing.consent,false);assert.equal(missing.consentRecorded,false);assert.ok(missing.issues.includes('MAILING_PREFERENCE_UNCONFIRMED'));
});
test('email/marketing permissions and contradictory answers do not establish postal permission',()=>{
 const email=answers.map(([q,a])=>[q.startsWith('May')?'I agree to receive photo updates by email':q,a]);assert.equal(parse(email).consent,false);assert.equal(parse(email).consentRecorded,false);
 const conflicting=parse([...answers,['Consent to postcard mailing','No']]);assert.equal(conflicting.consent,false);assert.equal(conflicting.complete,false);assert.ok(conflicting.issues.includes('CONFLICTING_SURVEY_ANSWERS'));
});
test('country, supported state and ZIP must be valid before mailing preparation',()=>{
 for(const [field,value] of [['Country','CA'],['Country',''],['State','ZZ'],['ZIP code','1234']]){
  const p=parse(answers.map(([q,a])=>[q,q===field?value:a]));assert.equal(p.complete,false);
 }
 const postal=parse(answers.map(([q,a])=>[q,q==='Country'?'Canada':a]));assert.equal(postal.recipient.address_country,'CANADA');
});
test('negative postal consent remains negative and full name preserves punctuation',()=>{
 const p=parse(answers.map(([q,a])=>[q,q.startsWith('May')?'No':q==='Full name'?'Synthetic, Guest "QA"':a]));assert.equal(p.consent,false);assert.equal(p.recipient.name,'Synthetic, Guest "QA"');
});
test('only explicit staging opt-in permits print-ready Lob tests; production stays blocked',()=>{
 assert.equal(lobPrintTestEnabled({APP_ENV:'development'}),true);assert.equal(lobPrintTestEnabled({APP_ENV:'test'}),true);
 assert.equal(lobPrintTestEnabled({APP_ENV:'staging'}),false);assert.equal(lobPrintTestEnabled({APP_ENV:'staging',LOB_STAGING_TEST_ENABLED:'true'}),true);
 assert.equal(lobPrintTestEnabled({APP_ENV:'production',NODE_ENV:'test',LOB_STAGING_TEST_ENABLED:'true'}),false);
});
test('only print-quality finished 4x6 layouts are eligible; no narrow strips or enlargement',()=>{
 assert.deepEqual(postcardFrontProfile(1800,1200),{eligible:true,kind:'TRIM_READY',rotation:0});
 assert.deepEqual(postcardFrontProfile(1275,1875),{eligible:true,kind:'BLEED_READY',rotation:90});
 for(const [w,h] of [[600,1800],[1200,3600],[1500,1000],[1536,1024],[2000,2000],[0,100],[NaN,1200]])assert.equal(postcardFrontProfile(w,h).eligible,false);
});
test('rendered trim layouts retain every edge inside white bleed and reject strips',async()=>{
 Object.assign(process.env,{APP_ENV:'test',NODE_ENV:'test',DATABASE_URL:'postgresql://localhost:1/lola_no_connection_test',JWT_SECRET:'synthetic-render-only-jwt-secret',INTEGRATION_SECRET_KEY:'synthetic-render-only-encryption-secret'});
 const sharp=(await import('sharp')).default;
 const {renderPhoto}=await import('../server/src/services/lob-print-ready-service.js');
 const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No provider calls permitted in render tests');};
 try{
  const source=await sharp({create:{width:1800,height:1200,channels:3,background:'#112233'}}).png().toBuffer();
  const output=await renderPhoto(source),{data,info}=await sharp(output).raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,1875);assert.equal(info.height,1275);
  const pixel=(x,y)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];
  assert.deepEqual(pixel(0,0),[255,255,255]);assert.deepEqual(pixel(38,38),[17,34,51]);assert.deepEqual(pixel(1837,1237),[17,34,51]);assert.deepEqual(pixel(1838,1238),[255,255,255]);
  for(const [width,height] of [[600,1800],[1500,1000]]){
   const bad=await sharp({create:{width,height,channels:3,background:'#112233'}}).png().toBuffer();
   await assert.rejects(renderPhoto(bad),{code:'POSTCARD_PRINT_READY'});
  }
  const {submitTestPostcard}=await import('../server/src/services/gallery-postcards-service.js');
  const {submitLobPrintTest}=await import('../server/src/services/lob-print-ready-service.js');
  for(const environment of ['staging','production']){
   process.env.APP_ENV=environment;process.env.LOB_STAGING_TEST_ENABLED=environment==='production'?'true':'false';
   await assert.rejects(submitTestPostcard(),error=>error.statusCode===410);await assert.rejects(submitLobPrintTest('synthetic','synthetic',{}),error=>error.statusCode===403);
  }
 }finally{globalThis.fetch=originalFetch;await(await import('../server/src/db/pool.js')).pool.end();}
});

test('duplicate sharing rows with conflicting postal answers stay in review',()=>{
 const header='Shared via,Email Address,Phone Number,Content Link,File Name,Share Time,Question,Answer,Question 2,Answer 2';
 const prefix='E-mail,duplicate@example.invalid,,https://boothpics.com/QAONLY/CAPTURE,DUPLICATE.png,2026-11-12 10:00 CST,Mailing preference,Yes,Physical mail consent,';
 const parsed=parseFiestaShares([header,prefix+'Yes',prefix+'No'].join('\n'),'QAONLY');
 assert.equal(parsed.records.length,1);assert.equal(parsed.records[0].sourceRow,2);
 assert.equal(parsed.records[0].postal.consent,false);assert.equal(parsed.records[0].postal.consentRecorded,false);
 assert.ok(parsed.records[0].postal.issues.includes('CONFLICTING_SURVEY_ANSWERS'));
});
