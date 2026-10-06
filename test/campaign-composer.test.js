import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {importCampaignContacts} from '../server/src/services/campaign-contact-import.js';
import {campaignContent,campaignOfferPrice,campaignInterestOptions,campaignPackageOffer} from '../shared/campaign-content.js';
import {renderCampaignEmail} from '../server/src/services/campaign-email.js';
import {campaignSchema,interestSchema} from '../server/src/services/campaign-service.js';
const eid=randomUUID();
const offer={key:'EXPERIENCE_'+eid,kind:'EXPERIENCE',catalog_id:eid,name:'360 Booth',description:'Four hours with an attendant',hours:4,image_url:'',original_price:1000,discount_type:'PERCENT',discount_value:15};
const campaign=content=>({name:'QA',subject:'Our December offer',preview_text:'Celebrate together',content_json:campaignContent({format:'TEXT',text_body:'Hi {{contact.first_name}},\nAn offer for {{company.name}}.',mailing_address:'Synthetic QA address',offers:[offer],...content})});
const render=(content,recipient={first_name:'Jordan',company:'Northstar'})=>renderCampaignEmail(campaign(content),recipient,{test:true,origin:'https://stagingadmin.thelolabooth.com',token:'testtoken'});
test('percent and amount discounts use rounded cents and preserve original price',()=>{
 assert.deepEqual(campaignOfferPrice(offer),{original:1000,discounted:850,saving:150});
 assert.deepEqual(campaignOfferPrice({...offer,original_price:999.99,discount_type:'AMOUNT',discount_value:25.25}),{original:999.99,discounted:974.74,saving:25.25});
 assert.equal(campaignOfferPrice({...offer,original_price:0.1,discount_value:15}).discounted,.08);
});
test('text campaign includes message, offers, strike-through discount and CTA',()=>{
 const out=render();assert.match(out.html,/>Hi Jordan,/);assert.match(out.html,/<s[^>]+>\$1,000.00<\/s>/);assert.match(out.html,/>\$850.00<\/strong>/);assert.match(out.text,/\$1,000.00 → \$850.00/);assert.match(out.html,new RegExp('package=EXPERIENCE_'+eid));assert.match(out.html,/Unsubscribe from marketing/);assert.equal(out.subject,'Our December offer');
});
test('HTML campaign preserves tables/styles and places selected offers at merge slot',()=>{
 const out=render({format:'HTML',html_body:'<html><head><style>.gold{color:#986b20}</style></head><body><table><tr><td class="gold">Hi {{contact.first_name}}</td></tr></table>{{offers}}<a href="{{interest_url}}">Get offer</a></body></html>'});
 assert.match(out.html,/<style>\.gold/);assert.match(out.html,/class="gold">Hi Jordan/);assert.equal((out.html.match(/>360 Booth<\/h2>/g)||[]).length,1);assert.match(out.html,/href="https:\/\/stagingadmin.thelolabooth.com\/interest\/testtoken"/);assert.match(out.html,/Unsubscribe from marketing/);
});
test('HTML drops active content and event handlers, rejects embedded or local images',()=>{
 const out=render({format:'HTML',html_body:'<p onclick="alert(1)">Hello</p><script>alert(2)</script><form><input></form><a href="javascript:alert(3)">bad</a>'});
 assert.doesNotMatch(out.html,/<script|onclick=|<form|<input|javascript:/i);
 for(const src of ['data:image/png;base64,abc','http://localhost/photo.jpg','/local.jpg'])assert.throws(()=>render({format:'HTML',html_body:'<img src="'+src+'">'}),/HTTPS/);
});
test('unsupported HTML merge fields fail clearly and contact HTML is escaped',()=>{
 assert.throws(()=>render({format:'HTML',html_body:'{{secret.password}}'}),/Unsupported/);
 const out=render({format:'HTML',html_body:'<h1>{{contact.first_name}}</h1>'},{first_name:'<img onerror="x">'});assert.match(out.html,/&lt;img/);assert.doesNotMatch(out.html,/<img onerror/);
});
test('custom campaign without an experience offers general interest; selected experience uses stable key',()=>{
 assert.deepEqual(campaignInterestOptions({format:'TEXT',offers:[]}),[{key:'GENERAL',name:'Tell me more',price:null}]);
 assert.equal(campaignInterestOptions(campaign().content_json)[0].key,offer.key);assert.equal(campaignInterestOptions(campaign().content_json)[0].price,850);
 assert.equal(interestSchema.parse({package:offer.key,event_date:'2099-12-01',event_time:'18:30'}).package,offer.key);
});
test('server rejects discounts exceeding price or percentage limits and mismatched identity',()=>{
 for(const bad of [{discount_value:101},{discount_type:'AMOUNT',discount_value:1001},{key:'EXPERIENCE_'+randomUUID()}])assert.equal(campaignSchema.safeParse(campaign({offers:[{...offer,...bad}]})).success,false);
 assert.equal(campaignSchema.safeParse(campaign()).success,true);
});
const csv=data=>importCampaignContacts({filename:'contacts.csv',data:Buffer.from(data).toString('base64')});
test('CSV import preserves contact details, normalizes emails and deduplicates',()=>{
 const out=csv('Email,First Name,Last Name,Company,Phone,Marketing Consent\r\njordan@example.com,Jordan,Smith,"Northstar, Inc.",+15551234567,Yes\r\nJORDAN@example.com,Other,Name,Company,,No\r\nno-consent@example.com,Lee,,,,\r\n');
 assert.equal(out.total,2);assert.equal(out.duplicates,1);assert.equal(out.withoutConsent,2);assert.equal(out.recipients[0].company,'Northstar, Inc.');assert.equal(out.recipients[0].phone,'+15551234567');assert.equal(out.recipients[0].marketing_email_opt_in,false);
});
test('CSV import reports invalid row numbers and requires explicit consent',()=>{
 const out=csv('Email,Marketing Consent\nbad,Yes\nvalid@example.com,Maybe\nblank@example.com,\n');assert.deepEqual(out.errors.map(e=>e.row),[2,3]);assert.equal(out.recipients[0].marketing_email_opt_in,false);
 assert.throws(()=>csv('Email\na@example.com'),/Marketing Consent/);assert.throws(()=>csv('Email,Marketing Consent\n"unclosed,Yes'),/Unclosed/);
});
function workbook(sheet,shared=''){
 const files={'xl/workbook.xml':strToU8('<workbook><sheets><sheet name="Contacts" r:id="rId1"/></sheets></workbook>'),'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),'xl/worksheets/sheet1.xml':strToU8(sheet)};
 if(shared)files['xl/sharedStrings.xml']=strToU8(shared);
 return {filename:'contacts.xlsx',data:Buffer.from(zipSync(files)).toString('base64')};
}
test('Excel import reads shared and inline strings without treating phone as a number',()=>{
 const file=workbook('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Phone</t></is></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="inlineStr"><is><t>0015551234567</t></is></c><c r="C2" t="inlineStr"><is><t>Yes</t></is></c></row></sheetData></worksheet>','<sst><si><t>Email</t></si><si><t>Marketing Consent</t></si><si><t>jordan@example.com</t></si></sst>');
 const out=importCampaignContacts(file);assert.equal(out.total,1);assert.equal(out.recipients[0].phone,'0015551234567');assert.equal(out.recipients[0].marketing_email_opt_in,true);
});
test('Excel import rejects formula cells, XML entities, oversized files and unsupported formats',()=>{
 assert.throws(()=>importCampaignContacts(workbook('<worksheet><sheetData><row><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>')),/formulas/);
 assert.throws(()=>importCampaignContacts(workbook('<!DOCTYPE worksheet [<!ENTITY x "bad">]><worksheet/>')),/entities/);
 assert.throws(()=>importCampaignContacts({filename:'file.exe',data:'aGVsbG8='}),/xlsx or .csv|Choose/);
 assert.throws(()=>importCampaignContacts({filename:'contacts.csv',data:'a'.repeat(3000000)}),/2 MB/);
});
test('shipped Excel template is accepted and contains no example recipients',()=>{
 const file=fs.readFileSync(new URL('../public/campaigns/contact-import-template.xlsx',import.meta.url));const out=importCampaignContacts({filename:'template.xlsx',data:file.toString('base64')});assert.equal(out.total,0);assert.deepEqual(out.errors,[]);
});

test('package selection reads current catalog starting price and included hours',()=>{
 const p=campaignPackageOffer(offer,{id:randomUUID(),starting_price:'1099.00',included_hours:3,proposal_description:'Professional attendant and instant sharing'});
 assert.equal(p.original_price,1099);assert.equal(p.hours,3);assert.equal(p.description,'Professional attendant and instant sharing');
});

test('missing contact import body returns a validation error',()=>{assert.throws(()=>importCampaignContacts(null),e=>e.code==='INVALID_CONTACT_FILE');});

 test('HTML asset placeholders use configured images and retain escaping in HTML and text',()=>{
 const out=render({format:'HTML',images:{wedding_hero_url:'https://thelolabooth.com/wedding.jpg?a=1&b=2'},html_body:'<img src="{{assets.wedding_hero_url}}"><p>{{assets.wedding_hero_url}}</p>'});
 assert.match(out.html,/src="https:\/\/thelolabooth.com\/wedding.jpg\?a=1&amp;b=2"/);assert.match(out.text,/wedding.jpg/);assert.doesNotMatch(out.html,/\{\{assets/);
 for(const prefix of ['asset','images'])assert.match(render({format:'HTML',html_body:'<img src="{{'+prefix+'.hero}}">'}).html,/year-end-2026\/hero.jpg/);
 });
 test('missing and unsafe campaign image placeholders fail with actionable errors',()=>{
 assert.throws(()=>render({format:'HTML',html_body:'<img src="{{assets.wedding_hero_url}}">'}),e=>e.code==='MISSING_CAMPAIGN_ASSET'&&/Campaign images/.test(e.message));
 for(const url of ['http://example.com/image.jpg','https://localhost/image.jpg','https://user:pass@example.com/image.jpg','javascript:alert(1)'])assert.throws(()=>render({format:'HTML',images:{wedding_hero_url:url},html_body:'<img src="{{assets.wedding_hero_url}}">'}));
 assert.throws(()=>render({format:'HTML',html_body:'{{assets.constructor}}'}),e=>e.code==='MISSING_CAMPAIGN_ASSET');
 });
