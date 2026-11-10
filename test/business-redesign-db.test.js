import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';

test('business plan publication, public privacy, CMS preservation and accepted proposal totals', {skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL}, async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.match(url.pathname,/qa|test/);
 const base=new pg.Pool({connectionString:String(url)}),schema='redesign_qa_'+crypto.randomBytes(6).toString('hex');let pool,server;
 try{
  await base.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');
  Object.assign(process.env,{DATABASE_URL:String(url),APP_ENV:'test',NODE_ENV:'test',PORT:'0',JWT_SECRET:'redesign-local-qa-secret-at-least-32-characters',INTEGRATION_SECRET_KEY:'redesign-local-encryption-test-only',EMAIL_PROVIDER:'development',PRICING_CATALOG_ENABLED:'true'});
  const db=await import('../server/src/db/pool.js');pool=db.pool;const {query,transaction}=db,one=async(sql,args=[])=>(await query(sql,args)).rows[0];
  for(const file of(await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await transaction(async()=>query(await fs.readFile(new URL('../server/migrations/'+file,import.meta.url),'utf8')));
  await query("INSERT INTO business_settings(business_name,timezone) VALUES('Redesign QA','UTC')");
  const owner=await one("INSERT INTO users(name,email,password_hash) VALUES('Redesign QA Owner','owner@redesign-qa.invalid','no-login') RETURNING id");
  await query("INSERT INTO permissions(key) VALUES('*'),('read:content'),('write:sales') ON CONFLICT DO NOTHING");await query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='*'",[owner.id]);
  const req={user:{...owner,permissions:['*']},headers:{}},ids={};
  for(const key of ['glam','360','mirror','vogue','audio'])ids[key]=(await one('INSERT INTO experiences(name,slug,show_on_website,website_status) VALUES($1,$1,true,\'PUBLISHED\') RETURNING id',[key])).id;
  const cms=await import('../server/src/services/staging-cms-service.js');
  for(const [key,id]of Object.entries(ids).filter(([k])=>k!=='audio'))await cms.saveStagingRecord('experiences',{entity_key:key,payload:{name:key,slug:key,source_catalog_id:id},status:'PUBLISHED',display_order:0},req.user);
  const faq=await cms.saveStagingRecord('faqs',{entity_key:'qa-faq',payload:{question:'QA preserved question',answer:'QA preserved answer',category:'Booking'},status:'PUBLISHED',display_order:0},req.user);
  const testimonial=await cms.saveStagingRecord('testimonials',{entity_key:'qa-testimonial',payload:{client_display_name:'QA synthetic testimonial',quote:'Synthetic local-only preservation fixture.'},status:'PUBLISHED',display_order:0},req.user);
  const pricing=await import('../server/src/services/pricing-catalog-service.js');await pricing.publishPricingVersion((await pricing.prepareStagingPricingCatalog(req)).id,req);
  const glam=await one("SELECT * FROM packages WHERE experience_id=$1 AND catalog_key='STANDARD' AND tier_key='ESSENTIAL'",[ids.glam]);
  await query("INSERT INTO packages(name,experience_id,starting_price,catalog_key,tier_key,pricing_profile,active) VALUES('Mirror QA base',$1,799,'STANDARD','ESSENTIAL',$2,true)",[ids.mirror,JSON.stringify({...glam.pricing_profile,experience:'mirror'})]);
  const current=await pricing.currentPricingCatalog(),original=JSON.stringify(current.snapshot);
  const update=await import('../server/src/services/staging-business-plan-update.js'),webUpdate=await import('../server/src/services/staging-website-redesign-update.js');
  const result=await transaction(async()=>{const business=await update.updateStagingBusinessPlans({apply:true,expectedVersion:current.id,req});const website=await webUpdate.updateStagingWebsiteRedesign({apply:true,expectedVersion:business.version,req});return {business,website};});
  assert.equal(result.business.packageIds.length,20);assert.equal(result.website.copySlots,100);
  assert.equal(JSON.stringify((await one('SELECT snapshot FROM pricing_catalog_versions WHERE id=$1',[current.id])).snapshot),original);
  for(const old of [faq,testimonial])assert.deepEqual((await one('SELECT payload FROM website_channel_records WHERE id=$1',[old.id])).payload,old.payload);
  const published=await pricing.currentPricingCatalog(),plans=published.snapshot.packages.filter(p=>p.active&&p.pricing_profile.businessPlan);assert.equal(plans.length,20);assert.ok(plans.every(p=>!p.show_on_website));
  const selected=['glam','360','mirror'].map(k=>plans.find(p=>p.pricing_profile.experience===k&&p.tier_key==='ACTIVATION'));
  const quote=await pricing.createPricingQuote({catalogVersion:published.id,eventCategory:'ACTIVATION',customerType:'BUSINESS',selections:selected.map(p=>({packageId:p.id})),businessPlan:{includedPackageIds:selected.slice(0,2).map(p=>p.id)},override:{travelAmountCents:0,reason:'Approved local QA plan'}},req);
  assert.equal(quote.status,'PRICED');assert.equal(quote.serviceTotalCents,1069715);assert.equal(quote.entitlements.find(e=>e.experience==='mirror').selectedPrints,500);
  const customer=await one("INSERT INTO clients(name,email,phone) VALUES('QA ONLY — business redesign','customer@redesign-qa.invalid','3125550100') RETURNING id");
  const event=await one("INSERT INTO events(client_id,event_name,event_type,event_date,start_time,end_time,status) VALUES($1,'QA ONLY — business redesign','Corporate Event','2038-06-10','17:00','23:00','DRAFT') RETURNING id",[customer.id]);
  const proposalSvc=await import('../server/src/services/proposal-service.js');
  const proposal=await proposalSvc.createProposal({...req,body:{client_id:customer.id,event_id:event.id,pricing_quote_id:quote.id,scenario_enabled:true,proposal_title:'QA ONLY — redesign proposal',selected_experiences:selected.map(p=>({experience_id:p.experience_id,name:p.pricing_profile.experience,packages:[{package_id:p.id,name:p.name,price:1}]}))}});
  assert.equal(Number(proposal.total),10697.15);assert.ok(proposal.selected_experiences.every(x=>x.packages.every(p=>!p.name.includes('Activation'))));
  assert.ok(proposal.content.scenario.mediaImages['experience:'+ids.mirror]?.[0].dataUri.startsWith('data:image/'));
  await query("UPDATE proposals SET status='SENT' WHERE id=$1",[proposal.id]);
  await (await import('../server/src/services/proposal-acceptance-service.js')).acceptProposal(proposal.id,'QA ONLY acceptance',req);
  const invoice=await (await import('../server/src/services/invoice-service.js')).createInvoice({...req,body:{proposal_id:proposal.id}});assert.equal(Number(invoice.total),10697.15);
  assert.ok((await one('SELECT business_reservation_missing($1) missing',[event.id])).missing.length>=4);
  for(const name of ['Glam QA booth','360 QA booth','Mirror QA booth','QA Printer 1','QA Printer 2']){const unit=await one("INSERT INTO equipment(name,category) VALUES($1,'QA synthetic asset') RETURNING id",[name]);await query('INSERT INTO equipment_assignments(event_id,equipment_id) VALUES($1,$2)',[event.id,unit.id]);}
  for(let i=0;i<3;i++){const staff=await one("INSERT INTO staff_profiles(name,email,role) VALUES($1,$2,'ATTENDANT') RETURNING id",['QA attendant '+i,'attendant-'+i+'@redesign-qa.invalid']);await query("INSERT INTO staff_assignments(event_id,staff_profile_id,assignment_role) VALUES($1,$2,'ATTENDANT')",[event.id,staff.id]);}
  assert.deepEqual((await one('SELECT business_reservation_missing($1) missing',[event.id])).missing,[]);
  await query("UPDATE staff_profiles SET active=false WHERE email='attendant-0@redesign-qa.invalid'");assert.ok((await one('SELECT business_reservation_missing($1) missing',[event.id])).missing.some(x=>x.includes('attendant')));await query("UPDATE staff_profiles SET active=true WHERE email='attendant-0@redesign-qa.invalid'");

  ({server}=await import('../server/src/index.js'));if(!server.listening)await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  async function call(path,{user,method='GET',body}={}){const r=await fetch(origin+'/api/'+path,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+jwt.sign({sub:user.id},process.env.JWT_SECRET)}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
  const publicCatalog=await call('public/pricing-catalog');assert.equal(publicCatalog.status,200);assert.ok(publicCatalog.body.packages.every(p=>p.catalog_key==='STANDARD'));assert.doesNotMatch(JSON.stringify(publicCatalog.body),/"businessPlan"|"includedExperiences"/);
  const booking=await call('public/booking-catalog');assert.ok(booking.body.packages.every(p=>p.catalog_key==='STANDARD'));
  assert.equal((await call('pricing/current')).status,401);assert.equal((await call('pricing/current',{user:owner})).body.packages.filter(p=>p.active&&p.pricing_profile.businessPlan).length,20);
  assert.equal((await call('public/pricing-quotes',{method:'POST',body:{eventCategory:'ACTIVATION',customerType:'BUSINESS',selections:selected.map(p=>({packageId:p.id}))}})).status,422);
  const site=await cms.stagingSitePayload();assert.equal(site.partners.length,5);assert.deepEqual(site.experiences.map(x=>x.name),['The Lola Glam','The Lola 360','The Lola Magic Mirror','The Lola Vogue']);assert.equal(site.testimonials.length,1);assert.equal(site.faqs.length,1);assert.deepEqual(site.heroSlides.filter(x=>x.page_slug==='home').map(x=>x.experience_key),['glam','360','mirror','vogue']);assert.equal(site.settings.instagram_url,'https://instagram.com/thelolabooth');assert.equal(site.settings.tiktok_url,'https://tiktok.com/@thelolabooth');
  const nextDraft=await call('pricing/drafts',{user:owner,method:'POST',body:{}});assert.equal(nextDraft.status,201);const editedRules=await call('pricing/'+nextDraft.body.id,{user:owner,method:'PATCH',body:{...published.rules,dispatchLabel:'QA updated dispatch label'}});assert.equal(editedRules.status,200);assert.deepEqual(editedRules.body.rules.businessPlans,published.rules.businessPlans);
  assert.equal((await update.updateStagingBusinessPlans({apply:true,expectedVersion:current.id,req})).alreadyApplied,true);
  if(process.env.REDESIGN_INTERACTIVE_QA==='true'){
   await query('UPDATE users SET password_hash=$2 WHERE id=$1',[owner.id,(await import('bcryptjs')).default.hashSync('Local-Redesign-QA-Only-2038',10)]);
   const {createServer}=await import('vite'),react=(await import('@vitejs/plugin-react')).default;
   const vite=await createServer({configFile:false,root:(await import('node:url')).fileURLToPath(new URL('../',import.meta.url)),plugins:[react(),{name:'local-redesign-config',configureServer(v){v.middlewares.use((q,r,next)=>{if(q.url?.split('?')[0]==='/staging-site/config.js'){r.setHeader('Content-Type','application/javascript');r.end('window.LOLA_CONFIG='+JSON.stringify({apiBase:'http://localhost:5198',environment:'staging',cmsChannel:'STAGING',formsEnabled:true}));}else next();});}}],define:{__BUILD_REVISION__:JSON.stringify('local-redesign-qa')},server:{host:'127.0.0.1',port:5198,strictPort:true,proxy:{'/api':origin}}});
   const {env}=await import('../server/src/config/env.js');env.clientOrigin='http://localhost:5198';env.publicInquiryAllowedOrigins=['http://localhost:5198'];await vite.listen();
   console.log('INTERACTIVE_REDESIGN_QA http://localhost:5198 /staging-site/index.html — synthetic database only; no worker or external email');
   try{await new Promise(resolve=>process.once('SIGINT',resolve));}finally{await vite.close();}
  }

 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();await base.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await base.end();}
});
