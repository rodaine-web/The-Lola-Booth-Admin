import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import crypto from 'node:crypto';import pg from 'pg';
test('staging catalogue update preserves history, print allowances, unrelated CMS and every other add-on price',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.match(url.pathname,/qa|test/);
 const root=new pg.Pool({connectionString:String(url)}),schema='experience_catalog_qa_'+crypto.randomBytes(5).toString('hex');let pool;
 try{
  await root.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');
  Object.assign(process.env,{DATABASE_URL:String(url),APP_ENV:'test',NODE_ENV:'test',JWT_SECRET:'local-catalogue-test-secret-only-32-characters',INTEGRATION_SECRET_KEY:'local-catalogue-encryption-test-only',EMAIL_PROVIDER:'development',PRICING_CATALOG_ENABLED:'true'});
  const db=await import('../server/src/db/pool.js');pool=db.pool;const {query,transaction}=db;const one=async(sql,args=[])=>(await query(sql,args)).rows[0];
  for(const f of(await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort())await transaction(async()=>query(await fs.readFile(new URL('../server/migrations/'+f,import.meta.url),'utf8')));
  const owner=await one("INSERT INTO users(name,email,password_hash) VALUES('QA Owner','catalogue-owner@example.invalid','no-login') RETURNING id");
  const req={user:{...owner,permissions:['*']},headers:{}};
  const experienceIds={};for(const key of ['glam','360','vogue','audio'])experienceIds[key]=(await one("INSERT INTO experiences(name,slug,active,show_on_website,website_status) VALUES($1,$1,true,true,'PUBLISHED') RETURNING id",[key])).id;
  await query("INSERT INTO addons(name,price,pricing_type,active) VALUES('Audio Guestbook',299,'FIXED',true),('Existing keepsake',175,'FIXED',true)");
  const service=await import('../server/src/services/pricing-catalog-service.js');const draft=await service.prepareStagingPricingCatalog(req);const published=await service.publishPricingVersion(draft.id,req);
  const originalSnapshot=JSON.stringify((await one('SELECT snapshot FROM pricing_catalog_versions WHERE id=$1',[published.id])).snapshot);
  const originalPrices=(await query('SELECT id,price FROM addons')).rows;
  const {saveStagingRecord}=await import('../server/src/services/staging-cms-service.js');
  const faq=await saveStagingRecord('faqs',{channel:'STAGING',entity_key:'keep-faq',payload:{question:'Keep this content',answer:'Unchanged'},status:'PUBLISHED',display_order:1},req.user);
  const oldAudio=await saveStagingRecord('experiences',{channel:'STAGING',entity_key:'audio',payload:{name:'Audio Guestbook',source_catalog_id:experienceIds.audio,image:'/staging-site/assets/audio.jpg'},status:'PUBLISHED',display_order:4},req.user);
  const {updateStagingExperiences}=await import('../server/src/services/staging-experience-update.js');
  const plan=await updateStagingExperiences({req});assert.equal(plan.dryRun,true);assert.deepEqual(plan.printAllowances.mirror,[0,200,500]);assert.equal((await one('SELECT count(*)::int n FROM pricing_catalog_versions')).n,1);
  await assert.rejects(updateStagingExperiences({apply:true,expectedVersion:crypto.randomUUID(),req}),{code:'CATALOG_VERSION_CHANGED'});
  const updated=await updateStagingExperiences({apply:true,expectedVersion:published.id,req});assert.equal(updated.versionNumber,2);assert.equal(updated.packageIds.length,16);
  assert.equal(JSON.stringify((await one('SELECT snapshot FROM pricing_catalog_versions WHERE id=$1',[published.id])).snapshot),originalSnapshot);
  const now=(await query("SELECT * FROM packages WHERE catalog_key='STANDARD' AND active=true AND pricing_profile->>'experience'<>'audio'")).rows;assert.equal(now.length,16);
  for(const key of ['glam','360','mirror','vogue']){const tiers=now.filter(p=>p.pricing_profile.experience===key);assert.equal(tiers.length,4);assert.equal(tiers.filter(p=>p.most_popular).length,1);assert.equal(tiers.find(p=>p.most_popular).tier_key,'SIGNATURE');assert.equal(tiers.find(p=>p.tier_key==='CUSTOM').starting_price,null);}
  assert.equal(now.find(p=>p.pricing_profile.experience==='mirror'&&p.tier_key==='SIGNATURE').pricing_profile.prints,200);
  assert.equal(now.find(p=>p.pricing_profile.experience==='vogue'&&p.tier_key==='SIGNATURE').pricing_profile.prints,0);
  const audio=await one("SELECT * FROM packages WHERE experience_id=$1 AND catalog_key='STANDARD' AND active=true",[experienceIds.audio]);assert.equal(audio.starting_price,'299.00');assert.equal(audio.pricing_profile.rentalHours,8);assert.ok(audio.pricing_profile.startingAt);assert.ok(audio.show_on_website);
  const addons=(await query('SELECT * FROM addons')).rows;assert.equal(addons.length,originalPrices.length);for(const row of addons)assert.equal(row.price,row.name==='Audio Guest Book'?'249.00':originalPrices.find(x=>x.id===row.id).price);
  const site=(await import('../server/src/services/staging-cms-service.js'));const payload=await site.stagingSitePayload();assert.deepEqual(payload.experiences.map(x=>x.name),['The Lola Glam','The Lola 360','The Lola Magic Mirror','The Lola Vogue']);assert.equal(payload.packages.length,16);assert.equal((await one('SELECT payload FROM website_channel_records WHERE id=$1',[faq.id])).payload.answer,'Unchanged');assert.equal((await one('SELECT status FROM website_channel_records WHERE id=$1',[oldAudio.id])).status,'ARCHIVED');
  const booking=await (await import('../server/src/services/public-booking-service.js')).publicBookingCatalog();assert.ok(booking.experiences.some(x=>x.key==='mirror'));assert.ok(booking.packages.some(x=>x.experience_id===experienceIds.audio&&x.active!==false));
  const repeat=await updateStagingExperiences({apply:true,expectedVersion:published.id,req});assert.equal(repeat.alreadyApplied,true);assert.equal((await one('SELECT count(*)::int n FROM pricing_catalog_versions')).n,2);
  process.env.APP_ENV='production';await assert.rejects(updateStagingExperiences({req}),{code:'STAGING_ONLY'});process.env.APP_ENV='test';
 }finally{if(pool)await pool.end();await root.query('DROP SCHEMA '+schema+' CASCADE');await root.end();}
});
