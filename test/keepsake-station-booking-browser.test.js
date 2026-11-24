import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {DEFAULT_STATION_POLICY,quoteCelebrationStation} from '../shared/keepsake-station-policy.js';
import {KEEPSAKES_CORE_PRODUCTS} from '../shared/keepsakes-core-catalogue.js';
test('Step 4 station configuration shares allowance, enforces minimum, and prices optional products independently',{skip:process.env.KEEPSAKES_BROWSER_TEST!=='true',timeout:120000},async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../public/staging-site/',import.meta.url)),server:{host:'127.0.0.1',port:0}});let browser;
 try{await vite.listen();const {chromium}=await import('playwright');browser=await chromium.launch();const origin='http://127.0.0.1:'+vite.httpServer.address().port;
 const policy={...DEFAULT_STATION_POLICY,status:'PUBLISHED'},products=KEEPSAKES_CORE_PRODUCTS.filter(p=>p.stationEligible),catalog={experiences:[{id:'glam',key:'glam',name:'The Lola Glam'},{id:'360',key:'360',name:'The Lola 360'},{id:'vogue',key:'vogue',name:'The Lola Vogue'}],packages:[{id:'signature',experience_id:'glam',name:'Signature',tier_key:'SIGNATURE',starting_price:899},{id:'essential',experience_id:'vogue',name:'Essential',tier_key:'ESSENTIAL',starting_price:699},{id:'video',experience_id:'360',name:'Luxe',tier_key:'LUXE',starting_price:899}],addons:[],keepsakeStation:{...policy,pricingPublished:true,experiences:['glam','mirror','vogue'],products}};
 const output=new URL('../artifacts/keepsake-station-booking-20261123/',import.meta.url);await fs.mkdir(output,{recursive:true});
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Booking page error:',e.message);});await page.route('https://**',r=>r.abort());
  await page.route('**/config.js',r=>r.fulfill({contentType:'application/javascript',body:'window.LOLA_CONFIG='+JSON.stringify({apiBase:origin,environment:'staging',cmsChannel:'STAGING',formsEnabled:true})}));
  await page.route('**/api/public/booking-catalog*',r=>r.fulfill({json:catalog}));
  await page.route('**/api/public/keepsake-station/preview',r=>{const input=r.request().postDataJSON();const quote=quoteCelebrationStation({...input.keepsakeStation,selections:input.selections.map(s=>({experience:s.experienceId,tier:catalog.packages.find(p=>p.id===s.packageId).tier_key}))},policy);return r.fulfill({json:{quote,pricingReady:true,requestOnly:false}});});
  await page.goto(origin+'/availability.html');await page.locator('[data-experience="glam"]').check();await page.locator('[data-experience-package="glam"]').selectOption('signature');await page.locator('[data-station-enable]').check();
  assert.equal(await page.locator('.station-product').count(),6);assert.equal(await page.locator('.station-product').first().evaluate(el=>getComputedStyle(el).display),'grid');assert.equal(await page.locator('[data-station-free]').count(),2);
  await page.getByLabel('Photo Keychain quantity',{exact:true}).fill('20');await page.getByLabel('Photo Magnet quantity',{exact:true}).fill('20');await page.locator('[data-station-minimum]').getByText('10 more paid keychains or magnets required',{exact:true}).waitFor();
  await page.getByLabel('Photo Keychain quantity',{exact:true}).fill('25');await page.getByLabel('Photo Magnet quantity',{exact:true}).fill('25');
  await page.locator('[data-booking-summary]').getByRole('heading',{name:'$1,672.50',exact:true}).waitFor();
  await page.getByLabel('Framed Photos quantity',{exact:true}).fill('5');await page.getByLabel('Photo Prints in Jackets quantity',{exact:true}).fill('10');await page.getByLabel('Simple Acrylic Photo Display quantity',{exact:true}).fill('5');await page.getByLabel('Personalized Postcards quantity',{exact:true}).fill('10');
  await page.locator('[data-booking-summary]').getByRole('heading',{name:'$2,092.20',exact:true}).waitFor();
  assert.equal(await page.locator('[data-station-unit="framed-photo"]').textContent(),'$29.99 per unit · $149.95 total');assert.equal(await page.locator('[data-station-unit="jacketed-print"]').textContent(),'$7.99 per unit · $79.90 total');
  await page.locator('[data-experience="vogue"]').check();await page.locator('[data-experience-package="vogue"]').selectOption('essential');
  await page.locator('[data-booking-summary]').getByRole('heading',{name:'$2,791.20',exact:true}).waitFor();assert.equal(await page.locator('[data-station-enable]').count(),1);assert.equal(await page.locator('[data-station-free]').count(),2);assert.ok((await page.locator('.station-config').innerText()).includes('one event-wide allowance'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:fileURLToPath(new URL(`booking-${width}.png`,output)),fullPage:true});
  page.once('dialog',d=>d.accept());await page.locator('[data-station-enable]').uncheck();assert.equal(await page.locator('.station-config').count(),0);
  await page.locator('[data-experience="glam"]').uncheck();await page.locator('[data-experience="vogue"]').uncheck();await page.locator('[data-experience="360"]').check();await page.locator('[data-experience-package="360"]').selectOption('video');assert.equal(await page.locator('.booking-keepsake-station').isVisible(),false);
  assert.deepEqual(errors,[]);await page.close();
 }
 }finally{await browser?.close();await vite.close();}
});
