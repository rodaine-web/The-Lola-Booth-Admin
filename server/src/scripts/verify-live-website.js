import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const manifest=JSON.parse(await fs.readFile('server/import-data/live-website.json','utf8'));
const output='audit-output/website-cms/after';await fs.mkdir(output,{recursive:true});
const response=await fetch('https://api.thelolabooth.com/api/public/site',{cache:'no-store',signal:AbortSignal.timeout(30000)});
assert.equal(response.status,200);const site=await response.json();
assert.equal(site.packages.length,16);assert.equal(site.experiences.length,4);assert.equal(site.heroSlides.length,6);assert.equal(site.gallery.length,10);assert.equal(site.eventTypes.length,6);assert.equal(site.faqs.length,40);
for(const p of manifest.packages){const actual=site.packages.find(x=>x.website_key===p.key);assert.ok(actual,`Missing ${p.key}`);assert.equal(actual.starting_price,p.starting_price);assert.equal(actual.pricing_mode,p.pricing_mode);}
assert.equal(site.settings.phone,'773-240-2744');assert.equal(site.settings.contact_email,'info@thelolabooth.com');
await fs.writeFile(output+'/public-site.json',JSON.stringify(site,null,2));
const report={checkedAt:new Date().toISOString(),apiCache:response.headers.get('cache-control'),pages:[],screenshots:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 for(const viewport of [{width:1440,height:1000},{width:820,height:1180},{width:390,height:844}]){
  const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')console.log(m.type(),m.text().slice(0,300));});
  page.on('requestfailed',r=>console.log('REQUEST FAILED',r.url(),r.failure()?.errorText));
  for(const slug of ['','packages','experiences','gallery','events','faq','about','contact','availability','connect','privacy','terms']){
   console.log('CHECK',viewport.width,slug||'home');
   const r=await page.goto('https://thelolabooth.com/'+slug,{waitUntil:'domcontentloaded',timeout:60000});assert.equal(r.status(),200);
   await page.waitForFunction(()=>document.documentElement.dataset.lolaCms==='connected',null,{timeout:60000});
   assert.equal(await page.title(),manifest.pages.find(p=>p.slug===(slug||'home')).title);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${slug}: horizontal overflow`);
   await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.filter(i=>i.offsetParent!==null).map(i=>i.complete?Promise.resolve():new Promise(resolve=>{i.addEventListener('load',resolve,{once:true});i.addEventListener('error',resolve,{once:true});setTimeout(resolve,15000);})))) ;
   const broken=await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>i.offsetParent!==null&&(!i.complete||i.naturalWidth===0)).map(i=>i.src));assert.deepEqual(broken,[],`${slug}: broken images`);
   const prices=await page.locator('[data-package-key]').evaluateAll(cards=>cards.map(c=>({key:c.dataset.packageKey,price:c.querySelector('.price')?.textContent||c.querySelector('.big-copy')?.textContent})));
   for(const actual of prices){const expected=manifest.packages.find(p=>p.key===actual.key);if(expected.pricing_mode==='CUSTOM')assert.ok(!/\$0/.test(actual.price));else assert.ok(actual.price.replaceAll(',','').includes(String(expected.starting_price)));}
   if(slug==='packages')for(const e of manifest.experiences){await page.locator(`[data-experience-tab="${e.key}"]`).click();assert.equal(await page.locator(`[data-experience-panel="${e.key}"]`).isVisible(),true);assert.equal(await page.locator(`[data-experience-panel="${e.key}"] .pricing-card:visible`).count(),4);}
   if(slug==='experiences'){assert.equal(await page.locator('[data-experience-key]:visible').count(),4);const vogue=site.experiences.find(e=>/vogue/i.test(e.name));assert.ok((await page.locator('[data-experience-key="vogue"] img').getAttribute('src')).endsWith(vogue.image));}
   if(slug==='gallery'){await page.locator('[data-category-filter="wedding"]').click();assert.equal(await page.locator('.gallery-card:visible').count(),2);await page.locator('.gallery-card:visible').first().click();assert.equal(await page.locator('#gallery-lightbox').getAttribute('aria-hidden'),'false');await page.locator('.lightbox-close').click();await page.locator('[data-category-filter="all"]').click();}
   if(slug==='faq')assert.equal(await page.locator('[data-cms-faqs] details').count(),40);
   if(slug==='connect'){assert.equal(await page.locator('a[href="tel:+17732402744"]').count()>0,true);assert.equal(await page.locator('a[href="mailto:info@thelolabooth.com"]').count()>0,true);}
   report.pages.push({page:slug||'home',width:viewport.width,status:r.status(),cms:'connected',prices});
   if(['','packages','experiences','gallery','contact','availability','connect'].includes(slug)){const file=`${output}/${slug||'home'}-${viewport.width}.png`;await page.screenshot({path:file,fullPage:true});report.screenshots.push(file);}
  }
  assert.deepEqual(errors,[],`Uncaught page errors at width ${viewport.width}`);await context.close();
 }
 report.passed=true;await fs.writeFile(output+'/live-browser-report.json',JSON.stringify(report,null,2));console.log('LIVE PASS: 12 pages desktop/mobile, 16 prices, all tabs, images, gallery, 40 FAQs and /connect.');
}finally{await browser.close();}
