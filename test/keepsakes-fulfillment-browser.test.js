import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';

test('paid orders are actionable from Admin through production, packing and dispatch on desktop/mobile',{skip:process.env.KEEPSAKES_BROWSER_TEST!=='true',timeout:120000},async()=>{
 const vite=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(os.tmpdir(),'lola-fulfillment-ui-cache'),plugins:[react(),{name:'fulfillment-qa',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/fulfillment-qa'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:Arial;background:#f8f5ef}</style></head><body><div id="root"></div><script type="module">import React from'react';import{createRoot}from'react-dom/client';import{AuthProvider}from'/src/context/AuthContext.jsx';import Admin from'/src/pages/KeepsakesAdmin.jsx';createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement(Admin)));</script></body></html>`));});}}],server:{host:'127.0.0.1',port:0}});let browser;
 try{await vite.listen();const {chromium}=await import('playwright');browser=await chromium.launch();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],actions=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  const order={id:'12345678-1234-4234-8234-123456789012',status:'FULFILLING',paid_at:'2026-11-27',created_at:'2026-11-27',total_cents:1980,album_title:'Synthetic Keepsakes Event'};
  const job={id:'job-test',order_id:order.id,status:'AWAITING_PRODUCTION',provider:'IN_HOUSE',shippo:true,artwork:[{}],tracking:[],shippingAddress:{name:'Synthetic Guest',address1:'965 Mission St',city:'San Francisco',state:'CA',zip:'94103'},item:{units:1,product:{title:'Photo Keychain'},variant:{label:'2 × 2 in'}}};
  await page.route(url=>url.pathname.startsWith('/api/'),async route=>{const req=route.request(),p=new URL(req.url()).pathname;let body;
   if(p.endsWith('/auth/me'))body={user:{id:'test-admin',roles:['ADMIN'],permissions:['read:finance','write:operations']}};
   else if(p==='/api/keepsakes-admin/production')body={jobs:[job]};
   else if(p.endsWith('/production/job-test/progress')){const input=req.postDataJSON();actions.push(input);job.status={APPROVE_PRODUCTION:'IN_PRODUCTION',FULFILLED:'FULFILLED',SHIPPED:'SHIPPED'}[input.action];order.status=input.action==='SHIPPED'?'SHIPPED':'FULFILLING';if(input.action==='SHIPPED')job.tracking=[{carrier:'USPS',trackingNumber:'TEST123'}];body={saved:true,status:job.status};}
   else if(p.endsWith('/orders/'+order.id))body={order,contact:{email:'qa@example.invalid'},fulfillments:[job],events:[],emails:[{id:'mail-test',subject:'Your Lola Keepsakes order confirmation',status:'SENT_TO_PROVIDER'}],notificationPolicy:{emailAllowed:true}};
   else if(p==='/api/keepsakes-admin')body={orders:[{...order,fulfillments:[job]},{id:'unpaid-checkout',status:'AWAITING_PAYMENT',created_at:'2026-11-27',total_cents:1299,fulfillments:[]}],metrics:{awaiting:job.status==='SHIPPED'?0:1},byEvent:[],byProduct:[]};
   else throw Error('Unexpected fulfillment UI request '+p);
   return route.fulfill({json:body});
  });
  await page.goto(origin+'/fulfillment-qa');await page.getByRole('heading',{name:'Pending fulfillment',exact:true}).waitFor();
  await page.getByRole('button',{name:'View pending orders',exact:true}).click();await page.getByRole('button',{name:'View order',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'View order',exact:true}).count(),1,'Unpaid checkout is excluded from pending fulfillment');
  await page.getByRole('button',{name:'View order',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'In-house production',exact:true,level:2}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Mark fulfilled / ready to ship',exact:true}).count(),0);
  await dialog.getByRole('checkbox',{name:'I reviewed the artwork, checked its fit for the current supplies, and confirmed stock and production capacity.',exact:true}).check();await dialog.getByRole('button',{name:'Approve production',exact:true}).click();await dialog.getByRole('button',{name:'Mark fulfilled / ready to ship',exact:true}).click();await dialog.getByRole('button',{name:'Mark shipped',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Mark shipped',exact:true}).click();await dialog.getByText('Delivery is confirmed automatically from Shippo tracking.',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Confirm delivered',exact:true}).count(),0,'Shippo delivery cannot be fabricated manually');
  assert.deepEqual(actions.map(a=>a.action),['APPROVE_PRODUCTION','FULFILLED','SHIPPED']);assert.equal(actions[0].proofReviewed,true);assert.equal(actions[0].stockAndCapacityConfirmed,true);
  await dialog.getByRole('heading',{name:'Customer emails',exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Request refund',exact:true}).count(),0,'Operations permission does not grant finance actions');
  await page.screenshot({path:path.join(os.tmpdir(),`lola-fulfillment-order-${width}.png`),fullPage:false});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.close();
 }
 }finally{await browser?.close();await vite.close();}
});
