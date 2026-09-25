import assert from 'node:assert/strict';import fs from 'node:fs/promises';import jwt from 'jsonwebtoken';import {randomUUID} from 'node:crypto';
const u=new URL(process.env.DATABASE_URL||'');if(u.hostname!=='localhost'||u.pathname!=='/lola_goal2_qualification')throw Error('Local QA database only.');
Object.assign(process.env,{APP_ENV:'staging',NODE_ENV:'test',PORT:'5190',EMAIL_PROVIDER:'development',STAGING_EMAIL_ENABLED:'false',STAGING_EMAIL_ALLOWLIST:'qa@example.invalid,owner@example.invalid',STAGING_FORM_OWNER_EMAIL:'owner@example.invalid'});
const {pool,query}=await import('../db/pool.js');const {env}=await import('../config/env.js');const {server}=await import('../index.js');
const run=randomUUID().slice(0,8),evidence=[];let user;
try{
 user=(await query("INSERT INTO users(name,email,password_hash) VALUES('Local form QA',$1,'disabled') RETURNING id",['local-'+run+'@example.invalid'])).rows[0];
 for(const key of ['read:website','write:website','publish:website','write:sales']){const p=(await query('INSERT INTO permissions(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET key=EXCLUDED.key RETURNING id',[key])).rows[0];await query('INSERT INTO user_permissions(user_id,permission_id) VALUES($1,$2)',[user.id,p.id]);}
 const token=jwt.sign({sub:user.id},env.jwtSecret,{expiresIn:'5m'});
 const call=async(path,body,auth=true)=>{const r=await fetch('http://localhost:5190/api'+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const base={firstName:'Local',lastName:'QA '+run,email:'qa@example.invalid',phone:'3125550100',eventDate:'2027-12-16',eventType:'Wedding',city:'Chicago',state:'IL',message:'LOCAL MOCK QA '+run,utm_source:'goal2',utm_campaign:run,referrer_url:'http://localhost/qa'};
 assert.equal((await call('/public/staging/inquiries',base,false)).status,401);
 assert.equal((await call('/public/staging/inquiries',{...base,email:'not-approved@example.invalid'})).status,403);
 for(const form of ['contact','availability']){
  const body={...base,form_id:form};const first=await call('/public/staging/inquiries',body);assert.equal(first.status,201,JSON.stringify(first.body));const replay=await call('/public/staging/inquiries',body);assert.equal(replay.status,201);assert.equal(first.body.leadId,replay.body.leadId);assert.equal(replay.body.inquiryStatus,'IDEMPOTENT_REPLAY');
  const lead=(await query('SELECT test_mode,first_touch,public_ack_pending FROM leads WHERE id=$1',[first.body.leadId])).rows[0];assert.equal(lead.test_mode,true);assert.equal(lead.public_ack_pending,false);
  const emails=(await query('SELECT recipient,status,rendered_html FROM communications WHERE lead_id=$1',[first.body.leadId])).rows;assert.equal(emails.length,2);assert.ok(emails.every(x=>x.status==='SCHEDULED'&&x.rendered_html));assert.deepEqual(emails.map(x=>x.recipient).sort(),['owner@example.invalid','qa@example.invalid']);
  evidence.push({form,leadId:first.body.leadId,persisted:true,testMode:true,queuedEmails:emails.length,replayDeduplicated:true,externalEmailsSent:0});
 }
 const frozen=await call('/website/hero',{title:'Must not write public'});assert.equal(frozen.status,409);
 await fs.writeFile('audit-output/goal2/local-form-api.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{if(user)await query('UPDATE users SET active=false WHERE id=$1',[user.id]);await new Promise(resolve=>server.close(resolve));await pool.end();}
