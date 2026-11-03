import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { once } from 'node:events';
const databaseUrl=process.env.LEAD_ACTIONS_TEST_DATABASE_URL||process.env.CRM_TEST_DATABASE_URL;
test('lead selection actions persist, preserve links, filter archives and enforce atomic permissions',{skip:!databaseUrl},async()=>{
 const url=new URL(databaseUrl);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/qa|test/);
 const base=new pg.Pool({connectionString:url.toString()}),schema='lead_actions_qa_'+crypto.randomBytes(5).toString('hex');let pool,server;
 try{
  await base.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');
  Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',NODE_ENV:'test',PORT:'0',JWT_SECRET:'lead-actions-local-test-secret-thirty-two-characters',EMAIL_PROVIDER:'development'});
  const db=await import('../server/src/db/pool.js');pool=db.pool;const {query,transaction}=db,one=async(sql,args=[])=>(await query(sql,args)).rows[0];
  for(const file of (await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort())await transaction(async()=>query(await fs.readFile(new URL('../server/migrations/'+file,import.meta.url),'utf8')));
  const owner=await one("INSERT INTO users(name,email,password_hash) VALUES('Lead QA Owner','owner@qa.invalid','disabled') RETURNING id");
  const viewer=await one("INSERT INTO users(name,email,password_hash) VALUES('Lead QA Viewer','viewer@qa.invalid','disabled') RETURNING id");
  await query("INSERT INTO permissions(key) VALUES('*'),('read:sales') ON CONFLICT DO NOTHING");
  for(const [user,key] of [[owner,'*'],[viewer,'read:sales']])await query('INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key=$2',[user.id,key]);
  const ids=[];
  for(const name of ['Ada','Grace'])ids.push((await one("INSERT INTO leads(first_name,last_name,email,phone,event_date,event_type) VALUES($1,'QA',$2,'5555555555','2027-12-16','Wedding') RETURNING id",[name,name.toLowerCase()+'@qa.invalid'])).id);
  const proposal=await one('INSERT INTO proposals(lead_id) VALUES($1) RETURNING id',[ids[0]]);
  ({server}=await import('../server/src/index.js'));if(!server.listening)await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  async function call(route,{body,user=owner}={}){const response=await fetch(origin+'/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt.sign({sub:user.id},process.env.JWT_SECRET)},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
  const action=(action,selected=ids,user=owner)=>call('leads/bulk-action',{body:{action,ids:selected},user});
  assert.equal((await action('delete',ids,viewer)).status,403);
  assert.equal((await action('archive',[])).status,400);
  assert.equal((await action('archive',[ids[0],crypto.randomUUID()])).status,409);
  assert.equal((await one('SELECT archived_at FROM leads WHERE id=$1',[ids[0]])).archived_at,null);
  assert.deepEqual((await action('archive',[...ids,ids[0]])).body,{count:2});
  assert.equal((await call('leads?status=ALL')).body.data.length,0);
  assert.equal((await call('leads?status=ALL&archived=true')).body.data.length,2);
  assert.equal((await one('SELECT status FROM leads WHERE id=$1',[ids[0]])).status,'NEW');
  assert.equal((await action('restore',[ids[0]])).status,200);
  assert.equal((await call('leads?status=ALL')).body.data.length,1);
  assert.equal((await action('delete')).status,200);
  assert.equal((await call('leads/'+ids[0])).status,404);
  assert.equal((await call('leads?status=ALL&archived=true')).body.data.length,0);
  assert.equal((await one('SELECT lead_id FROM proposals WHERE id=$1',[proposal.id])).lead_id,ids[0]);
  assert.equal((await one("SELECT count(*)::int n FROM audit_logs WHERE action IN ('lead_archived','lead_restored','lead_deleted')")).n,5);
  assert.equal((await action('restore')).status,409);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool?.end();await base.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await base.end();}
});
