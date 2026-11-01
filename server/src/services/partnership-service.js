import {query,transaction} from '../db/pool.js';
import {AppError,notFound} from '../utils/errors.js';
import {writeAudit} from '../middleware/audit.js';
import {createGalleryKey,createGalleryPerson,revealGalleryKey} from './private-gallery-service.js';
import {assertGalleryEnvironment} from './gallery-policy.js';
export async function partnerDetail(id){
 const partner=(await query('SELECT * FROM partners WHERE id=$1',[id])).rows[0];if(!partner)throw notFound('Partner');
 const events=(await query(`SELECT ep.*,e.event_name,e.event_date,e.status,a.id AS album_id,a.status AS gallery_status FROM event_partners ep JOIN events e ON e.id=ep.event_id LEFT JOIN gallery_albums a ON a.event_id=e.id WHERE ep.partner_id=$1 AND e.deleted_at IS NULL ORDER BY e.event_date DESC`,[id])).rows;
 return {...partner,events};
}
export async function partnershipEvent(id){
 const event=(await query("SELECT * FROM events WHERE id=$1 AND event_kind='PARTNERSHIP' AND deleted_at IS NULL",[id])).rows[0];if(!event)throw notFound('Partnership event');
 const partners=(await query('SELECT ep.*,p.name,p.partner_number FROM event_partners ep JOIN partners p ON p.id=ep.partner_id WHERE ep.event_id=$1 ORDER BY ep.created_at',[id])).rows;
 const album=(await query('SELECT id,title,status,expires_at FROM gallery_albums WHERE event_id=$1',[id])).rows[0]||null;
 // No token is returned until a privileged explicit reveal request.
 const grants=(await query(`SELECT g.*,k.status,k.expires_at FROM partner_gallery_grants g JOIN event_partners ep ON ep.id=g.event_partner_id JOIN gallery_access_keys k ON k.id=g.access_key_id WHERE ep.event_id=$1 ORDER BY g.created_at DESC`,[id])).rows;
 return {...event,partners,album,grants};
}
export async function createPartnershipEvent(input,req){
 return transaction(async()=>{
  for(const link of input.partners)if(!(await query("SELECT 1 FROM partners WHERE id=$1 AND status='ACTIVE' FOR SHARE",[link.partner_id])).rowCount)throw new AppError('Select active partners.',422,'PARTNER_UNAVAILABLE');
  const event=(await query(`INSERT INTO events(event_name,event_type,event_date,start_time,end_time,venue_name,venue_address,city,state,internal_notes,event_kind,status,event_number)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PARTNERSHIP',$11,'EVT-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))) RETURNING *`,[input.event_name,input.event_type,input.event_date,input.start_time||null,input.end_time||null,input.venue_name||null,input.venue_address||null,input.city||null,input.state||null,input.internal_notes||null,input.status])).rows[0];
  for(const link of input.partners)await query('INSERT INTO event_partners(event_id,partner_id,role,notes) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[event.id,link.partner_id,link.role,link.notes||null]);
  await writeAudit({req,action:'partnership_event_created',entity:'event',entityId:event.id,after:event});return event;
 });
}
export async function convertPartnershipLead(id,req){
 return transaction(async()=>{
  const lead=(await query('SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];if(!lead)throw notFound('Lead');
  if(lead.opportunity_type!=='PARTNERSHIP'||['LOST','ARCHIVED'].includes(lead.status))throw new AppError('Reopen and review a partnership opportunity before conversion.',409,'PARTNERSHIP_REVIEW_REQUIRED');
  const converted=(await query("UPDATE leads SET status='WON',updated_at=now() WHERE id=$1 RETURNING converted_partner_id",[id])).rows[0];
  await writeAudit({req,action:'partnership_lead_converted',entity:'lead',entityId:id,after:converted});return {partner:await partnerDetail(converted.converted_partner_id)};
 });
}
export async function grantPartnerGallery(eventId,linkId,input,req){
 assertGalleryEnvironment();
 return transaction(async()=>{
  const link=(await query(`SELECT ep.*,p.name,p.status AS partner_status FROM event_partners ep JOIN partners p ON p.id=ep.partner_id JOIN events e ON e.id=ep.event_id WHERE ep.id=$1 AND ep.event_id=$2 AND e.event_kind='PARTNERSHIP' AND e.deleted_at IS NULL FOR UPDATE OF ep FOR SHARE OF p`,[linkId,eventId])).rows[0];
  if(!link||link.partner_status!=='ACTIVE')throw notFound('Active event partner');
  const album=(await query("SELECT * FROM gallery_albums WHERE event_id=$1 FOR UPDATE",[eventId])).rows[0];
  if(!album||!['PUBLISHED','DELIVERED'].includes(album.status)||!album.expires_at||new Date(album.expires_at)<=new Date())throw new AppError('Publish an unexpired gallery before granting partner access.',409,'GALLERY_NOT_READY');
  let person=null;
  if(input.scope==='SELECTED'){
   const ids=[...new Set(input.media_ids)];
   const media=(await query("SELECT id FROM gallery_media WHERE album_id=$1 AND id=ANY($2::uuid[]) AND status='VISIBLE' FOR SHARE",[album.id,ids])).rows;
   if(!ids.length||media.length!==ids.length)throw new AppError('Choose visible images from this event gallery only.',422,'PARTNER_MEDIA_INVALID');
   person=await createGalleryPerson(album.id,`${link.name} — approved partner selection`);
   for(const row of media)await query('INSERT INTO gallery_media_people(album_id,media_id,person_id,confirmed_by) VALUES($1,$2,$3,$4)',[album.id,row.id,person.id,req.user.id]);
  }
  const access=await createGalleryKey(album.id,input.scope==='FULL'?'ALBUM':'PERSON',person?.id,album.expires_at,req.user);
  await query('INSERT INTO partner_gallery_grants(event_partner_id,access_key_id,scope,created_by) VALUES($1,$2,$3,$4)',[link.id,access.id,input.scope,req.user.id]);
  await writeAudit({req,action:'partner_gallery_access_granted',entity:'event',entityId:eventId,after:{partner_id:link.partner_id,scope:input.scope,key_id:access.id}});return access;
 });
}
export async function partnerGrantAction(id,req,revoke=false){
 return transaction(async()=>{
 const row=(await query(`SELECT k.* FROM partner_gallery_grants g JOIN gallery_access_keys k ON k.id=g.access_key_id WHERE g.id=$1 FOR UPDATE OF k`,[id])).rows[0];if(!row)throw notFound('Partner grant');
 if(revoke){await query("UPDATE gallery_access_keys SET status='REVOKED',revoked_at=now() WHERE id=$1",[row.id]);await writeAudit({req,action:'partner_gallery_access_revoked',entity:'gallery_access_key',entityId:row.id});return {revoked:true};}
 return revealGalleryKey(row.id);
 });
}
