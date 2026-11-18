import test from 'node:test';
import assert from 'node:assert/strict';
import {correctFiestaAddress} from '../shared/fiesta-address-correction.js';
import {parseFiestaShares,parseFiestaCsvGrid} from '../shared/fiesta-gallery.js';
const pairs=[['First Name','Test'],['Last Name','Guest'],['Address','12 Original St'],['City','Boston'],['State','Man'],['Zip Code','2134'],['Physical mail consent','No']];
const header=['Shared via','Email Address','Phone Number','Content Link','File Name','Share Time',...pairs.flatMap((_,i)=>[i?'Question '+(i+1):'Question',i?'Answer '+(i+1):'Answer'])];
const row=email=>['E-mail',email,'','https://boothpics.com/QA/photo','photo.jpeg','2026-11-18 10:00 CST',...pairs.flat()];
const csv=[header,row('test@example.invalid'),row('test@example.invalid'),row('other@example.invalid')].map(r=>r.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\n');
const address={name:'Corrected Guest',address_line1:'12 Corrected St',address_line2:'Apt 3',address_city:'Boston',address_state:'Massachusetts',address_zip:'02134',address_country:'US'};
test('address correction keeps ZIP zeros, original sharing identities, other guests and negative consent',()=>{
 const original=parseFiestaShares(csv,'QA',{defaultCountry:'US'}),result=correctFiestaAddress(csv,'QA',original.records[0],address,{defaultCountry:'US'}),parsed=parseFiestaShares(result.csv,'QA',{defaultCountry:'US'});
 assert.equal(parsed.sharingRows,3);assert.equal(parsed.records.length,2);assert.equal(parsed.records[0].postal.complete,true);assert.equal(parsed.records[0].postal.physicalMailConsent,false);assert.equal(parsed.records[0].postal.mailingPreference,null);assert.equal(parsed.records[0].postal.recipient.address_zip,'02134');assert.equal(parsed.records[0].postal.recipient.address_state,'MA');assert.equal(parsed.records[0].postal.recipient.name,'Corrected Guest');assert.deepEqual(parsed.records[1],original.records[1]);
 for(const [i,r]of parseFiestaCsvGrid(result.csv).slice(1).entries())assert.deepEqual(r.slice(0,6),parseFiestaCsvGrid(csv)[i+1].slice(0,6));
});
test('four-digit ZIPs and numeric-only streets require an explicit correction; missing identities fail',()=>{
 const target=parseFiestaShares(csv,'QA').records[0];
 for(const change of [{address_zip:'2134'},{address_state:'Man'},{address_line1:'455'},{address_country:'Canada'}])assert.throws(()=>correctFiestaAddress(csv,'QA',target,{...address,...change}));
 assert.throws(()=>correctFiestaAddress(csv,'QA',{...target,recipient:'missing@example.invalid'},address));
});
