import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {postcardResult,fulfillmentSummary} from '../shared/postcard-fulfillment.js';
import {providerMilestones} from '../shared/postcard-provider-status.js';
import {buildPostcardWorkbook} from '../server/src/services/postcard-report-workbook.js';

test('rendering, submission, scheduled release and actual postal milestones stay distinct',()=>{
 assert.equal(postcardResult({live_status:'SUBMITTED',live_provider_status:'rendered'}).status,'SUBMITTED');
 assert.equal(postcardResult({live_status:'SUBMITTED',live_provider_status:'delivered'}).status,'DELIVERED');
 assert.equal(postcardResult({live_status:'NEEDS_REVIEW'}).status,'NEEDS_REVIEW');
 const result=providerMilestones({status:'rendered',send_date:'2035-11-18T19:00:00Z',expected_delivery_date:'2035-11-25'});
 assert.equal(result.mailed,null);assert.equal(result.delivered,null);assert.equal(result.expected,'2035-11-25');
 const tracked=providerMilestones({tracking_events:[{name:'Mailed',time:'2035-11-19T10:00:00Z'},{name:'Delivered',time:'2035-11-22T10:00:00Z'}]});
 assert.ok(tracked.mailed);assert.ok(tracked.delivered);assert.equal(tracked.tracking,'delivered');
 assert.equal(postcardResult({consent:false}).status,'EXCLUDED');
 assert.equal(postcardResult({consent:true,match_status:'AMBIGUOUS'}).status,'HELD');
});
test('summary counts distinct images independently of recipient combinations',()=>{
 const rows=[{media_id:'a',postcard_id:'one',result:{status:'SUBMITTED'}},{media_id:'a',postcard_id:'two',result:{status:'DELIVERED'}},{media_id:'b',result:{status:'EXCLUDED'}}];
 const summary=fulfillmentSummary(rows,2);assert.equal(summary.images,2);assert.equal(summary.combinations,3);assert.equal(summary.processedImages,1);assert.equal(summary.successful,2);assert.equal(summary.excluded,1);
});
test('Excel report keeps literal strings, ZIP zeros, dates, links, native chart and no financial fields',async()=>{
 const snapshot={eventName:'Synthetic Event & Gallery',createdAt:'2035-11-18T18:00:00Z',summary:{images:1,processedImages:1,combinations:3,successful:1,held:1,ready:1},rows:[
  {filename:'photo.jpg',photoUrl:'https://staginggallery.thelolabooth.com/gallery/photo/'+'a'.repeat(43),name:'=HYPERLINK("https://invalid.test")',email:'synthetic@example.invalid',address:{address_line1:'100 Sample St',address_zip:'01234'},status:'SUBMITTED',reason:'Accepted for printing and mailing.',submittedAt:'2035-11-18T18:00:00Z',expectedDelivery:'2035-11-25'},
  {filename:'photo.jpg',name:'Second recipient',address:{address_zip:'01235'},status:'HELD',reason:'Address needs review.'},
  {filename:'photo.jpg',name:'Third recipient',address:{address_zip:'01236'},status:'READY',reason:'Ready for review; not submitted.'}
 ]};
 const files=unzipSync(await buildPostcardWorkbook(snapshot)),detail=strFromU8(files['xl/worksheets/sheet2.xml']),summary=strFromU8(files['xl/worksheets/sheet1.xml']);
 assert.match(detail,/01234/);assert.match(detail,/HYPERLINK\(&quot;/);assert.doesNotMatch(detail,/<x:f>/);assert.match(detail,/<x:autoFilter ref="A7:R10"/);assert.match(detail,/r="N8" s="8" t="n"/);assert.match(detail,/r="O8" s="8"\//);assert.match(summary,/Synthetic Event &amp; Gallery/);assert.match(summary,/<x:c r="B15" s="6" t="n"><x:v>1<\/x:v>/);assert.match(summary,/Not yet submitted/);
 assert.ok(Object.keys(files).some(p=>/charts\/chart1.xml$/.test(p)));assert.match(strFromU8(files['xl/worksheets/_rels/sheet2.xml.rels']),/gallery\/photo\//);
 const text=Object.keys(files).filter(p=>p.endsWith('.xml')).map(p=>strFromU8(files[p])).join('');assert.doesNotMatch(text,/\b(budget|cost_limit|price_source|margin|unit_cost)\b|Sample\.jpg|PLACEHOLDER/i);
});
