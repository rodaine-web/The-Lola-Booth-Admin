import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../public/staging-site/google-tag.js',import.meta.url),'utf8');
function run(hostname='www.thelolabooth.com',pathname='/availability'){
 const handlers={},scripts=[],window={location:{hostname,pathname}};
 const document={addEventListener:(event,handler)=>handlers[event]=handler,createElement:()=>({}),head:{appendChild:script=>scripts.push(script)}};
 vm.runInNewContext(code,{window,document});return {window,handlers,scripts};
}
test('successful new inquiries emit one GA event and preserve the Ads destination without guest data',()=>{
 const {window}=run();
 for(let i=0;i<2;i++)window.lolaTrackLeadConversion({inquiryStatus:'CREATED_LEAD',email:'private@example.invalid'},'random-id');
 const events=window.dataLayer.filter(x=>x[0]==='event');assert.equal(events.length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(Array.from(events[0]))),['event','generate_lead',{send_to:'G-CJBCQ9FYL1',form_type:'quote_request'}]);
 assert.equal(events[1][2].send_to,'AW-18531982704/JcHYCPPztaYdEPC63oRF');
 assert.ok(!JSON.stringify(events).includes('private@example.invalid'));
});
test('only allowlisted selected experiences are measured without form contents',()=>{
 const {window,handlers}=run();
 handlers.change({target:{checked:true,dataset:{businessExperience:'virtual'},value:'private@example.invalid'}});
 handlers.change({target:{checked:false,dataset:{businessExperience:'glam'}}});
 handlers.change({target:{checked:true,dataset:{experience:'private@example.invalid'}}});
 handlers.click({target:{closest:()=>({dataset:{packageExperience:'glam'}})}});
 const events=window.dataLayer.filter(x=>x[0]==='event');
 assert.deepEqual(Array.from(events,x=>x[1]),['select_experience_virtual','select_experience_glam']);
 assert.ok(!JSON.stringify(events).includes('private@example.invalid'));
});
test('staging, private pages and unsuccessful submissions produce no analytics events',()=>{
 for(const host of ['localhost','staging.thelolabooth.com','admin.thelolabooth.com'])assert.equal(run(host).scripts.length,0);
 assert.equal(run('www.thelolabooth.com','/proposal/token').scripts.length,0);
 const {window}=run();
 for(const inquiryStatus of ['UPDATED_LEAD','DUPLICATE','REPLAYED',undefined])window.lolaTrackLeadConversion({inquiryStatus},'random-id');
 assert.equal(window.dataLayer.filter(x=>x[0]==='event').length,0);
});
