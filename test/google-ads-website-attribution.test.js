import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {hasGoogleAdsAttribution} from '../shared/google-ads-attribution.js';
const app=fs.readFileSync(new URL('../public/staging-site/app.js',import.meta.url),'utf8');
const capture=app.slice(app.indexOf('  function captureAttribution()'),app.indexOf('\n  captureAttribution();'));
function fixture(search,store=new Map()){
 const context={URL,URLSearchParams,location:{search,origin:'https://website.invalid',pathname:'/packages',href:'https://website.invalid/packages'+search},document:{referrer:'https://search.invalid/?private=value'},sessionStorage:{setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k),removeItem:k=>store.delete(k)}};
 return {context,store,capture:()=>vm.runInNewContext(capture+';captureAttribution()',context)};
}
test('Google click identity survives website navigation and is replaced coherently by a later tagged visit',()=>{
 const f=fixture('?gclid=synthetic-google-click&utm_campaign=123');f.capture();
 assert.equal(f.store.get('lola_gclid'),'synthetic-google-click');assert.equal(f.store.get('lola_utm_source'),'google');assert.equal(f.store.get('lola_utm_medium'),'cpc');
 assert.equal(f.store.get('lola_referrer_url'),'https://search.invalid/');assert.equal(f.store.get('lola_landing_page_url'),'https://website.invalid/packages');
 f.context.location.search='';f.context.location.pathname='/availability';f.capture();assert.equal(f.store.get('lola_gclid'),'synthetic-google-click');
 f.context.location.search='?utm_source=instagram&utm_medium=social';f.capture();assert.equal(f.store.get('lola_gclid'),undefined);assert.equal(f.store.get('lola_utm_campaign'),undefined);assert.equal(f.store.get('lola_utm_source'),'instagram');
});
test('contact and quote payloads retain Google click IDs without sending visitors query strings as landing URLs',async()=>{
 const f=fixture('?wbraid=synthetic-ios-click&utm_campaign=123');f.capture();
 const form={dataset:{formKind:'CONTACT'},querySelector:()=>null};
 const data=new Map([['firstName','QA'],['lastName','User'],['email','qa@example.invalid'],['message','Quote request']]);data.getAll=()=>[];
 const formCode=app.slice(app.indexOf('  function formPayload(form)'),app.indexOf('\n  function showFieldErrors'));
 const payload=vm.runInNewContext(formCode+';formPayload(form)',{...f.context,form,FormData:function(){return data;},crypto:{randomUUID:()=> 'qa-submission'}});
 assert.equal(payload.wbraid,'synthetic-ios-click');assert.equal(payload.utm_campaign,'123');assert.equal(payload.landing_page_url,'https://website.invalid/packages');
 const booking=fs.readFileSync(new URL('../public/staging-site/booking.js',import.meta.url),'utf8');
 const start=booking.indexOf(" form.addEventListener('submit',"),end=booking.indexOf('\n window.addEventListener',start);
 let handler,posted;
 const bookingForm={dataset:{},reportValidity:()=>true,addEventListener:(_,fn)=>handler=fn};
 const status={focus(){}},button={textContent:'Submit'};
 vm.runInNewContext(booking.slice(start,end),{...f.context,window:{LOLA_CONFIG:{formsEnabled:true}},form:bookingForm,FormData:function(){return new Map();},el:s=>s.includes('status')?status:s.includes('submit')?button:{checked:false},catalog:{},chosen:new Map([['glam',{packageId:'qa-package'}]]),addons:new Map(),busy:false,ready:true,submissionId:'qa-id',base:'https://api.invalid',business:()=>false,submitLabel:()=> 'Submit',virtualDuration:'',fetch:async(_url,request)=>{posted=JSON.parse(request.body);return {ok:false,status:422,json:async()=>({error:{message:'Synthetic validation stop'}})};}});
 await handler({preventDefault(){}});assert.equal(posted.wbraid,'synthetic-ios-click');assert.equal(posted.utm_campaign,'123');
});
test('blocked storage does not crash attribution capture; organic Google is not labeled paid',()=>{
 const f=fixture('?gclid=synthetic');f.context.sessionStorage.setItem=()=>{throw Error('blocked')};assert.doesNotThrow(f.capture);
 assert.equal(hasGoogleAdsAttribution({utm_source:'google',utm_medium:'organic'}),false);
 assert.equal(hasGoogleAdsAttribution({utm_source:'google',utm_medium:'cpc'}),true);
 assert.equal(hasGoogleAdsAttribution({first_touch:{gbraid:'synthetic'}}),true);
});
