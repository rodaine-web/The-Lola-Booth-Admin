import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {pricingAddonDefaults,pricingPackageDefaults} from '../server/src/services/pricing-catalog-defaults.js';
import {coreCatalogueView} from '../shared/keepsakes-core-catalogue.js';

test('Website, Shop and all Gallery states share navigation and footer; package add-ons carry into booking',{skip:process.env.KEEPSAKES_BROWSER_TEST!=='true',timeout:120000},async()=>{
 const vite=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(os.tmpdir(),'lola-public-chrome-cache'),plugins:[react(),{name:'public-chrome-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(!['/','/gallery','/gallery/photo/synthetic-photo-token','/shop','/find-photos'].includes(req.url?.split('?')[0]))return next();
  res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module">import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route}from'react-router-dom';import Gallery from'/src/pages/GalleryHome.jsx';import Photos from'/src/pages/PublicGallery.jsx';import Shop from'/src/pages/KeepsakesShop.jsx';import'/src/styles/experience.css';createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Routes,null,React.createElement(Route,{path:'/gallery/:type/:token',element:React.createElement(Photos)}),React.createElement(Route,{path:'/gallery',element:React.createElement(Photos)}),React.createElement(Route,{path:'/shop',element:React.createElement(Shop)}),React.createElement(Route,{path:'*',element:React.createElement(Gallery)}))));</script></body></html>`));
 });}}],server:{host:'127.0.0.1',port:0}});let browser;
 try{
  await vite.listen();const origin='http://127.0.0.1:'+vite.httpServer.address().port,{chromium}=await import('playwright');browser=await chromium.launch();const out=path.join(os.tmpdir(),'lola-public-chrome-20261124');await fs.mkdir(out,{recursive:true});
  const settings={contact_email:'info@thelolabooth.com',phone:'(773) 240-2744',service_area:'Chicago & surrounding areas',copyright_text:'© 2026 The LOLA Booth. All rights reserved.',instagram_url:'https://instagram.com/thelolabooth',tiktok_url:'https://tiktok.com/@thelolabooth'};
  const packages=pricingPackageDefaults().map((p,i)=>({...p,id:'package-'+i,experience_id:p.pricing_profile.experience})),addons=pricingAddonDefaults().map((a,i)=>({...a,id:'addon-'+i})),catalog={id:'synthetic-version',pricingVersion:'synthetic-version',packages,addons,experiences:['glam','mirror','360','vogue','audio'].map(key=>({id:key,key,name:'The Lola '+key}))};
  for(const width of [1440,768,390,320]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{const url=new URL(route.request().url()),p=url.pathname;
    if(p.includes('/api/public/pricing-catalog')||p.includes('/api/public/booking-catalog'))return route.fulfill({json:catalog});
    if(p.endsWith('/api/public/staging/site'))return route.fulfill({json:{channel:'STAGING',cmsAuthoritative:true,settings,packages:[],experiences:[]}});
    if(p.endsWith('/api/keepsakes/catalogue'))return route.fulfill({json:{products:coreCatalogueView(),branding:settings}});
    if(p.includes('/api/gallery/access/'))return route.fulfill({json:{title:'Synthetic approved gallery',type:'ALBUM',media:[],allowDownload:false}});
    if(p.includes('/api/keepsakes/access/'))return route.fulfill({json:{enabled:false}});
    if(url.origin!==origin)return route.abort();return route.continue();
   });
   let footer,nav;
   for(const [slug,url]of [['website','/staging-site/packages.html'],['shop','/shop'],['gallery','/'],['gallery-code','/gallery'],['gallery-photos','/gallery/photo/synthetic-photo-token'],['legal','/staging-site/privacy.html'],['connect','/staging-site/connect.html']]){
    await page.goto(origin+url);await page.getByRole('navigation',{name:'Footer navigation',exact:true}).waitFor();
    const header=page.locator(['website','legal','connect'].includes(slug)?'.design-header':'.lola-site-header'),footerNode=page.locator(['website','legal','connect'].includes(slug)?'.design-footer':'.lola-site-footer');
    assert.equal(await page.getByRole('link',{name:'Home',exact:true}).count(),0);
    const footerLinks=await footerNode.locator('nav[aria-label="Footer navigation"] a').allTextContents(),headerLinks=await header.locator(['website','legal','connect'].includes(slug)?'.navlinks a':'.lola-site-links a').allTextContents();
    if(slug==='website'){
     await page.locator('[data-celebration-addon]').first().waitFor();nav=headerLinks;footer=footerLinks;
     assert.ok(await page.locator('.package-addon-card').count()>3);await page.locator('[data-celebration-addon="addon-4"]').check();
     const href=await page.locator('[data-package-key="glam:essential"] .btn').getAttribute('href');assert.equal(new URL(href,origin).searchParams.get('addons'),'addon-4');
     await page.goto(new URL(href,origin+'/staging-site/').href);await page.locator('[data-addon="addon-4"]').waitFor();assert.equal(await page.locator('[data-addon="addon-4"]').isChecked(),true,'Selected package add-ons must remain selected in booking');
     await page.goto(origin+'/staging-site/packages.html');await page.locator('[data-celebration-addon]').first().waitFor();
     await page.locator('[data-package-experience="360"]').click();assert.equal(await page.getByRole('heading',{name:'Extra Glam hour',exact:true}).count(),0);await page.getByRole('heading',{name:'Extra 360 hour',exact:true}).waitFor();
     const keepsakesTop=await page.locator('.keepsakes-package-offers').evaluate(n=>n.getBoundingClientRect().top),addonsTop=await page.locator('.package-addons').evaluate(n=>n.getBoundingClientRect().top);assert.ok(keepsakesTop<addonsTop,'Keepsakes must appear above add-ons');const imageSize=await page.locator('.package-addon-card img').first().evaluate(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}));assert.ok(imageSize.width<=72&&imageSize.height<=72,'Add-on displays must be compact');
     await page.locator('[data-package-audience="BUSINESS"]').click();await page.locator('[data-business-addon]').first().waitFor();assert.equal(await page.locator('[data-business-addon]:enabled').count(),0,'Browse business add-ons before choosing an experience');await page.locator('[data-business-experience="glam"]').check();await page.locator('[data-business-addon="addon-4"]').check();assert.equal(new URL(await page.locator('[data-business-quote]').getAttribute('href'),origin).searchParams.get('addons'),'addon-4');assert.doesNotMatch(await page.locator('[data-business-addons]').innerText(),/\$/);assert.ok(await page.locator('.keepsakes-package-offers').evaluate(n=>n.getBoundingClientRect().top)<await page.locator('[data-business-addons]').evaluate(n=>n.getBoundingClientRect().top));await page.locator('[data-package-audience="INDIVIDUAL"]').click();
    }else{assert.deepEqual(headerLinks,slug==='shop'?nav.filter(label=>label!=='Gallery'):nav);assert.deepEqual(footerLinks,footer);if(slug==='shop')assert.equal(await page.getByRole('navigation',{name:'Keepsakes navigation'}).getByRole('link',{name:/^(Gallery|For Event Clients)$/}).count(),0);}
    assert.equal(await footerNode.locator('a[href="mailto:info@thelolabooth.com"]').count(),1);
    assert.match(await footerNode.innerText(),/Service area: Chicago & surrounding areas/);
    await page.getByRole('heading',{name:'Good people. Better photos.',exact:true}).waitFor();
    if(width<=1100){await header.getByRole('button',{name:'Open navigation',exact:true}).click();const mobile=header.getByRole('navigation',{name:'Mobile navigation',exact:true});await mobile.waitFor();assert.equal(await mobile.getByRole('link',{name:'Shop',exact:true}).count(),1);if(['website','legal','connect'].includes(slug))await header.getByRole('button',{name:'Open navigation',exact:true}).click();else await header.getByRole('button',{name:'Close navigation',exact:true}).click();}
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),slug+' must fit '+width+' '+JSON.stringify(await page.locator('body *').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(n).position!=='absolute').slice(0,8).map(n=>({tag:n.tagName,cls:n.className,width:n.getBoundingClientRect().width})))));
    if(['website','gallery','gallery-code','legal','connect'].includes(slug))await page.screenshot({path:path.join(out,`${slug}-${width}.png`),fullPage:true});
   }
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser?.close();await vite.close();}
});
