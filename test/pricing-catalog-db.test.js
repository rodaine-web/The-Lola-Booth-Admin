import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
test('versioned pricing migration, publication, immutable quotes, permissions and proposal/invoice consistency',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.match(url.pathname,/qa|test/);
 const base=new pg.Pool({connectionString:url.toString()}),schema='pricing_qa_'+crypto.randomBytes(5).toString('hex');let pool,server;
 try{
  await base.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');
  Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',NODE_ENV:'test',PORT:'0',JWT_SECRET:'pricing-local-qa-secret-at-least-thirty-two-characters',INTEGRATION_SECRET_KEY:'pricing-qa-encryption-key-only',EMAIL_PROVIDER:'development',PRICING_CATALOG_ENABLED:'true'});
  const db=await import('../server/src/db/pool.js');pool=db.pool;const {query,transaction}=db,one=async(sql,args=[])=>(await query(sql,args)).rows[0];
  for(const file of (await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort())await transaction(async()=>query(await fs.readFile(new URL('../server/migrations/'+file,import.meta.url),'utf8')));
  await query("INSERT INTO business_settings(business_name,timezone) VALUES('Pricing QA','America/Chicago')");
  const owner=await one("INSERT INTO users(name,email,password_hash) VALUES('QA Owner','pricing-owner@qa.invalid','no-login') RETURNING id");
  await query("INSERT INTO permissions(key) VALUES('*'),('read:content'),('write:sales') ON CONFLICT DO NOTHING");
  await query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='*'",[owner.id]);
  const viewer=await one("INSERT INTO users(name,email,password_hash) VALUES('QA Viewer','pricing-viewer@qa.invalid','no-login') RETURNING id");
  await query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='read:content'",[viewer.id]);
  const sales=await one("INSERT INTO users(name,email,password_hash) VALUES('QA Sales','pricing-sales@qa.invalid','no-login') RETURNING id");
  await query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='write:sales'",[sales.id]);
  for(const name of ['glam','360','vogue','audio'])await query('INSERT INTO experiences(name,slug,active) VALUES($1,$1,true)',[name]);
  const originalExperience=await one("UPDATE experiences SET show_on_website=true,website_status='PUBLISHED' WHERE slug='glam' RETURNING id");
  await query("INSERT INTO packages(name,experience_id,website_key,starting_price,active,show_on_website,website_status,most_popular,website_features) VALUES('Original Glam Signature',$1,'glam:signature',899,true,true,'PUBLISHED',true,'[\"Original public inclusion\"]')",[originalExperience.id]);
  const originalAddon=await one("INSERT INTO addons(name,price,pricing_type,active) VALUES('Original optional enhancement',125,'FIXED',true) RETURNING id");
  const svc=await import('../server/src/services/pricing-catalog-service.js'),req={user:owner,headers:{}};
  await assert.rejects(svc.prepareProductionPricingCatalog(req),{code:'PRODUCTION_ONLY'});
 const draft=await svc.prepareStagingPricingCatalog(req);
  assert.equal((await one('SELECT count(*)::int n FROM packages')).n,36);
  const v=await svc.publishPricingVersion(draft.id,req);
  assert.equal(v.snapshot.packages.length,36);
  await assert.rejects(query("UPDATE pricing_catalog_versions SET rules='{}' WHERE id=$1",[v.id]));
  await assert.rejects(query('DELETE FROM pricing_catalog_versions WHERE id=$1',[v.id]));
  const pkg=await one("SELECT * FROM packages WHERE catalog_key='STANDARD' AND tier_key='SIGNATURE' AND pricing_profile->>'experience'='glam'");
  const input={eventCategory:'COMPANY_CELEBRATION',customerType:'BUSINESS',selections:[{packageId:pkg.id,prints:500}],override:{travelAmountCents:0,reason:'QA venue inside Chicago, manual review'}};
  const quote=await svc.createPricingQuote(input,req);assert.equal(quote.status,'PRICED');assert.equal(quote.serviceTotalCents,112400);
  await assert.rejects(svc.createPricingQuote({...input,catalogVersion:crypto.randomUUID()},req),{code:'CATALOG_VERSION_CHANGED'});
  await query('UPDATE packages SET starting_price=999 WHERE id=$1',[pkg.id]);
  const unchanged=await svc.createPricingQuote(input,req);assert.equal(unchanged.serviceTotalCents,112400,'Published version does not follow draft package edits');
  assert.equal((await svc.publishedWebsitePricing([{id:'cms-channel-item',source_catalog_id:pkg.id,starting_price:'1.00'}]))[0].starting_price,'899.00');
  const again=await svc.prepareStagingPricingCatalog(req);assert.equal(again.id,v.id);assert.equal((await one('SELECT starting_price FROM packages WHERE id=$1',[pkg.id])).starting_price,'999.00','Repeat setup must not overwrite draft edits');
  await assert.rejects(query("UPDATE pricing_quotes SET snapshot='{}' WHERE id=$1",[quote.id]));
  const customer=await one("INSERT INTO clients(name,email) VALUES('QA Pricing Customer','pricing-customer@qa.invalid') RETURNING id");
  const event=await one("INSERT INTO events(client_id,event_name,event_type,event_date,status) VALUES($1,'PRICING QA ONLY','Company Celebration','2030-12-15','DRAFT') RETURNING id",[customer.id]);
  const proposalSvc=await import('../server/src/services/proposal-service.js');
  const composed=await proposalSvc.buildProposalSnapshot({client_id:customer.id,event_id:event.id,pricing_quote_id:quote.id,scenario_enabled:true,selected_experiences:[{experience_id:pkg.experience_id,packages:[{package_id:pkg.id,price:1}]}]});
  assert.equal(composed.pricing.total,1124);assert.match(composed.selectedExperiences[0].packages[0].description,/500 physical prints/);assert.equal(composed.selectedExperiences[0].price,899);
  assert.equal(composed.content.scenario.lines.find(line=>line.type==='PRINT_UPGRADE').stripe_tax_code,'txcd_20090028');
  const creative=await one("SELECT id FROM addons WHERE pricing_policy->>'key'='creative-design'");
  const enhanced=await svc.createPricingQuote({...input,selections:[{packageId:pkg.id,prints:500,addons:[{addonId:creative.id,quantity:2}]}]},req);
  const enhancedSnapshot=await proposalSvc.buildProposalSnapshot({client_id:customer.id,event_id:event.id,pricing_quote_id:enhanced.id,selected_experiences:[{experience_id:pkg.experience_id,packages:[{package_id:pkg.id,price:899}]}]});
  const edit=(await import('../server/src/services/proposal-edit-input.js')).proposalEditInput({content:enhancedSnapshot.content,pricing_snapshot:enhancedSnapshot.pricing,line_items_snapshot:enhancedSnapshot.lineItems});
  assert.equal(edit.addons[0].addon_id,creative.id);assert.equal(edit.addons[0].quantity,2);assert.equal(edit.custom_line_items.length,0);
  const proposal=await proposalSvc.createProposal({...req,body:{client_id:customer.id,event_id:event.id,pricing_quote_id:quote.id,package_amount:1,travel:900,discount:800,selected_experiences:[]}});
  assert.equal(Number(proposal.total),1124,'Client totals and manual unrelated adjustments do not change the reviewed quote');
  assert.equal(proposal.content.catalog_quote.entitlements[0].selectedPrints,500);
  await query("UPDATE proposals SET status='SENT' WHERE id=$1",[proposal.id]);
  await (await import('../server/src/services/proposal-acceptance-service.js')).acceptProposal(proposal.id,'QA Pricing Only',req);
  const invoiceSvc=await import('../server/src/services/invoice-service.js');
  const invoice=await invoiceSvc.createInvoice({...req,body:{proposal_id:proposal.id}});
  assert.equal(Number(invoice.total),1124);
  assert.equal((await one("SELECT stripe_tax_code FROM invoice_items WHERE invoice_id=$1 AND description LIKE '%physical prints%'",[invoice.id])).stripe_tax_code,'txcd_20090028');
  ({server}=await import('../server/src/index.js'));if(!server.listening)await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  async function call(route,{method='GET',body,user=owner,publicRoute=false}={}){const response=await fetch(origin+'/api/'+(publicRoute?'public/':'')+route,{method,headers:{'Content-Type':'application/json',...(!publicRoute?{Authorization:'Bearer '+jwt.sign({sub:user.id},process.env.JWT_SECRET)}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
  assert.equal((await call('pricing')).status,200);
  assert.equal((await call('pricing/'+v.id+'/publish',{method:'POST',body:{},user:viewer})).status,403);
  assert.equal((await call('pricing/quotes',{method:'POST',body:input,user:sales})).status,201,'Sales may prepare audited quotes without catalog-edit permissions');
  assert.equal((await call('pricing',{user:sales})).status,403,'Sales quoting does not grant catalog administration');
  assert.equal((await call('pricing-quotes',{method:'POST',publicRoute:true,body:{...input,override:{travelAmountCents:0,reason:'Forged'}}})).status,422);
  const publicInput={...input};delete publicInput.override;
  const quotesBefore=(await one('SELECT count(*)::int n FROM pricing_quotes')).n;
  const pending=await call('pricing-quotes',{method:'POST',publicRoute:true,body:publicInput});assert.equal(pending.status,200);assert.equal(pending.body.status,'REVIEW_REQUIRED');
  assert.equal((await one('SELECT count(*)::int n FROM pricing_quotes')).n,quotesBefore,'Live estimates do not create durable records or consume booking-send quota');
  const publishedCatalog=(await call('pricing-catalog',{publicRoute:true})).body;assert.equal(publishedCatalog.packages.length,36);assert.equal(publishedCatalog.packages.find(p=>p.id===pkg.id).most_popular,true);
  assert.equal((await call('booking-catalog',{publicRoute:true})).body.packages.find(p=>p.id===pkg.id).most_popular,true);
  if(process.env.PRICING_BROWSER_TEST==='true'){
   await query("UPDATE clients SET phone='5555555555' WHERE id=$1",[customer.id]);
   const {createServer}=await import('vite'),react=(await import('@vitejs/plugin-react')).default,{fileURLToPath}=await import('node:url'),{chromium}=await import('playwright');
   const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[react()],define:{__BUILD_REVISION__:JSON.stringify('pricing-qa')},server:{host:'127.0.0.1',port:0,proxy:{'/api':origin}}});let browser;
   try{
    await vite.listen();browser=await chromium.launch();const web='http://127.0.0.1:'+vite.httpServer.address().port;(await import('../server/src/config/env.js')).env.clientOrigin=web;
    await call('pricing/drafts',{method:'POST',body:{}});
    for(const width of [1440,390]){
     const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
     await page.addInitScript(token=>{if(window.top===window)localStorage.setItem('lola_access_token',token);},jwt.sign({sub:owner.id},process.env.JWT_SECRET));
     await page.goto(web+'/content/pricing');await page.getByRole('heading',{name:'Pricing & travel',exact:true}).waitFor();
     await page.getByLabel('Dispatch location *',{exact:true}).waitFor();assert.equal(await page.getByLabel('Dispatch location *',{exact:true}).inputValue(),'Downtown Chicago');
     await page.getByLabel('Pricing catalog',{exact:true}).selectOption('PROFESSIONAL');assert.equal(await page.getByRole('heading',{name:'Package inclusions',exact:true}).locator('..').locator('tbody tr').count(),12);
     await page.getByLabel('Pricing catalog',{exact:true}).selectOption('STANDARD');await page.getByRole('button',{name:'Edit inclusions',exact:true}).first().click();
     await page.getByLabel('Reason for change *',{exact:true}).fill('QA browser inclusion review');await page.getByRole('button',{name:'Save package draft',exact:true}).click();await page.getByRole('status').filter({hasText:'Package draft updated'}).waitFor();
     await fs.mkdir('artifacts/pricing',{recursive:true});await page.screenshot({path:'artifacts/pricing/admin-'+width+'.png',fullPage:true});
     await page.goto(web+'/sales/proposals/new?clientId='+customer.id+'&eventId='+event.id);
     await page.getByText('Creating a proposal for QA Pricing Customer',{exact:false}).waitFor();
     await page.getByRole('button',{name:'Continue to Services',exact:false}).click();
     await page.locator('.experience-card').filter({hasText:/glam/i}).first().click();
     await page.locator('.package-card').filter({hasText:pkg.name}).first().click();
     const review=page.getByRole('heading',{name:'Package pricing review',exact:true}).locator('..');
     await review.getByLabel('Total physical prints',{exact:true}).selectOption('500');
     await review.getByLabel('Reviewed travel charge ($)',{exact:true}).fill('0');
     await review.getByLabel('Approval / travel review reason',{exact:true}).fill('QA verified city venue and standard scope');
     await review.getByLabel('Total physical prints',{exact:true}).selectOption('');
     await review.getByRole('button',{name:'Calculate reviewed package quote',exact:true}).click();await review.getByText(/Service total:.*\$899\.00/).waitFor();
     await review.getByLabel('Total physical prints',{exact:true}).selectOption('500');
     await review.getByRole('button',{name:'Calculate reviewed package quote',exact:true}).click();
     await review.getByText(/Service total:.*\$1,124\.00/).waitFor();assert.match(await review.innerText(),/1,124\.00/);
     await page.getByRole('button',{name:'Continue to Review',exact:false}).click();
     await page.getByRole('button',{name:'Create as Draft',exact:true}).click();
     await page.waitForURL(/\/sales\/proposals\/[a-f0-9-]+$/);
     const created=await one('SELECT total,pricing_quote_id FROM proposals WHERE id=$1',[page.url().split('/').pop()]);assert.equal(Number(created.total),1124);assert.ok(created.pricing_quote_id);
     const createdId=page.url().split('/').pop();await page.goto(web+'/sales/proposals/'+createdId+'/edit');
     const revision=page.getByRole('heading',{name:'Package pricing review',exact:true}).locator('..');
     await revision.getByLabel('Total physical prints',{exact:true}).waitFor();assert.equal(await revision.getByLabel('Total physical prints',{exact:true}).inputValue(),'500');
     await revision.getByRole('button',{name:'Calculate reviewed package quote',exact:true}).click();await revision.getByText('Service total:',{exact:false}).waitFor();assert.match(await revision.innerText(),/1,124\.00/);
     await page.getByRole('button',{name:'Save Proposal',exact:true}).click();await page.waitForURL(/\/review$/);
     assert.equal(Number((await one('SELECT total FROM proposals WHERE id=$1',[createdId])).total),1124,'Reopening and saving must not duplicate the print upgrade');
     await page.screenshot({path:'artifacts/pricing/proposal-'+width+'.png',fullPage:true});assert.deepEqual(errors,[]);await page.close();
    }
   }finally{await browser?.close();await vite.close();}
   {
    await query("UPDATE experiences SET show_on_website=true,website_status='PUBLISHED'");
    const website=await createServer({configFile:false,root:process.env.PRICING_WEBSITE_ROOT||fileURLToPath(new URL('../public/staging-site',import.meta.url)),plugins:[{name:'staging-asset-paths',configureServer(server){server.middlewares.use((req,_res,next)=>{if(req.url?.startsWith('/staging-site/'))req.url=req.url.slice('/staging-site'.length);next();});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':origin}}});let webBrowser;
    try{await website.listen();webBrowser=await chromium.launch();const web='http://127.0.0.1:'+website.httpServer.address().port;(await import('../server/src/config/env.js')).env.clientOrigin=web;
     for(const width of [1440,390]){const page=await webBrowser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('https://**',route=>route.abort());await page.route('**/config.js',route=>route.fulfill({contentType:'application/javascript',body:'window.LOLA_CONFIG='+JSON.stringify({apiBase:web,environment:'staging',formsEnabled:true})}));
      await page.goto(web+'/availability.html');await page.locator('[name=eventCategory]').waitFor();await page.locator('[name=customerType]').selectOption('BUSINESS');await page.locator('[name=eventCategory]').selectOption('COMPANY_CELEBRATION');
      await page.locator('[data-experience="glam"]').check();await page.locator('[data-experience-package="glam"]').selectOption(pkg.id);await page.locator('[data-print-allowance="glam"]').selectOption('500');
      await page.locator('[data-booking-summary]').getByText('$1,124.00',{exact:false}).first().waitFor();await page.screenshot({path:'artifacts/pricing/website-booking-'+width+'.png',fullPage:true});
      await page.goto(web+'/packages.html');await page.locator('[data-experience-panel="glam"] .pricing-badge').filter({hasText:'Most Popular'}).waitFor();
      for(const key of ['glam','360','vogue','audio'])assert.equal(await page.locator('[data-experience-panel="'+key+'"] .pricing-card[data-package-key$=":custom"]').count(),1,'Every standard experience retains its Custom card');
      const customLink=await page.locator('[data-experience-panel="glam"] [data-package-key="glam:custom"] a').getAttribute('href');
      await page.goto(new URL(customLink,web).href);await page.locator('[name=eventCategory]').waitFor();assert.equal(await page.locator('[name=eventCategory]').inputValue(),'CUSTOM_PRODUCTION');assert.equal(await page.locator('[name=catalogKey]').inputValue(),'CUSTOM');await page.locator('[data-booking-summary]').getByText('Custom quote required',{exact:true}).waitFor();assert.equal(await page.locator('[data-booking-summary]').getByText('$0.00',{exact:true}).count(),0);
      await page.goto(web+'/packages.html');await page.getByRole('button',{name:'Conferences & professional events',exact:true}).waitFor();await page.getByRole('button',{name:'Conferences & professional events',exact:true}).click();for(const key of ['glam','360','vogue','audio'])assert.equal(await page.locator('[data-experience-panel="'+key+'"] .pricing-card[data-package-key$=":custom"]').count(),1);await page.locator('[data-experience-panel="glam"] .pricing-card').filter({hasText:'$1,399'}).waitFor();
      await page.screenshot({path:'artifacts/pricing/website-packages-'+width+'.png',fullPage:true});assert.deepEqual(errors,[]);await page.close();
     }
    }finally{await webBrowser?.close();await website.close();}
   }
  }
  process.env.PRICING_CATALOG_ENABLED='false';assert.equal((await call('pricing-catalog',{publicRoute:true})).status,404);
  await assert.rejects((await import('../server/src/services/public-booking-service.js')).preparePublicBooking({pricingVersion:v.id,selections:[{experienceId:pkg.experience_id,packageId:pkg.id}]}),{code:'CATALOG_VERSION_CHANGED'});
  await query('UPDATE addons SET price=999 WHERE id=$1',[originalAddon.id]);
  const fallback=await (await import('../server/src/services/public-booking-service.js')).publicBookingCatalog();
  assert.equal(fallback.packages.find(row=>row.id===pkg.id).starting_price,'899.00');
  assert.equal(fallback.addons.length,1);assert.equal(fallback.addons[0].price,'125.00');
  assert.deepEqual((await svc.publishedWebsitePricing([{id:pkg.id}]))[0].website_features,['Original public inclusion']);
  await query('UPDATE addons SET active=false WHERE id=$1',[originalAddon.id]);assert.equal((await (await import('../server/src/services/public-booking-service.js')).publicBookingCatalog()).addons.length,0,'Rollback does not resurrect an archived enhancement');

  assert.equal((await one('SELECT total FROM proposals WHERE id=$1',[proposal.id])).total,'1124.00');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool?.end();await base.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await base.end();}
});
