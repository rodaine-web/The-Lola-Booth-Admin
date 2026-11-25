import crypto from 'node:crypto';
import sharp from 'sharp';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {assertKeepsakes,keepsakesOrderForToken} from './keepsakes-service.js';
import {assertKeepsakesManager} from './keepsakes-admin-service.js';
import {galleryStorage} from './gallery-storage.js';
import {verifiedGalleryBytes} from './gallery-media-delivery.js';
import {lockKeepsakesOrder} from './keepsakes-order-lock.js';
import {writeAudit} from './audit-service.js';
const deny=()=>new AppError('This editing job or deliverable is unavailable.',404,'KEEPSAKES_EDIT_UNAVAILABLE');
export async function editingJobs(user){assertKeepsakes();assertKeepsakesManager(user);return {jobs:(await query("SELECT f.id,f.order_id,f.status,f.item_index,o.snapshot->'items'->f.item_index AS item,(SELECT jsonb_agg(jsonb_build_object('id',e.id,'deliverable',e.deliverable,'reviewedAt',e.reviewed_at)) FROM keepsakes_edit_outputs e WHERE e.fulfillment_id=f.id AND revoked_at IS NULL) AS outputs FROM keepsakes_fulfillments f JOIN keepsakes_orders o ON o.id=f.order_id WHERE f.provider='DIGITAL_EDIT' AND o.paid_at IS NOT NULL AND o.refunded_cents=0 ORDER BY f.created_at DESC LIMIT 200")).rows};}
export async function completeEditedOutput(id,deliverable,bytes,user){
 assertKeepsakes();assertKeepsakesManager(user);if(!['PHOTO','STRIP'].includes(deliverable)||!Buffer.isBuffer(bytes)||bytes.length>20*1024*1024)throw deny();
 const meta=await sharp(bytes,{limitInputPixels:60000000}).metadata();if(!['jpeg','png'].includes(meta.format)||(meta.pages||1)!==1||Math.min(meta.width,meta.height)<300)throw new AppError('Upload a reviewed static JPEG or PNG at least 300 pixels on its shortest side.',422,'KEEPSAKES_EDIT_FILE');
 const normalized=await sharp(bytes,{limitInputPixels:60000000}).rotate().toColourspace('srgb').jpeg({quality:96,chromaSubsampling:'4:4:4'}).toBuffer();
 return transaction(async()=>{const f=(await query('SELECT * FROM keepsakes_fulfillments WHERE id=$1',[id])).rows[0];if(!f)throw deny();await lockKeepsakesOrder(f.order_id);
 const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1 FOR UPDATE',[f.order_id])).rows[0],item=order?.snapshot.items[f.item_index];
 const required=item?.product.key==='edited-package'?['PHOTO','STRIP']:item?.product.key==='edited-strip'?['STRIP']:['PHOTO'];
 if(!order?.paid_at||order.refunded_cents||f.provider!=='DIGITAL_EDIT'||!required.includes(deliverable)||['CANCELLED','REFUND_PENDING','REFUNDED'].includes(order.status))throw deny();
 if((await query('SELECT 1 FROM keepsakes_edit_outputs WHERE fulfillment_id=$1 AND deliverable=$2',[id,deliverable])).rowCount)throw new AppError('This deliverable is already reviewed. Review the existing delivery before replacing it.',409,'KEEPSAKES_EDIT_EXISTS');
 const storage=galleryStorage(),key=await storage.put(normalized,'image/jpeg');
 await query('INSERT INTO keepsakes_edit_outputs(fulfillment_id,deliverable,storage_key,storage_provider,checksum,size_bytes,mime_type,width,height,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,deliverable,key,storage.provider,crypto.createHash('sha256').update(normalized).digest('hex'),normalized.length,'image/jpeg',meta.width,meta.height,user.id]);
 const outputs=(await query('SELECT deliverable FROM keepsakes_edit_outputs WHERE fulfillment_id=$1 AND revoked_at IS NULL',[id])).rows;
 const complete=required.every(d=>outputs.some(e=>e.deliverable===d));await query("UPDATE keepsakes_fulfillments SET status=$2,lease_until=NULL,updated_at=now() WHERE id=$1",[id,complete?'COMPLETE':'EDITING']);
 await writeAudit({req:{user},action:'keepsakes_edit_quality_approved',entity:'keepsakes_fulfillment',entityId:id,after:{deliverable,complete,originalUnchanged:true}});
 return {saved:true,complete};});
}
export async function editedDownload(token,id){const order=await keepsakesOrderForToken(token);const row=(await query('SELECT e.* FROM keepsakes_edit_outputs e JOIN keepsakes_fulfillments f ON f.id=e.fulfillment_id WHERE e.id=$1 AND f.order_id=$2 AND e.expires_at>now() AND e.revoked_at IS NULL',[id,order.id])).rows[0];if(!order.paid_at||order.refunded_cents||['CANCELLED','REFUND_PENDING','REFUNDED'].includes(order.status)||!row)throw deny();return {bytes:await verifiedGalleryBytes(row,async()=>{const fresh=await keepsakesOrderForToken(token);if(fresh.refunded_cents)throw deny();},{maxBytes:20*1024*1024}),mime:'image/jpeg',filename:`Lola-Edited-${row.deliverable.toLowerCase()}.jpg`};}

export async function editingSource(id,index,user){assertKeepsakes();assertKeepsakesManager(user);const row=(await query("SELECT f.item_index,o.snapshot,o.paid_at,o.refunded_cents FROM keepsakes_fulfillments f JOIN keepsakes_orders o ON o.id=f.order_id WHERE f.id=$1 AND f.provider='DIGITAL_EDIT'",[id])).rows[0],asset=row?.snapshot.items[row.item_index]?.assets[index];if(!row?.paid_at||row.refunded_cents||!asset)throw deny();const media=(await query("SELECT * FROM gallery_media WHERE id=$1 AND checksum=$2 AND status<>'ARCHIVED'",[asset.mediaId,asset.checksum])).rows[0];if(!media)throw deny();return {bytes:await verifiedGalleryBytes(media),mime:media.mime_type};}
