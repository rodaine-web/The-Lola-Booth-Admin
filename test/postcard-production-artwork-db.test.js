import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import pg from 'pg';
import sharp from 'sharp';

test('production artwork upload, private preview and approval work without enabling dispatch',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/_qa$/);
 const bootstrap=new pg.Pool({connectionString:url.toString()}),schema='artwork_qa_'+crypto.randomBytes(6).toString('hex');let db,apiServer,s3;
 try{
  await bootstrap.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');
  Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',NODE_ENV:'test',JWT_SECRET:'synthetic-artwork-only-jwt-secret-32chars',INTEGRATION_SECRET_KEY:'synthetic-artwork-only-encryption-key'});
  db=await import('../server/src/db/pool.js');const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
  for(const file of(await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort())await db.transaction(()=>fs.readFile(new URL('../server/migrations/'+file,import.meta.url),'utf8').then(sql=>db.query(sql)));
  const user=await one("INSERT INTO users(name,email,password_hash) VALUES('Synthetic artwork QA','artwork-qa@example.invalid','not-a-login') RETURNING id");
  await db.query("INSERT INTO permissions(key) VALUES('*') ON CONFLICT DO NOTHING");await db.query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='*'",[user.id]);
  const event=await one("INSERT INTO events(event_name,event_type,event_date) VALUES('ARTWORK QA','CORPORATE','2035-11-18') RETURNING id");
  const album=await one("INSERT INTO gallery_albums(event_id,title) VALUES($1,'ARTWORK QA') RETURNING id",[event.id]);
  const objects=new Map();let puts=0;
  s3=http.createServer(async(req,res)=>{const key=new URL(req.url,'http://localhost').pathname;const chunks=[];for await(const chunk of req)chunks.push(chunk);if(req.method==='PUT'){puts++;objects.set(key,Buffer.concat(chunks));res.writeHead(200,{ETag:'"synthetic"'});res.end();}else if(req.method==='GET'&&objects.has(key)){res.writeHead(200,{'Content-Type':'image/png'});res.end(objects.get(key));}else{res.statusCode=404;res.end();}});
  s3.listen(0,'127.0.0.1');await new Promise(resolve=>s3.once('listening',resolve));
  Object.assign(process.env,{APP_ENV:'production',GALLERY_ENABLED:'true',GALLERY_STORAGE_PROVIDER:'s3',GALLERY_STORAGE_ENV:'production',GALLERY_S3_BUCKET:'qa-bucket',GALLERY_S3_REGION:'us-east-1',GALLERY_S3_ACCESS_KEY_ID:'synthetic',GALLERY_S3_SECRET_ACCESS_KEY:'synthetic',GALLERY_S3_PATH_STYLE:'true',GALLERY_S3_ENDPOINT:`http://127.0.0.1:${s3.address().port}`,GALLERY_POSTCARD_PREPARATION_ENABLED:'false',LOB_PRODUCTION_TEST_ENABLED:'false',GALLERY_MAILING_LIVE_ENABLED:'false',GALLERY_MAILING_LIVE_WORKER_ENABLED:'false'});
  const {default:express}=await import('express'),{default:jwt}=await import('jsonwebtoken'),{galleryAdminRouter}=await import('../server/src/routes/gallery.js'),{errorHandler}=await import('../server/src/middleware/error-handler.js');
  const app=express();app.use(express.json({limit:'14mb'}));app.use('/api/gallery-admin',galleryAdminRouter);app.use(errorHandler);apiServer=app.listen(0,'127.0.0.1');await new Promise(resolve=>apiServer.once('listening',resolve));
  const base=`http://127.0.0.1:${apiServer.address().port}/api/gallery-admin/albums/${album.id}`,headers={authorization:'Bearer '+jwt.sign({sub:user.id},process.env.JWT_SECRET),'content-type':'application/json'};
  const bytes=await sharp({create:{width:1875,height:1275,channels:3,background:'#ffffff'}}).png().toBuffer(),payload={filename:'synthetic-back.png',mime_type:'image/png',base64:bytes.toString('base64')};
  const post=(suffix,body)=>fetch(base+suffix,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await post('/postcard-backs',payload)).status,403);assert.equal(puts,0);
  process.env.GALLERY_POSTCARD_PREPARATION_ENABLED='true';
  assert.equal((await fetch(base+'/postcard-backs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})).status,401);
  const small=await sharp({create:{width:100,height:100,channels:3,background:'#ffffff'}}).png().toBuffer();assert.equal((await post('/postcard-backs',{...payload,base64:small.toString('base64')})).status,422);
  const response=await post('/postcard-backs',payload);assert.equal(response.status,201,await response.clone().text());const art=await response.json();assert.equal(art.status,'DRAFT');assert.equal(puts,1);
  const preview=await fetch(base+`/postcard-backs/${art.id}/media`,{headers});assert.equal(preview.status,200);assert.deepEqual(Buffer.from(await preview.arrayBuffer()),bytes);
  const approved=await post(`/postcard-backs/${art.id}/approve`,{});assert.equal(approved.status,200);assert.equal((await approved.json()).status,'APPROVED');
  const {lobPrintTestEnabled}=await import('../shared/postcard-print-policy.js');assert.equal(lobPrintTestEnabled(process.env),false);
  const {submitLobPrintTest}=await import('../server/src/services/lob-print-ready-service.js');await assert.rejects(submitLobPrintTest(album.id,crypto.randomUUID(),user),error=>error.statusCode===403);
  for(const table of ['gallery_postcards','gallery_mailing_jobs','gallery_live_mailing_jobs'])assert.equal((await one(`SELECT count(*)::int n FROM ${table}`)).n,0);
 }finally{
  for(const server of [apiServer,s3])if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(db)await db.pool.end();await bootstrap.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await bootstrap.end();
 }
});
