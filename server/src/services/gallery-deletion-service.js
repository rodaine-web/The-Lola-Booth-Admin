import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';

async function lockAlbum(albumId) {
  const album=(await query('SELECT * FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0];
  if(!album)throw new AppError('Gallery unavailable.',404,'NOT_FOUND');
  // All import commits acquire this album lock. Removing their lease fences
  // downloads already in progress before they can write another photo.
  await query('UPDATE gallery_dropbox_sources SET enabled=false,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE album_id=$1',[albumId]);
  return album;
}
export async function deleteGalleryPhotos(albumId,mediaIds,user) {
  return transaction(async()=>{
    await lockAlbum(albumId);
    if((await query('SELECT 1 FROM keepsakes_orders WHERE album_id=$1 LIMIT 1',[albumId])).rowCount)throw new AppError('This gallery has Keepsakes orders. Retain its photos for order and download history.',409,'KEEPSAKES_ORDER_HISTORY');
    const ids=[...new Set(mediaIds)];
    const media=(await query('SELECT id FROM gallery_media WHERE album_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE',[albumId,ids])).rows;
    if(media.length!==ids.length)throw new AppError('Select photos from this gallery only.',422,'GALLERY_MEDIA_MISMATCH');
    if((await query('SELECT 1 FROM gallery_postcards WHERE album_id=$1 AND media_id=ANY($2::uuid[]) LIMIT 1',[albumId,ids])).rowCount)
      throw new AppError('A selected photo is used by a postcard. Delete the test album to reset its postcard records, or keep this photo for its mailing history.',409,'GALLERY_PHOTO_IN_USE');
    await query('UPDATE gallery_albums SET cover_media_id=NULL,updated_at=now() WHERE id=$1 AND cover_media_id=ANY($2::uuid[])',[albumId,ids]);
    await query('DELETE FROM gallery_session_assets WHERE album_id=$1 AND media_id=ANY($2::uuid[])',[albumId,ids]);
    await query('DELETE FROM gallery_photo_sessions WHERE album_id=$1 AND anchor_media_id=ANY($2::uuid[])',[albumId,ids]);
    await query('DELETE FROM gallery_activity WHERE album_id=$1 AND media_id=ANY($2::uuid[])',[albumId,ids]);
    await query('DELETE FROM gallery_media_people WHERE album_id=$1 AND media_id=ANY($2::uuid[])',[albumId,ids]);
    await query("UPDATE gallery_postcard_recipients SET media_id=NULL,status=CASE WHEN consent THEN 'UNMATCHED' ELSE 'NO_CONSENT' END,updated_at=now() WHERE album_id=$1 AND media_id=ANY($2::uuid[])",[albumId,ids]);
    // Dropbox revision receipts remain as tombstones so sync cannot restore a
    // deleted picture. Original Dropbox files and private storage are untouched.
    await query('DELETE FROM gallery_media WHERE album_id=$1 AND id=ANY($2::uuid[])',[albumId,ids]);
    await writeAudit({req:{user},action:'gallery_photos_deleted',entity:'gallery_album',entityId:albumId,after:{media_ids:ids,count:ids.length}});
    return {deleted:ids.length,importsPaused:true};
  });
}
export async function deleteGalleryAlbum(albumId,user,{recreate=false}={}) {
  return transaction(async()=>{
    const album=await lockAlbum(albumId);
    if((await query('SELECT 1 FROM keepsakes_orders WHERE album_id=$1 LIMIT 1',[albumId])).rowCount)throw new AppError('This gallery has Keepsakes orders. Retain its gallery for order and download history.',409,'KEEPSAKES_ORDER_HISTORY');
    await query('DELETE FROM keepsakes_quotes WHERE album_id=$1',[albumId]);
    await query('DELETE FROM gallery_photo_sessions WHERE album_id=$1',[albumId]);
    if((await query("SELECT 1 FROM gallery_live_mailing_jobs WHERE album_id=$1 AND status<>'CANCELLED' LIMIT 1",[albumId])).rowCount)
      throw new AppError('This gallery has live mailing records. Cancel unsubmitted live mailing jobs or retain the gallery for mailing history.',409,'GALLERY_LIVE_MAILING_EXISTS');
    if((await query("SELECT 1 FROM gallery_mailing_jobs WHERE album_id=$1 AND status='PROCESSING' UNION ALL SELECT 1 FROM gallery_postcards WHERE album_id=$1 AND status='SUBMITTING' LIMIT 1",[albumId])).rowCount)
      throw new AppError('Wait for the postcard submission to finish before deleting this gallery.',409,'GALLERY_MAILING_BUSY');
    const counts=(await query('SELECT (SELECT count(*)::int FROM gallery_media WHERE album_id=$1) photos,(SELECT count(*)::int FROM gallery_people WHERE album_id=$1) people,(SELECT count(*)::int FROM gallery_activity WHERE album_id=$1) activity',[albumId])).rows[0];
    await query('DELETE FROM partner_gallery_grants WHERE access_key_id IN (SELECT id FROM gallery_access_keys WHERE album_id=$1)',[albumId]);
    for(const table of ['gallery_postcard_notifications','gallery_postcard_reports','gallery_live_mailing_jobs','gallery_live_mailing_batches','gallery_mailing_history','gallery_mailing_jobs','gallery_mailing_requests','gallery_mailing_policies','gallery_fiesta_survey_rows','gallery_fiesta_survey_batches','gallery_postcard_recipients','gallery_postcards','gallery_postcard_back_artworks','gallery_activity','gallery_dropbox_imports','gallery_dropbox_sources','gallery_imports','fiesta_gallery_shares','gallery_access_keys','gallery_media_people'])
      await query(`DELETE FROM ${table} WHERE album_id=$1`,[albumId]);
    await query('UPDATE gallery_albums SET cover_media_id=NULL WHERE id=$1',[albumId]);
    await query('DELETE FROM gallery_media WHERE album_id=$1',[albumId]);
    await query('DELETE FROM gallery_people WHERE album_id=$1',[albumId]);
    await query('DELETE FROM gallery_albums WHERE id=$1',[albumId]);
    let replacement=null;
    if(recreate)replacement=(await query('INSERT INTO gallery_albums(event_id,title) SELECT id,event_name FROM events WHERE id=$1 RETURNING *',[album.event_id])).rows[0];
    await writeAudit({req:{user},action:recreate?'gallery_album_reset':'gallery_album_deleted',entity:'gallery_album',entityId:albumId,before:{event_id:album.event_id,title:album.title,...counts},after:{replacement_album_id:replacement?.id||null}});
    return {deleted:true,event_id:album.event_id,...counts,album:replacement};
  });
}
