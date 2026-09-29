import test from 'node:test';
import assert from 'node:assert/strict';
import {brandedEmailHtml,renderTemplate} from '../server/src/services/automation-service.js';
import {inquiryEventDate} from '../server/src/services/public-form-email-service.js';

test('invoice email keeps the document CTA and links payment to the LOLA page',()=>{
 const url='https://admin.thelolabooth.com/invoice/qa-token';
 const html=brandedEmailHtml('Your invoice is ready.',{ctaLabel:'View Your Invoice',ctaUrl:url,secondaryCta:{label:'Pay Invoice',url:`${url}#payment-options`}});
 assert.match(html,/href="https:\/\/admin\.thelolabooth\.com\/invoice\/qa-token"[^>]*>View Your Invoice/);
 assert.match(html,/href="https:\/\/admin\.thelolabooth\.com\/invoice\/qa-token#payment-options"[^>]*>Pay Invoice/);
 assert.doesNotMatch(html,/checkout\.stripe\.com|paypal\.com/);
 assert.doesNotMatch(brandedEmailHtml('A regular email'),/Pay Invoice|payment link/);
});

test('stored template newlines become real breaks without rewriting customer data',()=>{
 const text=renderTemplate('Name: {{client.name}}\\n\\nMessage: {{request.notes}}',{client:{name:'Alex'},request:{notes:'Keep literal \\n in my message'}});
 assert.equal(text,'Name: Alex\n\nMessage: Keep literal \\n in my message');
 const html=brandedEmailHtml(text,{firstName:'Alex'});
 assert.match(html,/Name: Alex<\/p><p/);
 assert.doesNotMatch(html,/\{\{First Name\}\}/);
});
test('email assets use the admin host rather than the public website',()=>{
 const old={public:process.env.PUBLIC_BASE_URL,client:process.env.CLIENT_ORIGIN,asset:process.env.EMAIL_ASSET_BASE_URL};
 try{process.env.PUBLIC_BASE_URL='https://thelolabooth.com';process.env.CLIENT_ORIGIN='https://admin.thelolabooth.com';delete process.env.EMAIL_ASSET_BASE_URL;
 const html=brandedEmailHtml('Hello <script>bad</script>');
 assert.match(html,/https:\/\/admin.thelolabooth.com\/brand\/LOLA_Primary_Dark_Transparent.png/);
 assert.doesNotMatch(html,/https:\/\/thelolabooth.com\/brand\//);
 assert.match(html,/Hi there,/);assert.match(html,/&lt;script&gt;/);
 }finally{for(const [key,value] of [['PUBLIC_BASE_URL',old.public],['CLIENT_ORIGIN',old.client],['EMAIL_ASSET_BASE_URL',old.asset]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test('event dates have human readable formatting without a timezone shift',()=>{
 assert.equal(inquiryEventDate(new Date('2027-12-16T00:00:00Z')),'December 16, 2027');
 assert.equal(inquiryEventDate('2027-12-16'),'December 16, 2027');
 assert.equal(inquiryEventDate(null),'TBD');
});


test('branded email uses one greeting while retaining the plain-text message',()=>{
 const body='Hi Mia,\n\nYour invoice is ready.\nLOLA Booths';
 const html=brandedEmailHtml(body);
 assert.equal((html.match(/Hi Mia,/g)||[]).length,1);
 assert.match(html,/Your invoice is ready/);
 assert.equal(body.startsWith('Hi Mia,'),true);
});
