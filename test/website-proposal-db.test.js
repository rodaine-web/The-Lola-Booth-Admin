import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
test('disposable PostgreSQL: website proposal outbox is atomic, deduplicated and review-safe',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.ok(url.pathname.startsWith('/lola_phase1_qa_'));
 const schema='website_'+crypto.randomBytes(8).toString('hex');const bootstrap=new pg.Pool({connectionString:url.toString()});let pool;
 try{
  await bootstrap.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-c search_path=${schema},public`);
  process.env.DATABASE_URL=url.toString();process.env.NODE_ENV='test';delete process.env.APP_ENV;process.env.EMAIL_PROVIDER='development';
  process.env.BOOKING_WEBSITE_PROPOSAL_ENABLED='true';process.env.BOOKING_AUTO_QUOTE_CITIES='Chicago';
  const db=await import('../server/src/db/pool.js');pool=db.pool;const {query,transaction}=db;
  const dir=new URL('../server/migrations/',import.meta.url);
  for(const name of (await fs.readdir(dir)).filter(x=>x.endsWith('.sql')).sort()){const sql=await fs.readFile(new URL(name,dir),'utf8');await transaction(()=>query(sql));}
  await query("INSERT INTO business_settings(business_name) VALUES('Website QA')");
  const exp=(await query("INSERT INTO experiences(name,slug,active,show_on_website,website_status) VALUES('The LOLA Glam','glam',true,true,'PUBLISHED') RETURNING id")).rows[0];
  const pkg=(await query("INSERT INTO packages(name,experience_id,starting_price,active,show_on_website,website_status,pricing_mode) VALUES('QA fixed',$1,599,true,true,'PUBLISHED','STARTING') RETURNING id",[exp.id])).rows[0];
  const {preparePublicBooking}=await import('../server/src/services/public-booking-service.js');
  const {ingestProviderLead}=await import('../server/src/services/social-lead-service.js');
  const {queueWebsiteProposal,processWebsiteProposalHandoffs}=await import('../server/src/services/website-proposal-handoff-service.js');
  async function newLead(overrides={}){const payload=await preparePublicBooking({firstName:'Website',lastName:'QA',email:'qa@example.invalid',phone:'3125550000',eventType:'Wedding',eventName:'QA only',eventDate:'2030-12-01',eventStartTime:'18:00',eventEndTime:'22:00',venueAddress:'QA venue',city:'Chicago',state:'IL',submissionId:crypto.randomUUID(),selections:[{experienceId:exp.id,packageId:pkg.id}],addons:[],...overrides});return (await ingestProviderLead({provider:'WEBSITE',payload,skipAutomations:true})).lead;}
  const {previewLeadAvailability,confirmLeadAvailability,hasCurrentAvailability}=await import('../server/src/services/lead-availability-service.js');
  const user=(await query("INSERT INTO users(name,email,password_hash) VALUES('QA availability staff','staff@example.invalid','not-a-login') RETURNING *")).rows[0];
  async function approve(id){const preview=await previewLeadAvailability(id);return confirmLeadAvailability(id,{confirmed:true,fingerprint:preview.fingerprint,calendarRevision:preview.calendar.revision},user);}
  const lead=await newLead();
  await queueWebsiteProposal(lead.id);
  assert.equal((await query('SELECT count(*)::int n FROM automation_jobs WHERE related_entity_id=$1',[lead.id])).rows[0].n,0,'Arrival cannot send a proposal');
  await Promise.all(Array.from({length:8},()=>approve(lead.id)));
  await Promise.all(Array.from({length:8},()=>queueWebsiteProposal(lead.id)));
  assert.equal((await query("SELECT count(*)::int n FROM automation_jobs WHERE related_entity_id=$1",[lead.id])).rows[0].n,1);
  const outcomes=await Promise.all(Array.from({length:8},()=>processWebsiteProposalHandoffs()));
  assert.deepEqual(outcomes.flatMap(x=>x.processed).map(x=>x.status),['COMPLETED'],JSON.stringify((await query('SELECT status,last_error FROM automation_jobs WHERE related_entity_id=$1',[lead.id])).rows));
  const proposals=(await query('SELECT * FROM proposals WHERE lead_id=$1',[lead.id])).rows;assert.equal(proposals.length,1);assert.equal(proposals[0].status,'SENT');assert.equal(Number(proposals[0].total),599);
  assert.equal((await query('SELECT count(*)::int n FROM email_messages')).rows[0].n,1);
  await queueWebsiteProposal(lead.id);assert.equal((await processWebsiteProposalHandoffs()).processed.length,0);
  const customPkg=(await query("INSERT INTO packages(name,experience_id,starting_price,active,show_on_website,website_status,pricing_mode) VALUES('Custom',$1,0,true,true,'PUBLISHED','CUSTOM') RETURNING id",[exp.id])).rows[0];
  const custom=await newLead({selections:[{experienceId:exp.id,packageId:customPkg.id}]});
  await Promise.all(Array.from({length:8},()=>approve(custom.id)));
  assert.equal((await query('SELECT count(*)::int n FROM tasks WHERE lead_id=$1 AND title=$2',[custom.id,'Schedule discovery call'])).rows[0].n,1);
  assert.equal((await query('SELECT count(*)::int n FROM automation_jobs WHERE related_entity_id=$1',[custom.id])).rows[0].n,0);
  const edited=await newLead();await approve(edited.id);
  await query("UPDATE leads SET event_start_time='19:00' WHERE id=$1",[edited.id]);
  assert.equal(hasCurrentAvailability((await query('SELECT * FROM leads WHERE id=$1',[edited.id])).rows[0]),false);
  assert.equal((await query('SELECT status FROM automation_jobs WHERE related_entity_id=$1',[edited.id])).rows[0].status,'CANCELLED');
  const stale=await newLead();const preview=await previewLeadAvailability(stale.id);
  await query("UPDATE leads SET event_date='2030-12-02' WHERE id=$1",[stale.id]);
  await assert.rejects(confirmLeadAvailability(stale.id,{confirmed:true,fingerprint:preview.fingerprint,calendarRevision:preview.calendar.revision},user),e=>e.code==='AVAILABILITY_CHANGED');
  const changedCalendar=await newLead();const oldCalendar=await previewLeadAvailability(changedCalendar.id);
  await query("UPDATE events SET venue_name='Calendar changed' WHERE id=$1",[proposals[0].event_id]);
  await assert.rejects(confirmLeadAvailability(changedCalendar.id,{confirmed:true,fingerprint:oldCalendar.fingerprint,calendarRevision:oldCalendar.calendar.revision},user),e=>e.code==='AVAILABILITY_CHANGED');
  const manual=(await query("INSERT INTO leads(first_name,last_name,email,lead_source,event_date,event_start_time,event_end_time,venue_address,preferred_package_id,preferred_experience_id) VALUES('Manual','QA','manual@example.invalid','REFERRAL','2030-12-03','18:00','22:00','QA venue',$1,$2) RETURNING *",[pkg.id,exp.id])).rows[0];
  await approve(manual.id);assert.equal((await processWebsiteProposalHandoffs()).processed[0].status,'COMPLETED','Manual channel follows same approval');
  const changed=await newLead();await approve(changed.id);await query('UPDATE packages SET starting_price=899 WHERE id=$1',[pkg.id]);assert.equal((await processWebsiteProposalHandoffs()).processed[0].status,'FAILED');
  assert.equal((await query('SELECT count(*)::int n FROM proposals WHERE lead_id=$1',[changed.id])).rows[0].n,0);
  const paused=await newLead();await approve(paused.id);process.env.BOOKING_WEBSITE_PROPOSAL_ENABLED='false';assert.equal((await processWebsiteProposalHandoffs()).processed.length,0);
  assert.equal((await query("SELECT status FROM automation_jobs WHERE related_entity_id=$1",[paused.id])).rows[0].status,'PENDING');
 }finally{if(pool)await pool.end();await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();}
});
