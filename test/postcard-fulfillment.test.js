import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
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
 const chartPath=Object.keys(files).find(p=>/charts\/chart1.xml$/.test(p)),chart=new XMLParser({ignoreAttributes:false}).parse(strFromU8(files[chartPath]))['c:chartSpace']['c:chart'];
 assert.equal(chart['c:title']['c:dPt'],undefined);
 assert.equal(chart['c:plotArea']['c:doughnutChart']['c:ser']['c:dPt'].length,5);
 assert.equal(chart['c:plotArea']['c:doughnutChart']['c:holeSize']['@_val'],'55');
 const text=Object.keys(files).filter(p=>p.endsWith('.xml')).map(p=>strFromU8(files[p])).join('');assert.doesNotMatch(text,/\b(budget|cost_limit|price_source|margin|unit_cost)\b|Sample\.jpg|PLACEHOLDER/i);
});
test('Excel detail sheet preserves all recipient rows and valid worksheet element order',async()=>{
 const rows=Array.from({length:87},(_,i)=>({filename:`photo-${i}.jpg`,name:`Synthetic recipient ${i}`,address:{address_zip:'01234'},photoUrl:`https://gallery.thelolabooth.com/gallery/photo/synthetic-${i}`,status:i<69?'SUBMITTED':'HELD',reason:i<69?'Accepted for printing.':'Address needs review.'}));
 const files=unzipSync(await buildPostcardWorkbook({eventName:'Synthetic compatibility check',createdAt:'2035-11-19T12:00:00Z',summary:{images:85,combinations:87,successful:69,held:18},rows}));
 const detail=strFromU8(files['xl/worksheets/sheet2.xml']);assert.equal(XMLValidator.validate(detail),true);
 const parser=new XMLParser({ignoreAttributes:false}),sheet=parser.parse(detail)['x:worksheet'];
 assert.equal(sheet['x:sheetData']['x:row'].length,94);
 const dataRows=sheet['x:sheetData']['x:row'].slice(7);
 assert.deepEqual(dataRows.map(r=>r['x:c'][0]['x:is']['x:t']['#text']),rows.map(r=>r.filename));
 assert.equal(sheet['x:hyperlinks']['x:hyperlink'].length,87);
 assert.equal(sheet['x:conditionalFormatting']['@_sqref'],'L8:L94');
 assert.ok(sheet['x:conditionalFormatting']['x:cfRule'].every(r=>r['x:formula']));
 // ISO/IEC 29500 CT_Worksheet sequence: hyperlinks precede pageMargins,
 // but follow conditionalFormatting. Lenient XML readers don't enforce this.
 const ordered=new XMLParser({preserveOrder:true}).parse(detail).find(n=>n['x:worksheet'])['x:worksheet'].map(n=>Object.keys(n)[0]);
 assert.ok(ordered.indexOf('x:conditionalFormatting')<ordered.indexOf('x:hyperlinks'));
 assert.ok(ordered.indexOf('x:hyperlinks')<ordered.indexOf('x:pageMargins'));
});
