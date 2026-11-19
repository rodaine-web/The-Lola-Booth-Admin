import {query,transaction} from '../db/pool.js';
import {decryptSecretJson} from './integration-secrets.js';
import {assertFiestaReviewAccess} from './fiesta-survey-review-service.js';
import {postcardResult,fulfillmentSummary} from '../../../shared/postcard-fulfillment.js';
import {mailingHistory} from './gallery-mailing-service.js';
import {AppError} from '../utils/errors.js';
import {parseFiestaCsvGrid} from '../../../shared/fiesta-gallery.js';

// No financial fields leave this read model. All private reads require event scope.
export async function fulfillmentData(albumId){
 const [album,surveys,recipients,photos,cards,jobs,reports,notifications]=await Promise.all([
  query('SELECT a.id,a.event_id,a.title,a.status,e.event_name,e.event_date FROM gallery_albums a JOIN events e ON e.id=a.event_id WHERE a.id=$1',[albumId]),
  query(`SELECT s.*,x.reason AS exclusion_reason,fs.channel,fs.recipient_ciphertext AS contact_ciphertext FROM
   (SELECT DISTINCT ON(fingerprint) * FROM gallery_fiesta_survey_rows WHERE album_id=$1 ORDER BY fingerprint,sequence DESC) s
   LEFT JOIN gallery_postcard_exclusions x ON x.album_id=s.album_id AND x.fingerprint=s.fingerprint
   LEFT JOIN fiesta_gallery_shares fs ON fs.album_id=s.album_id AND fs.person_id=s.person_id AND fs.filename=s.filename`,[albumId]),
  query('SELECT * FROM gallery_postcard_recipients WHERE album_id=$1',[albumId]),
  query("SELECT id,filename,width,height FROM gallery_media WHERE album_id=$1 AND status='VISIBLE' AND media_type='IMAGE'",[albumId]),
  query('SELECT id,person_id,media_id,status,provider_render_status,lob_status,last_error,revision,proof_approved_at FROM gallery_postcards WHERE album_id=$1',[albumId]),
  query(`SELECT id,postcard_id,status AS live_status,lob_status AS live_provider_status,provider_render_status,COALESCE(submitted_at,CASE WHEN status='SUBMITTED' THEN finished_at END) AS submitted_at,scheduled_release_at,mailed_at,delivered_at,expected_delivery_date,finished_at FROM gallery_live_mailing_jobs WHERE album_id=$1 AND status<>'CANCELLED' ORDER BY created_at`,[albumId]),
  query('SELECT id,batch_id,created_at FROM gallery_postcard_reports WHERE album_id=$1 ORDER BY created_at DESC LIMIT 30',[albumId]),
  query('SELECT id,batch_id,report_id,status,last_error,created_at,sent_at FROM gallery_postcard_notifications WHERE album_id=$1 ORDER BY created_at DESC LIMIT 30',[albumId])]);
 if(!album.rows[0])throw new AppError('Gallery unavailable.',404,'NOT_FOUND');
 // Sharing delivery stores one channel. The original row can contain both
 // contact fields; preserve those details without treating them as identities.
 const batchIds=[...new Set(surveys.rows.map(s=>s.batch_id))];
 const sources=new Map();
 if(batchIds.length){
  const batches=await query('SELECT id,source_ciphertext FROM gallery_fiesta_survey_batches WHERE album_id=$1 AND id=ANY($2::uuid[])',[albumId,batchIds]);
  for(const b of batches.rows){const grid=parseFiestaCsvGrid(decryptSecretJson(b.source_ciphertext).csv);const header=grid[0]||[];sources.set(b.id,{grid,email:header.indexOf('Email Address'),phone:header.indexOf('Phone Number')});}
 }
 const used=new Set(),rows=[];
 function append(s,r){
  if(r)used.add(r.id);
  const postal=s?decryptSecretJson(s.answers_ciphertext).postal:null;
  const recipient=r?decryptSecretJson(r.recipient_ciphertext):(postal?.recipient||{});
  const candidates=photos.rows.filter(p=>p.filename===s?.filename);
  const media=photos.rows.find(p=>p.id===r?.media_id)||(candidates.length===1?candidates[0]:null);
  const card=cards.rows.find(p=>p.id===r?.postcard_id);
  const live=jobs.rows.filter(j=>j.postcard_id===card?.id).at(-1);
  const contact=s?.contact_ciphertext?decryptSecretJson(s.contact_ciphertext).recipient:'';
  const source=s?sources.get(s.batch_id):null,sourceRow=source?.grid[s.source_row-1];
  const row={id:s?.id||r.id,survey_row_id:s?.id||null,source_batch_id:s?.batch_id||null,source_row:s?.source_row||null,recipient_id:r?.id||null,filename:s?.filename||r.filename,
   person_id:r?.person_id||s?.person_id,media_id:media?.id||null,width:media?.width,height:media?.height,
   recipient,email:(sourceRow?.[source.email]||'').trim()||(s?.channel==='EMAIL'?contact:''),phone:(sourceRow?.[source.phone]||'').trim()||(s?.channel==='SMS'?contact:''),
   consent:r?.consent??postal?.consent??false,permissionSource:postal?.administrativeAuthorization?'Administrator authorization':'Guest survey',
   match_status:r?.status||'UNMATCHED',survey_status:s?.status,issues:s?.issues||[],exclusion_reason:s?.exclusion_reason||null,
   postcard_id:card?.id||null,card_status:card?.status||null,test_render_status:card?.provider_render_status||null,test_provider_status:card?.lob_status||null,test_error:card?.last_error||null,
   ...live};
  // live job id must not replace the stable survey/recipient identity.
  row.id=s?.id||r.id;row.result=postcardResult(row);rows.push(row);
 }
 for(const s of surveys.rows){const r=recipients.rows.find(r=>r.filename===s.filename&&r.person_id===s.person_id);append(s,r);}
 for(const r of recipients.rows)if(!used.has(r.id))append(null,r);
 for(const p of photos.rows)if(!rows.some(r=>r.media_id===p.id||r.filename===p.filename))rows.push({id:p.id,filename:p.filename,media_id:p.id,recipient:{},email:'',phone:'',consent:false,issues:[],result:{status:'EXCLUDED',reason:'No mailing survey or recipient for this image.'}});
 return {album:album.rows[0],rows,summary:fulfillmentSummary(rows,photos.rowCount),reports:reports.rows,notifications:notifications.rows};
}
export async function fulfillmentWorkspace(albumId,user){
 await assertFiestaReviewAccess(albumId,user);
 return fulfillmentData(albumId);
}
export async function excludeRecipient(albumId,rowId,reason,user,excluded=true){
 await assertFiestaReviewAccess(albumId,user);
 return transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
  const data=await fulfillmentData(albumId),row=data.rows.find(r=>r.survey_row_id===rowId);
  if(!row||row.live_status&&row.live_status!=='CANCELLED')throw new AppError('Only unreserved survey records can be excluded.',409,'POSTCARD_RESERVED');
  if(row.postcard_id&&(await query("SELECT 1 FROM gallery_mailing_jobs WHERE postcard_id=$1 AND status IN('PENDING','PROCESSING')",[row.postcard_id])).rowCount)throw new AppError('Resolve the queued test attempt before changing this recipient.',409,'POSTCARD_RESERVED');
  if(excluded)await query(`INSERT INTO gallery_postcard_exclusions(album_id,survey_row_id,fingerprint,reason,created_by) SELECT $1,$2,fingerprint,$3,$4 FROM gallery_fiesta_survey_rows WHERE id=$2 AND album_id=$1 ON CONFLICT(album_id,fingerprint) DO UPDATE SET survey_row_id=EXCLUDED.survey_row_id,reason=EXCLUDED.reason,created_by=EXCLUDED.created_by,created_at=now()`,[albumId,rowId,reason,user.id]);
  else await query('DELETE FROM gallery_postcard_exclusions WHERE album_id=$1 AND fingerprint=(SELECT fingerprint FROM gallery_fiesta_survey_rows WHERE id=$2 AND album_id=$1)',[albumId,rowId]);
  await mailingHistory(albumId,row.postcard_id,excluded?'RECIPIENT_EXCLUDED':'RECIPIENT_RESTORED',user,{rowId,reason});
  return {updated:true};
 });
}
