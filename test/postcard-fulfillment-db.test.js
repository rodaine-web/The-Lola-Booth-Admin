import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';

test('single-photo grants, scoped reporting, exclusions and exactly-once notification claims',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL,timeout:90000},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/_qa$/);
 const bootstrap=new pg.Pool({connectionString:url.toString()}),schema='fulfillment_'+crypto.randomBytes(6).toString('hex');let db;
 try{
  await bootstrap.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');
  Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',NODE_ENV:'test',GALLERY_ENABLED:'true',GALLERY_PUBLIC_ORIGIN:'https://staginggallery.thelolabooth.com',JWT_SECRET:'synthetic-postcard-fulfillment-secret',INTEGRATION_SECRET_KEY:'synthetic-fulfillment-encryption-key'});
  db=await import('../server/src/db/pool.js');const {query,transaction}=db,one=async(sql,args=[])=>(await query(sql,args)).rows[0];
  for(const f of(await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort())await transaction(()=>fs.readFile(new URL('../server/migrations/'+f,import.meta.url),'utf8').then(s=>query(s)));
  const user=await one("INSERT INTO users(name,email,password_hash) VALUES('QA Admin','postcard-admin@example.invalid','not-a-login') RETURNING id");
  await query("INSERT INTO roles(name) VALUES('ADMIN') ON CONFLICT DO NOTHING");await query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='ADMIN'",[user.id]);const admin={...user,roles:['ADMIN'],permissions:['*']};
  const client=await one("INSERT INTO clients(name,email,client_type) VALUES('Synthetic business','client@example.invalid','CORPORATE') RETURNING id");
  const event=await one("INSERT INTO events(event_name,event_type,event_date,client_id) VALUES('Synthetic postcard QA','CORPORATE','2035-11-18',$1) RETURNING id",[client.id]);
  const gallery=await import('../server/src/services/private-gallery-service.js');
  const album=await gallery.createGalleryAlbum(event.id,'Synthetic QA',admin);
  const photo=async name=>one("INSERT INTO gallery_media(album_id,storage_provider,storage_key,filename,mime_type,media_type,width,height,size_bytes,checksum) VALUES($1,'local',$2,$2,'image/jpeg','IMAGE',1800,1200,1,'qa') RETURNING id",[album.id,name]);
  const a=await photo('first.jpg'),b=await photo('second.jpg');
  const key=await gallery.createGalleryKey(album.id,'ALBUM',null,null,admin);
  const {photoLink,photoLinkView,resolvePhotoLink}=await import('../server/src/services/gallery-photo-link-service.js');
  const link=await photoLink(album.id,a.id),token=link.url.split('/').at(-1);assert.equal((await photoLink(album.id,a.id)).url,link.url);
  await assert.rejects(photoLinkView(token),{statusCode:404});
  await query("UPDATE gallery_albums SET status='PUBLISHED',expires_at=now()+interval '1 year' WHERE id=$1",[album.id]);
  const view=await photoLinkView(token);assert.equal(view.media.length,1);assert.equal(view.media[0].id,a.id);assert.equal(view.allowZip,false);assert.equal(view.type,'PHOTO');assert.ok(!JSON.stringify(view).includes(b.id));
  await query("UPDATE gallery_media SET status='HIDDEN' WHERE id=$1",[a.id]);await assert.rejects(resolvePhotoLink(token),{statusCode:404});await query("UPDATE gallery_media SET status='VISIBLE' WHERE id=$1",[a.id]);
  await query("UPDATE gallery_access_keys SET status='REVOKED' WHERE id=$1",[key.id]);await assert.rejects(photoLinkView(token),{statusCode:404});await query("UPDATE gallery_access_keys SET status='ACTIVE' WHERE id=$1",[key.id]);
  const {encryptSecretJson}=await import('../server/src/services/integration-secrets.js');
  const person=await gallery.createGalleryPerson(album.id,'Synthetic recipient');
  const recipient={name:'Synthetic Recipient',address_line1:'100 Sample St',address_line2:'',address_city:'Sample City',address_state:'MN',address_zip:'01234',address_country:'US'};
  const card=await one("INSERT INTO gallery_postcards(album_id,person_id,media_id,recipient_ciphertext,recipient_label,consent_at,consent_source,front_url,back_url,created_by) VALUES($1,$2,$3,$4,'Synthetic',now(),'Synthetic guest consent','gallery-media:'||$3::uuid::text,'https://example.invalid/back',$5) RETURNING id",[album.id,person.id,a.id,encryptSecretJson(recipient),user.id]);
  await query("INSERT INTO gallery_postcard_recipients(album_id,filename,fingerprint,recipient_ciphertext,recipient_label,consent,consent_source,status,person_id,media_id,postcard_id,created_by) VALUES($1,'first.jpg','synthetic',$2,'Synthetic',true,'Synthetic guest consent','PREPARED',$3,$4,$5,$6)",[album.id,encryptSecretJson(recipient),person.id,a.id,card.id,user.id]);
  const surveyBatch=await one('INSERT INTO gallery_fiesta_survey_batches(album_id,event_code,source_sha256,source_ciphertext,created_by) VALUES($1,\'QA\',$2,$3,$4) RETURNING id',[album.id,'1'.repeat(64),encryptSecretJson({csv:'Synthetic evidence'}),user.id]);
  const survey=(batchId=surveyBatch.id)=>one("INSERT INTO gallery_fiesta_survey_rows(album_id,batch_id,fingerprint,filename,source_row,person_id,status,answers_ciphertext) VALUES($1,$2,$3,'first.jpg',2,$4,'IMPORTED',$5) RETURNING id",[album.id,batchId,'2'.repeat(64),person.id,encryptSecretJson({postal:{recipient,consent:true}})]);
  const original=await survey();
  const {excludeRecipient,fulfillmentWorkspace}=await import('../server/src/services/postcard-fulfillment-service.js');
  const {assertPostcardSurveyClear}=await import('../server/src/services/fiesta-survey-review-service.js');
  await excludeRecipient(album.id,original.id,'Client asked to hold this recipient',admin);
  await assert.rejects(assertPostcardSurveyClear(album.id,[card.id]),{code:'POSTCARD_EXCLUDED'});
  const revisedBatch=await one('INSERT INTO gallery_fiesta_survey_batches(album_id,event_code,source_sha256,source_ciphertext,created_by) VALUES($1,\'QA\',$2,$3,$4) RETURNING id',[album.id,'3'.repeat(64),encryptSecretJson({csv:'Corrected synthetic evidence'}),user.id]);
  const revised=await survey(revisedBatch.id);assert.equal((await fulfillmentWorkspace(album.id,admin)).rows.find(r=>r.survey_row_id===revised.id).result.status,'EXCLUDED');
  await excludeRecipient(album.id,revised.id,'Client authorized restoring this recipient',admin,false);await assertPostcardSurveyClear(album.id,[card.id]);
  const batch=await one("INSERT INTO gallery_live_mailing_batches(album_id,quantity,cost_limit_cents,unit_cost_cents,price_source,status,created_by) VALUES($1,1,100,100,'Synthetic approved pricing','COMPLETE',$2) RETURNING id",[album.id,user.id]);
  await query("INSERT INTO gallery_live_mailing_jobs(batch_id,album_id,postcard_id,revision,recipient_label,recipient_key,recipient_ciphertext,sender_ciphertext,sender_hash,proof_hash,test_postcard_id,cost_cents,status,lob_postcard_id,submitted_at,expected_delivery_date) VALUES($1,$2,$3,1,'Synthetic',$4,$5,$5,$4,$4,'psc_testSynthetic',100,'SUBMITTED','psc_liveSynthetic',now(),'2035-11-25')",[batch.id,album.id,card.id,'0'.repeat(64),encryptSecretJson(recipient)]);
  const data=await fulfillmentWorkspace(album.id,admin);assert.equal(data.summary.images,2);assert.equal(data.summary.successful,1);assert.equal(data.rows.find(r=>r.postcard_id===card.id).recipient.address_zip,'01234');
  const reports=await import('../server/src/services/postcard-report-service.js');
  let sends=0;const send=async message=>{sends++;assert.equal(message.to,'client@example.invalid');assert.equal(message.attachments.length,1);assert.ok(message.attachments[0].buffer.length>1000);assert.doesNotMatch(message.text,/\$|cost|budget/);return {deliveredExternally:true};};
  const results=await Promise.all([reports.processPostcardNotifications({send}),reports.processPostcardNotifications({send})]);assert.equal(sends,1);assert.equal(results.flat().filter(r=>r.status==='SENT').length,1);
  await reports.processPostcardNotifications({send});assert.equal(sends,1);
  const stored=await one('SELECT * FROM gallery_postcard_reports WHERE album_id=$1',[album.id]);assert.ok(stored.snapshot_ciphertext);assert.ok((await reports.adminReportDownload(album.id,stored.id,admin)).length>1000);
  await assert.rejects(reports.clientReportDownload({client_id:crypto.randomUUID()},event.id,stored.id));
  const {default:express}=await import('express'),{galleryPublicRouter,galleryAdminRouter}=await import('../server/src/routes/gallery.js'),{clientSessionRouter}=await import('../server/src/routes/client-session.js'),{errorHandler}=await import('../server/src/middleware/error-handler.js');
  const app=express();app.use(express.json());app.use('/api/gallery',galleryPublicRouter);app.use('/api/gallery-admin',galleryAdminRouter);app.use('/api/public/client',clientSessionRouter);app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try{
   assert.equal((await fetch(origin+`/api/gallery-admin/albums/${album.id}/postcard-workspace`)).status,401);
   assert.equal((await fetch(origin+`/api/gallery/access/photo/${token}/zip`)).status,404);
   assert.equal((await fetch(origin+`/api/gallery/access/photo/${token}/media/${b.id}/download`,{method:'POST'})).status,404);
   process.env.APP_ENV='development';
   assert.equal((await fetch(origin+`/api/public/client/events/${event.id}/postcard-reports`)).status,401);
   process.env.APP_ENV='test';
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await query("UPDATE gallery_postcard_notifications SET status='SENDING',started_at=now()-interval '1 hour' WHERE album_id=$1",[album.id]);await reports.processPostcardNotifications({send});assert.equal(sends,1);assert.equal((await one('SELECT status FROM gallery_postcard_notifications WHERE album_id=$1',[album.id])).status,'NEEDS_REVIEW');
  // No physical-mail dispatch path is invoked by report generation or notification.
  assert.equal((await one('SELECT count(*)::int n FROM gallery_live_mailing_jobs')).n,1);
 }finally{if(db)await db.pool.end();await bootstrap.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await bootstrap.end();}
});
