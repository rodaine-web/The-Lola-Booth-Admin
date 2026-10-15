import {query} from '../db/pool.js';
import {clientEventGrant} from './client-session-workspace-service.js';
import {assertGalleryEnvironment,unavailable} from './gallery-policy.js';

export async function customerGalleryAccess(session,eventId){
 assertGalleryEnvironment();await clientEventGrant(session,eventId);
 const album=(await query(`SELECT a.* FROM gallery_albums a JOIN events e ON e.id=a.event_id WHERE a.event_id=$1 AND e.client_id=$2
 AND e.deleted_at IS NULL AND e.sales_closed_at IS NULL AND e.status<>'CANCELLED'
 AND a.status IN('PUBLISHED','DELIVERED') AND a.expires_at IS NOT NULL AND a.expires_at>now()`,[eventId,session.client_id])).rows[0];
 if(!album)throw unavailable();return album;
}
export async function customerGalleryView(session,eventId){
 const album=await customerGalleryAccess(session,eventId);
 const media=(await query("SELECT id,filename,mime_type,media_type FROM gallery_media WHERE album_id=$1 AND status='VISIBLE' ORDER BY sort_order,created_at LIMIT 1000",[album.id])).rows;
 return {title:album.title,expiresAt:album.expires_at,allowDownload:album.allow_download,allowZip:album.allow_zip,media:media.map(m=>({id:m.id,filename:m.filename,mimeType:m.mime_type,mediaType:m.media_type}))};
}
export async function customerGalleryMedia(session,eventId,mediaId,download=false){
 const album=await customerGalleryAccess(session,eventId);if(download&&!album.allow_download)throw unavailable();
 const media=(await query("SELECT * FROM gallery_media WHERE id=$1 AND album_id=$2 AND status='VISIBLE'",[mediaId,album.id])).rows[0];
 if(!media)throw unavailable();return media;
}
