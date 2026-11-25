import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';

test('Admin book mapping saves a draft and preserves readable catalogue controls on mobile',{skip:process.env.KEEPSAKES_BROWSER_TEST!=='true',timeout:90000},async()=>{
 const vite=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(os.tmpdir(),'lola-book-mapping-cache'),plugins:[react(),{name:'book-mapping-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url!=='/book-mapping-qa')return next();
  res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:16px;font-family:Arial,sans-serif}</style></head><body><main id="root" class="ka-admin"></main><script type="module">import React from'react';import{createRoot}from'react-dom/client';import Books from'/src/components/KeepsakesBooksAdmin.jsx';import'/src/styles/keepsakes-admin.css';createRoot(document.getElementById('root')).render(React.createElement(Books,{writable:true}));</script></body></html>`));
 });}}],server:{host:'127.0.0.1',port:0}});let browser;
 try{
  await vite.listen();const {chromium}=await import('playwright');browser=await chromium.launch();const origin='http://127.0.0.1:'+vite.httpServer.address().port;
  const output=path.join(os.tmpdir(),'lola-book-mapping-20261124');await fs.mkdir(output,{recursive:true});
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
   const variant={id:'mini',label:'Mini Softcover Photo Book',audience:'GUEST',provider:'GELATO',cover:'Softcover',retail_cents:3499,status:'DRAFT',specification:{}};
   await page.route('**/api/keepsakes-admin/books**',async route=>{
    const request=route.request();
    if(request.method()==='PUT'){const body=request.postDataJSON();writes.push(body);Object.assign(variant,{provider_product_id:body.providerProductId,provider_cost_cents:749,verified_at:'2026-11-25T00:00:00Z',specification:{size:'5.5×5.5',blockers:['Validate the final print proof before checkout.']}});return route.fulfill({json:{saved:true,checkoutEnabled:false,blockers:variant.specification.blockers}});}
    if(request.url().includes('/suppliers/'))return route.fulfill({json:{provider:'GELATO',readOnly:true,checkedAt:'2026-11-25T00:00:00Z',data:{productUid:'actual-catalogue-reference-'.repeat(10),supportedCountries:['US']}}});
    return route.fulfill({json:{credentials:{whcc:true,gelato:true},variants:[variant],drafts:[],workflow:'Final print proof required before checkout.'}});
   });
   await page.goto(origin+'/book-mapping-qa');await page.getByRole('heading',{name:'Photo Books & Albums'}).waitFor();
   await page.getByRole('button',{name:'Check GELATO catalogue'}).click();await page.getByText(/Read-only catalogue/).waitFor();
   await page.getByRole('button',{name:'Verify catalogue mapping'}).click();await page.getByLabel('Gelato product UID').fill('catalogue-reference-from-supplier');await page.getByLabel('Reason',{exact:true}).fill('Confirm supported US book catalogue mapping.');
   await page.getByRole('button',{name:'Check and save draft mapping'}).click();await page.getByRole('status').filter({hasText:'saved as a draft'}).waitFor();
   assert.deepEqual(writes,[{providerProductId:'catalogue-reference-from-supplier',reason:'Confirm supported US book catalogue mapping.',pageCount:28}]);
   await page.getByText(/Provider cost \$7.49/).waitFor();assert.equal(await page.getByRole('button',{name:/activate|enable checkout|submit order/i}).count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
   await page.screenshot({path:path.join(output,`mapping-${width}.png`),fullPage:true});await page.close();
  }
 }finally{await browser?.close();await vite.close();}
});
