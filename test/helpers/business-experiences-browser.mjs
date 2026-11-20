import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export async function qualifyBusinessExperiences({origin,token,clientId,eventId}){
 const browser=await chromium.launch(),out=process.env.BUSINESS_QA_EVIDENCE_DIR||path.join(os.tmpdir(),'lola-business-redesign','screens');await fs.mkdir(out,{recursive:true});
 try{for(const width of [1440,768,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await page.goto(origin+'/staging-site/packages.html',{waitUntil:'domcontentloaded'});await page.locator('[data-design-packages] .package-card').first().waitFor();
  const celebration=await page.locator('[data-design-packages]').innerHTML();
  await page.locator('[data-package-audience="BUSINESS"]').click();
  const checks=page.locator('[data-business-experience]');await page.waitForFunction(()=>document.querySelectorAll('[data-business-experience]:enabled').length===5);assert.equal(await checks.count(),5);
  for(const key of ['glam','360','mirror','vogue','virtual'])await page.locator(`[data-business-experience="${key}"]`).check();
  assert.equal(await page.locator('[data-business-experience]:checked').count(),5);
  await page.getByLabel('Virtual Booth duration',{exact:true}).selectOption('MONTHLY');
  const addons=page.locator('[data-business-addon]');if(await addons.count())await addons.first().check();
  assert.doesNotMatch(await page.locator('[data-audience-view="BUSINESS"]').innerText(),/\$|Event Plus|Event Premium|starting price/i);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const panels=await page.locator('.business-benefits').evaluateAll(nodes=>nodes.map(n=>({top:n.getBoundingClientRect().top,cardTop:n.closest('.business-card').getBoundingClientRect().top})));
  for(const panel of panels)for(const peer of panels)if(Math.abs(panel.cardTop-peer.cardTop)<2)assert.ok(Math.abs(panel.top-peer.top)<2,'Benefit panels in the same card row must align');
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});return document.fonts.ready;});await page.screenshot({path:path.join(out,`business-${width}.png`),fullPage:true});
  const quote=page.locator('[data-business-quote]');const href=await quote.getAttribute('href');assert.equal(new URL(href,origin).searchParams.get('experiences').split(',').length,5);assert.equal(new URL(href,origin).searchParams.get('virtualDuration'),'MONTHLY');
  await quote.click();await page.waitForFunction(()=>document.querySelectorAll('[data-experience]:checked').length===5);
  assert.equal(await page.getByLabel('Virtual Booth duration',{exact:true}).inputValue(),'MONTHLY');assert.equal(await page.locator('[data-addon]:checked').count(),1);
  await page.getByLabel('Virtual Booth duration',{exact:true}).selectOption('WEEK');
  await page.getByLabel('First name',{exact:false}).fill('Synthetic');await page.getByLabel('Last name',{exact:false}).fill('Business');
  await page.locator('[name="email"]').fill(`browser-${width}@example.invalid`);await page.locator('[name="phone"]').fill('3125550100');
  // Use native form names so optional marketing labels do not affect the fixture.
  const values={eventName:'QA ONLY — browser business request',eventDate:'2038-12-10',eventStartTime:'10:00',eventEndTime:'16:00',guestCount:'150',venueName:'Synthetic venue',venueAddress:'100 Sample St',city:'Chicago',state:'IL',zip:'60601',company:'Synthetic company'};
  for(const [name,value]of Object.entries(values)){const field=page.locator(`[name="${name}"]`);if(await field.count()){if(await field.evaluate(n=>n.tagName)==='SELECT')await field.selectOption(value);else await field.fill(value);}}
  await page.locator('[name="eventType"]').selectOption('Corporate Event');
  const sent=page.waitForRequest(r=>r.url().endsWith('/api/public/inquiries')&&r.method()==='POST');await page.locator('[data-multi-booking] button[type="submit"]').click();
  const payload=(await sent).postDataJSON();assert.equal(payload.selections.length,5);assert.equal(payload.selections.find(x=>x.virtualDuration).virtualDuration,'WEEK');assert.equal(payload.addons.length,1);
  await page.getByText(/Your Quote Request Has Been Submitted!/).waitFor();
  await page.goto(origin+'/staging-site/packages.html',{waitUntil:'domcontentloaded'});await page.locator('[data-design-packages] .package-card').first().waitFor();assert.equal(await page.locator('[data-design-packages]').innerHTML(),celebration);
  assert.deepEqual(errors,[]);await page.close();
 }
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});await page.addInitScript(t=>localStorage.setItem('lola_access_token',t),token);await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin+'/content/pricing',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Pricing & catalog',exact:true}).waitFor();await page.getByLabel('Pricing catalog',{exact:true}).selectOption('VIRTUAL');await page.getByLabel('Show inactive packages').check();
  assert.equal(await page.locator('tr').filter({hasText:'Virtual Booth —'}).count(),4);await page.getByRole('button',{name:'Edit inclusions',exact:true}).first().click();
  await page.getByLabel('Participant/session allowance',{exact:true}).fill('250');await page.getByLabel('Active branded experiences',{exact:true}).fill('2');await page.getByLabel('Reason for change *',{exact:true}).fill('Synthetic browser scope persistence');await page.getByRole('button',{name:'Save package draft',exact:true}).click();await page.getByText('Package draft updated.',{exact:false}).waitFor();
  await page.getByRole('heading',{name:'Retail printing & postcards'}).waitFor();assert.equal(await page.locator('#retail-rates tbody tr').count(),6);await page.screenshot({path:path.join(out,`admin-${width}.png`),fullPage:true});
  await page.goto(origin+'/sales/proposals/new?clientId='+clientId+'&eventId='+eventId,{waitUntil:'domcontentloaded'});
  await page.getByText('Creating a proposal for QA ONLY — business redesign',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Continue to Services',exact:false}).click();
  await page.locator('.experience-card').filter({hasText:'The Lola Virtual Booth'}).click();
  await page.locator('.package-card').filter({hasText:'Virtual Booth — 24 Hours'}).click();
  const review=page.locator('#package-pricing-review');
  await review.getByLabel('Participant/session allowance',{exact:true}).fill('250');
  await review.getByLabel('Active branded experiences',{exact:true}).fill('2');
  await review.getByText(/Service total:.*\$349\.00/).waitFor();
  await page.getByRole('button',{name:'Existing business package',exact:true}).click();
  const duration=page.getByLabel('Business Virtual Booth duration',{exact:true});assert.notEqual(await duration.inputValue(),'');
  await duration.selectOption({label:'Monthly Subscription — $499.00/month + setup'});
  await page.locator('.experience-card[aria-pressed]').filter({hasText:/glam/i}).click();
  const monthlyId=await duration.inputValue();await page.getByLabel('Business plan',{exact:true}).selectOption('EVENT_PLUS');
  assert.equal(await duration.inputValue(),monthlyId,'Changing physical tiers must preserve the separately priced Virtual Booth selection');
  await page.screenshot({path:path.join(out,`proposal-virtual-${width}.png`),fullPage:true});await page.close();
 }
 console.log('Business browser QA: all five experiences, durations, compatible add-ons, real CRM submissions, unchanged Celebrations, Admin persistence and retail separation passed.');
 }finally{await browser.close();}
}
