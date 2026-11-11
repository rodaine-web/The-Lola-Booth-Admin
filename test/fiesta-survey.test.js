import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFiestaSurvey,surveyTable} from '../shared/fiesta-survey.js';
const csv='Guest,Street,City,State,ZIP,Country,Photo,Postcard?,Permission\nSynthetic Guest,100 Test Ave,Chicago,il,60601,USA,PHOTO1.jpg,Yes,I agree';
const mapping={name:'Guest',address1:'Street',city:'City',state:'State',postalCode:'ZIP',country:'Country',filename:'Photo',mailingPreference:'Postcard?',consent:'Permission'};
const affirmative={mailingPreference:['Yes'],consent:['I agree']};
test('explicit survey mapping preserves source evidence and normalizes domestic fields',()=>{
 const parsed=parseFiestaSurvey(csv,mapping,affirmative),r=parsed.records[0];
 assert.equal(r.sourceRow,2);assert.equal(r.data.state,'IL');assert.equal(r.data.country,'US');assert.deepEqual(r.issues,[]);
 assert.equal(r.original[8],'I agree');assert.equal(parsed.headers[8],'Permission');
});
test('no inferred consent, preference or country; incomplete and foreign addresses require review',()=>{
 const r=parseFiestaSurvey(csv.replace(',USA,',',Canada,'),mapping).records[0];
 assert.deepEqual(r.issues,['US_COUNTRY_REQUIRED','MAILING_PREFERENCE_UNCONFIRMED','CONSENT_UNCONFIRMED']);
 const absent={...mapping};delete absent.country;delete absent.consent;delete absent.address1;
 const issues=parseFiestaSurvey(csv,absent,affirmative).records[0].issues;
 for(const issue of ['US_COUNTRY_REQUIRED','CONSENT_UNCONFIRMED','ADDRESS_INCOMPLETE'])assert.ok(issues.includes(issue));
 assert.ok(parseFiestaSurvey(csv.replace('I agree','No'),mapping,affirmative).records[0].issues.includes('CONSENT_UNCONFIRMED'));
});
test('session references remain source evidence and are never fabricated as filenames',()=>{
 const m={...mapping,sessionId:'Photo'};delete m.filename;
 const r=parseFiestaSurvey(csv,m,affirmative).records[0];assert.equal(r.data.filename,'');assert.equal(r.data.sessionId,'PHOTO1.jpg');
 assert.throws(()=>parseFiestaSurvey(csv,{name:'Guest'}),{code:'FIESTA_SURVEY_INVALID'});
});
test('video and path references are not print photo references',()=>{
 for(const ref of ['movie.mp4','../PHOTO1.jpg','https://example.invalid/photo.jpg'])assert.ok(parseFiestaSurvey(csv.replace('PHOTO1.jpg',ref),mapping,affirmative).records[0].issues.includes('PHOTO_REFERENCE_UNSUPPORTED'));
});
test('CSV handles quoted commas, line breaks, BOM and literal formula text without evaluation',()=>{
 const t=surveyTable('\uFEFFA,B\r\n"one, two","line\nnext"\r\n=1+1,literal');
 assert.deepEqual(t.rows,[['one, two','line\nnext'],['=1+1','literal']]);
});
test('reject malformed, oversized, ambiguous or unknown column mappings',()=>{
 for(const input of ['A,A\nx,y','A,B\nx','A\n"oops','A\n"x"y','A\n'+ 'a'.repeat(10001)])assert.throws(()=>surveyTable(input),{code:'FIESTA_SURVEY_INVALID'});
 assert.throws(()=>surveyTable('A\n'+'a'.repeat(1024*1024)),{code:'FIESTA_SURVEY_INVALID'});
 assert.throws(()=>parseFiestaSurvey(csv,{...mapping,unknown:'Guest'}),{code:'FIESTA_SURVEY_INVALID'});
 assert.throws(()=>parseFiestaSurvey(csv,{...mapping,city:'Not a column'}),{code:'FIESTA_SURVEY_INVALID'});
 assert.throws(()=>parseFiestaSurvey(csv,mapping,{consent:[true]}),{code:'FIESTA_SURVEY_INVALID'});
});
