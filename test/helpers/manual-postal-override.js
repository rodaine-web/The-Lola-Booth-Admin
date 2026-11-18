// Isolated QA fixture for the audited administrative authorization workflow.
import crypto from 'node:crypto';
import {query,transaction} from '../../server/src/db/pool.js';
import {env} from '../../server/src/config/env.js';
import {AppError} from '../../server/src/utils/errors.js';
import {decryptSecretJson,encryptSecretJson} from '../../server/src/services/integration-secrets.js';
import {writeAudit} from '../../server/src/services/audit-service.js';
import {parseFiestaShares} from '../../shared/fiesta-gallery.js';
import {assertFiestaReviewAccess,createFiestaSurveyBatch,saveFiestaSurveyOutcome} from '../../server/src/services/fiesta-survey-review-service.js';
const fail=(message,status=409)=>{throw new AppError(message,status,'MANUAL_POSTAL_AUTHORIZATION');};
export async function authorizeCurrentFiestaBatch(albumId,{sourceBatchId,sourceSha256,reason},user){
 if(typeof reason!=='string'||reason.trim().length<15)fail('Record the administrator authorization reason.',422);
 const actor=(await query("SELECT u.id,array_agg(r.name) roles FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.id=$1 AND u.active AND u.deleted_at IS NULL GROUP BY u.id",[user.id])).rows[0];
 if(!actor?.roles.some(r=>['OWNER','ADMIN','SUPER_ADMIN'].includes(r)))fail('Administrator authorization is required.',403);
 const administrator={id:actor.id,roles:actor.roles,permissions:['write:operations']};
 await assertFiestaReviewAccess(albumId,administrator);
 return transaction(async()=>{
  const album=(await query('SELECT * FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0];
  if(!album||['ARCHIVED','EXPIRED'].includes(album.status))fail('Use an active gallery.');
  const source=(await query('SELECT * FROM gallery_fiesta_survey_batches WHERE album_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE',[albumId])).rows[0];
  if(source?.id!==sourceBatchId||source.source_sha256!==sourceSha256)fail('The source changed. Review the latest batch before authorizing.');
  const evidence=decryptSecretJson(source.source_ciphertext),parsed=parseFiestaShares(evidence.csv,source.event_code,evidence.context||{});
  if(crypto.createHash('sha256').update(evidence.csv).digest('hex')!==sourceSha256)fail('Source evidence integrity mismatch.');
  const batchId=await createFiestaSurveyBatch(albumId,evidence.csv,source.event_code,administrator,evidence.context||{});
  const authorization={type:'ADMIN_OVERRIDE',authorizedBy:actor.id,authorizedAt:new Date().toISOString(),reason:reason.trim(),sourceBatchId,sourceSha256,guestConsentRecorded:false};
  const counts={authorized:0,held:0,explicitOptOuts:0,alreadyPrepared:0},recipientIds=[];
  for(const record of parsed.records){
   const original=record.postal;
   const explicitNo=original?.mailingPreference===false||original?.physicalMailConsent===false;
   const conflicting=original?.issues.includes('CONFLICTING_SURVEY_ANSWERS');
   const external='fiesta:'+crypto.createHmac('sha256',env.integrationSecretKey).update(record.channel+':'+record.recipient).digest('hex');
   const person=(await query("SELECT id FROM gallery_people WHERE album_id=$1 AND external_ref=$2 AND status='ACTIVE'",[albumId,external])).rows[0];
   const fingerprint=crypto.createHash('sha256').update(JSON.stringify([record.filename.toLowerCase(),record.channel,record.recipient])).digest('hex');
   const prior=(await query('SELECT postcard_id FROM gallery_postcard_recipients WHERE album_id=$1 AND fingerprint=$2',[albumId,fingerprint])).rows[0];
   if(prior?.postcard_id){counts.alreadyPrepared++;continue;}
   if(explicitNo||conflicting||!original){
    counts.held++;if(explicitNo)counts.explicitOptOuts++;
    await saveFiestaSurveyOutcome(albumId,batchId,record,person?.id||null,explicitNo?'NO_CONSENT':'NEEDS_REVIEW',original?.issues||['POSTAL_ANSWERS_UNRECOGNIZED']);continue;
   }
   const post={...original,consent:true,consentRecorded:true,administrativeAuthorization:authorization,issues:original.issues.filter(i=>!['MAILING_PREFERENCE_UNCONFIRMED','PHYSICAL_MAIL_CONSENT_UNCONFIRMED'].includes(i))};
   // Original preference/permission answers stay null or their recorded value.
   // Operational authorization is explicitly administrator-supplied, never a guest opt-in claim.
   record.postal=post;
   const share=person&&(await query('SELECT 1 FROM fiesta_gallery_shares WHERE album_id=$1 AND person_id=$2 AND filename=$3',[albumId,person.id,record.filename])).rowCount;
   if(!post.complete||!person||!share){counts.held++;await saveFiestaSurveyOutcome(albumId,batchId,record,person?.id||null,'NEEDS_REVIEW',[...post.issues,...(!person||!share?['GUEST_MATCH_REQUIRES_REVIEW']:[])]);continue;}
   const matches=(await query("SELECT m.id FROM gallery_media m JOIN gallery_media_people mp ON mp.album_id=m.album_id AND mp.media_id=m.id AND mp.person_id=$3 WHERE m.album_id=$1 AND m.filename=$2 AND m.status='VISIBLE' AND m.media_type='IMAGE'",[albumId,record.filename,person.id])).rows;
   if(matches.length!==1){counts.held++;await saveFiestaSurveyOutcome(albumId,batchId,record,person.id,'NEEDS_REVIEW',['PHOTO_MATCH_REQUIRES_REVIEW']);continue;}
   const address=post.recipient,label=`${address.name.slice(0,1)}*** · ${address.address_state} ${address.address_zip.slice(0,3)}**`;
   const consentSource=JSON.stringify({...authorization,originalGuestAnswers:{mailingPreference:original.mailingPreference,physicalMailConsent:original.physicalMailConsent},originalConsentSource:original.consentSource});
   const result=await query(`INSERT INTO gallery_postcard_recipients(album_id,filename,fingerprint,recipient_ciphertext,recipient_label,consent,consent_source,status,person_id,media_id,created_by)
    VALUES($1,$2,$3,$4,$5,true,$6,'MATCHED',$7,$8,$9)
    ON CONFLICT(album_id,fingerprint) DO UPDATE SET recipient_ciphertext=EXCLUDED.recipient_ciphertext,recipient_label=EXCLUDED.recipient_label,consent=true,consent_source=EXCLUDED.consent_source,status='MATCHED',person_id=EXCLUDED.person_id,media_id=EXCLUDED.media_id,updated_at=now() WHERE gallery_postcard_recipients.postcard_id IS NULL RETURNING id`,[albumId,record.filename,fingerprint,encryptSecretJson(address),label,consentSource,person.id,matches[0].id,actor.id]);
   if(result.rowCount){counts.authorized++;recipientIds.push(result.rows[0].id);await saveFiestaSurveyOutcome(albumId,batchId,record,person.id,'IMPORTED',[]);}
  }
  await writeAudit({req:{user:administrator},action:'gallery_postal_admin_override',entity:'gallery_album',entityId:albumId,after:{...authorization,batchId,...counts,recipientIds}});
  return {batchId,sourceBatchId,...counts,recipientIds};
 });
}
