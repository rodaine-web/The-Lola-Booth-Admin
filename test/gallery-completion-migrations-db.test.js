import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const exec=promisify(execFile);

test('local migrations, survey corrections, dispatch claims and partner invitation lifecycle',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.match(url.pathname,/lola_.*qa/);
 const bootstrap=new pg.Pool({connectionString:url.toString()}),schema='gallery_completion_'+crypto.randomBytes(6).toString('hex');
 let db;
 try{
  await bootstrap.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema+',public');
  const environment={...process.env,DATABASE_URL:url.toString(),APP_ENV:'test',NODE_ENV:'test',JWT_SECRET:'synthetic-migration-test-jwt-secret',INTEGRATION_SECRET_KEY:'synthetic-migration-test-encryption-secret'};
  const root=fileURLToPath(new URL('../',import.meta.url));
  const migrate=()=>exec(process.execPath,['server/src/db/migrate.js'],{cwd:root,env:environment,maxBuffer:2*1024*1024});
  await migrate();
  Object.assign(process.env,environment);db=await import('../server/src/db/pool.js');
  const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
  const applied=(await db.query('SELECT filename FROM schema_migrations ORDER BY filename')).rows.map(r=>r.filename);
  assert.ok(applied.includes('078_partner_workspaces.sql'));assert.ok(applied.includes('079_gallery_postcard_workflow.sql'));assert.ok(applied.every(name=>!name.startsWith('manual_')));
  const user=await one("INSERT INTO users(name,email,password_hash) VALUES('Synthetic QA','completion-qa@example.invalid','not-a-login') RETURNING id");
  const partner=await one("INSERT INTO partners(name,email) VALUES('Synthetic QA Partner','partner-qa@example.invalid') RETURNING id");
  const workspace=await one('INSERT INTO partner_workspaces(partner_id,contact_email,created_by) VALUES($1,$2,$3) RETURNING id',[partner.id,'partner-qa@example.invalid',user.id]);
  const event=await one("INSERT INTO events(event_name,event_type,event_date) VALUES('QA ONLY','Corporate Event','2035-11-12') RETURNING id");
  const album=await one("INSERT INTO gallery_albums(event_id,title) VALUES($1,'QA ONLY') RETURNING id",[event.id]);
  const person=await one("INSERT INTO gallery_people(album_id,display_name) VALUES($1,'Synthetic guest') RETURNING id",[album.id]);
  const drafts=[];
  for(let i=0;i<2;i++){
   const media=await one("INSERT INTO gallery_media(album_id,storage_provider,storage_key,filename,mime_type,size_bytes,checksum) VALUES($1,'local',$2,$3,'image/png',1,'synthetic') RETURNING id",[album.id,'test-'+crypto.randomUUID(),`QA${i}.png`]);
   drafts.push((await one("INSERT INTO gallery_postcards(album_id,person_id,media_id,recipient_ciphertext,recipient_label,consent_at,consent_source,front_url,back_url,status,created_by) VALUES($1,$2,$3,'{}','Synthetic QA',now(),'Synthetic consent','internal-front','internal-back','APPROVED',$4) RETURNING id",[album.id,person.id,media.id,user.id])).id);
  }
  // Simulate tables populated by the old manual scripts, with no numbered
  // migration records yet. The upgrade must preserve those existing rows.
  await db.query("DELETE FROM schema_migrations WHERE filename IN('078_partner_workspaces.sql','079_gallery_postcard_workflow.sql')");
  await migrate();assert.equal((await one('SELECT id FROM partner_workspaces WHERE id=$1',[workspace.id])).id,workspace.id);assert.equal((await one('SELECT count(*)::int n FROM gallery_postcards')).n,2);
  const {claimPostcardDispatch}=await import('../server/src/services/postcard-dispatch-claim.js');
  const claims=await Promise.all(drafts.map(id=>claimPostcardDispatch(album.id,id,person.id)));
  assert.equal(claims.reduce((sum,result)=>sum+result.rowCount,0),1,'only one simultaneous draft can claim this recipient');
  const claimed=await one("SELECT id FROM gallery_postcards WHERE status='SUBMITTING'");
  await db.query("UPDATE gallery_postcards SET status='FAILED' WHERE id=$1",[claimed.id]);
  const other=drafts.find(id=>id!==claimed.id);assert.equal((await claimPostcardDispatch(album.id,other,person.id)).rowCount,0,'uncertain provider outcomes must be reconciled before another copy');
  await db.query("UPDATE gallery_postcards SET status='CANCELLED' WHERE id=$1",[claimed.id]);
  assert.equal((await claimPostcardDispatch(album.id,other,person.id)).rowCount,1,'explicit resolution can release the other approved draft');
  // Durable survey review exercises the real importer, encrypted evidence and corrections.
  const admin={id:user.id,permissions:['*'],roles:[]};
  const {importFiestaShares}=await import('../server/src/services/fiesta-gallery-service.js');
  const {listFiestaSurveyReview,fiestaSurveyEvidence}=await import('../server/src/services/fiesta-survey-review-service.js');
  const survey=(zip='60601',permission='Yes')=>{
   const pairs=[['Full name','Synthetic Guest'],['Address line 1','100 QA Example Ave'],['City','Chicago'],['State','IL'],['ZIP code',zip],['Country','US'],['Mailing preference','Yes'],['Consent to postcard mailing',permission]];
   const header=['Shared via','Email Address','Phone Number','Content Link','File Name','Share Time',...pairs.flatMap((_,i)=>[i?`Question ${i+1}`:'Question',i?`Answer ${i+1}`:'Answer'])];
   const values=['E-mail','guest-qa@example.invalid','','https://boothpics.com/QASURVEY/CAPTURE','SURVEYQA.png','2026-11-12 10:00 CST',...pairs.flat()];
   const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
   return header.map(quote).join(',')+'\n'+values.map(quote).join(',');
  };
  const csv=survey('');
  const first=await importFiestaShares(album.id,csv,'QASURVEY',admin);
  assert.equal(first.postalNeedsReview,1);assert.equal(first.postalImported,0);
  let review=await listFiestaSurveyReview(album.id,admin);
  assert.equal(review.needsReview,1);assert.equal(review.data[0].source_row,2);
  assert.ok(review.data[0].issues.includes('ADDRESS_REVIEW_REQUIRED'));
  assert.equal(JSON.stringify(review).includes('guest-qa@'),false,'review responses mask private answers');
  const evidence=await one('SELECT source_ciphertext FROM gallery_fiesta_survey_batches WHERE id=$1',[first.surveyBatchId]);
  assert.equal(JSON.stringify(evidence).includes('QA Example'),false,'source is encrypted at rest');
  assert.equal(await fiestaSurveyEvidence(album.id,first.surveyBatchId,admin),csv,'original CSV retained byte-for-byte');
  const denied={id:user.id,permissions:['read:events'],roles:[]};
  await assert.rejects(listFiestaSurveyReview(album.id,denied),e=>e.status===403||e.statusCode===403);
  await assert.rejects(fiestaSurveyEvidence(album.id,first.surveyBatchId,denied),e=>e.status===403||e.statusCode===403);
  const corrected=await importFiestaShares(album.id,survey(),'QASURVEY',admin);
  assert.equal(corrected.postalImported,1);
  review=await listFiestaSurveyReview(album.id,admin);assert.equal(review.data.length,1);assert.equal(review.needsReview,0);assert.equal(review.data[0].status,'IMPORTED');
  assert.equal((await one('SELECT count(*)::int n FROM gallery_fiesta_survey_batches')).n,2,'historical imports retained');
  await importFiestaShares(album.id,survey(),'QASURVEY',admin);
  assert.equal((await one('SELECT count(*)::int n FROM gallery_postcard_recipients')).n,1,'replay does not duplicate recipients');
  await importFiestaShares(album.id,csv,'QASURVEY',admin);
  assert.equal((await one('SELECT consent FROM gallery_postcard_recipients')).consent,false,'incomplete corrections invalidate prior eligibility');
  await importFiestaShares(album.id,survey(),'QASURVEY',admin);
  const recipient=await one('SELECT * FROM gallery_postcard_recipients');
  const photo=await one("INSERT INTO gallery_media(album_id,storage_provider,storage_key,filename,mime_type,size_bytes,checksum) VALUES($1,'local','QA-SURVEY','SURVEYQA.png','image/png',1,'synthetic') RETURNING id",[album.id]);
  const prepared=await one("INSERT INTO gallery_postcards(album_id,person_id,media_id,recipient_ciphertext,recipient_label,consent_at,consent_source,front_url,back_url,status,created_by) VALUES($1,$2,$3,$4,'Synthetic QA',now(),'Synthetic consent','internal-front','internal-back','APPROVED',$5) RETURNING id",[album.id,recipient.person_id,photo.id,recipient.recipient_ciphertext,user.id]);
  await db.query("UPDATE gallery_postcard_recipients SET postcard_id=$2,status='PREPARED' WHERE id=$1",[recipient.id,prepared.id]);
  await importFiestaShares(album.id,survey(),'QASURVEY',admin);
  assert.equal((await listFiestaSurveyReview(album.id,admin)).needsReview,0,'unchanged replay does not freeze a prepared draft');
  await importFiestaShares(album.id,survey('60602'),'QASURVEY',admin);
  assert.equal((await listFiestaSurveyReview(album.id,admin)).data[0].status,'PREPARED_LOCKED');
  assert.equal((await claimPostcardDispatch(album.id,prepared.id,recipient.person_id)).rowCount,0,'a changed prepared address must block stale dispatch');
  await importFiestaShares(album.id,survey('60601','No'),'QASURVEY',admin);
  assert.equal((await claimPostcardDispatch(album.id,prepared.id,recipient.person_id)).rowCount,0,'withdrawn permission blocks a previously approved draft');
  await importFiestaShares(album.id,survey(),'QASURVEY',admin);
  assert.equal((await claimPostcardDispatch(album.id,prepared.id,recipient.person_id)).rowCount,1,'only verified original answers release an unchanged draft');
  const batchesBefore=(await one('SELECT count(*)::int n FROM gallery_fiesta_survey_batches')).n;
  await assert.rejects(importFiestaShares(album.id,survey().replaceAll('QASURVEY','OTHERQA'),'OTHERQA',admin));
  assert.equal((await one('SELECT count(*)::int n FROM gallery_fiesta_survey_batches')).n,batchesBefore,'cross-event import writes nothing');
  const unknown='Shared via,Email Address,Phone Number,Content Link,File Name,Share Time,Question,Answer\nE-mail,guest-qa@example.invalid,,https://boothpics.com/QASURVEY/CAPTURE,SURVEYQA.png,2026-11-12 10:00 CST,Unrecognized mailing question,Synthetic answer';
  const unknownResult=await importFiestaShares(album.id,unknown,'QASURVEY',admin);
  assert.equal(unknownResult.postalNeedsReview,1,'unrecognized survey mappings are retained rather than discarded');
  assert.ok((await listFiestaSurveyReview(album.id,admin)).data[0].issues.includes('POSTAL_ANSWERS_UNRECOGNIZED'));
  const {qualifyMailingRelease}=await import('./helpers/gallery-mailing-release-qualification.js');
  await qualifyMailingRelease({db,user});
  const {qualifyPartnerWorkspace}=await import('./helpers/partner-workspace-qualification.js');
  await qualifyPartnerWorkspace({db,user,partner,event});
 }finally{
  if(db)await db.pool.end();await bootstrap.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await bootstrap.end();
 }
});
