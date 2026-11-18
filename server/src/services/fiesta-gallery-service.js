import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {parseFiestaShares} from '../../../shared/fiesta-gallery.js';
import {assertFiestaReviewAccess,createFiestaSurveyBatch,saveFiestaSurveyOutcome} from './fiesta-survey-review-service.js';
export async function fiestaGalleryRecipient(albumId,personId){
 const row=(await query('SELECT channel,recipient_ciphertext FROM fiesta_gallery_shares WHERE album_id=$1 AND person_id=$2 LIMIT 1',[albumId,personId])).rows[0];
 return row?{channel:row.channel,recipient:decryptSecretJson(row.recipient_ciphertext).recipient}:null;
}

// Called under the same album lock by both CSV import and media ingestion.
export async function reconcileFiestaShares(albumId){
 await query(`INSERT INTO gallery_media_people(album_id,media_id,person_id,assignment_source)
  SELECT s.album_id,m.id,s.person_id,'CAPTURE_SESSION' FROM fiesta_gallery_shares s
  JOIN gallery_media m ON m.album_id=s.album_id AND m.filename=s.filename AND m.status<>'ARCHIVED'
  WHERE s.album_id=$1 AND (SELECT count(*) FROM gallery_media other WHERE other.album_id=m.album_id AND other.filename=m.filename AND other.status<>'ARCHIVED')=1
  ON CONFLICT DO NOTHING`,[albumId]);
}
const explicitPostalDecline = post => post?.mailingPreference===false || post?.physicalMailConsent===false;
const surveyFingerprint = record => crypto.createHmac('sha256',env.integrationSecretKey).update(JSON.stringify([record.filename,record.channel,record.recipient])).digest('hex');
// Administrator-reviewed identities for guests who shared a placeholder contact.
// Only recorded, event-scoped audit anchors can establish this mapping.
async function reviewedSharingIdentities(albumId){
 const audits=(await query("SELECT user_id,after_value FROM audit_logs WHERE entity_id=$1 AND action='fiesta_shared_contact_separated' ORDER BY created_at DESC",[albumId])).rows;
 const people=(await query("SELECT id,external_ref FROM gallery_people WHERE album_id=$1 AND external_ref LIKE 'fiesta-reviewed:%'",[albumId])).rows;
 const refs=new Map(people.map(p=>[p.id,p.external_ref])),reviewed=new Map();
 for(const {user_id,after_value:a}of audits){
  if(a?.type!=='USER_CONFIRMED_DISTINCT_GUESTS'||a.confirmedBy!==user_id||!Array.isArray(a.records))continue;
  for(const r of a.records)if(/^[a-f0-9]{64}$/.test(r.fingerprint||'')&&/^fiesta-reviewed:[a-f0-9]{64}$/.test(r.externalRef||'')&&refs.get(r.personId)===r.externalRef&&!reviewed.has(r.fingerprint))reviewed.set(r.fingerprint,r.externalRef);
 }
 return reviewed;
}
async function recordedPostalAuthorizations(albumId,user){
 const audits=(await query("SELECT user_id,after_value FROM audit_logs WHERE entity_id=$1 AND action='gallery_postal_admin_override' ORDER BY created_at DESC LIMIT 100",[albumId])).rows;
 const anchors=new Map();
 for(const row of audits){const a=row.after_value;if(a?.type==='ADMIN_OVERRIDE'&&a.guestConsentRecorded===false&&a.authorizedBy===row.user_id&&typeof a.reason==='string'&&/^[a-f0-9-]{36}$/.test(a.batchId||''))anchors.set(a.batchId,a);}
 if(!anchors.size)return new Map();
 const authorizations=new Map();
 const rows=(await query('SELECT fingerprint,batch_id,answers_ciphertext FROM gallery_fiesta_survey_rows WHERE album_id=$1 AND batch_id=ANY($2::uuid[]) ORDER BY sequence',[albumId,[...anchors.keys()]])).rows;
 for(const row of rows){const post=decryptSecretJson(row.answers_ciphertext).postal,a=post?.administrativeAuthorization,anchor=anchors.get(row.batch_id);
  if(a?.type==='ADMIN_OVERRIDE'&&a.guestConsentRecorded===false&&a.authorizedBy===anchor.authorizedBy&&a.sourceBatchId===anchor.sourceBatchId&&a.sourceSha256===anchor.sourceSha256&&a.reason===anchor.reason)
   authorizations.set(row.fingerprint,{...a,authorizationBatchId:row.batch_id});
 }
 const revoked=(await query("SELECT after_value FROM audit_logs WHERE entity_id=$1 AND action='gallery_postal_admin_override_revoked'",[albumId])).rows;
 for(const {after_value:a}of revoked)if(authorizations.get(a?.fingerprint)?.authorizationBatchId===a.authorizationBatchId)authorizations.delete(a.fingerprint);
 // A previously recorded No remains a revocation even if a later CSV omits it.
 const latest=(await query('SELECT DISTINCT ON(fingerprint) fingerprint,answers_ciphertext FROM gallery_fiesta_survey_rows WHERE album_id=$1 ORDER BY fingerprint,sequence DESC',[albumId])).rows;
 for(const row of latest)if(authorizations.has(row.fingerprint)&&explicitPostalDecline(decryptSecretJson(row.answers_ciphertext).postal)){
  const a=authorizations.get(row.fingerprint);await writeAudit({req:{user},action:'gallery_postal_admin_override_revoked',entity:'gallery_album',entityId:albumId,after:{fingerprint:row.fingerprint,authorizationBatchId:a.authorizationBatchId,reason:'Explicit opt-out recorded in survey'}});authorizations.delete(row.fingerprint);
 }
 return authorizations;
}
async function applyRecordedPostalAuthorization(albumId,record,post,authorizations,user){
 const fingerprint=surveyFingerprint(record),authorization=authorizations.get(fingerprint);
 if(!authorization||!post)return post;
 if(explicitPostalDecline(post)){
  await writeAudit({req:{user},action:'gallery_postal_admin_override_revoked',entity:'gallery_album',entityId:albumId,after:{fingerprint,authorizationBatchId:authorization.authorizationBatchId,reason:'Explicit opt-out in imported survey'}});authorizations.delete(fingerprint);return post;
 }
 if(post.issues?.includes('CONFLICTING_SURVEY_ANSWERS'))return post;
 return {...post,consent:true,consentRecorded:true,administrativeAuthorization:authorization,
  consentSource:JSON.stringify({...authorization,originalGuestAnswers:{mailingPreference:post.mailingPreference,physicalMailConsent:post.physicalMailConsent},originalConsentSource:post.consentSource}),
  issues:post.issues.filter(i=>!['MAILING_PREFERENCE_UNCONFIRMED','PHYSICAL_MAIL_CONSENT_UNCONFIRMED'].includes(i))};
}
export async function importFiestaShares(albumId,csv,eventCode,user,options={}){
 let parsed;try{parsed=parseFiestaShares(csv,eventCode,options);}catch{throw new AppError('Fiesta CSV validation failed. Check event code, capture filenames, recipients and Question/Answer columns.',422,'FIESTA_CSV_INVALID');}
 await assertFiestaReviewAccess(albumId,user);
 return transaction(async()=>{
  const album=(await query('SELECT * FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0];
  if(!album)throw new AppError('Gallery unavailable.',404,'NOT_FOUND');
  if(album.source_provider&&album.source_provider!=='FIESTA')throw new AppError('This album is linked to another provider.',409,'GALLERY_PROVIDER_CONFLICT');
  if(album.external_event_id&&album.external_event_id!==parsed.eventCode)throw new AppError('This album is linked to another Fiesta event.',409,'GALLERY_EVENT_CONFLICT');
  // One source cannot be mapped to two customer events. Database constraint also enforces this.
  if((await query('SELECT 1 FROM gallery_albums WHERE source_provider=\'FIESTA\' AND external_event_id=$1 AND id<>$2',[parsed.eventCode,albumId])).rowCount)throw new AppError('This Fiesta event already has a gallery.',409,'GALLERY_EVENT_CONFLICT');
  await query("UPDATE gallery_albums SET source_provider='FIESTA',external_event_id=$2 WHERE id=$1",[albumId,parsed.eventCode]);
  const reviewedIdentities=await reviewedSharingIdentities(albumId);
  for(const record of parsed.records){
   const external=reviewedIdentities.get(surveyFingerprint(record))||'fiesta:'+crypto.createHmac('sha256',env.integrationSecretKey).update(record.channel+':'+record.recipient).digest('hex');
   const person=(await query(`INSERT INTO gallery_people(album_id,display_name,external_ref) VALUES($1,$2,$3)
    ON CONFLICT(album_id,external_ref) WHERE external_ref IS NOT NULL DO UPDATE SET external_ref=EXCLUDED.external_ref RETURNING id,status`,[albumId,'Fiesta '+record.channel.toLowerCase()+' guest '+external.slice(-8),external])).rows[0];
   if(person.status!=='ACTIVE')continue; // An archived guest is never silently reactivated.
   await query(`INSERT INTO fiesta_gallery_shares(album_id,person_id,filename,channel,recipient_ciphertext,capture_ref,source_share_time)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[albumId,person.id,record.filename,record.channel,encryptSecretJson({recipient:record.recipient}),record.captureRef,record.sharedAt]);
  }
  await reconcileFiestaShares(albumId);
  // LOLA Fiesta survey postcard recipient bridge v1
  // A sharing CSV can include optional Question/Answer postal survey columns.
  // Import does not approve mail or submit to Lob. Never infer postal consent from sharing consent.
  if(parsed.postalRows){
   const available=(await query("SELECT to_regclass('gallery_postcard_recipients') AS table_name")).rows[0];
   if(!available?.table_name)throw new AppError('Apply numbered migration 079 (gallery_postcard_recipients) before importing Fiesta mailing surveys.',409,'POSTCARD_MIGRATION_REQUIRED');
  }
  const postalAuthorizations=await recordedPostalAuthorizations(albumId,user);
  const surveyBatchId=parsed.hasSurvey?await createFiestaSurveyBatch(albumId,csv,parsed.eventCode,user,options):null;
  let postalImported=0,postalNeedsReview=0,postalAdminAuthorized=0;
  for(const record of parsed.records){
   if(!record.postal&&!parsed.hasSurvey)continue;
   const originalPost=record.postal||{complete:false,consentRecorded:false,issues:['POSTAL_ANSWERS_UNRECOGNIZED']};
   const post=await applyRecordedPostalAuthorization(albumId,record,originalPost,postalAuthorizations,user);
   record.postal=post;if(post.administrativeAuthorization)postalAdminAuthorized++;
   // Consent and US address completeness are separate mandatory checks.
   const external=reviewedIdentities.get(surveyFingerprint(record))||'fiesta:'+crypto.createHmac('sha256',env.integrationSecretKey).update(record.channel+':'+record.recipient).digest('hex');
   const person=(await query('SELECT id,status FROM gallery_people WHERE album_id=$1 AND external_ref=$2',[albumId,external])).rows[0];
   if(!post.complete||!post.consentRecorded||!person||person.status!=='ACTIVE'){
    postalNeedsReview++;
    // An invalid correction cannot leave an older unprepared recipient eligible.
    const staleFingerprint=crypto.createHash('sha256').update(JSON.stringify([record.filename.toLowerCase(),record.channel,record.recipient])).digest('hex');
    await query("UPDATE gallery_postcard_recipients SET consent=false,status='NO_CONSENT',media_id=NULL,updated_at=now() WHERE album_id=$1 AND fingerprint=$2 AND postcard_id IS NULL",[albumId,staleFingerprint]);
    await saveFiestaSurveyOutcome(albumId,surveyBatchId,record,person?.id||null,'NEEDS_REVIEW',[
     ...post.issues,...(!person||person.status!=='ACTIVE'?['GUEST_UNAVAILABLE']:[])]);
    continue;
   }
   const matches=(await query(`SELECT m.id FROM gallery_media m JOIN gallery_media_people mp ON mp.media_id=m.id AND mp.album_id=m.album_id AND mp.person_id=$3 WHERE m.album_id=$1 AND m.filename=$2 AND m.status='VISIBLE' AND m.media_type='IMAGE'`,[albumId,record.filename,person.id])).rows;
   const status=!post.consent?'NO_CONSENT':matches.length===1?'MATCHED':matches.length>1?'AMBIGUOUS':'UNMATCHED';
   const fingerprint=crypto.createHash('sha256').update(JSON.stringify([record.filename.toLowerCase(),record.channel,record.recipient])).digest('hex');
   const label=`${(post.recipient.name||'Guest').slice(0,1)}*** · ${post.recipient.address_state} ${post.recipient.address_zip.slice(0,3)}**`;
   await query(`INSERT INTO gallery_postcard_recipients(album_id,filename,fingerprint,recipient_ciphertext,recipient_label,consent,consent_source,status,person_id,media_id,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT(album_id,fingerprint) DO UPDATE SET recipient_ciphertext=EXCLUDED.recipient_ciphertext,recipient_label=EXCLUDED.recipient_label,consent=EXCLUDED.consent,consent_source=EXCLUDED.consent_source,status=EXCLUDED.status,person_id=EXCLUDED.person_id,media_id=EXCLUDED.media_id,updated_at=now()
    WHERE gallery_postcard_recipients.postcard_id IS NULL`,[albumId,record.filename,fingerprint,encryptSecretJson(post.recipient),label,post.consent,post.consentSource,status,person.id,status==='MATCHED'?matches[0].id:null,user.id]);
   const prior=(await query(`SELECT p.recipient_ciphertext FROM gallery_postcard_recipients r JOIN gallery_postcards p ON p.id=r.postcard_id WHERE r.album_id=$1 AND r.fingerprint=$2`,[albumId,fingerprint])).rows[0];
   const prepared=Boolean(prior && (!post.consent || !isDeepStrictEqual(decryptSecretJson(prior.recipient_ciphertext),post.recipient)));
   await saveFiestaSurveyOutcome(albumId,surveyBatchId,record,person.id,prepared?'PREPARED_LOCKED':post.consent?'IMPORTED':'NO_CONSENT',prepared?['PREPARED_POSTCARD_REQUIRES_REVIEW']:[]);
   if(prepared)postalNeedsReview++;else postalImported++;
  }

  const counts=(await query(`SELECT count(*)::int AS associations,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM gallery_media m JOIN gallery_media_people mp ON mp.media_id=m.id AND mp.person_id=s.person_id WHERE m.album_id=s.album_id AND m.filename=s.filename))::int AS matched FROM fiesta_gallery_shares s WHERE s.album_id=$1`,[albumId])).rows[0];
  await writeAudit({req:{user},action:'fiesta_shares_imported',entity:'gallery_album',entityId:albumId,after:{eventCode:parsed.eventCode,records:parsed.records.length,defaultCountry:options.defaultCountry||null,postalAdminAuthorized,...counts}});
  return {...counts,pending:counts.associations-counts.matched,sharingRows:parsed.sharingRows,captures:parsed.captures,postalImported,postalNeedsReview,postalAdminAuthorized,surveyBatchId};
 });
}
