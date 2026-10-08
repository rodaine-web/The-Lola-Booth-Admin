import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';

test('disposable database: concurrent holds, expiry, atomic confirmation, inventory and rescheduling', {skip:!process.env.BOOTHBOOK_TEST_DATABASE_URL}, async()=>{
 const target=new URL(process.env.BOOTHBOOK_TEST_DATABASE_URL);
 assert.ok(['localhost','127.0.0.1'].includes(target.hostname),'Only a disposable local database is permitted.');
 const schema='holds_'+crypto.randomBytes(8).toString('hex');
 const bootstrap=new pg.Pool({connectionString:target.toString()});
 let pool;
 try{
  await bootstrap.query(`CREATE SCHEMA ${schema}`);
  target.searchParams.set('options',`-c search_path=${schema},public`);
  process.env.DATABASE_URL=target.toString();process.env.NODE_ENV='test';delete process.env.APP_ENV;
  const db=await import('../server/src/db/pool.js');pool=db.pool;
  const {query,transaction}=db;
  const directory=new URL('../server/migrations/',import.meta.url);
  for(const filename of (await fs.readdir(directory)).filter(x=>x.endsWith('.sql')).sort()){
   await transaction(async()=>query(await fs.readFile(new URL(filename,directory),'utf8')));
  }
  const holds=await import('../server/src/services/booking-hold-service.js');
  const client=(await query("INSERT INTO clients(name,email) VALUES('Hold QA','hold@example.invalid') RETURNING id")).rows[0];
  const equipment=(await query("INSERT INTO equipment(name,category) VALUES('Hold QA booth','BOOTH') RETURNING id")).rows[0];
  const event=async(date)=>(await query("INSERT INTO events(event_name,client_id,event_type,event_date,start_time,end_time) VALUES('Hold QA',$1,'Wedding',$2,'18:00','23:00') RETURNING id",[client.id,date])).rows[0];
  const first=await event('2030-01-05'),second=await event('2030-01-05');
  const options={equipmentIds:[equipment.id]};
  const competing=await Promise.allSettled([holds.createBookingHold(first.id,options),holds.createBookingHold(second.id,options)]);
  assert.equal(competing.filter(x=>x.status==='fulfilled').length,1,'Exactly one competing reservation wins');
  const winner=competing.find(x=>x.status==='fulfilled').value;
  const loser=winner.event_id===first.id?second:first;
  assert.equal((await holds.createBookingHold(winner.event_id,options)).expires_at.getTime(),winner.expires_at.getTime(),'Retry cannot extend expiry');
  await query("UPDATE booking_holds SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[winner.id]);
  await assert.rejects(holds.confirmHeldBooking(winner.event_id,winner.id),error=>error.code==='BOOKING_HOLD_EXPIRED');
  await holds.expireBookingHolds();
  const replacement=await holds.createBookingHold(loser.id,options);
  await holds.confirmHeldBooking(loser.id,replacement.id);
  await holds.confirmHeldBooking(loser.id,replacement.id);
  assert.equal((await query('SELECT count(*)::int n FROM equipment_assignments WHERE event_id=$1 AND released_at IS NULL',[loser.id])).rows[0].n,1,'Confirmation replay does not duplicate assignments');
  await assert.rejects(query("UPDATE equipment SET status='MAINTENANCE' WHERE id=$1",[equipment.id]),error=>error.code==='23514');
  const later=await event('2030-01-06');
  const laterHold=await holds.createBookingHold(later.id,options);await holds.confirmHeldBooking(later.id,laterHold.id);
  await assert.rejects(query("UPDATE events SET event_date='2030-01-05' WHERE id=$1",[later.id]),error=>error.code==='23514');
  assert.equal((await query('SELECT event_date FROM events WHERE id=$1',[later.id])).rows[0].event_date,'2030-01-06','Failed reschedule preserves prior date');
  await query("UPDATE events SET status='CANCELLED' WHERE id=$1",[loser.id]);
  assert.equal((await query('SELECT count(*)::int n FROM equipment_assignments WHERE event_id=$1 AND released_at IS NULL',[loser.id])).rows[0].n,0);
 }finally{
  if(pool)await pool.end();
  await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();
 }
});
