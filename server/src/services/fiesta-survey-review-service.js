import crypto from 'node:crypto';
import {query} from '../db/pool.js';
import {env} from '../config/env.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {userCanAccessEvent} from './event-operations-service.js';
import {writeAudit} from './audit-service.js';
import {AppError} from '../utils/errors.js';

export async function assertFiestaReviewAccess(albumId,user){
 const album=(await query('SELECT event_id FROM gallery_albums WHERE id=$1',[albumId])).rows[0];
 if(!album)throw new AppError('Gallery unavailable.',404,'NOT_FOUND');
 if(!await userCanAccessEvent(user,album.event_id))throw new AppError('Event access denied.',403,'FORBIDDEN');
}
// These writes run inside the import transaction, under the album row lock.
export async function createFiestaSurveyBatch(albumId,csv,eventCode,user,options={}){
 const available=(await query("SELECT to_regclass('gallery_fiesta_survey_batches') AS name")).rows[0];
 if(!available?.name)throw new AppError('Apply migration 080 before importing Fiesta mailing surveys.',409,'POSTCARD_MIGRATION_REQUIRED');
 return (await query(`INSERT INTO gallery_fiesta_survey_batches(album_id,event_code,source_sha256,source_ciphertext,created_by)
 VALUES($1,$2,$3,$4,$5) RETURNING id`,[albumId,eventCode,crypto.createHash('sha256').update(csv).digest('hex'),encryptSecretJson({csv,context:{defaultCountry:options.defaultCountry||null}}),user.id])).rows[0].id;
}
export async function saveFiestaSurveyOutcome(albumId,batchId,record,personId,status,issues=[]){
 const fingerprint=crypto.createHmac('sha256',env.integrationSecretKey).update(JSON.stringify([record.filename,record.channel,record.recipient])).digest('hex');
 await query(`INSERT INTO gallery_fiesta_survey_rows(album_id,batch_id,fingerprint,filename,source_row,person_id,status,issues,answers_ciphertext)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[albumId,batchId,fingerprint,record.filename,record.sourceRow,personId,status,[...new Set(issues)],encryptSecretJson({postal:record.postal})]);
}
export async function listFiestaSurveyReview(albumId,user){
 await assertFiestaReviewAccess(albumId,user);
 const data=(await query(`SELECT * FROM (SELECT DISTINCT ON(r.fingerprint)
 r.id,r.batch_id,r.filename,r.source_row,r.status,r.issues,r.sequence,b.created_at
 FROM gallery_fiesta_survey_rows r JOIN gallery_fiesta_survey_batches b ON b.id=r.batch_id AND b.album_id=r.album_id
 WHERE r.album_id=$1 ORDER BY r.fingerprint,r.sequence DESC) current_rows ORDER BY sequence DESC LIMIT 5001`,[albumId])).rows;
 if(data.length>5000)throw new AppError('Review limit reached. Split large imports.',422,'FIESTA_REVIEW_LIMIT');
 return {data:data.map(({sequence,...row})=>row),needsReview:data.filter(row=>['NEEDS_REVIEW','PREPARED_LOCKED'].includes(row.status)).length};
}
export async function fiestaSurveyEvidence(albumId,batchId,user){
 await assertFiestaReviewAccess(albumId,user);
 const row=(await query('SELECT source_ciphertext FROM gallery_fiesta_survey_batches WHERE album_id=$1 AND id=$2',[albumId,batchId])).rows[0];
 if(!row)throw new AppError('Import unavailable.',404,'NOT_FOUND');
 const {csv}=decryptSecretJson(row.source_ciphertext);
 await writeAudit({req:{user},action:'fiesta_survey_source_downloaded',entity:'gallery_album',entityId:albumId,after:{batchId}});
 return csv;
}

// Private Fiesta postcards cannot be approved while this guest has unresolved survey records.
export async function assertPostcardSurveyClear(albumId,postcardIds){
 const excluded=await query(`SELECT 1 FROM gallery_postcards p JOIN (SELECT DISTINCT ON(fingerprint) * FROM gallery_fiesta_survey_rows WHERE album_id=$1 ORDER BY fingerprint,sequence DESC) s ON s.album_id=p.album_id AND s.person_id=p.person_id
 JOIN gallery_postcard_exclusions x ON x.album_id=s.album_id AND x.fingerprint=s.fingerprint
 JOIN gallery_media m ON m.id=p.media_id AND m.filename=s.filename
 WHERE p.album_id=$1 AND p.id=ANY($2::uuid[]) LIMIT 1`,[albumId,postcardIds]);
 if(excluded.rowCount)throw new AppError('This recipient has been excluded. Review the exclusion before approving or releasing.',409,'POSTCARD_EXCLUDED');
 const held=await query(`SELECT 1 FROM gallery_postcards p WHERE p.album_id=$1 AND p.id=ANY($2::uuid[]) AND p.front_url='gallery-media:'||p.media_id::text AND EXISTS(SELECT 1 FROM (SELECT DISTINCT ON(fingerprint) person_id,status FROM gallery_fiesta_survey_rows WHERE album_id=$1 ORDER BY fingerprint,sequence DESC) s WHERE s.person_id=p.person_id AND s.status IN('NEEDS_REVIEW','NO_CONSENT','PREPARED_LOCKED')) LIMIT 1`,[albumId,postcardIds]);
 if(held.rowCount)throw new AppError('Resolve the guest mailing address or survey review before approving this postcard.',409,'POSTCARD_SURVEY_REVIEW');
}
