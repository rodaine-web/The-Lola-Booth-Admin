import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {coreCatalogueView} from '../shared/keepsakes-core-catalogue.js';

test('built public bundles load without third-party stylesheets and show supplied examples',{skip:process.env.KEEPSAKES_BROWSER_TEST!=='true',timeout:60000},async()=>{
 const root=path.resolve('dist');await fs.access(path.join(root,'index.html'));
 const {chromium}=await import('playwright'),browser=await chromium.launch();
 const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg'};
 try{for(const [host,route]of [['staginggallery.thelolabooth.com','/'],['stagingshop.thelolabooth.com','/shop/collection']]){
  const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[],thirdParty=[];page.on('pageerror',e=>errors.push(e.message));
  // Every request is intercepted. This exercises built chunks locally, not hosted customer data.
  await page.route('**/*',async request=>{
   const url=new URL(request.request().url());
   if(url.pathname.endsWith('/api/keepsakes/catalogue'))return request.fulfill({json:{products:coreCatalogueView()}});
   if(url.pathname.endsWith('/api/public/staging/site'))return request.fulfill({json:{settings:{}}});
   if(url.pathname.includes('/api/'))return request.fulfill({status:401,json:{error:{message:'Synthetic public test'}}});
   if(url.hostname!==host){thirdParty.push(url.href);return request.abort();}
   let name=url.pathname.replace(/^\/customer-documents\//,'/');if(!path.extname(name))name='/index.html';
   const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep))return request.abort();
   try{return request.fulfill({body:await fs.readFile(file),contentType:types[path.extname(file)]||'application/octet-stream'});}catch{return request.fulfill({status:404,body:'Missing built fixture'});}
  });
  await page.goto('https://'+host+route);await page.getByRole('navigation',{name:'Footer navigation',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.getByRole('heading',{name:'Good people. Better photos.',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Home',exact:true}).count(),0);assert.deepEqual(thirdParty,[]);assert.deepEqual(errors,[]);
  if(host.startsWith('stagingshop')){
   const keychain=page.locator('[data-example-image$="/keychain.png"] img');await keychain.scrollIntoViewIfNeeded();await keychain.evaluate(image=>image.decode());assert.equal(await keychain.getAttribute('src'),'/brand/keepsakes-examples/keychain.png');
   await page.goto('https://'+host+'/shop/products/framed-photo');const example=page.locator('[data-example-image]');await example.waitFor();assert.match(await example.getAttribute('data-example-image'),/framed-strip-gold/);await page.getByRole('button',{name:'View another product example'}).click();assert.match(await example.getAttribute('data-example-image'),/framed-strip-silver/);
   await page.goto('https://'+host+'/shop/products/photo-book');await page.getByRole('img',{name:'Open album design example',exact:true}).waitFor();
  }
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
});
