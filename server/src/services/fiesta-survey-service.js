import crypto from 'node:crypto';
import {parseFiestaSurvey} from '../../../shared/fiesta-survey.js';
import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {writeAudit} from './audit-service.js';
import {assertGalleryEnvironment} from './gallery-policy.js';
import {gallerySurveyEnabled} from '../../../shared/features.js';

export function assertSurveyImportEnabled(config=process.env) {
  assertGalleryEnvironment(config);
  if(!gallerySurveyEnabled(config))throw new AppError('Gallery 2.0 survey imports are not enabled.',404,'GALLERY_V2_DISABLED');
}
const digest=value=>crypto.createHmac('sha256',env.integrationSecretKey).update(value).digest('hex');
function parse(input) {
  try{return parseFiestaSurvey(input.csv,input.mapping,input.affirmative);}
  catch{throw new AppError('Check the survey CSV, exact column mapping and affirmative answers.',422,'FIESTA_SURVEY_INVALID');}
}
export async function previewFiestaSurvey(input) {
  assertSurveyImportEnabled();
  const parsed=parse(input);
  // No guest details or raw answers in preview responses/logs.
  return {rows:parsed.records.length,needsAddressReview:parsed.records.filter(r=>r.issues.some(i=>i==='ADDRESS_INCOMPLETE'||i==='US_COUNTRY_REQUIRED')).length,
    unconfirmedConsent:parsed.records.filter(r=>r.issues.includes('CONSENT_UNCONFIRMED')).length,
    unconfirmedPreference:parsed.records.filter(r=>r.issues.includes('MAILING_PREFERENCE_UNCONFIRMED')).length,
    reviewRequired:parsed.records.length,mailingAuthorized:false};
}
export async function importFiestaSurvey(albumId,input,user) {
  assertSurveyImportEnabled();
  const parsed=parse(input),sourceDigest=digest(input.csv);
  const canonical=object=>Object.fromEntries(Object.entries(object).sort(([a],[b])=>a.localeCompare(b)));
  const configurationDigest=digest(JSON.stringify({mapping:canonical(input.mapping),affirmative:canonical(input.affirmative||{})}));
  return transaction(async()=>{
    const album=(await query('SELECT a.*,e.deleted_at AS event_deleted_at,e.status AS event_status FROM gallery_albums a JOIN events e ON e.id=a.event_id WHERE a.id=$1 FOR UPDATE OF a',[albumId])).rows[0];
    if(!album||album.event_deleted_at||album.event_status==='CANCELLED')throw new AppError('Gallery unavailable.',404,'NOT_FOUND');
    if(album.published_at||!['DRAFT','PROCESSING','READY'].includes(album.status))throw new AppError('Import surveys into an unpublished gallery.',409,'GALLERY_SURVEY_LOCKED');
    if(album.source_provider!=='FIESTA'||album.external_event_id!==input.eventCode)throw new AppError('Verify the Fiesta event mapping before importing this survey.',409,'GALLERY_EVENT_CONFLICT');
    const prior=(await query('SELECT id,configuration_digest,row_count FROM gallery_survey_imports WHERE album_id=$1 AND source_digest=$2',[albumId,sourceDigest])).rows[0];
    if(prior){if(prior.configuration_digest!==configurationDigest)throw new AppError('This file was imported with another mapping. Review the existing import before changing it.',409,'SURVEY_MAPPING_CONFLICT');return {id:prior.id,rows:prior.row_count,replayed:true,mailingAuthorized:false};}
    const run=(await query(`INSERT INTO gallery_survey_imports(album_id,event_code,source_digest,configuration_digest,source_ciphertext,mapping,row_count,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[albumId,input.eventCode,sourceDigest,configurationDigest,encryptSecretJson({csv:input.csv}),input.mapping,parsed.records.length,user.id])).rows[0];
    let matched=0;
    for(const record of parsed.records){
      // Session-reference rules require a demonstrated export; do not guess.
      const media=record.data.filename?(await query("SELECT id FROM gallery_media WHERE album_id=$1 AND filename=$2 AND status<>'ARCHIVED' AND media_type='IMAGE'",[albumId,record.data.filename])).rows:[];
      const match=media.length===1?media[0].id:null;
      const issues=[...record.issues,...(!match?[media.length>1?'PHOTO_MATCH_AMBIGUOUS':'PHOTO_MATCH_UNRESOLVED']:[])];
      if(match)matched++;
      await query(`INSERT INTO gallery_survey_responses(album_id,import_id,source_row,response_ciphertext,issues,media_id,match_method,filename_ref)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[albumId,run.id,record.sourceRow,encryptSecretJson({data:record.data,original:record.original,headers:parsed.headers,affirmative:input.affirmative||{}}),JSON.stringify(issues),match,match?'EXACT_FILENAME':null,record.data.filename||null]);
    }
    const summary={id:run.id,rows:parsed.records.length,matched,pending:parsed.records.length-matched,reviewRequired:parsed.records.length,mailingAuthorized:false};
    await writeAudit({req:{user},action:'gallery_survey_imported',entity:'gallery_album',entityId:albumId,after:summary});
    return summary;
  });
}

// Called inside media ingestion's album lock. Missing files can arrive after
// the survey, without reimporting the spreadsheet or overwriting staff reviews.
export async function reconcileSurveyFilename(albumId,filename) {
  if(!gallerySurveyEnabled(process.env))return;
  const media=(await query("SELECT id,media_type FROM gallery_media WHERE album_id=$1 AND filename=$2 AND status<>'ARCHIVED'",[albumId,filename])).rows;
  if(media.length!==1||media[0].media_type!=='IMAGE')return;
  await query(`UPDATE gallery_survey_responses SET media_id=$3,match_method='EXACT_FILENAME',
    issues=COALESCE((SELECT jsonb_agg(issue) FROM jsonb_array_elements(issues) issue WHERE issue NOT IN ('"PHOTO_MATCH_UNRESOLVED"'::jsonb,'"PHOTO_MATCH_AMBIGUOUS"'::jsonb)),'[]'::jsonb)
    WHERE album_id=$1 AND filename_ref=$2 AND media_id IS NULL AND review_status='NEEDS_REVIEW'`,[albumId,filename,media[0].id]);
}

export async function listSurveyImports(albumId,offset=0) {
  assertSurveyImportEnabled();
  if(!(await query('SELECT 1 FROM gallery_albums WHERE id=$1',[albumId])).rowCount)throw new AppError('Gallery unavailable.',404,'NOT_FOUND');
  const imports=(await query('SELECT id,event_code,row_count,created_at FROM gallery_survey_imports WHERE album_id=$1 ORDER BY created_at DESC',[albumId])).rows;
  const responses=(await query(`SELECT r.id,r.import_id,r.source_row,r.issues,r.media_id,r.match_method,r.review_status,r.reviewed_at,m.filename
    FROM gallery_survey_responses r LEFT JOIN gallery_media m ON m.id=r.media_id AND m.album_id=r.album_id
    WHERE r.album_id=$1 ORDER BY r.created_at,r.source_row,r.id LIMIT 50 OFFSET $2`,[albumId,offset])).rows;
  const counts=(await query(`SELECT count(*)::int total,count(*) FILTER(WHERE media_id IS NOT NULL)::int matched,
    count(*) FILTER(WHERE review_status='NEEDS_REVIEW')::int needs_review,count(*) FILTER(WHERE review_status='EXCLUDED')::int excluded
    FROM gallery_survey_responses WHERE album_id=$1`,[albumId])).rows[0];
  return {imports,responses,counts,offset,mailingAuthorized:false};
}

export async function surveyResponseDetail(albumId,responseId) {
  assertSurveyImportEnabled();
  const row=(await query('SELECT id,source_row,response_ciphertext,issues,media_id,match_method,review_status,review_reason FROM gallery_survey_responses WHERE id=$1 AND album_id=$2',[responseId,albumId])).rows[0];
  if(!row)throw new AppError('Survey response unavailable.',404,'NOT_FOUND');
  const {response_ciphertext,review_reason,...safe}=row;
  return {...safe,review_reason:review_reason?decryptSecretJson(review_reason).reason:null,...decryptSecretJson(response_ciphertext),mailingAuthorized:false};
}

export async function reviewSurveyResponse(albumId,responseId,input,user) {
  assertSurveyImportEnabled();
  return transaction(async()=>{
    const album=(await query('SELECT a.status,a.published_at,e.deleted_at,e.status AS event_status FROM gallery_albums a JOIN events e ON e.id=a.event_id WHERE a.id=$1 FOR UPDATE OF a',[albumId])).rows[0];
    if(!album||album.deleted_at||album.event_status==='CANCELLED'||album.published_at||!['DRAFT','PROCESSING','READY'].includes(album.status))throw new AppError('Review surveys in an unpublished gallery.',409,'GALLERY_SURVEY_LOCKED');
    const row=(await query('SELECT id,review_status,issues FROM gallery_survey_responses WHERE id=$1 AND album_id=$2 FOR UPDATE',[responseId,albumId])).rows[0];
    if(!row)throw new AppError('Survey response unavailable.',404,'NOT_FOUND');
    let mediaId=null;
    if(input.decision==='CONFIRMED'){
      const media=(await query("SELECT id FROM gallery_media WHERE id=$1 AND album_id=$2 AND media_type='IMAGE' AND status<>'ARCHIVED'",[input.mediaId,albumId])).rows[0];
      if(!media)throw new AppError('Choose a photo from this event gallery.',422,'SURVEY_PHOTO_INVALID');
      mediaId=media.id;
    }
    const issues=row.issues.filter(issue=>!['PHOTO_MATCH_UNRESOLVED','PHOTO_MATCH_AMBIGUOUS'].includes(issue));
    if(!mediaId)issues.push('EXCLUDED_BY_ADMIN');
    await query(`UPDATE gallery_survey_responses SET review_status=$3,media_id=$4,match_method=$5,reviewed_by=$6,reviewed_at=now(),review_reason=$7,issues=$8 WHERE id=$1 AND album_id=$2`,
      [responseId,albumId,input.decision,mediaId,mediaId?'MANUAL':null,user.id,encryptSecretJson({reason:input.reason}),JSON.stringify(issues.filter(issue=>mediaId?issue!=='EXCLUDED_BY_ADMIN':true))]);
    // Review reasons may contain personal details; retain them only in the
    // restricted response record, never in the generic audit payload.
    await writeAudit({req:{user},action:'gallery_survey_reviewed',entity:'gallery_album',entityId:albumId,before:{responseId,status:row.review_status},after:{responseId,status:input.decision,mediaId}});
    return {id:responseId,reviewStatus:input.decision,mailingAuthorized:false};
  });
}
