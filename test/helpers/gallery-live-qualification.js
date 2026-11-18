import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as live from '../../server/src/services/gallery-live-mailing-service.js';
export async function qualifyLiveMailing({db,admin,album,card,root}){
 const names=['APP_ENV','GALLERY_STORAGE_PROVIDER','GALLERY_STORAGE_ENV','GALLERY_S3_BUCKET','GALLERY_S3_ACCESS_KEY_ID','GALLERY_S3_SECRET_ACCESS_KEY','GALLERY_S3_REGION','GALLERY_S3_ENDPOINT','GALLERY_S3_PATH_STYLE','GALLERY_MAILING_LIVE_ENABLED','GALLERY_MAILING_LIVE_WORKER_ENABLED','LOB_LIVE_API_KEY','LOB_LIVE_WEBHOOK_SECRET'];
 const old=Object.fromEntries(names.map(k=>[k,process.env[k]])),originalFetch=globalThis.fetch;
 const media=(await db.query('SELECT id,storage_key,storage_provider FROM gallery_media WHERE album_id=$1',[album.id])).rows;
 const backs=(await db.query('SELECT id,storage_key,storage_provider FROM gallery_postcard_back_artworks WHERE album_id=$1',[album.id])).rows;
 const blobs=new Map();
 for(const r of [...media,...backs])blobs.set('/qa-bucket/'+r.storage_key.replace(/^development\//,'production/'),await fs.readFile(root+'/'+r.storage_key));
 const server=http.createServer((req,res)=>{const b=blobs.get(new URL(req.url,'http://localhost').pathname);if(!b){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Length':b.length,'Content-Type':'application/octet-stream'});res.end(b);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const input={postcard_ids:[card.id],cost_limit_cents:100,unit_cost_cents:100,price_source:'Synthetic provider all-in price approved for isolated QA only.'};
 try{
  await assert.rejects(live.prepareLiveBatch(album.id,{...input,cost_limit_cents:99},admin));
  const batch=await live.prepareLiveBatch(album.id,input,admin);
  await assert.rejects(live.prepareLiveBatch(album.id,input,admin),'live recipient uniqueness persists across batches');
  await assert.rejects(live.authorizeLiveBatch(album.id,batch.id,{confirmation:'AUTHORIZE LIVE MAILING',note:'Synthetic live authorization'},admin),'development cannot release live mail');
  Object.assign(process.env,{APP_ENV:'production',GALLERY_STORAGE_PROVIDER:'s3',GALLERY_STORAGE_ENV:'production',GALLERY_S3_BUCKET:'qa-bucket',GALLERY_S3_ACCESS_KEY_ID:'synthetic',GALLERY_S3_SECRET_ACCESS_KEY:'synthetic',GALLERY_S3_REGION:'us-east-1',GALLERY_S3_ENDPOINT:'http://127.0.0.1:'+server.address().port,GALLERY_S3_PATH_STYLE:'true',GALLERY_MAILING_LIVE_ENABLED:'true',GALLERY_MAILING_LIVE_WORKER_ENABLED:'true',LOB_LIVE_API_KEY:'live_synthetic_only',LOB_LIVE_WEBHOOK_SECRET:'synthetic-live-webhook-secret'});
  for(const [table,rs]of [['gallery_media',media],['gallery_postcard_back_artworks',backs]])for(const r of rs)await db.query(`UPDATE ${table} SET storage_provider='s3',storage_key=$2 WHERE id=$1`,[r.id,r.storage_key.replace(/^development\//,'production/')]);
  await assert.rejects(live.authorizeLiveBatch(album.id,batch.id,{confirmation:'AUTHORIZE LIVE MAILING',note:'Synthetic live authorization'},admin),'an unverified webhook blocks production release');
  const pollingInput={confirmation:'AUTHORIZE LIVE MAILING',note:'Synthetic authenticated polling authorization',status_channel:'POLLING'};
  let reads=0;
  globalThis.fetch=async(url,options={})=>{reads++;assert.equal(url,'https://api.lob.com/v1/postcards?limit=1');assert.equal(options.method,undefined);return new Response(JSON.stringify({error:'Invalid synthetic key'}),{status:401});};
  await assert.rejects(live.authorizeLiveBatch(album.id,batch.id,pollingInput,admin),/could not be verified/);
  assert.equal((await db.query('SELECT status FROM gallery_live_mailing_batches WHERE id=$1',[batch.id])).rows[0].status,'DRAFT');
  globalThis.fetch=async()=>new Response(JSON.stringify({unexpected:true}),{status:200});
  await assert.rejects(live.authorizeLiveBatch(album.id,batch.id,pollingInput,admin),/invalid status response/);
  globalThis.fetch=async(url,options={})=>{reads++;assert.equal(options.method,undefined);return new Response(JSON.stringify({data:[]}),{status:200});};
  await live.authorizeLiveBatch(album.id,batch.id,pollingInput,admin);
  assert.equal((await db.query('SELECT status_channel FROM gallery_live_mailing_batches WHERE id=$1',[batch.id])).rows[0].status_channel,'POLLING');
  assert.equal((await db.query('SELECT count(*)::int n FROM gallery_live_webhook_health')).rows[0].n,0,'polling never invents a signed webhook receipt');
  await live.cancelLiveBatch(album.id,batch.id,admin);
  const webhookBatch=await live.prepareLiveBatch(album.id,input,admin);
  batch.id=webhookBatch.id;
  globalThis.fetch=originalFetch;
  function event(id,type,reference='psc_LiveQA',date=new Date().toISOString()){
   const raw=Buffer.from(JSON.stringify({id,event_type:{id:type},reference_id:reference,date_created:date})),stamp=String(Math.floor(Date.now()/1000));return {raw,headers:{'lob-signature-timestamp':stamp,'lob-signature':crypto.createHmac('sha256',process.env.LOB_LIVE_WEBHOOK_SECRET).update(stamp+'.').update(raw).digest('hex')}};
  }
  const health=event('evt_LiveHealth','postcard.created');await assert.rejects(live.receiveLiveLobEvent(health.raw,{...health.headers,'lob-signature':'0'.repeat(64)}));
  await live.receiveLiveLobEvent(health.raw,health.headers);await live.receiveLiveLobEvent(health.raw,health.headers);
  assert.equal((await db.query("SELECT count(*)::int n FROM gallery_live_lob_events WHERE event_id='evt_LiveHealth'")).rows[0].n,1);
  await assert.rejects(live.authorizeLiveBatch(album.id,batch.id,{confirmation:'TEST ONLY',note:'Synthetic live authorization'},admin));
  await live.authorizeLiveBatch(album.id,batch.id,{confirmation:'AUTHORIZE LIVE MAILING',note:'Synthetic all-in budget and final proofs approved.'},admin);
  let attempts=0;
  globalThis.fetch=async(url,options={})=>{assert.equal(options.method,undefined,'polling never creates an order');return new Response(JSON.stringify({id:'psc_LiveQA',status:'rendered'}),{status:200});};
  const result=await live.processLiveMailingQueue({transport:async(url,options)=>{
   attempts++;assert.equal(url,'https://api.lob.com/v1/postcards');assert.ok(options.headers['Idempotency-Key'].startsWith('lola-live:'));
   assert.equal(options.body.get('mail_type'),'usps_first_class');assert.equal(options.body.get('from[name]'),'Mailing QA Client');
   return new Response(JSON.stringify({id:'psc_LiveQA',status:'processed'}),{status:200});
  }});
  assert.deepEqual(result.map(r=>r.status),['SUBMITTED']);assert.equal(attempts,1);
  assert.equal((await db.query('SELECT status FROM gallery_live_mailing_batches WHERE id=$1',[batch.id])).rows[0].status,'COMPLETE');
  await live.processLiveMailingQueue({transport:async()=>{throw Error('No duplicate submission allowed');}});assert.equal(attempts,1);
  const delivered=event('evt_LiveDelivered','postcard.delivered');await live.receiveLiveLobEvent(delivered.raw,delivered.headers);
  const older=event('evt_LiveOlder','postcard.mailed','psc_LiveQA',new Date(Date.now()-60000).toISOString());await live.receiveLiveLobEvent(older.raw,older.headers);
  assert.equal((await db.query("SELECT lob_status FROM gallery_live_mailing_jobs WHERE lob_postcard_id='psc_LiveQA'")).rows[0].lob_status,'delivered');
  assert.equal((await db.query('SELECT status FROM gallery_postcards WHERE id=$1',[card.id])).rows[0].status,'SUBMITTED_TEST','live release must preserve test history');
  await assert.rejects(live.cancelLiveBatch(album.id,batch.id,admin),'provider-created orders cannot be cancelled implicitly');
 }finally{
  globalThis.fetch=originalFetch;
  for(const [table,rs]of [['gallery_media',media],['gallery_postcard_back_artworks',backs]])for(const r of rs)await db.query(`UPDATE ${table} SET storage_provider=$2,storage_key=$3 WHERE id=$1`,[r.id,r.storage_provider,r.storage_key]);
  for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;
  await new Promise(resolve=>server.close(resolve));
 }
}
