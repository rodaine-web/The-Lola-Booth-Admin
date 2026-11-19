import {query,transaction} from '../db/pool.js';
import {assertFiestaReviewAccess} from './fiesta-survey-review-service.js';
import {decryptSecretJson,encryptSecretJson} from './integration-secrets.js';
import {writeAudit} from './audit-service.js';
import {AppError} from '../utils/errors.js';
import {parseFiestaShares} from '../../../shared/fiesta-gallery.js';
import {correctFiestaAddress} from '../../../shared/fiesta-address-correction.js';
import {importFiestaShares} from './fiesta-gallery-service.js';
import {reconcilePostcard} from './gallery-mailing-service.js';

const fail=(message,status=409)=>{throw new AppError(message,status,'FIESTA_ADDRESS_REVIEW');};
async function currentRow(albumId,rowId){
 const row=(await query(`SELECT r.*,b.event_code,b.source_ciphertext FROM gallery_fiesta_survey_rows r JOIN gallery_fiesta_survey_batches b ON b.id=r.batch_id AND b.album_id=r.album_id WHERE r.album_id=$1 AND r.id=$2`,[albumId,rowId])).rows[0];
 if(!row)fail('Survey record unavailable.',404);
 if((await query('SELECT 1 FROM gallery_fiesta_survey_rows WHERE album_id=$1 AND fingerprint=$2 AND sequence>$3',[albumId,row.fingerprint,row.sequence])).rowCount)fail('This survey changed. Refresh the review before editing.');
 return row;
}
export async function fiestaAddressForReview(albumId,rowId,user){
 await assertFiestaReviewAccess(albumId,user);const row=await currentRow(albumId,rowId);
 const postal=decryptSecretJson(row.answers_ciphertext).postal;
 await writeAudit({req:{user},action:'fiesta_address_viewed',entity:'gallery_album',entityId:albumId,after:{rowId}});
 return {id:row.id,filename:row.filename,status:row.status,issues:row.issues,address:postal?.recipient||{}};
}
export async function updateFiestaAddress(albumId,rowId,input,user){
 await assertFiestaReviewAccess(albumId,user);
 return transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
  const row=await currentRow(albumId,rowId),source=decryptSecretJson(row.source_ciphertext),parsed=parseFiestaShares(source.csv,row.event_code,source.context||{});
  const record=parsed.records.find(r=>r.sourceRow===row.source_row&&r.filename===row.filename);if(!record)fail('Source record unavailable. Reimport the corrected CSV.');
  let correction;try{correction=correctFiestaAddress(source.csv,row.event_code,record,input.address,source.context||{});}catch(e){fail(e.message,422);}
  const cards=(await query(`SELECT p.id,p.status,p.lob_postcard_id FROM gallery_postcards p JOIN gallery_postcard_recipients r ON r.postcard_id=p.id AND r.album_id=p.album_id WHERE p.album_id=$1 AND p.person_id=$2 AND r.filename=$3 FOR UPDATE OF p`,[albumId,row.person_id,row.filename])).rows;
  for(const card of cards){
   if(!['DRAFT','APPROVED'].includes(card.status)||card.lob_postcard_id)fail('A submitted or uncertain postcard cannot be edited here. Reconcile its provider status first.');
   for(const table of ['gallery_mailing_jobs','gallery_live_mailing_jobs'])if((await query(`SELECT 1 FROM ${table} WHERE postcard_id=$1 AND status<>'CANCELLED'`,[card.id])).rowCount)fail('This postcard is reserved for mailing. Resolve its mailing job before editing.');
  }
  const imported=await importFiestaShares(albumId,correction.csv,row.event_code,user,source.context||{});
  for(const card of cards)await reconcilePostcard(albumId,card.id,{reason:input.reason,confirm_not_created:false},user);
  const current=(await query('SELECT id,status,issues FROM gallery_fiesta_survey_rows WHERE album_id=$1 AND fingerprint=$2 ORDER BY sequence DESC LIMIT 1',[albumId,row.fingerprint])).rows[0];
  await writeAudit({req:{user},action:'fiesta_address_corrected',entity:'gallery_album',entityId:albumId,before:{rowId,address:encryptSecretJson(decryptSecretJson(row.answers_ciphertext).postal?.recipient||{})},after:{rowId:current.id,sourceBatchId:row.batch_id,correctionBatchId:imported.surveyBatchId,address:encryptSecretJson(correction.address),reason:input.reason,rebuiltPostcards:cards.map(c=>c.id),requiresFreshApproval:cards.length>0}});
  return {updated:true,row:current,rebuilt:cards.length,requiresFreshApproval:cards.length>0};
 });
}
