import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import pg from 'pg';
import jwt from 'jsonwebtoken';
const enabled=process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL;
test('V1.2 private Event Files: real API, storage, concurrency, permissions and failure recovery',{skip:!enabled},async()=>{
 const url=new URL(enabled);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.startsWith('/lola_phase1_qa_'));
 const bootstrap=new pg.Pool({connectionString:enabled}),schema='event_files_'+crypto.randomBytes(8).toString('hex');let pool,server;
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lola-event-files-db-'));
 try{
 await bootstrap.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-c search_path=${schema},public`);
 Object.assign(process.env,{DATABASE_URL:url.toString(),NODE_ENV:'test',APP_ENV:'test',PORT:'0',JWT_SECRET:'synthetic-event-files-api-test-secret-32',STORAGE_PROVIDER:'local',LOCAL_STORAGE_ROOT:root,EMAIL_PROVIDER:'development'});
 const db=await import('../server/src/db/pool.js');pool=db.pool;const {query,transaction}=db;
 const dir=new URL('../server/migrations/',import.meta.url);for(const name of (await fs.readdir(dir)).filter(x=>x.endsWith('.sql')).sort()){const sql=await fs.readFile(new URL(name,dir),'utf8');await transaction(()=>query(sql));}
 const owner=(await query("INSERT INTO users(name,email,password_hash) VALUES('Files QA Owner','files-owner@example.invalid','not-a-login') RETURNING *")).rows[0];
 const viewer=(await query("INSERT INTO users(name,email,password_hash) VALUES('Files QA Viewer','files-viewer@example.invalid','not-a-login') RETURNING *")).rows[0];
 const attendant=(await query("INSERT INTO users(name,email,password_hash) VALUES('Files QA Attendant','files-staff@example.invalid','not-a-login') RETURNING *")).rows[0];
 await query("INSERT INTO permissions(key) VALUES('*'),('read:events'),('write:events') ON CONFLICT(key) DO NOTHING");
 await query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='*'",[owner.id]);
 for(const user of [viewer,attendant])await query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='read:events'",[user.id]);
 await query("INSERT INTO roles(name) VALUES('ATTENDANT') ON CONFLICT(name) DO NOTHING");await query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='ATTENDANT'",[attendant.id]);
 const event=(await query("INSERT INTO events(event_name,event_type,event_date,status) VALUES('V1.2 Files QA only','Wedding','2031-02-15','INQUIRY') RETURNING *")).rows[0];
 const other=(await query("INSERT INTO events(event_name,event_type,event_date,status) VALUES('V1.2 Other QA','Wedding','2031-02-16','INQUIRY') RETURNING *")).rows[0];
 const profile=(await query("INSERT INTO staff_profiles(name,user_id) VALUES('Files QA Staff',$1) RETURNING id",[attendant.id])).rows[0];
 await query('INSERT INTO staff_assignments(event_id,staff_profile_id) VALUES($1,$2)',[event.id,profile.id]);
 ({server}=await import('../server/src/index.js'));if(!server.listening)await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
 const tokens={owner:jwt.sign({sub:owner.id},process.env.JWT_SECRET),viewer:jwt.sign({sub:viewer.id},process.env.JWT_SECRET),attendant:jwt.sign({sub:attendant.id},process.env.JWT_SECRET)};
 async function api(p,{method='GET',body,token=tokens.owner,raw=false}={}){const response=await fetch(origin+'/api'+p,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,headers:response.headers,data:raw?Buffer.from(await response.arrayBuffer()):await response.json()};}
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=','base64');
 const input={requestId:crypto.randomUUID(),filename:'venue-reference.png',mimeType:'image/png',category:'VENUE',visibility:'PRIVATE',data:png.toString('base64')};
 assert.equal((await api(`/events/${event.id}/files`,{token:null})).status,401);
 assert.equal((await api(`/events/${event.id}/files`,{token:tokens.viewer})).status,403);
 assert.equal((await api('/files',{token:tokens.viewer})).status,403);
 assert.equal((await api(`/events/${event.id}/files`,{method:'POST',token:tokens.viewer,body:input})).status,403);
 assert.equal((await api(`/events/${event.id}/files`,{method:'POST',body:{...input,data:'not-a-png'}})).status,422);
 const saved=await api(`/events/${event.id}/files`,{method:'POST',body:input});assert.equal(saved.status,201);const file=saved.data.file;
 assert.ok(file.hasContent);assert.equal('storage_key' in file,false);
 const globalFiles=await api('/files');assert.equal(globalFiles.status,200);assert.ok(globalFiles.data.data.every(x=>!('storage_key' in x)));
 const eventDetails=await api(`/events/${event.id}`);assert.equal(eventDetails.status,200);assert.ok(eventDetails.data.files.some(x=>x.id===file.id&&x.hasContent));assert.ok(eventDetails.data.files.every(x=>!('storage_key' in x)));
 const repeats=await Promise.all(Array.from({length:8},()=>api(`/events/${event.id}/files`,{method:'POST',body:input})));assert.ok(repeats.every(x=>x.status===200));
 assert.equal((await query('SELECT count(*)::int n FROM files WHERE event_id=$1 AND upload_request_id=$2',[event.id,input.requestId])).rows[0].n,1);
 assert.equal((await api(`/events/${event.id}/files`,{method:'POST',body:{...input,filename:'changed.png'}})).status,409);
 const download=await api(`/events/${event.id}/files/${file.id}/download`,{raw:true});assert.equal(download.status,200);assert.deepEqual(download.data,png);assert.match(download.headers.get('content-disposition'),/^attachment;/);assert.match(download.headers.get('cache-control'),/no-store/);
 assert.equal((await api(`/events/${other.id}/files/${file.id}/download`)).status,404);
 assert.equal((await api(`/events/${event.id}/files/${file.id}/download`,{token:tokens.viewer})).status,403);
 assert.equal((await api(`/events/${event.id}/files/${file.id}/download`,{token:tokens.attendant,raw:true})).status,200);
 await query("INSERT INTO files(event_id,category,filename,visibility) VALUES($1,'INTERNAL','internal.pdf','INTERNAL'),($1,'CONTRACT','agreement.pdf','PRIVATE'),($1,'VENUE','metadata.pdf','PRIVATE')",[event.id]);
 const staffList=await api(`/events/${event.id}/files`,{token:tokens.attendant});assert.equal(staffList.status,200);assert.ok(!staffList.data.data.some(x=>['internal.pdf','agreement.pdf'].includes(x.filename)));
 const legacy=(await query("SELECT id FROM files WHERE event_id=$1 AND filename='metadata.pdf'",[event.id])).rows[0];assert.equal((await api(`/events/${event.id}/files/${legacy.id}/download`)).data.error.code,'EVENT_FILE_BYTES_MISSING');
 await query('UPDATE staff_assignments SET released_at=now() WHERE event_id=$1',[event.id]);assert.equal((await api(`/events/${event.id}/files/${file.id}/download`,{token:tokens.attendant})).status,403);
 const files=await import('../server/src/services/event-files-service.js');const req={user:{...owner,roles:['OWNER'],permissions:['*']},headers:{},ip:'127.0.0.1'};
 const before=(await query('SELECT count(*)::int n FROM files')).rows[0].n;
 await assert.rejects(files.uploadEventFile(event.id,{...input,requestId:crypto.randomUUID()},req,{storage:{put:async()=>{throw new Error('Provider unavailable');}}}));assert.equal((await query('SELECT count(*)::int n FROM files')).rows[0].n,before);
 await query(`CREATE FUNCTION reject_test_file() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.filename='reject.png' THEN RAISE EXCEPTION 'Simulated metadata persistence failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_test_file BEFORE INSERT ON files FOR EACH ROW EXECUTE FUNCTION reject_test_file();`);
 const deleted=[];await assert.rejects(files.uploadEventFile(event.id,{...input,filename:'reject.png',requestId:crypto.randomUUID()},req,{storage:{put:async()=>({storageProvider:'LOCAL',storageKey:'only-new-object'}),delete:async key=>deleted.push(key)}}));assert.deepEqual(deleted,['only-new-object']);assert.equal((await query('SELECT count(*)::int n FROM files')).rows[0].n,before);
 // Simulate a lost COMMIT acknowledgement after the database actually committed.
 const originalConnect=pool.connect;pool.connect=async function(){pool.connect=originalConnect;const client=await originalConnect.call(pool),originalQuery=client.query,originalRelease=client.release;
 client.query=async function(sql,...args){const result=await originalQuery.call(client,sql,...args);if(sql==='COMMIT')throw new Error('Lost COMMIT acknowledgement');return result;};
 client.release=function(...args){client.query=originalQuery;client.release=originalRelease;return originalRelease.apply(client,args);};return client;};
 const uncertain={...input,requestId:crypto.randomUUID(),filename:'uncertain-commit.png'},cleanup=[];
 await assert.rejects(files.uploadEventFile(event.id,uncertain,req,{storage:{put:async()=>({storageProvider:'LOCAL',storageKey:'uncertain-but-committed'}),delete:async key=>cleanup.push(key)}}));
 assert.deepEqual(cleanup,[],'Never remove bytes referenced by a committed upload');
 assert.equal((await query('SELECT count(*)::int n FROM files WHERE upload_request_id=$1',[uncertain.requestId])).rows[0].n,1);
 const recovered=await files.uploadEventFile(event.id,uncertain,req,{storage:{put:async()=>{throw new Error('Committed retry must not write again');}}});assert.equal(recovered.replayed,true);
 await assert.rejects(files.downloadEventFile(event.id,file.id,req,{storage:{get:async()=>Buffer.from('corrupt')}}),e=>e.code==='EVENT_FILE_INTEGRITY');
 if(process.env.V12_BROWSER_TEST==='true'){const {verifyEventFilesBrowser}=await import('./support/event-files-browser.js');await verifyEventFilesBrowser({origin,eventId:event.id,ownerToken:tokens.owner,png});}
 await query('UPDATE events SET deleted_at=now() WHERE id=$1',[event.id]);assert.equal((await api(`/events/${event.id}/files/${file.id}/download`)).status,404);
 assert.ok((await query("SELECT count(*)::int n FROM audit_logs WHERE action='event_file_uploaded'")).rows[0].n>=1);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();await fs.rm(root,{recursive:true,force:true});}
});
