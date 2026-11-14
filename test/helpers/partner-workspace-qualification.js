import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {once} from 'node:events';
import nodePath from 'node:path';
import {env} from '../../server/src/config/env.js';
import {getStorageProvider} from '../../server/src/services/storage-service.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {partnerWorkspacesRouter,publicPartnerWorkspaceRouter} from '../../server/src/routes/partner-workspaces.js';
import {errorHandler} from '../../server/src/middleware/error-handler.js';

export async function qualifyPartnerWorkspace({db,user,partner,event}){
 await db.query("INSERT INTO permissions(key) VALUES('read:sales'),('write:sales'),('read:events') ON CONFLICT DO NOTHING");
 await db.query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key IN('read:sales','write:sales','read:events') ON CONFLICT DO NOTHING",[user.id]);
 await db.query("INSERT INTO event_partners(event_id,partner_id,role) VALUES($1,$2,'ORGANIZER')",[event.id,partner.id]);
 const app=express();app.use(express.json());app.use('/api/partner-workspaces',publicPartnerWorkspaceRouter);app.use('/api',partnerWorkspacesRouter);
 if(process.env.LOLA_QA_FRONTEND_DIR){
  const directory=nodePath.resolve(process.env.LOLA_QA_FRONTEND_DIR);
  assert.ok(directory.startsWith('/private/tmp/lola-'),'browser fixture serves only the isolated QA build');
  app.use('/customer-documents',express.static(directory));app.use(express.static(directory));app.get('/partner-workspace',(_req,res)=>res.sendFile(nodePath.join(directory,'index.html')));
 }
 app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${server.address().port}`;
 const oldOrigin=env.clientOrigin,oldRoot=env.localStorageRoot,oldProvider=env.storageProvider;const root=await fs.mkdtemp('/private/tmp/lola-partner-files-');env.clientOrigin=origin;env.localStorageRoot=root;env.storageProvider='local';
 const token=jwt.sign({sub:user.id},process.env.JWT_SECRET,{expiresIn:'5m'});
 const request=async(path,{method='GET',body,admin=false,cookie}={})=>{
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(admin?{Authorization:`Bearer ${token}`}:{}) ,...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {response,body:await response.json()};
 };
 const path=`/api/partners/${partner.id}/workspace`;
 const invite=async()=>{
  const result=await request(path+'/invite',{method:'POST',admin:true});assert.equal(result.response.status,201);
  assert.equal(result.body.recipientEmail,'partner-qa@example.invalid');
  return new URL('https://example.invalid'+result.body.invitationPath).hash.slice('#token='.length);
 };
 try{
  assert.equal((await request(path)).response.status,401,'admin workspace records require authentication');
  assert.equal((await request(path,{admin:true})).response.status,200);
  assert.equal((await request(path,{method:'POST',admin:true})).response.status,409,'duplicate workspace creation is rejected');
  const unrelated=(await db.query("INSERT INTO events(event_name,event_type,event_date) VALUES('Unrelated QA','Corporate Event','2035-12-01') RETURNING id")).rows[0];
  assert.equal((await request(path+'/events',{method:'PUT',admin:true,body:{eventIds:[unrelated.id]}})).response.status,422,'unassociated events cannot be granted');
  assert.equal((await request(path+'/events',{method:'PUT',admin:true,body:{eventIds:[event.id]}})).response.status,200);
  const bytes=Buffer.from('Synthetic private venue reference');const stored=await getStorageProvider().put({buffer:bytes,filename:'QA-venue.txt'});
  const file=(await db.query("INSERT INTO files(event_id,category,filename,visibility,storage_provider,storage_key,mime_type,size_bytes,content_sha256) VALUES($1,'VENUE','QA-venue.txt','PRIVATE','LOCAL',$2,'text/plain',$3,$4) RETURNING id",[event.id,stored.storageKey,bytes.length,crypto.createHash('sha256').update(bytes).digest('hex')])).rows[0];
  const financial=(await db.query("INSERT INTO files(event_id,category,filename,visibility,storage_provider,storage_key,size_bytes,content_sha256) VALUES($1,'INVOICE','PRIVATE-INVOICE.txt','PRIVATE','LOCAL',$2,$3,$4) RETURNING id",[event.id,stored.storageKey,bytes.length,crypto.createHash('sha256').update(bytes).digest('hex')])).rows[0];
  assert.equal((await request(path+'/files',{method:'POST',admin:true,body:{fileId:financial.id,shared:true}})).response.status,404,'financial files cannot be shared through the partner workspace');
  assert.equal((await request(path+'/files',{method:'POST',admin:true,body:{fileId:file.id,shared:true}})).response.status,200);
  const initial=await invite();
  if(process.env.LOLA_QA_FRONTEND_DIR){const {qualifyPartnerBrowser}=await import('./partner-workspace-browser.js');await qualifyPartnerBrowser(origin,initial);}
  const view=await request('/api/partner-workspaces/view',{method:'POST',body:{token:initial}});
  assert.equal(view.response.status,200);assert.equal(view.body.events.length,1);
  assert.deepEqual(Object.keys(view.body.events[0]).sort(),['event_date','event_name','id','status'],'external partner view excludes finance and private contact records');
  const setCookie=view.response.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/Path=\/api\/partner-workspaces/);
  const cookie=setCookie.split(';')[0];
  const detail=await request('/api/partner-workspaces/events/'+event.id,{cookie});assert.equal(detail.response.status,200);assert.equal(detail.body.files.length,1);
  assert.equal((await request('/api/partner-workspaces/events/'+unrelated.id,{cookie})).response.status,404);
  let download=await fetch(`${origin}/api/partner-workspaces/events/${event.id}/files/${file.id}`,{headers:{Cookie:cookie}});assert.equal(download.status,200);assert.equal(await download.text(),bytes.toString());
  await request(path+'/files',{method:'POST',admin:true,body:{fileId:file.id,shared:false}});
  download=await fetch(`${origin}/api/partner-workspaces/events/${event.id}/files/${file.id}`,{headers:{Cookie:cookie}});assert.equal(download.status,404,'removing a grant revokes subsequent downloads');
  const review=await request(path+'/review',{admin:true});
  if(review.body.requests[0]){const r=review.body.requests[0];assert.equal((await request(path+`/requests/${r.id}/resolve`,{method:'POST',admin:true})).response.status,200);}

  assert.equal((await request('/api/partner-workspaces/view',{method:'POST',body:{},cookie})).response.status,200,'reload works without retaining invitation in URL or localStorage');
  const logout=await request('/api/partner-workspaces/logout',{method:'POST',body:{},cookie});assert.equal(logout.response.status,200);assert.match(logout.response.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
  assert.notEqual((await request('/api/partner-workspaces/view',{method:'POST',body:{}})).response.status,200,'cleared browser cookie cannot re-enter');
  await request(path+'/events',{method:'PUT',admin:true,body:{eventIds:[]}});
  assert.equal((await request('/api/partner-workspaces/view',{method:'POST',body:{},cookie})).response.status,404,'changing grants revokes existing cookie access');
  await request(path+'/events',{method:'PUT',admin:true,body:{eventIds:[event.id]}});
  const expired=await invite();await db.query("UPDATE partner_workspace_invitations SET expires_at=now()-interval '1 second' WHERE revoked_at IS NULL");
  assert.equal((await request('/api/partner-workspaces/view',{method:'POST',body:{token:expired}})).response.status,404);
  const changedEmail=await invite();await db.query("UPDATE partners SET email='new-contact@example.invalid' WHERE id=$1",[partner.id]);
  assert.equal((await request('/api/partner-workspaces/view',{method:'POST',body:{token:changedEmail}})).response.status,404,'old invitation cannot survive a changed recipient identity');
  await db.query("UPDATE partners SET email='partner-qa@example.invalid' WHERE id=$1",[partner.id]);
  const archived=await invite();await db.query("UPDATE partners SET status='ARCHIVED' WHERE id=$1",[partner.id]);
  assert.equal((await request('/api/partner-workspaces/view',{method:'POST',body:{token:archived}})).response.status,404);
  await db.query("UPDATE partners SET status='ACTIVE' WHERE id=$1",[partner.id]);
  const revoked=await invite();assert.equal((await request(path+'/revoke',{method:'POST',admin:true})).response.status,200);
  assert.equal((await request('/api/partner-workspaces/view',{method:'POST',body:{token:revoked}})).response.status,404);
 }finally{await new Promise(resolve=>server.close(resolve));env.clientOrigin=oldOrigin;env.localStorageRoot=oldRoot;env.storageProvider=oldProvider;await fs.rm(root,{recursive:true,force:true});}
}
