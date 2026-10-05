import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {load} from 'cheerio';
const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
test('customer document scripts can execute under the deployed self-only CSP',()=>{
 const policy=config.headers.find(x=>x.source==='/(.*)').headers.find(x=>x.key==='Content-Security-Policy').value;
 assert.match(policy,/script-src 'self';/);
 for(const page of ['pay.html','proposal.html']) {
  const $=load(fs.readFileSync('public/staging-site/'+page,'utf8'));
  $('script').each((_,element)=>{
   const src=$(element).attr('src');assert.ok(src,`${page} has a CSP-blocked inline script`);
   const route=config.rewrites.find(r=>r.source===src&&r.has?.some(c=>c.value==='staging.thelolabooth.com'));
   assert.ok(route,`${src} has no staging website route`);
   assert.ok(fs.existsSync('public'+route.destination),`${src} is missing from the deployment`);
  });
 }
});
test('recorded deposit return preserves controls across status refresh and offers receipt and balance',async()=>{
 const elements=new Map();const make=()=>({style:{},hidden:false,children:[],querySelector:()=>({}),append(...nodes){this.children.push(...nodes)},after(node){elements.set(node.id,node)},replaceChildren(){this.children=[]}});
 const document={getElementById(id){if(!elements.has(id))elements.set(id,make());return elements.get(id)},createElement:make,querySelectorAll:()=>[]};
 const payload={invoice:{invoice_number:'QA',total:1099,currency:'USD'},paymentOptions:{amountDue:0,fullAmount:769.3,minimumAmount:0,providers:[],payable:true,allowPayInFull:true},checkoutConfirmation:{status:'RECORDED',amount:329.7,paymentId:'qa-payment'}};
 let calls=0;
 const context={window:{LOLA_CONFIG:{apiBase:'https://stagingapi.thelolabooth.com'}},location:{search:'?token=qa-token&payment=success',pathname:'/pay/qa-token'},document,URLSearchParams,Intl,fetch:async()=>{calls++;return {ok:true,json:async()=>payload}}};
 vm.runInNewContext(fs.readFileSync('public/staging-site/payment-viewer.js','utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 const card=elements.get('confirmationCard');assert.ok(card);
 assert.match(card.children[0].textContent,/payment is recorded/);
 assert.match(card.children[1].textContent,/329.70.*769.30/);
 assert.equal(card.children.find(n=>n.textContent==='Download receipt').href,'https://stagingapi.thelolabooth.com/api/public/invoices/qa-token/receipts/qa-payment/pdf');
 assert.equal(card.children.find(n=>n.textContent==='Pay remaining balance').href,'/pay/qa-token');
 await card.children.find(n=>n.textContent==='Refresh status').onclick();
 assert.equal(calls,2);assert.equal(elements.get('paymentCard').hidden,true);
 assert.match(card.children[0].textContent,/payment is recorded/);
});
