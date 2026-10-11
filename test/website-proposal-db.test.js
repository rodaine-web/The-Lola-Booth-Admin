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
  const lead=await newLead();
  await Promise.all(Array.from({length:8},()=>queueWebsiteProposal(lead.id)));
  assert.equal((await query("SELECT count(*)::int n FROM automation_jobs WHERE related_entity_id=$1",[lead.id])).rows[0].n,1);
  const outcomes=await Promise.all(Array.from({length:8},()=>processWebsiteProposalHandoffs()));
  assert.deepEqual(outcomes.flatMap(x=>x.processed).map(x=>x.status),['COMPLETED'],JSON.stringify((await query('SELECT status,last_error FROM automation_jobs WHERE related_entity_id=$1',[lead.id])).rows));
  const proposals=(await query('SELECT * FROM proposals WHERE lead_id=$1',[lead.id])).rows;assert.equal(proposals.length,1);assert.equal(proposals[0].status,'SENT');assert.equal(Number(proposals[0].total),599);
  assert.equal((await query('SELECT count(*)::int n FROM email_messages')).rows[0].n,1);
  await queueWebsiteProposal(lead.id);assert.equal((await processWebsiteProposalHandoffs()).processed.length,0);
  const review=await newLead({city:'Unapproved city'});await queueWebsiteProposal(review.id);assert.equal((await processWebsiteProposalHandoffs()).processed[0].status,'FAILED');
  assert.equal((await query('SELECT count(*)::int n FROM tasks WHERE lead_id=$1 AND lifecycle_key IS NOT NULL',[review.id])).rows[0].n,1);
  assert.equal((await query('SELECT count(*)::int n FROM proposals WHERE lead_id=$1',[review.id])).rows[0].n,0);
  const changed=await newLead();await queueWebsiteProposal(changed.id);await query('UPDATE packages SET starting_price=899 WHERE id=$1',[pkg.id]);assert.equal((await processWebsiteProposalHandoffs()).processed[0].status,'FAILED');
  assert.equal((await query('SELECT count(*)::int n FROM proposals WHERE lead_id=$1',[changed.id])).rows[0].n,0);
  const paused=await newLead();await queueWebsiteProposal(paused.id);process.env.BOOKING_WEBSITE_PROPOSAL_ENABLED='false';assert.equal((await processWebsiteProposalHandoffs()).processed.length,0);
  assert.equal((await query("SELECT status FROM automation_jobs WHERE related_entity_id=$1",[paused.id])).rows[0].status,'PENDING');
 }finally{if(pool)await pool.end();await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();}
});
