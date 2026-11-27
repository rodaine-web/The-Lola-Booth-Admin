import {syncKeepsakesOrder} from './keepsakes-lifecycle-service.js';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {assertKeepsakes,keepsakesSnapshot} from './keepsakes-service.js';
import {decryptSecretJson} from './integration-secrets.js';
import {assertKeepsakesManager} from './keepsakes-admin-service.js';
import {lockKeepsakesOrder} from './keepsakes-order-lock.js';
import {verifiedGalleryBytes} from './gallery-media-delivery.js';
import {AppError} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
const denied=()=>new AppError('This production job is unavailable.',404,'KEEPSAKES_PRODUCTION_UNAVAILABLE');
export async function productionJobs(user){assertKeepsakes();assertKeepsakesManager(user);return {jobs:(await query("SELECT f.id,f.order_id,f.status,f.tracking,f.artwork,(o.snapshot->'shipping'->>'provider'='SHIPPO') AS shippo,o.snapshot->'items'->f.item_index AS item,o.contact_ciphertext FROM keepsakes_fulfillments f JOIN keepsakes_orders o ON o.id=f.order_id WHERE f.provider='IN_HOUSE' AND o.paid_at IS NOT NULL AND o.refunded_cents=0 AND o.status NOT IN('CANCELLED','REFUND_PENDING','REFUNDED') ORDER BY f.created_at DESC LIMIT 200")).rows.map(({contact_ciphertext,...row})=>{const item=keepsakesSnapshot({items:[row.item]}).items[0];return {...row,item,shippingAddress:item.shippingAddress||decryptSecretJson(contact_ciphertext).shippingAddress};})};}
export async function productionArtwork(id,user){assertKeepsakes();assertKeepsakesManager(user);const row=(await query("SELECT f.artwork,o.paid_at,o.refunded_cents,o.status FROM keepsakes_fulfillments f JOIN keepsakes_orders o ON o.id=f.order_id WHERE f.id=$1 AND f.provider='IN_HOUSE'",[id])).rows[0];if(!row?.paid_at||row.refunded_cents||['CANCELLED','REFUND_PENDING','REFUNDED'].includes(row.status)||!row.artwork?.[0])throw denied();return verifiedGalleryBytes(row.artwork[0],async()=>{const current=(await query('SELECT o.refunded_cents,o.status FROM keepsakes_orders o JOIN keepsakes_fulfillments f ON f.order_id=o.id WHERE f.id=$1',[id])).rows[0];if(current.refunded_cents||['CANCELLED','REFUND_PENDING','REFUNDED'].includes(current.status))throw denied();},{maxBytes:20*1024*1024});}
export async function progressProduction(id,raw,user){assertKeepsakes();assertKeepsakesManager(user);const input=z.object({action:z.enum(['APPROVE_PRODUCTION','FULFILLED','SHIPPED','COMPLETE']),stockAndCapacityConfirmed:z.boolean().optional(),proofReviewed:z.boolean().optional(),carrier:z.string().trim().max(100).optional(),trackingNumber:z.string().trim().max(150).optional(),trackingUrl:z.url().refine(v=>new URL(v).protocol==='https:').optional()}).strict().parse(raw);return transaction(async()=>{const job=(await query('SELECT order_id FROM keepsakes_fulfillments WHERE id=$1',[id])).rows[0];if(!job)throw denied();await lockKeepsakesOrder(job.order_id);const row=(await query("SELECT f.*,o.paid_at,o.refunded_cents,o.status AS order_status FROM keepsakes_fulfillments f JOIN keepsakes_orders o ON o.id=f.order_id WHERE f.id=$1 FOR UPDATE OF f,o",[id])).rows[0];if(!row.paid_at||row.refunded_cents||row.provider!=='IN_HOUSE'||['CANCELLED','REFUND_PENDING','REFUNDED'].includes(row.order_status))throw denied();
 const expected={APPROVE_PRODUCTION:'AWAITING_PRODUCTION',FULFILLED:'IN_PRODUCTION',SHIPPED:'FULFILLED',COMPLETE:'SHIPPED'};
 if(row.status!==expected[input.action])throw new AppError('Reload this job before advancing its production stage.',409,'KEEPSAKES_PRODUCTION_STATE');
 if(input.action==='APPROVE_PRODUCTION'&&(!input.stockAndCapacityConfirmed||!input.proofReviewed||!row.artwork?.length))throw new AppError('Review the print file and confirm stock and production capacity first.',422,'KEEPSAKES_PRODUCTION_APPROVAL');
 const order=(await query('SELECT snapshot FROM keepsakes_orders WHERE id=$1',[job.order_id])).rows[0];
 const shippo=order.snapshot.shipping?.provider==='SHIPPO';let tracking=row.tracking;
 if(input.action==='COMPLETE'&&shippo)throw new AppError('Shippo confirms delivery automatically. Refresh its tracking from Shipping.',409,'KEEPSAKES_CARRIER_DELIVERY_REQUIRED');
 if(input.action==='SHIPPED'){
  if(shippo){
   const parcels=order.snapshot.shipping.parcels.map((p,index)=>({...p,index})).filter(p=>p.itemIndices.includes(row.item_index));
   const labels=(await query("SELECT parcel_index,tracking FROM keepsakes_shippo_labels WHERE order_id=$1 AND status='READY'",[job.order_id])).rows;
   if(!parcels.length||!parcels.every(p=>labels.some(l=>l.parcel_index===p.index&&l.tracking?.trackingNumber)))throw new AppError('Create reviewed Shippo labels for every package covering this item before marking shipped.',409,'KEEPSAKES_TRACKING_REQUIRED');
   const covered=[...new Set(parcels.flatMap(p=>p.itemIndices))],jobs=(await query("SELECT item_index,status FROM keepsakes_fulfillments WHERE order_id=$1 AND provider='IN_HOUSE' AND item_index=ANY($2::int[])",[job.order_id,covered])).rows;
   if(!covered.every(index=>jobs.some(j=>j.item_index===index&&['FULFILLED','SHIPPED','COMPLETE'].includes(j.status))))throw new AppError('Finish and pack every item sharing these packages before marking shipped.',409,'KEEPSAKES_PACKAGE_NOT_READY');
   tracking=parcels.map(p=>labels.find(l=>l.parcel_index===p.index).tracking);
  }else{
   if(!input.carrier||!input.trackingNumber||!input.trackingUrl)throw new AppError('Enter carrier and tracking details before marking shipped.',422,'KEEPSAKES_TRACKING_REQUIRED');
   tracking=[{carrier:input.carrier,trackingNumber:input.trackingNumber,trackingUrl:input.trackingUrl}];
  }
 }
 const status=input.action==='APPROVE_PRODUCTION'?'IN_PRODUCTION':input.action;
 await query('UPDATE keepsakes_fulfillments SET status=$2,tracking=$3,updated_at=now() WHERE id=$1',[id,status,JSON.stringify(tracking)]);
 await writeAudit({req:{user},action:'keepsakes_production_'+input.action.toLowerCase(),entity:'keepsakes_fulfillment',entityId:id,after:input});await query('INSERT INTO keepsakes_events(order_id,action,details) VALUES($1,$2,$3)',[job.order_id,'production_'+input.action.toLowerCase(),{fulfillmentId:id,message:input.action==='FULFILLED'?'Item fulfilled and ready to ship.':input.action==='SHIPPED'?'Admin confirmed carrier handoff.':input.action==='COMPLETE'?'Admin confirmed delivery.':'Artwork, stock and capacity reviewed; production approved.'}]);await syncKeepsakesOrder(job.order_id);return {saved:true,status};});}
