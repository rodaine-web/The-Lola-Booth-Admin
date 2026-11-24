import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {coreCatalogueView} from '../shared/keepsakes-core-catalogue.js';

test('approved shop preserves the twelve-product catalogue and secure photo entry across desktop and mobile', {skip:process.env.KEEPSAKES_BROWSER_TEST!=='true',timeout:120000},async()=>{
 const vite=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(os.tmpdir(),'lola-core-shop-cache'),plugins:[react(),{
  name:'core-shop-qa',configureServer(server){server.middlewares.use(async(req,res,next)=>{
   if(!req.url?.startsWith('/shop'))return next();
   res.setHeader('Content-Type','text/html');
   res.end(await server.transformIndexHtml(req.url,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body><div id="root"></div><script type="module">import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route}from'react-router-dom';import Shop from'/src/pages/KeepsakesShop.jsx';createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Routes,null,React.createElement(Route,{path:'/shop/products/:productKey',element:React.createElement(Shop)}),React.createElement(Route,{path:'/shop/*',element:React.createElement(Shop)}),React.createElement(Route,{path:'/gallery/photo/:token',element:React.createElement('h1',null,'Authorized gallery resolver')}))));</script></body></html>`));
  });}
 }],server:{host:'127.0.0.1',port:0}});
 let browser;
 try{
  await vite.listen();const {chromium}=await import('playwright');browser=await chromium.launch();
  const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  const output=path.join(os.tmpdir(),'lola-core-shop-browser');await fs.mkdir(output,{recursive:true});
  for(const width of [1440,768,390,320]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/keepsakes/photos/link',r=>r.fulfill({json:{token:'synthetic-photo-session-token-123456789012345'}}));
   await page.route('**/api/keepsakes/photos/collection',r=>r.fulfill({json:{expiresAt:'2035-11-30',albums:[],assets:[]}}));
   await page.route('**/api/keepsakes/catalogue',r=>r.fulfill({json:{products:coreCatalogueView([{id:'qa-keychain',catalogue_key:'keychain',retail_cents:2499}])}}));
   await page.goto(origin+'/shop');await page.getByRole('heading',{name:/Turn Your/}).waitFor();await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.locator('.shop-product-strip>a').count(),12);
   await page.waitForFunction(()=>document.querySelectorAll('.shop-product-strip [data-preview-state="ready"]').length===12);
   assert.equal(await page.locator('.shop-collection').evaluateAll(cards=>cards.every(card=>card.querySelector('.shop-own-preview').getBoundingClientRect().bottom<=card.querySelector('.shop-own-preview+div').getBoundingClientRect().top+1)),true,'Collection text must stay outside its photograph');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(output,`home-${width}.png`),fullPage:true});
   await page.goto(origin+'/shop/collection');await page.getByRole('heading',{name:'Our Keepsake Collections'}).waitFor();
   await page.locator('.shop-product').filter({has:page.getByRole('heading',{name:'Photo Keychain',exact:true})}).getByText('$24.99',{exact:true}).waitFor();
   assert.equal(await page.locator('.shop-product').count(),12);
   assert.equal(await page.getByRole('heading',{name:/mug|coaster|calendar/i}).count(),0);
   await page.getByRole('link',{name:'Everyday Keepsakes',exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.shop-product').length===6);
   await page.getByRole('link',{name:'Photo Keychain',exact:true}).click();
   await page.getByRole('heading',{name:'Photo Keychain',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Add to cart',exact:true}).count(),0);
   await page.getByRole('link',{name:'Find My Photos',exact:true}).last().click();
   await page.getByLabel('Your secure Lola Booth photo link').fill('https://evil.example/gallery/photo/not-your-private-photo123');
   await page.getByRole('button',{name:'Find My Photos',exact:true}).click();await page.getByRole('alert').waitFor();
   await page.getByLabel('Your secure Lola Booth photo link').fill('https://staginggallery.thelolabooth.com/gallery/photo/synthetic-private-photo-link123456');
   await page.getByRole('button',{name:'Find My Photos',exact:true}).click();
   await page.getByRole('heading',{name:'Your Lola Memories'}).waitFor();
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser?.close();await vite.close();}
});
