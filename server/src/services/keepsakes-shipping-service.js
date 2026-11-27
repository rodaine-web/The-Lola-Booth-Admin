import {orderHasGlobalHold} from '../../../shared/keepsakes-order-workflow.js';
import {refundedOrderHold,remainingItemUnits} from '../../../shared/keepsakes-refunds.js';
import {syncKeepsakesOrder} from './keepsakes-lifecycle-service.js';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {keepsakesAddress} from '../../../shared/keepsakes.js';
import {assertKeepsakes} from './keepsakes-service.js';
import {assertKeepsakesManager} from './keepsakes-admin-service.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {writeAudit} from './audit-service.js';
import {withKeepsakesOrderLock} from './keepsakes-order-lock.js';
import {shippoReadiness,shippoRate,shippoAddress,shippoRequest,shippoHttps} from './shippo-service.js';
import {AppError} from '../utils/errors.js';
const keys=['keychain','magnet','jacketed-print','framed-photo','acrylic-display'];
const size=z.number().positive().max(100),weight=z.number().positive().max(2400);
export const shippingConfiguration=z.object({enabled:z.boolean(),origin:keepsakesAddress.extend({email:z.email().max(254),phone:z.string().regex(/^\+[1-9]\d{7,14}$/)}),services:z.array(z.string().regex(/^[a-z0-9_]+$/).max(100)).max(30).default([]),profiles:z.array(z.object({id:z.string().regex(/^[\w-]+$/).max(60),name:z.string().trim().min(1).max(100),products:z.array(z.enum(keys)).min(1).max(5),length:size,width:size,height:size,emptyWeightOz:z.number().min(0).max(500),unitWeightOz:weight,capacity:z.number().int().min(1).max(100)}).strict()).min(1).max(10)}).strict().superRefine((v,ctx)=>{const used=v.profiles.flatMap(p=>p.products);if(new Set(used).size!==used.length||new Set(v.profiles.map(p=>p.id)).size!==v.profiles.length)ctx.addIssue({code:'custom',message:'Use unique package names and assign each product to one package profile.'});});
export async function shippingConfig(){const row=(await query('SELECT * FROM keepsakes_shipping_config WHERE id=true')).rows[0];return {enabled:row.enabled,version:row.revision,...(row.config_ciphertext?decryptSecretJson(row.config_ciphertext):{})};}
export async function shippingAdmin(user){assertKeepsakes();assertKeepsakesManager(user);return {configuration:await shippingConfig(),...shippoReadiness(),labels:(await query('SELECT id,order_id,parcel_index,status,rate,quoted_at,label_url,tracking FROM keepsakes_shippo_labels WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 100')).rows};}
export async function saveShipping(input,user){assertKeepsakes();assertKeepsakesManager(user);const data=shippingConfiguration.parse(input);await transaction(async()=>{await query('UPDATE keepsakes_shipping_config SET enabled=$1,config_ciphertext=$2,revision=gen_random_uuid(),updated_at=clock_timestamp() WHERE id=true',[data.enabled,encryptSecretJson(data)]);await writeAudit({req:{user},action:'keepsakes_shipping_configured',entity:'keepsakes',after:{enabled:data.enabled,profileIds:data.profiles.map(p=>p.id)}});});return {saved:true};}
const normalized=a=>JSON.stringify([a.name,a.address1,a.address2||'',a.city,a.state,a.zip,a.country].map(s=>s.trim().toLowerCase().replace(/\s+/g,' ')));
export function packShippoParcels(items,defaultAddress,config){
 const groups=new Map();items.forEach((item,index)=>{if(item.product.provider!=='IN_HOUSE')return;const address=item.shippingAddress||defaultAddress,profile=config.profiles.find(p=>p.products.includes(item.product.key));if(!address||!profile)throw new AppError('Shipping packaging is not configured for this product.',409,'SHIPPO_PACKAGING_REQUIRED');const key=normalized(address);if(!groups.has(key))groups.set(key,{address,profiles:new Map(),units:[]});const group=groups.get(key);for(let n=0;n<remainingItemUnits(item);n++)group.units.push(index);if(!group.profiles.has(profile.id))group.profiles.set(profile.id,{profile,count:0});group.profiles.get(profile.id).count+=remainingItemUnits(item);});
 const parcels=[];for(const {address,profiles,units}of groups.values()){
  if(!units.length)continue;const rows=[...profiles.values()],length=Math.max(...rows.map(r=>r.profile.length)),width=Math.max(...rows.map(r=>r.profile.width)),height=rows.reduce((n,r)=>n+r.profile.height*Math.ceil(r.count/r.profile.capacity),0),weight=rows.reduce((n,r)=>n+r.profile.unitWeightOz*r.count,0)+Math.max(...rows.map(r=>r.profile.emptyWeightOz));
  if(height>100||weight>2400)throw new AppError('The packed order needs a reviewed box size and weight before checkout.',409,'SHIPPO_PACKAGING_REQUIRED');
  parcels.push({itemIndices:[...new Set(units)],itemQuantities:units.reduce((counts,index)=>({...counts,[index]:(counts[index]||0)+1}),{}),payload:{address_from:shippoAddress(config.origin),address_to:shippoAddress(address),parcels:[{length:String(length),width:String(width),height:String(height),distance_unit:'in',weight:String(Number(weight.toFixed(3))),mass_unit:'oz'}]}});
 }
 if(parcels.length>25)throw new AppError('Use up to 25 delivery destinations per order.',422,'SHIPPO_PACKAGE_LIMIT');return parcels;
}
export async function quoteShippoShipping(items,address,config){
 if(!config.origin?.email||!config.origin?.phone)throw new AppError('Delivery configuration is being updated. Please try again shortly.',409,'SHIPPO_SENDER_CONTACT_REQUIRED');
 const parcels=packShippoParcels(items,address,config);const quoted=[];
 for(const parcel of parcels){const rate=await shippoRate(parcel.payload,config.services);quoted.push({itemIndices:parcel.itemIndices,itemQuantities:parcel.itemQuantities,rate,shipmentCiphertext:encryptSecretJson(parcel.payload)});}
 return {provider:'SHIPPO',mode:'TEST',packingMode:'ORDER',measurementReviewRequired:true,configVersion:config.version,services:config.services,parcels:quoted};
}
const unavailable=()=>new AppError('This paid production shipment is unavailable.',409,'SHIPPO_ORDER_UNAVAILABLE');
async function orderParcel(orderId,index,{forPurchase=false}={}){const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1',[orderId])).rows[0],parcel=order?.snapshot.shipping?.parcels[index];if(!order?.paid_at||refundedOrderHold(order)||['CANCELLED','REFUND_PENDING','REFUNDED'].includes(order.status)||order.snapshot.shipping?.provider!=='SHIPPO'||!parcel)throw unavailable();const allOrderJobs=(await query('SELECT status FROM keepsakes_fulfillments WHERE order_id=$1',[orderId])).rows;if(orderHasGlobalHold(order,allOrderJobs))throw unavailable();parcel.itemIndices=parcel.itemIndices.filter(i=>remainingItemUnits(order.snapshot.items[i])>0);if(!parcel.itemIndices.length)throw unavailable();const jobs=(await query("SELECT * FROM keepsakes_fulfillments WHERE order_id=$1 AND item_index=ANY($2::int[]) AND provider='IN_HOUSE'",[orderId,parcel.itemIndices])).rows;if(!parcel.itemIndices.every(i=>jobs.some(j=>j.item_index===i&&(forPurchase?['IN_PRODUCTION','FULFILLED']:['IN_PRODUCTION','FULFILLED','SHIPPED','COMPLETE']).includes(j.status))))throw unavailable();return {order,parcel};}
export async function quoteLabel(orderId,index,user){assertKeepsakes();assertKeepsakesManager(user);return withKeepsakesOrderLock(orderId,async()=>{const {order,parcel}=await orderParcel(orderId,index,{forPurchase:true}),existing=(await query('SELECT * FROM keepsakes_shippo_labels WHERE order_id=$1 AND parcel_index=$2 AND archived_at IS NULL',[orderId,index])).rows[0];if(existing&&existing.status!=='QUOTED')throw new AppError('Refresh this label or review its existing reservation. Do not create a duplicate.',409,'SHIPPO_LABEL_RESERVED');if(order.snapshot.shipping.measurementReviewRequired)throw new AppError('Confirm the dimensions and total weight of the packed order before requesting its label.',409,'SHIPPO_PACKED_ORDER_REQUIRED');const rate=await shippoRate(decryptSecretJson(parcel.shipmentCiphertext),order.snapshot.shipping.services);await query("INSERT INTO keepsakes_shippo_labels(order_id,parcel_index,status,rate) VALUES($1,$2,'QUOTED',$3) ON CONFLICT(order_id,parcel_index) WHERE archived_at IS NULL DO UPDATE SET rate=$3,quoted_at=now(),updated_at=now()",[orderId,index,rate]);await writeAudit({req:{user},action:'shippo_label_quoted',entity:'keepsakes',entityId:orderId,after:{parcelIndex:index,rate}});return {rate};});}
async function recordLabel(row,result){
 await query("UPDATE keepsakes_shippo_labels SET transaction_id=$2,status='PENDING',updated_at=now() WHERE id=$1",[row.id,result.object_id]);
 if(result.status==='SUCCESS'&&(!shippoHttps(result.label_url)||typeof result.tracking_number!=='string'||!result.tracking_number||!shippoHttps(result.tracking_url_provider)))throw new AppError('The label response is incomplete. Refresh its confirmed transaction.',502,'SHIPPO_LABEL_INCOMPLETE');
 const status=result.status==='SUCCESS'?'READY':result.status==='ERROR'?'ERROR':'PENDING',tracking={carrier:row.rate.carrier,trackingNumber:result.tracking_number,trackingUrl:shippoHttps(result.tracking_url_provider),status:row.tracking?.status==='DELIVERED'?'DELIVERED':result.tracking_status||'PRE_TRANSIT',test:true};
 await query('UPDATE keepsakes_shippo_labels SET status=$2,transaction_id=$3,label_url=$4,tracking=$5,updated_at=now() WHERE id=$1',[row.id,status,result.object_id,shippoHttps(result.label_url),tracking]);
await reconcileShippoDelivery(row.order_id);return {status};
}

export async function createLabel(orderId,index,input,user){assertKeepsakes();assertKeepsakesManager(user);const approval=z.object({approved:z.literal(true),rateId:z.string().min(1).max(100),maxCents:z.number().int().min(0).max(100000)}).strict().parse(input);return withKeepsakesOrderLock(orderId,async()=>{
 await orderParcel(orderId,index,{forPurchase:true});const row=(await query('SELECT * FROM keepsakes_shippo_labels WHERE order_id=$1 AND parcel_index=$2 AND archived_at IS NULL',[orderId,index])).rows[0];if(!row||row.status!=='QUOTED'||Date.now()-new Date(row.quoted_at).getTime()>10*60000||row.rate.id!==approval.rateId||row.rate.cents!==approval.maxCents)throw new AppError('Refresh the label rate and review its cost before approval.',409,'SHIPPO_LABEL_REVIEW_REQUIRED');
 // Commit reservation BEFORE the external POST. A timeout never triggers another purchase.
 await query("UPDATE keepsakes_shippo_labels SET status='CREATING',updated_at=now() WHERE id=$1",[row.id]);await writeAudit({req:{user},action:'shippo_test_label_approved',entity:'keepsakes',entityId:orderId,after:{parcelIndex:index,rateId:row.rate.id,cents:row.rate.cents}});
 try{const result=await shippoRequest('/transactions/',{rate:row.rate.id,label_file_type:'PDF',async:false,metadata:`lola:${row.id}`});if(!result.object_id)throw unavailable();return await recordLabel(row,result);}catch(error){await query("UPDATE keepsakes_shippo_labels SET status=CASE WHEN transaction_id IS NULL THEN 'UNKNOWN' ELSE status END,updated_at=now() WHERE id=$1",[row.id]);throw error;}
 });}
export async function refreshLabel(id,user){assertKeepsakes();assertKeepsakesManager(user);const row=(await query('SELECT * FROM keepsakes_shippo_labels WHERE id=$1',[id])).rows[0];if(!row?.transaction_id||row.status==='VOIDED')throw new AppError('No confirmed transaction ID. Reconcile this reservation in Shippo before any new label attempt.',409,'SHIPPO_RECONCILE_REQUIRED');return withKeepsakesOrderLock(row.order_id,async()=>{const current=(await query('SELECT status,transaction_id FROM keepsakes_shippo_labels WHERE id=$1',[row.id])).rows[0];if(current.status==='VOIDED'||current.transaction_id!==row.transaction_id)throw unavailable();await orderParcel(row.order_id,row.parcel_index);const result=await shippoRequest(`/transactions/${row.transaction_id}/`);if(result.object_id!==row.transaction_id)throw unavailable();return recordLabel(row,result);});}
export async function shippingOrders(user){assertKeepsakes();assertKeepsakesManager(user);return {orders:(await query("SELECT id,snapshot FROM keepsakes_orders WHERE paid_at IS NOT NULL AND (refunded_cents=0 OR (item_refunds_managed AND refunded_cents<total_cents)) AND status NOT IN('CANCELLED','REFUND_PENDING','REFUNDED') AND snapshot->'shipping'->>'provider'='SHIPPO' ORDER BY created_at DESC LIMIT 100")).rows.map(o=>({id:o.id,parcels:o.snapshot.shipping.parcels.map((p,index)=>({index,itemIndices:p.itemIndices,checkoutRate:p.rate}))}))};}

export async function reconcileLabel(id,input,user){assertKeepsakes();assertKeepsakesManager(user);const transactionId=z.string().regex(/^[\w-]{1,100}$/).parse(input.transactionId),row=(await query('SELECT * FROM keepsakes_shippo_labels WHERE id=$1',[id])).rows[0];if(!row||!['CREATING','UNKNOWN'].includes(row.status))throw unavailable();return withKeepsakesOrderLock(row.order_id,async()=>{const current=(await query('SELECT status FROM keepsakes_shippo_labels WHERE id=$1',[row.id])).rows[0];if(!['CREATING','UNKNOWN'].includes(current.status))throw unavailable();await orderParcel(row.order_id,row.parcel_index);const result=await shippoRequest(`/transactions/${transactionId}/`);if(result.object_id!==transactionId||result.metadata!==`lola:${row.id}`)throw new AppError('This transaction does not match the reserved label request.',409,'SHIPPO_RECONCILE_MISMATCH');const saved=await recordLabel(row,result);await writeAudit({req:{user},action:'shippo_label_reconciled',entity:'keepsakes',entityId:row.order_id,after:{labelId:id,transactionId}});return saved;});}
export async function pollShippoLabels(){if(!shippoReadiness().configured)return;const rows=(await query("SELECT id FROM keepsakes_shippo_labels WHERE archived_at IS NULL AND status IN('READY','PENDING') AND updated_at<now()-interval '15 minutes' ORDER BY updated_at LIMIT 10")).rows;for(const row of rows){try{const label=(await query('SELECT * FROM keepsakes_shippo_labels WHERE id=$1',[row.id])).rows[0];await withKeepsakesOrderLock(label.order_id,async()=>{const current=(await query('SELECT status FROM keepsakes_shippo_labels WHERE id=$1',[label.id])).rows[0];if(!['READY','PENDING'].includes(current.status))return;await orderParcel(label.order_id,label.parcel_index);const result=await shippoRequest(`/transactions/${label.transaction_id}/`);if(result.object_id!==label.transaction_id)throw unavailable();await recordLabel(label,result);});}catch{await query('UPDATE keepsakes_shippo_labels SET updated_at=now() WHERE id=$1',[row.id]);/* Back off without creating labels or notifications. */}}}

export async function verifyLabelVoid(id,input,user){assertKeepsakes();assertKeepsakesManager(user);const refundId=z.string().regex(/^[\w-]{1,100}$/).parse(input.refundId),row=(await query('SELECT * FROM keepsakes_shippo_labels WHERE id=$1',[id])).rows[0];if(!row?.transaction_id)throw unavailable();return withKeepsakesOrderLock(row.order_id,async()=>{const {order,parcel}=await orderParcel(row.order_id,row.parcel_index),refund=await shippoRequest(`/refunds/${refundId}/`);if(refund.transaction!==row.transaction_id||refund.status!=='SUCCESS')throw new AppError('Shippo has not confirmed a completed void for this label.',409,'SHIPPO_VOID_UNCONFIRMED');await query("UPDATE keepsakes_shippo_labels SET status='VOIDED',label_url=NULL,tracking=NULL,updated_at=now() WHERE id=$1",[row.id]);const labels=(await query("SELECT parcel_index,tracking FROM keepsakes_shippo_labels WHERE order_id=$1 AND status='READY' AND archived_at IS NULL",[row.order_id])).rows;for(const index of parcel.itemIndices)await query("UPDATE keepsakes_fulfillments SET tracking=$3,updated_at=now() WHERE order_id=$1 AND item_index=$2 AND provider='IN_HOUSE'",[row.order_id,index,JSON.stringify(labels.filter(l=>order.snapshot.shipping.parcels[l.parcel_index].itemIndices.includes(index)).map(l=>l.tracking))]);await writeAudit({req:{user},action:'shippo_label_void_verified',entity:'keepsakes',entityId:row.order_id,after:{labelId:id,refundId}});return {status:'VOIDED'};});}

async function reconcileShippoDelivery(orderId){
 await transaction(async()=>{
  const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  if(!order?.paid_at||refundedOrderHold(order)||['CANCELLED','REFUND_PENDING','REFUNDED'].includes(order.status))throw unavailable();
  const labels=(await query("SELECT parcel_index,tracking FROM keepsakes_shippo_labels WHERE order_id=$1 AND status='READY' AND archived_at IS NULL",[orderId])).rows;
  const jobs=(await query("SELECT id,item_index,status FROM keepsakes_fulfillments WHERE order_id=$1 AND provider='IN_HOUSE'",[orderId])).rows;
  for(const job of jobs){
   const expected=order.snapshot.shipping.parcels.map((p,index)=>({...p,index})).filter(p=>p.itemIndices.includes(job.item_index));
   const matching=expected.map(p=>labels.find(l=>l.parcel_index===p.index));
   const allPresent=expected.length>0&&matching.every(Boolean),tracking=matching.filter(Boolean).map(l=>l.tracking);
   // A label alone is not dispatch. Require every covered parcel, and never
   // replace completed delivery with an older carrier response.
   let next=job.status;
   if(allPresent&&job.status==='SHIPPED'){
    if(tracking.every(t=>t.status==='DELIVERED'))next='COMPLETE';
    else if(tracking.every(t=>['TRANSIT','DELIVERED'].includes(t.status)))next='SHIPPED';
   }
   await query('UPDATE keepsakes_fulfillments SET status=$2,tracking=$3,updated_at=now() WHERE id=$1',[job.id,next,JSON.stringify(tracking)]);
  }
  await syncKeepsakesOrder(orderId);
 });
}

export async function simulateLabelTracking(id,input,user){
 assertKeepsakes();assertKeepsakesManager(user);
 const status=z.enum(['TRANSIT','DELIVERED','FAILURE']).parse(input.status);
 const label=(await query("SELECT l.*,o.mode FROM keepsakes_shippo_labels l JOIN keepsakes_orders o ON o.id=l.order_id WHERE l.id=$1",[id])).rows[0];
 if(label?.status!=='READY'||label.mode!=='TEST'||label.tracking?.test!==true)throw unavailable();
 return withKeepsakesOrderLock(label.order_id,async()=>{
  await orderParcel(label.order_id,label.parcel_index);
  const jobs=(await query("SELECT status FROM keepsakes_fulfillments WHERE order_id=$1 AND item_index=ANY($2::int[]) AND provider='IN_HOUSE'",[label.order_id,(await orderParcel(label.order_id,label.parcel_index)).parcel.itemIndices])).rows;
  if(!jobs.length||jobs.some(j=>!['FULFILLED','SHIPPED','COMPLETE'].includes(j.status)))throw new AppError('Finish and pack the covered items before testing carrier movement.',409,'SHIPPO_PRODUCTION_REQUIRED');
  const result=await shippoRequest(`/tracks/shippo/SHIPPO_${status}/`);
  if(result.carrier!=='shippo'||result.tracking_number!==`SHIPPO_${status}`||result.tracking_status?.status!==status)throw new AppError('Shippo did not confirm the requested test tracking status.',502,'SHIPPO_TEST_TRACKING_INVALID');
  const current=(await query("SELECT * FROM keepsakes_shippo_labels WHERE id=$1 AND status='READY' AND archived_at IS NULL",[id])).rows[0];if(!current)throw unavailable();
  if(current.tracking.status==='DELIVERED'&&status!=='DELIVERED')throw new AppError('Delivered shipments cannot be moved backwards.',409,'SHIPPO_TRACKING_STATE');
  await query('UPDATE keepsakes_shippo_labels SET tracking=$2,updated_at=now() WHERE id=$1',[id,{...current.tracking,status,simulated:true}]);
  await query('INSERT INTO keepsakes_events(order_id,action,details) VALUES($1,$2,$3)',[label.order_id,'shippo_test_tracking',{labelId:id,status,message:`Shippo Sandbox tracking simulation: ${status}`}]);
  await writeAudit({req:{user},action:'shippo_tracking_simulated',entity:'keepsakes',entityId:label.order_id,after:{labelId:id,status,test:true}});
  await reconcileShippoDelivery(label.order_id);return {status,test:true};
 });
}

export async function saveOrderPackage(orderId,raw,user){
 assertKeepsakes();assertKeepsakesManager(user);const input=z.object({length:size,width:size,height:size,weightOz:weight,confirmed:z.literal(true)}).strict().parse(raw);
 return withKeepsakesOrderLock(orderId,async()=>{
 const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1',[orderId])).rows[0];if(!order?.paid_at||refundedOrderHold(order)||['CANCELLED','REFUND_PENDING','REFUNDED'].includes(order.status)||order.snapshot.shipping?.provider!=='SHIPPO')throw unavailable();
 const jobs=(await query("SELECT * FROM keepsakes_fulfillments WHERE order_id=$1 AND provider='IN_HOUSE' AND status<>'CANCELLED'",[orderId])).rows;
 const allJobs=(await query('SELECT status FROM keepsakes_fulfillments WHERE order_id=$1',[orderId])).rows;if(orderHasGlobalHold(order,allJobs)||!jobs.length||jobs.some(j=>j.status!=='FULFILLED'))throw new AppError('Fulfill and pack all in-house items before confirming one order package.',409,'SHIPPO_PACKAGE_NOT_READY');
 if((await query("SELECT 1 FROM keepsakes_shippo_labels WHERE order_id=$1 AND archived_at IS NULL AND status NOT IN('QUOTED','VOIDED','ERROR') LIMIT 1",[orderId])).rowCount)throw new AppError('This order already has shipping labels. Existing dispatched or delivered shipments cannot be combined. Review unused labels before replacing a packing plan.',409,'SHIPPO_EXISTING_LABELS');
 const contact=decryptSecretJson(order.contact_ciphertext),items=keepsakesSnapshotForShipping(order.snapshot),indices=jobs.map(j=>j.item_index),addresses=indices.map(i=>items[i].shippingAddress||contact.shippingAddress);
 if(addresses.some(a=>!a)||new Set(addresses.map(normalized)).size!==1)throw new AppError('One shipping label requires one delivery destination. Review the requested addresses before combining this order.',409,'SHIPPO_MULTIPLE_DESTINATIONS');
 const config=await shippingConfig(),payload={address_from:shippoAddress(config.origin),address_to:shippoAddress(addresses[0]),parcels:[{length:String(input.length),width:String(input.width),height:String(input.height),distance_unit:'in',weight:String(input.weightOz),mass_unit:'oz'}]};
 await transaction(async()=>{const previous=order.snapshot.shipping;order.snapshot.shipping={...previous,checkoutParcels:previous.checkoutParcels||previous.parcels,packingMode:'ORDER',measurementReviewRequired:false,sizingConfirmedAt:new Date().toISOString(),parcels:[{itemIndices:indices,itemQuantities:Object.fromEntries(indices.map(i=>[i,remainingItemUnits(items[i])])),shipmentCiphertext:encryptSecretJson(payload)}]};await query('UPDATE keepsakes_shippo_labels SET archived_at=now() WHERE order_id=$1 AND archived_at IS NULL',[orderId]);await query('UPDATE keepsakes_orders SET snapshot=$2,updated_at=now() WHERE id=$1',[orderId,JSON.stringify(order.snapshot)]);await writeAudit({req:{user},action:'keepsakes_order_package_confirmed',entity:'keepsakes',entityId:orderId,after:{...input,itemIndices:indices,originalPackages:previous.parcels.length,customerShippingCentsUnchanged:order.shipping_cents}});});return {saved:true,packages:1};
 });
}
function keepsakesSnapshotForShipping(snapshot){return snapshot.items.map(item=>({...item,...(item.recipientsCiphertext?decryptSecretJson(item.recipientsCiphertext):{})}));}
