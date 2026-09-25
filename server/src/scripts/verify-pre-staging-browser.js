import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {env} from '../config/env.js';
export async function verifyPreStagingBrowser({base,owner,token,db,call}) {
 const out='audit-output/admin-pre-staging-review';await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const report={sales:[],settings:[],cms:[],responsive:[],accessibility:[],failures:[]};
 const originalFetch=globalThis.fetch,oldStripe=env.stripeSecretKey,oldWebhook=env.stripeWebhookSecret;
 let session,checkoutCalls=0;
 env.publicInquiryAllowedOrigins=[base];env.stripeSecretKey='sk_test_local_browser';env.stripeWebhookSecret='whsec_local_browser';
 // Disposable fixture configuration only; every business transition below uses UI.
 await db.query('UPDATE business_settings SET stripe_enabled=true');
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.stripe.com/v1/checkout/sessions'){
   checkoutCalls++;session={id:'cs_test_full_browser',invoiceId:options.body.get('metadata[invoice_id]'),amount:Number(options.body.get('line_items[0][price_data][unit_amount]'))};
   return new Response(JSON.stringify({id:session.id,url:'https://checkout.stripe.com/c/pay/local-browser'}),{status:200});
  }
  if(!String(url).startsWith(base))throw new Error('External provider request blocked');return originalFetch(url,options);
 };
 async function contextFor(width=1440){
  const context=await browser.newContext({viewport:{width,height:1000},timezoneId:'America/Chicago'});await context.addInitScript(t=>localStorage.setItem('lola_access_token',t),token(owner.id));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='checkout.stripe.com')return route.fulfill({contentType:'text/html',body:'<h1>Local mock checkout</h1><form method="post" action="/mock-confirm"><button>Confirm test payment</button></form>'});
   if(url.origin!==base)return route.abort();
   if(url.pathname.startsWith('/api/'))return route.continue();
   let file;
   if(url.pathname.startsWith('/fixture/')){
    const relative=url.pathname.slice('/fixture/'.length);
    if(relative==='config.js')return route.fulfill({contentType:'application/javascript',body:`window.LOLA_API_BASE=${JSON.stringify(base)};window.LOLA_CONFIG={apiBase:window.LOLA_API_BASE};`});
    file=path.join('audit-output/website-cms/before',relative);
   }else file=path.join('dist',url.pathname);
   try{if(!(await fs.stat(file)).isFile())file='dist/index.html';}catch{file='dist/index.html';}
   return route.fulfill({path:file,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]});
  });return context;
 }
 let context,page;
 async function snapshot(name){await page.screenshot({path:`${out}/${name}.png`,fullPage:true});}
 const clickResponse=async(name,suffix,method='POST')=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(suffix)&&r.request().method()===method);await page.getByRole('button',{name,exact:true}).click({clickCount:2});const r=await response;assert.ok(r.ok(),name+': '+await r.text());return r.json();};
 try{
  context=await contextFor();page=await context.newPage();page.setDefaultTimeout(12000);
  await page.goto(base+'/fixture/contact.html');
  for(const [name,value] of Object.entries({firstName:'Avery',lastName:'Browser',email:'avery-browser@example.invalid',phone:'3125550100',eventDate:'2027-12-16',city:'Chicago',state:'IL',message:'Synthetic continuous browser journey.'}))await page.locator(`[name="${name}"]`).fill(value);
  await page.locator('[name=eventType]').selectOption({index:1});
  const inquiry=page.waitForResponse(r=>r.url().endsWith('/api/public/inquiries')&&r.request().method()==='POST');await page.getByRole('button',{name:'Send Inquiry'}).click();assert.equal((await inquiry).status(),201);
  const lead=(await db.query("SELECT * FROM leads WHERE email='avery-browser@example.invalid'")).rows[0];assert.ok(lead);report.sales.push('Inquiry submitted through locally served archived website form; lead persisted');
  await page.goto(base+'/sales/leads');await page.getByLabel('Search leads').fill('avery-browser');await page.getByRole('row').filter({hasText:'avery-browser@example.invalid'}).click();
  await page.getByRole('combobox',{name:'Lead owner',exact:true}).selectOption(owner.id);
  await page.getByText('Lead details saved.',{exact:true}).waitFor();
  const packageId=(await db.query('SELECT id FROM packages WHERE active=true LIMIT 1')).rows[0].id;
  await page.getByRole('combobox',{name:'Preferred package',exact:true}).selectOption(packageId);await page.waitForLoadState('networkidle');
  assert.equal((await db.query('SELECT assigned_user_id FROM leads WHERE id=$1',[lead.id])).rows[0].assigned_user_id,owner.id);
  await page.getByRole('button',{name:'Convert to Booking',exact:true}).click();
  await snapshot('sales-conversion-review');
  const converted=await clickResponse('Confirm Conversion','/convert');await page.waitForURL(/\/events\/events\//);
  assert.ok(converted.client.id&&converted.event.id);report.sales.push('Lead owner/package saved, conversion creates related client and event through browser');
  await page.goto(base+'/sales/clients/'+converted.client.id);await page.locator('main h1').waitFor();
  await page.goto(base+`/sales/proposals/new?leadId=${lead.id}&clientId=${converted.client.id}&eventId=${converted.event.id}`);
  await page.getByLabel('Proposal title',{exact:true}).fill('Avery winter celebration');
  await page.getByLabel('Package amount',{exact:true}).fill('250');
  await page.getByLabel('Expiration date').fill('2027-12-31');
  await snapshot('proposal-builder-1440');
  const proposal=await clickResponse('Create Proposal','/api/proposals');await page.waitForURL(/\/sales\/proposals\/[a-f0-9-]+$/);
  await page.getByText('Proposal preview',{exact:true}).first().waitFor();await clickResponse('Send','/send');
  assert.ok((await db.query("SELECT id FROM communications WHERE proposal_id=$1 AND status='SENT_TO_PROVIDER'",[proposal.id])).rowCount);
  const publicLink=await page.getByRole('link',{name:'Public proposal',exact:true}).getAttribute('href');await page.goto(publicLink);
  await page.getByLabel('Your full name').fill('Avery Browser');await clickResponse('Accept','/accept');
  assert.equal((await db.query('SELECT status FROM proposals WHERE id=$1',[proposal.id])).rows[0].status,'ACCEPTED');report.sales.push('Proposal created, PDF preview loaded, development email sent, public proposal accepted through browser');
  await page.goto(base+`/finance/invoices/new?proposalId=${proposal.id}`);const invoice=await clickResponse('Create Invoice','/api/invoices');await page.waitForURL(/\/finance\/invoices\/[a-f0-9-]+$/);
  await clickResponse('Send','/send');assert.ok((await db.query("SELECT id FROM communications WHERE invoice_id=$1 AND status='SENT_TO_PROVIDER'",[invoice.id])).rowCount);
  const payLink=await page.getByRole('link',{name:'Open payment page'}).getAttribute('href');await page.goto(payLink);
  assert.equal(await page.getByRole('button',{name:/paypal/i}).count(),0);await snapshot('payment-page-1440');
  const payResponse=page.waitForResponse(r=>r.url().includes('/payment-session'));await page.getByRole('button',{name:'Card / wallet checkout'}).click({clickCount:2});assert.equal((await payResponse).status(),201);await page.waitForURL('https://checkout.stripe.com/**');
  // Provider simulator emits the signed webhook only after the browser confirms.
  await context.route('https://checkout.stripe.com/mock-confirm',async route=>{
   const raw=Buffer.from(JSON.stringify({id:'evt_full_browser',type:'checkout.session.completed',livemode:false,data:{object:{id:session.id,payment_intent:'pi_full_browser',payment_status:'paid',metadata:{invoice_id:invoice.id},amount_total:session.amount,currency:'usd'}}}));
   const time=Math.floor(Date.now()/1000),signature=crypto.createHmac('sha256',env.stripeWebhookSecret).update(`${time}.${raw}`).digest('hex');
   const {handleStripeWebhook}=await import('../services/payment-service.js');await handleStripeWebhook(raw,`t=${time},v1=${signature}`);
   return route.fulfill({contentType:'text/html',body:`<h1>Mock payment confirmed</h1><a href="${payLink}?payment=success">Return to invoice</a>`});
  });
  await page.getByRole('button',{name:'Confirm test payment'}).click();await page.getByRole('link',{name:'Return to invoice'}).click();await page.getByRole('heading',{name:'Payment verified'}).waitFor();
  assert.equal(Number((await db.query('SELECT balance_due FROM invoices WHERE id=$1',[invoice.id])).rows[0].balance_due),0);
  const receipt=await page.getByRole('link',{name:/Download receipt/}).getAttribute('href');assert.equal((await originalFetch(new URL(receipt,base))).status,200);
  assert.equal((await db.query('SELECT count(*)::int n FROM payment_receipts WHERE invoice_id=$1',[invoice.id])).rows[0].n,1);
  assert.ok((await db.query("SELECT id FROM communications WHERE invoice_id=$1 AND trigger_key='PAYMENT_CONFIRMATION'",[invoice.id])).rowCount);
  assert.ok((await db.query('SELECT id FROM audit_logs WHERE entity_id=ANY($1::uuid[])',[[lead.id,proposal.id,invoice.id]])).rowCount>=3);
  report.sales.push('Invoice sent, public payment opened, mocked checkout confirmed by UI, signed webhook reconciles payment/receipt/confirmation exactly once');
  const paymentId=(await db.query('SELECT id FROM payments WHERE invoice_id=$1',[invoice.id])).rows[0].id;
  const lifecycle=(await db.query('SELECT provider,event_name FROM integration_jobs WHERE entity_id=ANY($1::uuid[])',[[lead.id,proposal.id,invoice.id,paymentId]])).rows;
  for(const event of ['generate_lead','booking_created','proposal_sent','proposal_accepted','invoice_issued','payment_completed'])assert.equal(lifecycle.filter(row=>row.event_name===event).length,3,event+' durable provider jobs');
  report.sales.push('Six CRM transitions each queued exactly once for all three disabled marketing adapters');

  assert.equal(checkoutCalls,1);assert.equal((await db.query('SELECT count(*)::int n FROM proposals WHERE lead_id=$1',[lead.id])).rows[0].n,1);assert.equal((await db.query('SELECT count(*)::int n FROM invoices WHERE proposal_id=$1',[proposal.id])).rows[0].n,1);
  const {verifyPreStagingDuplicates}=await import('./verify-pre-staging-duplicates.js');await verifyPreStagingDuplicates({page,base,db,report});
  report.doubleSubmit.push(...['Proposal','Invoice','Mock payment submit'].map(action=>({action,status:'PASS',evidence:'Rapid browser double-click; exactly one proposal, invoice or checkout session'})));
  report.records={lead:lead.id,client:converted.client.id,event:converted.event.id,proposal:proposal.id,invoice:invoice.id};
  const {verifyPreStagingMatrix}=await import('./verify-pre-staging-matrix.js');await verifyPreStagingMatrix({page,context,base,db,call,report,records:report.records,contextFor});
  await fs.writeFile(out+'/browser-report.json',JSON.stringify(report,null,2));
  return ['Complete continuous browser sales journey: inquiry through receipt and confirmation; real local API/database and mock Stripe provider'];
 }catch(error){if(page){await snapshot('failure');await fs.writeFile(out+'/failure.txt',await page.locator('body').innerText());await fs.writeFile(out+'/failure.html',await page.content());}throw error;}
 finally{await fs.writeFile(out+'/browser-report.json',JSON.stringify(report,null,2));await browser.close();globalThis.fetch=originalFetch;env.stripeSecretKey=oldStripe;env.stripeWebhookSecret=oldWebhook;}
}
