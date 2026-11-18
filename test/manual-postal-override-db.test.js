import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs/promises';import pg from 'pg';
test('manual authorization is audited, scoped, preserves actual answers and holds bad addresses or opt-outs',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/_qa$/);const bootstrap=new pg.Pool({connectionString:url.toString()}),schema='override_qa_'+crypto.randomBytes(6).toString('hex');let db;
 try{
  await bootstrap.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',NODE_ENV:'test',JWT_SECRET:'synthetic-override-only-jwt-secret',INTEGRATION_SECRET_KEY:'synthetic-override-only-encryption-key'});
  db=await import('../server/src/db/pool.js');const one=async(s,p=[])=>(await db.query(s,p)).rows[0];for(const f of(await fs.readdir(new URL('../server/migrations/',import.meta.url))).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort())await db.transaction(()=>fs.readFile(new URL('../server/migrations/'+f,import.meta.url),'utf8').then(s=>db.query(s)));
  const user=await one("INSERT INTO users(name,email,password_hash) VALUES('Synthetic override admin','override@example.invalid','not-a-login') RETURNING id");await db.query("INSERT INTO roles(name) VALUES('ADMIN') ON CONFLICT(name) DO NOTHING");await db.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='ADMIN'",[user.id]);
  const reader=await one("INSERT INTO users(name,email,password_hash) VALUES('Synthetic reader','reader@example.invalid','not-a-login') RETURNING id");
  const event=await one("INSERT INTO events(event_name,event_type,event_date) VALUES('QA Override','CORPORATE','2035-11-18') RETURNING id"),album=await one("INSERT INTO gallery_albums(event_id,title) VALUES($1,'QA Override') RETURNING id",[event.id]);
  const pairs=[['First Name','Synthetic'],['Last Name','Guest'],['Street Address','100 QA Ave'],['City','Chicago'],['State','IL'],['Zip Code','60601'],['Mailing preference',''],['Physical mail consent','']];const quote=v=>'"'+v.replaceAll('"','""')+'"';
  const header=['Shared via','Email Address','Phone Number','Content Link','File Name','Share Time',...pairs.flatMap((_,i)=>[i?'Question '+(i+1):'Question',i?'Answer '+(i+1):'Answer'])];
  const csv=[header.map(quote).join(','),...[['valid','60601',''],['incomplete','1234',''],['optout','60601','No']].map(([n,zip,no])=>['E-mail',n+'@example.invalid','','https://boothpics.com/QA/'+n,n+'.jpeg','2026-11-18 10:00 CST',...pairs.flatMap(([q,a])=>[q,q==='Zip Code'?zip:q==='Physical mail consent'?no:a])].map(quote).join(','))].join('\n');
  const {importFiestaShares}=await import('../server/src/services/fiesta-gallery-service.js'),{authorizeCurrentFiestaBatch}=await import('./helpers/manual-postal-override.js');
  await importFiestaShares(album.id,csv,'QA',{...user,roles:['ADMIN'],permissions:['*']},{defaultCountry:'US'});
  await db.query("INSERT INTO gallery_media(album_id,storage_provider,storage_key,filename,mime_type,size_bytes,checksum) SELECT $1,'local',gen_random_uuid()::text,filename,'image/jpeg',1,'synthetic' FROM fiesta_gallery_shares WHERE album_id=$1",[album.id]);
  const {reconcileFiestaShares}=await import('../server/src/services/fiesta-gallery-service.js');await reconcileFiestaShares(album.id);
  const source=await one('SELECT id,source_sha256 FROM gallery_fiesta_survey_batches WHERE album_id=$1 ORDER BY created_at DESC LIMIT 1',[album.id]);const input={sourceBatchId:source.id,sourceSha256:source.source_sha256,reason:'Owner explicitly requested manual authorization for this event.'};
  await assert.rejects(authorizeCurrentFiestaBatch(album.id,input,reader),{statusCode:403});await assert.rejects(authorizeCurrentFiestaBatch(album.id,{...input,sourceSha256:'0'.repeat(64)},user));
  await db.query("UPDATE gallery_albums SET status='PUBLISHED',published_at=now() WHERE id=$1",[album.id]);
  const result=await authorizeCurrentFiestaBatch(album.id,input,user);assert.equal(result.authorized,1);assert.equal(result.held,2);assert.equal(result.explicitOptOuts,1);
  const recipient=await one('SELECT consent,consent_source FROM gallery_postcard_recipients WHERE album_id=$1',[album.id]);assert.equal(recipient.consent,true);const record=JSON.parse(recipient.consent_source);assert.equal(record.type,'ADMIN_OVERRIDE');assert.equal(record.guestConsentRecorded,false);assert.equal(record.originalGuestAnswers.mailingPreference,null);assert.equal(record.originalGuestAnswers.physicalMailConsent,null);
  const {decryptSecretJson}=await import('../server/src/services/integration-secrets.js');const preserved=await one('SELECT source_ciphertext FROM gallery_fiesta_survey_batches WHERE id=$1',[source.id]);assert.equal(decryptSecretJson(preserved.source_ciphertext).csv,csv);
  assert.equal((await one("SELECT count(*)::int n FROM audit_logs WHERE action='gallery_postal_admin_override'")).n,1);
  const fixed=csv.replace('1234','60601');
  const again=await importFiestaShares(album.id,fixed,'QA',{...user,roles:['ADMIN'],permissions:['*']},{defaultCountry:'US'});assert.equal(again.postalAdminAuthorized,2);
  assert.equal((await one('SELECT count(*)::int n FROM gallery_postcard_recipients WHERE album_id=$1 AND consent',[album.id])).n,2,'same guest address correction preserves admin authority');
  const newRow=fixed.split('\n')[1].replaceAll('valid@example.invalid','new@example.invalid').replaceAll('/valid','/new').replaceAll('valid.jpeg','new.jpeg');
  const withNew=fixed+'\n'+newRow;await importFiestaShares(album.id,withNew,'QA',{...user,roles:['ADMIN'],permissions:['*']},{defaultCountry:'US'});
  assert.equal((await one('SELECT count(*)::int n FROM gallery_postcard_recipients WHERE album_id=$1 AND consent',[album.id])).n,2,'new recipients never inherit the event override');
  const lines=withNew.split('\n'),cells=lines[1].split(',');cells[cells.length-1]='"No"';lines[1]=cells.join(',');
  await importFiestaShares(album.id,lines.join('\n'),'QA',{...user,roles:['ADMIN'],permissions:['*']},{defaultCountry:'US'});
  assert.equal((await one("SELECT count(*)::int n FROM gallery_postcard_recipients WHERE album_id=$1 AND consent",[album.id])).n,1,'a fresh explicit No revokes manual authority');
  await importFiestaShares(album.id,withNew,'QA',{...user,roles:['ADMIN'],permissions:['*']},{defaultCountry:'US'});
  assert.equal((await one('SELECT count(*)::int n FROM gallery_postcard_recipients WHERE album_id=$1 AND consent',[album.id])).n,1,'removing a No does not silently restore a revoked override');
  for(const t of ['gallery_postcards','gallery_mailing_jobs','gallery_live_mailing_jobs'])assert.equal((await one(`SELECT count(*)::int n FROM ${t}`)).n,0);
 }finally{if(db)await db.pool.end();await bootstrap.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await bootstrap.end();}
});
