import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import {normalizePhotoLookup,photoSourceForProduct} from '../shared/keepsakes-photo-access.js';
test('phone/email normalization and explicit source selection',()=>{
 assert.equal(normalizePhotoLookup('SMS','(312) 555-0123'),'+13125550123');assert.equal(normalizePhotoLookup('EMAIL',' Guest@Example.com '),'guest@example.com');assert.equal(normalizePhotoLookup('SMS','abc123'),null);
 const assets=[{id:'a',sessionId:'s',kind:'COMPOSITE',branded:true},{id:'b',sessionId:'s',kind:'ORIGINAL',branded:false},{id:'c',sessionId:'s',kind:'BRANDED_STRIP',branded:true},{id:'other',sessionId:'x',kind:'ORIGINAL',branded:false}];
 assert.equal(photoSourceForProduct({source:'ORIGINAL_UNBRANDED'},assets,'a').asset.id,'b');assert.equal(photoSourceForProduct({source:'BRANDED_STRIP'},assets,'a').asset.id,'c');assert.equal(photoSourceForProduct({source:'BRANDED_STRIP'},assets.slice(0,2),'a').asset,undefined);
});
test('photo retrieval queues neutral email, binds unverified phone associations, redeems once and rechecks every scope',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL,timeout:120000},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/_qa$/);
 const schema='photo_access_'+crypto.randomBytes(6).toString('hex'),bootstrap=new pg.Pool({connectionString:url.toString()}),storage=await fs.mkdtemp(path.join(os.tmpdir(),'lola-photo-access-'));let db;
 try{
  await bootstrap.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');
  Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',NODE_ENV:'test',JWT_SECRET:'synthetic-photo-access-signing-secret',INTEGRATION_SECRET_KEY:'synthetic-photo-access-encryption-key',CLIENT_ORIGIN:'http://localhost:5173',GALLERY_ENABLED:'true',GALLERY_STORAGE_PROVIDER:'local',GALLERY_LOCAL_ROOT:storage,GALLERY_PUBLIC_ORIGIN:'https://staginggallery.thelolabooth.com',EMAIL_PROVIDER:'development',SMS_PROVIDER:'none'});
  db=await import('../server/src/db/pool.js');const {query,transaction}=db,one=async(s,p=[])=>(await query(s,p)).rows[0];
  for(const f of (await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort())await transaction(()=>fs.readFile(new URL('../server/migrations/'+f,import.meta.url),'utf8').then(query));
  const admin=await one("INSERT INTO users(name,email,password_hash) VALUES('Photo QA','photo-admin@example.invalid','not-a-login') RETURNING id");admin.roles=['ADMIN'];admin.permissions=['*'];
  const station=await import('../server/src/services/keepsake-station-policy-service.js'),{DEFAULT_STATION_POLICY}=await import('../shared/keepsake-station-policy.js');
  await assert.rejects(station.stationPolicyAdmin({roles:['ATTENDANT'],permissions:[]}),{code:'FORBIDDEN'});
  const {packages,paidTiers,optionalTiers}=DEFAULT_STATION_POLICY;
  const saved=await station.saveStationPolicy({packages,paidTiers,optionalTiers},admin);assert.equal(saved.status,'DRAFT');
  const q=await station.previewStationPolicy({selections:[{experience:'glam',tier:'SIGNATURE'}],baseCents:89900,complimentary:{keychain:50},paid:{keychain:25,magnet:25},optional:{'framed-photo':5,'jacketed-print':10,'acrylic-display':5,postcard:10}},admin);assert.equal(q.totalCents,209220);assert.equal(q.policyVersion,saved.version);assert.equal(q.purchasable,false);
  await station.saveStationPolicy({packages,paidTiers:paidTiers.map(t=>({...t,keychain:t.keychain+100})),optionalTiers},admin);assert.equal(q.totalCents,209220);assert.equal((await one('SELECT count(*)::int AS n FROM keepsake_station_policies')).n,2);
  const client=await one("INSERT INTO clients(name,email,client_type) VALUES('Photo QA','photo-client@example.invalid','CORPORATE') RETURNING id");
  const gallery=await import('../server/src/services/private-gallery-service.js'),access=await import('../server/src/services/keepsakes-photo-access-service.js'),manager=await import('../server/src/services/keepsakes-admin-service.js');
  const {importFiestaShares}=await import('../server/src/services/fiesta-gallery-service.js'),{photoLink}=await import('../server/src/services/gallery-photo-link-service.js');
  // Seed exactly the imported identity representation; unrelated filenames never confer access.
  const {encryptSecretJson,decryptSecretJson}=await import('../server/src/services/integration-secrets.js');
  const fixtures=[];
  for(let i=0;i<2;i++){
   const event=await one("INSERT INTO events(event_name,event_type,event_date,client_id) VALUES($1,'CORPORATE','2035-11-18',$2) RETURNING id",['Photo event '+i,client.id]);
   const album=await gallery.createGalleryAlbum(event.id,'Photo event '+i,admin);
   const upload=async name=>{const bytes=await sharp({create:{width:800,height:600,channels:3,background:i?'#304050':'#b48a50'}}).jpeg().toBuffer();return gallery.uploadGalleryMedia(album.id,{filename:name,mime_type:'image/jpeg',base64:bytes.toString('base64'),source_provider:'MANUAL'});};
   const anchor=await upload('guest.jpg'),unrelated=await upload('other.jpg'),original=await upload('unbranded.jpg'),strip=await upload('strip.jpg');
   await query("UPDATE gallery_media SET status='HIDDEN' WHERE id=ANY($1::uuid[])",[[original.id,strip.id]]);
   await query("UPDATE gallery_albums SET status='PUBLISHED',expires_at=now()+interval '1 year' WHERE id=$1",[album.id]);
   const albumKey=await gallery.createGalleryKey(album.id,'ALBUM',null,null,admin);
   const people=[];
   for(const [channel,recipient]of [['EMAIL','guest@example.invalid'],['SMS','+13125550123']]){
    const fingerprint=crypto.createHmac('sha256',process.env.INTEGRATION_SECRET_KEY).update(channel+':'+recipient).digest('hex');
    const person=await one('INSERT INTO gallery_people(album_id,display_name,external_ref) VALUES($1,$2,$3) RETURNING id',[album.id,'Guest','fiesta:'+fingerprint]);people.push(person);
    await query('INSERT INTO fiesta_gallery_shares(album_id,person_id,filename,channel,recipient_ciphertext,capture_ref,source_share_time) VALUES($1,$2,$3,$4,$5,$6,$7)',[album.id,person.id,'guest.jpg',channel,encryptSecretJson({recipient}),'capture','now']);
    await query('INSERT INTO gallery_media_people(album_id,media_id,person_id) VALUES($1,$2,$3)',[album.id,anchor.id,person.id]);
   }
   await manager.saveKeepsakesSession(album.id,{anchorMediaId:anchor.id,assets:[{mediaId:anchor.id,kind:'COMPOSITE',label:'Included photo',sortOrder:0,branded:true,merchandiseEligible:true,digitalEligible:false,included:true},{mediaId:original.id,kind:'ORIGINAL',label:'Unbranded photo',sortOrder:1,branded:false,merchandiseEligible:true,digitalEligible:true,included:false},{mediaId:strip.id,kind:'BRANDED_STRIP',label:'Branded strip',sortOrder:2,branded:true,merchandiseEligible:true,digitalEligible:false,included:false}]},admin);
   fixtures.push({album,anchor,unrelated,original,people,albumKey});
  }
  const neutral=await access.requestPhotoAccess({channel:'EMAIL',value:'nobody@example.invalid'});assert.equal((await one('SELECT count(*)::int AS n FROM communications')).n,0);
  assert.deepEqual(await access.requestPhotoAccess({channel:'EMAIL',value:'guest@example.invalid'}),neutral);
  const email=await one('SELECT * FROM communications ORDER BY created_at DESC LIMIT 1');assert.equal(email.status,'SCHEDULED');assert.equal(email.recipient,'guest@example.invalid');assert.equal(email.trigger_key,'KEEPSAKES_PHOTO_ACCESS');
  const code=/#code=([\w-]+)/.exec(email.rendered_body)[1];assert.equal(code.length,43);assert.ok(!email.rendered_body.includes('Photo event'));
  await Promise.all([access.requestPhotoAccess({channel:'EMAIL',value:'guest@example.invalid'}),access.requestPhotoAccess({channel:'EMAIL',value:'guest@example.invalid'})]);assert.equal((await one('SELECT count(*)::int AS n FROM communications')).n,1);
  const outcomes=await Promise.allSettled([access.redeemPhotoAccess(code),access.redeemPhotoAccess(code)]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
  const session=outcomes.find(o=>o.status==='fulfilled').value;
  let view=await access.photoCollection(session.token);assert.equal(view.albums.length,2);assert.equal(view.assets.length,6);assert.ok(!JSON.stringify(view).includes('storage_key'));assert.ok(!JSON.stringify(view).includes(session.token));
  await assert.rejects(access.collectionPhoto(session.token,fixtures[0].unrelated.id),{code:'PHOTO_ACCESS_UNAVAILABLE'});
  const image=await access.collectionPhoto(session.token,view.assets[0].id);assert.equal((await sharp(image).metadata()).format,'jpeg');
  await access.requestPhotoAccess({channel:'PHONE',value:'(312) 555-0123',email:'test-recipient@example.invalid'});
  const association=await one('SELECT * FROM keepsakes_unverified_contacts');assert.equal(association.verification_status,'UNVERIFIED');assert.equal(decryptSecretJson(association.contact_ciphertext).email,'test-recipient@example.invalid');assert.ok(!JSON.stringify(association).includes('+13125550123'));
  // A newly revoked personal key takes precedence over any album grant.
  const personal=await gallery.createGalleryKey(fixtures[0].album.id,'PERSON',fixtures[0].people[0].id,null,admin);
  await query("UPDATE gallery_access_keys SET status='REVOKED' WHERE id=$1",[personal.id]);
  await query("UPDATE keepsakes_photo_requests SET created_at=now()-interval '3 minutes'");
  await access.requestPhotoAccess({channel:'EMAIL',value:'guest@example.invalid'});
  const latest=await one('SELECT * FROM keepsakes_photo_requests ORDER BY created_at DESC LIMIT 1');assert.equal(latest.scopes.length,1);assert.equal(latest.scopes[0].albumId,fixtures[1].album.id);
  // Existing access also ceases when its original grant or album is revoked.
  await query("UPDATE gallery_access_keys SET status='REVOKED' WHERE id=$1",[fixtures[0].albumKey.id]);view=await access.photoCollection(session.token);assert.equal(view.albums.length,1);
  await query("UPDATE gallery_people SET status='ARCHIVED' WHERE id=$1",[fixtures[1].people[0].id]);view=await access.photoCollection(session.token);assert.equal(view.assets.length,0);
  await assert.rejects(access.collectionPhoto(session.token,fixtures[0].original.id),{code:'PHOTO_ACCESS_UNAVAILABLE'});
  // Direct-photo capability stays confined to its explicitly mapped capture session.
  const directToken=(await photoLink(fixtures[1].album.id,fixtures[1].anchor.id)).url.split('/').at(-1),direct=await access.directPhotoAccess('photo',directToken);
  const directView=await access.photoCollection(direct.token);assert.equal(directView.assets.length,3);assert.ok(!directView.assets.some(a=>a.id===fixtures[1].unrelated.id));
  await query("UPDATE keepsakes_photo_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[crypto.createHash('sha256').update(direct.token).digest('hex')]);await assert.rejects(access.photoCollection(direct.token),{code:'PHOTO_ACCESS_UNAVAILABLE'});
 }finally{await db?.pool.end();await bootstrap.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await bootstrap.end();await fs.rm(storage,{recursive:true,force:true});}
});
