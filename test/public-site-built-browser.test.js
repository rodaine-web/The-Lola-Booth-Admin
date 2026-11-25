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
  if(host.startsWith('stagingshop')){assert.equal(await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Gallery',exact:true}).count(),0);const keepsakeMenu=page.getByRole('navigation',{name:'Keepsakes navigation',exact:true});assert.equal(await keepsakeMenu.getByRole('link',{name:/^(Gallery|For Event Clients)$/}).count(),0);await page.getByRole('button',{name:'Open navigation',exact:true}).click();assert.equal(await page.getByRole('navigation',{name:'Mobile navigation',exact:true}).getByRole('link',{name:'Gallery',exact:true}).count(),0);await page.getByRole('button',{name:'Close navigation',exact:true}).click();
   const keychain=page.locator('[data-example-image$="/keychain.png"] img');await keychain.scrollIntoViewIfNeeded();await keychain.evaluate(image=>image.decode());assert.equal(await keychain.getAttribute('src'),'/brand/keepsakes-examples/keychain.png');const geometry=await keychain.evaluate(image=>({imageHeight:image.getBoundingClientRect().height,previewHeight:image.parentElement.getBoundingClientRect().height,fit:getComputedStyle(image).objectFit}));assert.ok(geometry.imageHeight<=geometry.previewHeight+1,'The full product example must fit inside its preview');assert.equal(geometry.fit,'contain');
   for(const key of ['metal-print','postcard']){const image=page.locator('[data-example-image$="/'+key+'.png"] img');await image.scrollIntoViewIfNeeded();await image.evaluate(node=>node.decode());}
   await page.goto('https://'+host+'/shop');await page.getByRole('heading',{name:'The Complete Keepsake Collection',exact:true}).waitFor();const strip=page.locator('.shop-product-strip');await strip.scrollIntoViewIfNeeded();assert.equal(await strip.locator('a').count(),12);await page.waitForFunction(()=>document.querySelectorAll('.shop-product-strip [data-preview-state="ready"]').length===12);assert.equal(await strip.locator('.shop-preview-disclosure:visible').count(),0,'Thumbnail captions must not cover product images');for(const image of await strip.locator('img').all()){await image.scrollIntoViewIfNeeded();await image.evaluate(node=>node.decode());}assert.equal(await strip.locator('img').count(),7);await page.screenshot({path:'/private/tmp/lola-built-keepsakes-collection.jpg',fullPage:true});
   await page.goto('https://'+host+'/shop/products/framed-photo');const example=page.locator('[data-example-image]');await example.waitFor();assert.match(await example.getAttribute('data-example-image'),/framed-strip-gold/);await page.getByRole('button',{name:'View another product example'}).click();assert.match(await example.getAttribute('data-example-image'),/framed-strip-silver/);
   await page.goto('https://'+host+'/shop/products/photo-book');await page.getByRole('img',{name:'Open album design example',exact:true}).waitFor();
  }
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
});
