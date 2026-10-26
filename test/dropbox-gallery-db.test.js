import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import {dropboxContentHash} from '../server/src/services/dropbox-gallery-adapter.js';

test('Dropbox ingestion persists exact mappings and survives retries without publishing or messaging',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/lola_.*qa/);
 const bootstrap=new pg.Pool({connectionString:url.toString()}),schema='dropbox_qa_'+crypto.randomBytes(6).toString('hex'),root=await fs.mkdtemp(path.join(os.tmpdir(),'dropbox-qa-'));let pool;
 try {
  await bootstrap.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');
  Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',NODE_ENV:'test',JWT_SECRET:'synthetic-dropbox-test-only-secret',INTEGRATION_SECRET_KEY:'synthetic-dropbox-test-only-encryption-key',GALLERY_STORAGE_PROVIDER:'local',GALLERY_LOCAL_ROOT:root,GALLERY_DROPBOX_SYNC_ENABLED:'true',EMAIL_PROVIDER:'development'});
  const db=await import('../server/src/db/pool.js');pool=db.pool;const {query,transaction}=db,one=async(sql,args=[])=>(await query(sql,args)).rows[0];
  for(const file of(await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await transaction(async()=>query(await fs.readFile(new URL('../server/migrations/'+file,import.meta.url),'utf8')));
  const g=await import('../server/src/services/private-gallery-service.js'),sync=await import('../server/src/services/dropbox-gallery-service.js'),{importFiestaShares}=await import('../server/src/services/fiesta-gallery-service.js');
  const user=await one("INSERT INTO users(name,email,password_hash) VALUES('Dropbox QA','dropbox-qa@example.invalid','not-a-login') RETURNING id"),viewer=await one("INSERT INTO users(name,email,password_hash) VALUES('Viewer QA','dropbox-viewer@example.invalid','not-a-login') RETURNING id");
  await query("INSERT INTO permissions(key) VALUES('*') ON CONFLICT DO NOTHING");await query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='*'",[user.id]);
  const event=await one("INSERT INTO events(event_name,event_type,event_date) VALUES('DROPBOX QA ONLY','Wedding','2035-10-15') RETURNING id"),album=await g.createGalleryAlbum(event.id,null,user);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=','base64');
  const entry=(id,name)=>({'.tag':'file',id:'id:'+id,rev:'a123',name,path_lower:'/fiesta/qa/'+name.toLowerCase(),size:png.length,content_hash:dropboxContentHash(png)});
  let entries=[entry('one','ONE.png')],downloads=0,interrupt=null;
  const connect=async()=>({accountId:'dbid:qa',folder:async()=>({'.tag':'folder',id:'id:folder',path_lower:'/fiesta/qa'}),page:async()=>({entries,cursor:'cursor-'+entries.length,has_more:false}),download:async(capture)=>{downloads++;if(interrupt)await interrupt(capture);return png;}});
  await assert.rejects(sync.saveDropboxGallerySource(album.id,{folderPath:'/fiesta/qa'},viewer,{connect}),{code:'FORBIDDEN'});
  await assert.rejects(sync.saveDropboxGallerySource(album.id,{folderPath:'/fiesta/qa'},user,{connect}),{code:'DROPBOX_FIESTA_MAPPING_REQUIRED'});
  await importFiestaShares(album.id,'Shared via,Email Address,Phone Number,Content Link,File Name,Share Time\nE-mail,guest@example.invalid,,https://boothpics.com/QA/one,ONE.png,2026-10-15 10:00 PST','QA',user);
  await sync.saveDropboxGallerySource(album.id,{folderPath:'/fiesta/qa',enabled:true},user,{connect});
  const first=await sync.syncDropboxGallerySource(album.id,{connect,user});assert.equal(first.imported,1);assert.equal(first.messagesSent,0);
  assert.equal((await one('SELECT count(*)::int n FROM gallery_media_people')).n,1);assert.equal((await one('SELECT status FROM gallery_albums WHERE id=$1',[album.id])).status,'DRAFT');
  assert.equal((await sync.syncDropboxGallerySource(album.id,{connect,user})).replayed,1);assert.equal(downloads,1);
  // Production polling must dispatch eligible sources only with both explicit flags.
  Object.assign(process.env,{APP_ENV:'production',GALLERY_ENABLED:'true'});
  await query("UPDATE gallery_dropbox_sources SET next_sync_at=now()-interval '1 minute' WHERE album_id=$1",[album.id]);
  const polled=await sync.processDropboxGallerySources({connect});assert.equal(polled.length,1);assert.equal(polled[0].albumId,album.id);assert.equal(polled[0].replayed,1);assert.equal(downloads,1);
  await query("UPDATE gallery_dropbox_sources SET next_sync_at=now()-interval '1 minute' WHERE album_id=$1",[album.id]);
  process.env.GALLERY_ENABLED='false';assert.deepEqual(await sync.processDropboxGallerySources({connect}),[]);
  process.env.GALLERY_ENABLED='true';process.env.GALLERY_DROPBOX_SYNC_ENABLED='false';assert.deepEqual(await sync.processDropboxGallerySources({connect}),[]);
  process.env.GALLERY_DROPBOX_SYNC_ENABLED='true';await query('UPDATE gallery_dropbox_sources SET enabled=false WHERE album_id=$1',[album.id]);assert.deepEqual(await sync.processDropboxGallerySources({connect}),[]);
  await query('UPDATE gallery_dropbox_sources SET enabled=true WHERE album_id=$1',[album.id]);process.env.APP_ENV='test';
  entries=[entry('two','TWO.png'),entry('three','THREE.png')];interrupt=async capture=>{if(capture.id==='id:three')throw Error('provider failure containing sensitive text');};
  await assert.rejects(sync.syncDropboxGallerySource(album.id,{connect,user}),{code:'DROPBOX_SYNC_FAILED'});
  assert.equal((await one('SELECT count(*)::int n FROM gallery_media')).n,2);
  const checkpoint=await one('SELECT cursor_ciphertext,last_error_code FROM gallery_dropbox_sources WHERE album_id=$1',[album.id]);assert.equal(checkpoint.last_error_code,'DROPBOX_SYNC_FAILED');assert.ok(!JSON.stringify(checkpoint.cursor_ciphertext).includes('cursor-'));
  interrupt=null;const retried=await sync.syncDropboxGallerySource(album.id,{connect,user});assert.equal(retried.replayed,1);assert.equal(retried.imported,1);assert.equal((await one('SELECT count(*)::int n FROM gallery_media')).n,3);
  // Concurrent imports are fenced by a source lease. Pausing while bytes arrive
  // prevents the in-flight capture from being committed or checkpoint advanced.
  entries=[entry('four','FOUR.png')];let release,started;const waiting=new Promise(resolve=>{started=resolve;});interrupt=async()=>{started();await new Promise(resolve=>{release=resolve;});};
  const running=sync.syncDropboxGallerySource(album.id,{connect,user});await waiting;
  await assert.rejects(sync.syncDropboxGallerySource(album.id,{connect,user}),{code:'DROPBOX_SYNC_BUSY'});
  await sync.pauseDropboxGallerySource(album.id,user);release();await assert.rejects(running,{code:'DROPBOX_IMPORT_STOPPED'});assert.equal((await one('SELECT count(*)::int n FROM gallery_media')).n,3);
  interrupt=async()=>{await query('DELETE FROM user_permissions WHERE user_id=$1',[user.id]);};await assert.rejects(sync.syncDropboxGallerySource(album.id,{connect,user}),{code:'FORBIDDEN'});assert.equal((await one('SELECT count(*)::int n FROM gallery_media')).n,3);
  await query("INSERT INTO user_permissions(user_id,permission_id) SELECT $1,id FROM permissions WHERE key='*'",[user.id]);
  interrupt=async()=>{await query("UPDATE events SET status='CANCELLED' WHERE id=$1",[event.id]);};await assert.rejects(sync.syncDropboxGallerySource(album.id,{connect,user}),{code:'DROPBOX_IMPORT_STOPPED'});
  await query("UPDATE events SET status='INQUIRY' WHERE id=$1",[event.id]);
  await g.updateGalleryAlbum(album.id,{retention_days:30},user);await g.transitionGalleryAlbum(album.id,'PUBLISHED',user);
  interrupt=null;await assert.rejects(sync.syncDropboxGallerySource(album.id,{connect,user}),{code:'DROPBOX_GALLERY_PUBLISHED'});
  Object.assign(process.env,{APP_ENV:'production',GALLERY_ENABLED:'true'});await query("UPDATE gallery_dropbox_sources SET enabled=true,next_sync_at=now()-interval '1 minute' WHERE album_id=$1",[album.id]);assert.deepEqual(await sync.processDropboxGallerySources({connect}),[]);process.env.APP_ENV='test';
  assert.equal((await one('SELECT count(*)::int n FROM communications')).n,0);assert.equal((await one('SELECT count(*)::int n FROM gallery_access_keys')).n,0);
  const oauth=await import('../server/src/services/dropbox-gallery-connection.js');
  Object.assign(process.env,{DROPBOX_GALLERY_APP_KEY:'fixture-app',DROPBOX_GALLERY_APP_SECRET:'fixture-secret'});
  const req={user};const authorization=await oauth.startDropboxGalleryOAuth(album.id,req),authUrl=new URL(authorization.url);
  assert.equal(authUrl.searchParams.get('token_access_type'),'offline');assert.equal(authUrl.searchParams.get('code_challenge_method'),'S256');assert.equal(authUrl.searchParams.get('scope'),oauth.dropboxGalleryScopes.join(' '));
  const input={state:authUrl.searchParams.get('state'),browser:authorization.browser,code:'fixture-auth-code'};
  await assert.rejects(oauth.finishDropboxGalleryOAuth({...input,browser:'wrong-browser'},req),{code:'OAUTH_STATE_INVALID'});
  const providerFetch=async(url,options)=>{if(url.endsWith('/oauth2/token')){const grant=options.body.get('grant_type');return new Response(JSON.stringify(grant==='authorization_code'?{refresh_token:'fixture-private-refresh-token',account_id:'dbid:qa',scope:oauth.dropboxGalleryScopes.join(' ')}:{access_token:'fixture-access'}),{headers:{'content-type':'application/json'}});}if(url.endsWith('/users/get_current_account'))return new Response(JSON.stringify({account_id:'dbid:qa',email:'info@thelolabooth.com',email_verified:true}),{headers:{'content-type':'application/json'}});throw Error('Unexpected OAuth endpoint');};
  assert.equal((await oauth.finishDropboxGalleryOAuth(input,req,{fetcher:providerFetch})).albumId,album.id);
  assert.equal((await oauth.dropboxConnectionStatus()).connected,true);
  const savedConnection=await one("SELECT encrypted_credentials FROM integration_connections WHERE provider='DROPBOX_GALLERY'");assert.ok(!JSON.stringify(savedConnection).includes('fixture-private-refresh-token'));
  assert.ok(!JSON.stringify(await sync.dropboxGalleryStatus(album.id)).includes('fixture-private-refresh-token'));
  await assert.rejects(oauth.finishDropboxGalleryOAuth(input,req,{fetcher:providerFetch}),{code:'OAUTH_STATE_INVALID'});
  await oauth.disconnectDropboxGallery(req);assert.equal((await oauth.dropboxConnectionStatus()).connected,false);assert.equal((await one('SELECT enabled FROM gallery_dropbox_sources WHERE album_id=$1',[album.id])).enabled,false);
  process.env.GALLERY_DROPBOX_SYNC_ENABLED='false';assert.deepEqual(await sync.processDropboxGallerySources(),[]);await assert.rejects(sync.syncDropboxGallerySource(album.id,{connect,user}),{code:'DROPBOX_SYNC_PAUSED'});
 } finally {if(pool)await pool.end();await bootstrap.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await bootstrap.end();await fs.rm(root,{recursive:true,force:true});}
});
