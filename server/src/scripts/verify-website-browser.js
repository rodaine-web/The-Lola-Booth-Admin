import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root=process.env.LOLA_WEBSITE_ROOT||'/private/tmp/lola-website-cms';
const manifest=JSON.parse(await fs.readFile('server/import-data/live-website.json','utf8'));
const payload=JSON.parse(await fs.readFile('audit-output/website-cms/local/public-site.json','utf8'));
const assetById=new Map(Object.entries(payload.content['website.media'].body).map(([asset,url])=>[url,asset]));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report=[];
try {
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport});
  let site=structuredClone(payload),offline=false;
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='api.thelolabooth.com'){
    if(offline)return route.abort();
    if(u.pathname==='/api/public/site')return route.fulfill({json:site});
    const asset=assetById.get(u.pathname);if(asset)return route.fulfill({path:path.join(root,asset)});
    return route.fulfill({status:404,body:'Not found'});
   }
   if(u.hostname!=='lola.test')return route.abort();
   let file=u.pathname==='/'?'index.html':u.pathname.slice(1);if(!path.extname(file))file+='.html';
   if(file.includes('..'))return route.abort();
   try{await route.fulfill({path:path.join(root,file),contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]});}catch{await route.fulfill({status:404,body:'Not found'});}
  });
  const page=await context.newPage();
  for(const slug of ['','packages','experiences','gallery','events','faq','about','contact','availability','connect','privacy','terms']){
   await page.goto('https://lola.test/'+slug);await page.waitForFunction(()=>document.documentElement.dataset.lolaCms==='connected');
   assert.equal(await page.title(),manifest.pages.find(p=>p.slug===(slug||'home')).title);
   const broken=await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>i.offsetParent!==null&&(!i.complete||i.naturalWidth===0)).map(i=>i.src));
   assert.deepEqual(broken,[],`${slug}: broken images`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${slug} overflows at ${viewport.width}`);
   if(!slug||slug==='packages'){
    const prices=await page.locator('[data-package-key]').evaluateAll(cards=>cards.map(c=>({key:c.dataset.packageKey,price:c.querySelector('.price')?.textContent||c.querySelector('.big-copy')?.textContent,hidden:c.hidden})));
    for(const p of prices){const expected=manifest.packages.find(x=>x.key===p.key);assert.equal(p.hidden,false);if(expected.pricing_mode==='CUSTOM')assert.ok(!/\$0/.test(p.price));else assert.ok(p.price.replaceAll(',','').includes(String(expected.starting_price)));}
    report.push({viewport:viewport.width,page:slug||'home',prices});
   }
   if(slug==='gallery'){
    await page.locator('[data-category-filter="wedding"]').click();assert.equal(await page.locator('.gallery-card:visible').count(),2);
    await page.locator('.gallery-card:visible').first().click();assert.equal(await page.locator('#gallery-lightbox').getAttribute('aria-hidden'),'false');await page.locator('.lightbox-close').click();
    await page.locator('[data-category-filter="all"]').click();await page.locator('[data-type-filter="video"]').click();assert.equal(await page.locator('.gallery-card:visible').count(),1);await page.locator('[data-type-filter="all"]').click();
   }
   if(slug==='events')assert.equal(await page.locator('.event-section:visible').count(),6);
   await page.screenshot({path:`audit-output/website-cms/local/${slug||'home'}-${viewport.width}.png`,fullPage:true});
  }
  site.packages.find(p=>p.website_key==='glam:essential').starting_price=625;
  for(const slug of ['','packages']){await page.goto('https://lola.test/'+slug);await page.waitForFunction(()=>document.documentElement.dataset.lolaCms==='connected');assert.ok((await page.locator('[data-package-key="glam:essential"] .price').textContent()).includes('625'));}
  site.packages=site.packages.filter(p=>p.website_key!=='glam:essential');site.faqs=[];
  await page.goto('https://lola.test/packages');await page.waitForFunction(()=>document.documentElement.dataset.lolaCms==='connected');assert.equal(await page.locator('[data-package-key="glam:essential"]').evaluate(n=>n.hidden),true);
  await page.goto('https://lola.test/faq');await page.waitForFunction(()=>document.documentElement.dataset.lolaCms==='connected');assert.equal(await page.locator('[data-cms-faqs] details').count(),0);
  offline=true;
  for(const slug of ['','packages']){await page.goto('https://lola.test/'+slug);await page.waitForFunction(()=>document.documentElement.dataset.lolaCms==='fallback');assert.ok((await page.locator('[data-package-key="glam:essential"] .price').textContent()).includes('599'));}
  await context.close();
 }
 await fs.writeFile('audit-output/website-cms/local/browser-report.json',JSON.stringify({passed:true,apiOverride:true,publishFiltering:true,offlineFallback:true,report},null,2));
 console.log('Desktop/mobile: 12 routes, all prices, API override, unpublish and offline fallback passed.');
}finally{await browser.close();}
