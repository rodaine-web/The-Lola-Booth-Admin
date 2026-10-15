import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {env} from '../config/env.js';
import {AppError} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {parseFiestaShares} from '../../../shared/fiesta-gallery.js';
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
export async function importFiestaShares(albumId,csv,eventCode,user){
 let parsed;try{parsed=parseFiestaShares(csv,eventCode);}catch{throw new AppError('Invalid Fiesta CSV. Check its columns, event code, recipients and capture links.',422,'FIESTA_CSV_INVALID');}
 return transaction(async()=>{
  const album=(await query('SELECT * FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0];
  if(!album)throw new AppError('Gallery unavailable.',404,'NOT_FOUND');
  if(album.source_provider&&album.source_provider!=='FIESTA')throw new AppError('This album is linked to another provider.',409,'GALLERY_PROVIDER_CONFLICT');
  if(album.external_event_id&&album.external_event_id!==parsed.eventCode)throw new AppError('This album is linked to another Fiesta event.',409,'GALLERY_EVENT_CONFLICT');
  // One source cannot be mapped to two customer events. Database constraint also enforces this.
  if((await query('SELECT 1 FROM gallery_albums WHERE source_provider=\'FIESTA\' AND external_event_id=$1 AND id<>$2',[parsed.eventCode,albumId])).rowCount)throw new AppError('This Fiesta event already has a gallery.',409,'GALLERY_EVENT_CONFLICT');
  await query("UPDATE gallery_albums SET source_provider='FIESTA',external_event_id=$2 WHERE id=$1",[albumId,parsed.eventCode]);
  for(const record of parsed.records){
   const external='fiesta:'+crypto.createHmac('sha256',env.integrationSecretKey).update(record.channel+':'+record.recipient).digest('hex');
   const person=(await query(`INSERT INTO gallery_people(album_id,display_name,external_ref) VALUES($1,$2,$3)
    ON CONFLICT(album_id,external_ref) WHERE external_ref IS NOT NULL DO UPDATE SET external_ref=EXCLUDED.external_ref RETURNING id,status`,[albumId,'Fiesta '+record.channel.toLowerCase()+' guest '+external.slice(-8),external])).rows[0];
   if(person.status!=='ACTIVE')continue; // An archived guest is never silently reactivated.
   await query(`INSERT INTO fiesta_gallery_shares(album_id,person_id,filename,channel,recipient_ciphertext,capture_ref,source_share_time)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[albumId,person.id,record.filename,record.channel,encryptSecretJson({recipient:record.recipient}),record.captureRef,record.sharedAt]);
  }
  await reconcileFiestaShares(albumId);
  const counts=(await query(`SELECT count(*)::int AS associations,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM gallery_media m JOIN gallery_media_people mp ON mp.media_id=m.id AND mp.person_id=s.person_id WHERE m.album_id=s.album_id AND m.filename=s.filename))::int AS matched FROM fiesta_gallery_shares s WHERE s.album_id=$1`,[albumId])).rows[0];
  await writeAudit({req:{user},action:'fiesta_shares_imported',entity:'gallery_album',entityId:albumId,after:{eventCode:parsed.eventCode,records:parsed.records.length,...counts}});
  return {...counts,pending:counts.associations-counts.matched,sharingRows:parsed.sharingRows,captures:parsed.captures};
 });
}
