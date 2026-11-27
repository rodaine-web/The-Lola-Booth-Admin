import {orderHasGlobalHold} from '../../../shared/keepsakes-order-workflow.js';
import {refundedOrderHold,remainingItemUnits} from '../../../shared/keepsakes-refunds.js';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {assertFiestaReviewAccess} from './fiesta-survey-review-service.js';
import {writeAudit} from './audit-service.js';
import {keepsakesAddress,keepsakesProduct} from '../../../shared/keepsakes.js';
import {assertKeepsakes,keepsakesReadiness,keepsakesSettings,keepsakesStripe,keepsakesSnapshot} from './keepsakes-service.js';
import {decryptSecretJson} from './integration-secrets.js';
import {prodigiVariant,prodigiStatus,getProdigiOrder,cancelProdigiOrder,prodigiQuote} from './prodigi-service.js';
import {verifiedGalleryBytes} from './gallery-media-delivery.js';
import sharp from 'sharp';
import {isDeepStrictEqual} from 'node:util';
import {lockKeepsakesOrder} from './keepsakes-order-lock.js';
import {STANDARD_POSTCARD_TEMPLATE,STANDARD_POSTCARD_SHA256} from '../../../shared/postcard-template.js';
import {standardPostcardBack} from './keepsakes-postcard-template.js';

export function assertKeepsakesManager(user){assertKeepsakes();if(!user?.roles?.some(r=>['OWNER','ADMIN','SUPER_ADMIN'].includes(r)))throw new AppError('Keepsakes financial management requires an administrator.',403,'FORBIDDEN');}
const audit=(user,action,id,after)=>writeAudit({req:{user},action,entity:'keepsakes',entityId:id,after});
export async function keepsakesDashboard(user){
 assertKeepsakesManager(user);
 const orders=(await query(`SELECT o.id,o.status,o.total_cents,o.paid_at,o.created_at,o.fulfilled_at,o.shipped_at,o.delivered_at,o.last_error,a.title album_title,(SELECT jsonb_agg(jsonb_build_object('title',i->'product'->>'title','provider',i->'product'->>'provider','quantity',GREATEST(0,(i->>'units')::int-COALESCE((i->>'cancelledUnits')::int,0)))) FROM jsonb_array_elements(o.snapshot->'items') i) line_items,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'provider',f.provider,'status',f.status,'provider_order_id',f.provider_order_id,'last_error',f.last_error,'tracking',f.tracking)) FROM keepsakes_fulfillments f WHERE f.order_id=o.id),'[]') fulfillments
 FROM keepsakes_orders o JOIN gallery_albums a ON a.id=o.album_id ORDER BY o.created_at DESC LIMIT 300`)).rows;
 const m=(await query(`SELECT COALESCE(sum(subtotal_cents+shipping_cents) FILTER(WHERE paid_at IS NOT NULL),0)::bigint gross,
 COALESCE(sum(CASE WHEN refunded_cents>=total_cents THEN 0 ELSE subtotal_cents+shipping_cents-refunded_cents END) FILTER(WHERE paid_at IS NOT NULL),0)::bigint net,
 count(*) FILTER(WHERE paid_at IS NOT NULL)::int orders,
 count(*) FILTER(WHERE paid_at IS NOT NULL AND (refunded_cents=0 OR (item_refunds_managed AND refunded_cents<total_cents)) AND status IN('PAID','FULFILLING','FULFILLED','REQUIRES_REVIEW'))::int awaiting,
 count(*) FILTER(WHERE status='REQUIRES_REVIEW' OR tax_refund_status='REQUIRES_REVIEW' OR EXISTS(SELECT 1 FROM keepsakes_fulfillments f WHERE f.order_id=keepsakes_orders.id AND f.status='REQUIRES_REVIEW'))::int intervention,
 sum(stripe_fee_cents) fees,count(*) FILTER(WHERE paid_at IS NOT NULL AND stripe_fee_cents IS NULL)::int missing_fees
 FROM keepsakes_orders`)).rows[0];
 const costs=(await query(`SELECT sum(provider_cost_cents) production,sum(shipping_cost_cents) shipping,count(*) FILTER(WHERE provider<>'DIGITAL' AND (provider_cost_cents IS NULL OR shipping_cost_cents IS NULL))::int unknown FROM keepsakes_fulfillments`)).rows[0];
 const count=(await query(`SELECT COALESCE(sum((i->>'units')::int),0)::int count FROM keepsakes_orders o CROSS JOIN LATERAL jsonb_array_elements(o.snapshot->'items') i WHERE paid_at IS NOT NULL`)).rows[0].count;
 const byEvent=(await query(`SELECT a.title name,sum(o.total_cents-o.refunded_cents)::bigint total FROM keepsakes_orders o JOIN gallery_albums a ON a.id=o.album_id WHERE o.paid_at IS NOT NULL GROUP BY a.id,a.title ORDER BY total DESC`)).rows.map(r=>({...r,total:Number(r.total)}));
 const byProduct=(await query(`SELECT i->'product'->>'title' name,sum((i->>'units')::int*(i->'product'->>'retailCents')::int)::bigint total FROM keepsakes_orders o CROSS JOIN LATERAL jsonb_array_elements(o.snapshot->'items') i WHERE o.paid_at IS NOT NULL GROUP BY 1 ORDER BY total DESC`)).rows.map(r=>({...r,total:Number(r.total)}));
 return {orders,products:(await query('SELECT * FROM keepsakes_products WHERE retired_at IS NULL ORDER BY title')).rows,byEvent,byProduct,readiness:keepsakesReadiness(),metrics:{grossCents:Number(m.gross),netCents:Number(m.net),orders:m.orders,averageCents:m.orders?Math.round(Number(m.net)/m.orders):0,productsSold:count,supplierCents:costs.production===null?null:Number(costs.production),shippingCents:costs.shipping===null?null:Number(costs.shipping),stripeFeesCents:m.missing_fees?null:Number(m.fees||0),contributionCents:m.missing_fees||costs.unknown?null:Number(m.net)-Number(costs.production||0)-Number(costs.shipping||0)-Number(m.fees||0),awaiting:m.awaiting,intervention:m.intervention}};
}
export async function saveKeepsakesProduct(id,input,user){
 assertKeepsakesManager(user);const p=keepsakesProduct.parse(input);
 if((p.provider==='DIGITAL')!==['digital','bundle'].includes(p.category)||p.provider==='LOB'&&p.category!=='postcard')throw new AppError('Product category does not match its fulfillment provider.',422,'KEEPSAKES_PRODUCT_PROVIDER');
 if(p.category==='keychain')throw new AppError('No compatible keychain SKU has been verified. Keep this category unavailable.',422,'KEEPSAKES_SKU_UNVERIFIED');
 return transaction(async()=>{
  const existing=id?(await query('SELECT * FROM keepsakes_products WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
  if(id&&!existing)throw new AppError('Product unavailable.',404,'NOT_FOUND');
  const unchanged=existing&&existing.provider===p.provider&&existing.category===p.category&&isDeepStrictEqual(existing.variants,p.variants);
  const verified=Boolean(unchanged&&existing.verified);
  if(p.active&&!verified)throw new AppError('Save inactive, verify the mapping, then activate this product.',409,'KEEPSAKES_SKU_UNVERIFIED');
  const values=[p.title,p.category,p.provider,p.active,p.retailCents,p.currency,p.taxCode,JSON.stringify(p.variants),verified];
  const result=id?await query('UPDATE keepsakes_products SET title=$1,category=$2,provider=$3,active=$4,retail_cents=$5,currency=$6,tax_code=$7,variants=$8,verified=$9,updated_at=now() WHERE id=$10 RETURNING *',[...values,id]):await query('INSERT INTO keepsakes_products(title,category,provider,active,retail_cents,currency,tax_code,variants,verified) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',values);
  await audit(user,'keepsakes_product_saved',result.rows[0].id,{title:p.title,active:p.active,verified});return result.rows[0];
 });
}
export async function verifyKeepsakesProduct(id,user){
 assertKeepsakesManager(user);
 const product=(await query('SELECT * FROM keepsakes_products WHERE id=$1',[id])).rows[0];if(!product)throw new AppError('Product unavailable.',404,'NOT_FOUND');
 const evidence=[];
 for(const variant of product.variants){
  if(product.provider==='PRODIGI'){
   const data=await prodigiVariant(variant.sku),area=data.printAreas?.find(a=>a.name===(variant.printArea||'default')),spec=variant.printSpec,review=variant.specEvidence;
   if(!area||!spec||!review||!/^https:\/\/(www\.)?prodigi\.com\//.test(review.sourceUrl)||review.colorProfile!=='sRGB'||review.bleedPx!==spec.bleedPx||review.safePx!==spec.safePx)throw new AppError('A supplier print template, reviewed bleed, safe area and sRGB profile are required.',422,'KEEPSAKES_PRINT_TEMPLATE_REQUIRED');
   const width=Math.round(area.widthMm/25.4*area.recommendedDpi),height=Math.round(area.heightMm/25.4*area.recommendedDpi);
   if(data.sku!==variant.sku||spec.widthPx!==width||spec.heightPx!==height||spec.dpi!==area.recommendedDpi||!area.required||data.printAreas.filter(a=>a.required).length!==1)throw new AppError('The configured print area does not match this SKU, or requires unsupported multiple print areas.',422,'KEEPSAKES_SKU_SPEC_MISMATCH');
   for(const [key,value]of Object.entries(variant.attributes||{}))if(!data.attributeOptions?.[key]?.includes(value))throw new AppError('A variant attribute is not available for this SKU.',422,'KEEPSAKES_SKU_ATTRIBUTE');
   const quote=await prodigiQuote({items:[{catalogueVariantId:variant.sku,quantity:1,attributes:variant.attributes||{},assets:[{printArea:variant.printArea||'default'}]}],shippingAddress:{line1:'101 Test Street',townOrCity:'New York',stateOrCounty:'NY',postalOrZipCode:'10001',countryCode:'US'},shippingMethod:'standard',currencyCode:'USD'});
   evidence.push({sku:data.sku,area,source:review.sourceUrl,destinationCheck:'US/10001 sandbox quote',supplierTotal:quote.total,checkedAt:new Date().toISOString()});
  }else if(product.provider==='LOB'){
   if(variant.printSpec?.widthPx!==1875||variant.printSpec?.heightPx!==1275||variant.printSpec?.dpi!==300||variant.printSpec?.bleedPx!==37||variant.printSpec?.safePx<37)throw new AppError('Lob 4×6 requires the reviewed 1875×1275, 300 DPI bleed template.',422,'KEEPSAKES_LOB_SPEC');
   if(!process.env.LOB_TEST_API_KEY?.startsWith('test_'))throw new AppError('Lob test credentials are required.',409,'KEEPSAKES_LOB_NOT_READY');
   if(variant.backTemplate===STANDARD_POSTCARD_TEMPLATE)await standardPostcardBack();
   evidence.push({provider:'LOB',template:'4x6',...(variant.backTemplate?{backTemplate:variant.backTemplate,backChecksum:STANDARD_POSTCARD_SHA256}:{}),checkedAt:new Date().toISOString()});
  }else evidence.push({provider:'DIGITAL',checks:'Existing, authorized, not included source files only'});
 }
 if(!evidence.length)throw new AppError('Configure at least one variant.',422,'KEEPSAKES_VARIANTS_REQUIRED');
 const verified=await query('UPDATE keepsakes_products SET verified=true,verified_at=now(),verification=$2 WHERE id=$1 AND variants=$3::jsonb AND provider=$4 AND category=$5 RETURNING id',[id,JSON.stringify({evidence}),JSON.stringify(product.variants),product.provider,product.category]);
 if(!verified.rowCount)throw new AppError('The product changed during verification. Verify its current mapping again.',409,'KEEPSAKES_PRODUCT_CHANGED');
 await audit(user,'keepsakes_product_verified',id,{evidence});return (await query('SELECT * FROM keepsakes_products WHERE id=$1',[id])).rows[0];
}
export async function keepsakesAlbumAdmin(albumId,user){
 assertKeepsakes();await assertFiestaReviewAccess(albumId,user);
 return {settings:await keepsakesSettings(albumId),products:(await query('SELECT * FROM keepsakes_products WHERE retired_at IS NULL ORDER BY title')).rows,media:(await query("SELECT id,filename,status,width,height FROM gallery_media WHERE album_id=$1 AND media_type='IMAGE' ORDER BY sort_order,created_at",[albumId])).rows,sessions:(await query(`SELECT s.*,COALESCE((SELECT jsonb_agg(a ORDER BY a.sort_order) FROM gallery_session_assets a WHERE a.session_id=s.id),'[]') assets FROM gallery_photo_sessions s WHERE album_id=$1`,[albumId])).rows};
}
export async function saveKeepsakesSettings(albumId,input,user){
 assertKeepsakes();await assertFiestaReviewAccess(albumId,user);
 const settings=z.object({enabled:z.boolean(),brandedMerchandise:z.boolean(),originalSales:z.boolean(),productIds:z.array(z.uuid()).max(50),returnAddress:keepsakesAddress.nullable().optional()}).parse(input);
 await transaction(async()=>{
  await query('SELECT id FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId]);
  await query(`INSERT INTO keepsakes_gallery_settings(album_id,enabled,branded_merchandise,original_sales,product_ids,return_address,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7)
  ON CONFLICT(album_id) DO UPDATE SET enabled=$2,branded_merchandise=$3,original_sales=$4,product_ids=$5,return_address=$6,updated_by=$7,updated_at=now()`,[albumId,settings.enabled,settings.brandedMerchandise,settings.originalSales,settings.productIds,settings.returnAddress||null,user.id]);
  await audit(user,'keepsakes_gallery_settings',albumId,{...settings,returnAddress:settings.returnAddress?'configured':null});
 });return {settings};
}
export async function saveKeepsakesSession(albumId,input,user){
 assertKeepsakes();await assertFiestaReviewAccess(albumId,user);
 const data=z.object({anchorMediaId:z.uuid(),sourceRef:z.string().max(150).optional(),assets:z.array(z.object({mediaId:z.uuid(),kind:z.enum(['COMPOSITE','ORIGINAL','PROCESSED','EXTRACTED_CROP','BRANDED_STRIP']),label:z.string().min(1).max(100),sortOrder:z.number().int().min(0),branded:z.boolean(),merchandiseEligible:z.boolean(),digitalEligible:z.boolean(),included:z.boolean()})).min(1).max(100)}).parse(input);
 if(new Set(data.assets.map(a=>a.mediaId)).size!==data.assets.length||!data.assets.some(a=>a.mediaId===data.anchorMediaId))throw new AppError('Include the session anchor once, with unique real source files.',422,'KEEPSAKES_SESSION_INVALID');
 return transaction(async()=>{
  const album=(await query('SELECT * FROM gallery_albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0];
  const media=(await query("SELECT * FROM gallery_media WHERE album_id=$1 AND id=ANY($2::uuid[]) AND status<>'ARCHIVED' AND media_type='IMAGE' FOR UPDATE",[albumId,data.assets.map(a=>a.mediaId)])).rows;
  if(media.length!==data.assets.length)throw new AppError('All source files must belong to this gallery.',422,'KEEPSAKES_SESSION_MISMATCH');
  const overlap=(await query('SELECT 1 FROM gallery_session_assets WHERE album_id=$1 AND media_id=ANY($2::uuid[]) AND session_id NOT IN(SELECT id FROM gallery_photo_sessions WHERE anchor_media_id=$3) LIMIT 1',[albumId,data.assets.map(a=>a.mediaId),data.anchorMediaId])).rowCount;
  if(overlap)throw new AppError('An asset already belongs to another guest session. Review the source mapping first.',409,'KEEPSAKES_SESSION_OVERLAP');
  for(const asset of data.assets){
   const source=media.find(m=>m.id===asset.mediaId);
   if(asset.digitalEligible&&(asset.included||!['ORIGINAL','PROCESSED'].includes(asset.kind)||source.status==='VISIBLE'&&(album.allow_download||album.allow_personal_download)))throw new AppError('Included downloads and visible free photos cannot be sold as originals. Review the file and its permissions.',422,'KEEPSAKES_INCLUDED_ASSET');
   const metadata=await sharp(await verifiedGalleryBytes(source),{limitInputPixels:60_000_000}).metadata();
   await query('UPDATE gallery_media SET width=$2,height=$3 WHERE id=$1',[source.id,metadata.autoOrient?.width||metadata.width,metadata.autoOrient?.height||metadata.height]);
  }
  const session=(await query('INSERT INTO gallery_photo_sessions(album_id,anchor_media_id,source_ref,confirmed_by) VALUES($1,$2,$3,$4) ON CONFLICT(anchor_media_id) DO UPDATE SET source_ref=$3,confirmed_by=$4 RETURNING *',[albumId,data.anchorMediaId,data.sourceRef||null,user.id])).rows[0];
  await query('DELETE FROM gallery_session_assets WHERE session_id=$1',[session.id]);
  for(const asset of data.assets)await query(`INSERT INTO gallery_session_assets(session_id,album_id,media_id,kind,label,sort_order,branded,merchandise_eligible,digital_eligible,included) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[session.id,albumId,asset.mediaId,asset.kind,asset.label,asset.sortOrder,asset.branded,asset.merchandiseEligible,asset.digitalEligible,asset.included]);
  await audit(user,'keepsakes_session_confirmed',session.id,{anchorMediaId:data.anchorMediaId,assets:data.assets});return session;
 });
}
export async function keepsakesAdminOrder(id,user){
 assertKeepsakesManager(user);
 const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1',[id])).rows[0];if(!order)throw new AppError('Order unavailable.',404,'NOT_FOUND');
 const contact=decryptSecretJson(order.contact_ciphertext);delete contact.statusToken;delete order.contact_ciphertext;delete order.token_hash;delete order.checkout_url;
 order.snapshot=keepsakesSnapshot(order.snapshot);
 const emails=(await query("SELECT id,subject,status,failure_code,created_at FROM communications WHERE trigger_key='KEEPSAKES_TRANSACTIONAL' AND idempotency_key LIKE 'keepsakes:'||$1::text||':%' ORDER BY created_at",[id])).rows;
 const labels=(await query('SELECT id,parcel_index,status,rate,quoted_at,label_url,tracking FROM keepsakes_shippo_labels WHERE order_id=$1 AND archived_at IS NULL ORDER BY parcel_index',[id])).rows;
 const packages=(order.snapshot.shipping?.parcels||[]).map((p,index)=>({index,itemIndices:p.itemIndices.filter(i=>remainingItemUnits(order.snapshot.items[i])>0),itemQuantities:p.itemQuantities?Object.fromEntries(p.itemIndices.map(i=>[i,Math.min(p.itemQuantities[i]||0,remainingItemUnits(order.snapshot.items[i]))])):undefined,checkoutRate:p.rate,measurements:p.shipmentCiphertext?decryptSecretJson(p.shipmentCiphertext).parcels?.[0]:null,address:order.snapshot.items[p.itemIndices[0]]?.shippingAddress||contact.shippingAddress,label:labels.find(l=>l.parcel_index===index)||null})).filter(p=>p.itemIndices.length);
 return {adjustments:(await query('SELECT id,action,scope,items,amount_cents,tax_cents,status,last_error,created_at FROM keepsakes_adjustments WHERE order_id=$1 ORDER BY created_at DESC',[id])).rows,order,contact,emails,packages,notificationPolicy:{testOnly:true,emailAllowed:String(process.env.KEEPSAKES_TEST_EMAIL_ALLOWLIST||'').toLowerCase().split(',').map(v=>v.trim()).includes(contact.email?.toLowerCase())},fulfillments:(await query('SELECT * FROM keepsakes_fulfillments WHERE order_id=$1 ORDER BY item_index',[id])).rows,events:(await query('SELECT * FROM keepsakes_events WHERE order_id=$1 ORDER BY created_at DESC',[id])).rows};
}
export async function retryKeepsakesOrder(id,user){
 assertKeepsakesManager(user);
 await transaction(async()=>{
  await lockKeepsakesOrder(id);
  const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!order?.paid_at||refundedOrderHold(order))throw new AppError('Only paid, non-refunded orders can be retried.',409,'KEEPSAKES_RETRY_BLOCKED');
  const failed=(await query("SELECT id FROM keepsakes_fulfillments WHERE order_id=$1 AND status IN('FAILED','REQUIRES_REVIEW')",[id])).rows;
  if(!failed.length)throw new AppError('Open the affected processing section to review this order.',409,'KEEPSAKES_RETRY_BLOCKED');
  for(const item of failed)await retryKeepsakesItem(id,item.id,user);
  await audit(user,'keepsakes_retry_requested',id,{items:failed.map(i=>i.id)});
 });return {requested:true};
}
export async function cancelKeepsakesOrder(id,user,{refund=false,reason='requested_by_customer'}={}){
 assertKeepsakesManager(user);
 const result=await transaction(async()=>{
  await lockKeepsakesOrder(id);
  const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!order)throw new AppError('Order unavailable.',404,'NOT_FOUND');
  if(order.paid_at&&order.refunded_cents>=order.total_cents){
   if(order.tax_refund_status==='REQUIRES_REVIEW')await query("UPDATE keepsakes_orders SET tax_refund_status='PENDING' WHERE id=$1",[id]);
   return {requested:true,alreadyProcessed:true};
  }
  if(order.status==='CANCELLED'||order.status==='REFUND_PENDING')return {requested:true,alreadyProcessed:true};
  if(order.paid_at&&!refund)throw new AppError('Use refund to cancel a paid order after supplier cancellation.',409,'KEEPSAKES_PAID_CANCEL_REQUIRES_REFUND');
  const fulfillments=(await query('SELECT * FROM keepsakes_fulfillments WHERE order_id=$1 FOR UPDATE',[id])).rows;
  if(fulfillments.some(f=>f.lease_until&&new Date(f.lease_until)>new Date()))throw new AppError('Fulfillment is processing. Retry after reconciliation.',409,'KEEPSAKES_FULFILLMENT_BUSY');
  if((await query("SELECT 1 FROM keepsakes_shippo_labels WHERE order_id=$1 AND archived_at IS NULL AND status NOT IN('QUOTED','VOIDED','ERROR') LIMIT 1",[id])).rowCount)throw new AppError('Review and void or reconcile Shippo labels before refunding this order.',409,'SHIPPO_CANCEL_REVIEW');
  // Preflight every provider before the first irreversible remote action.
  if(fulfillments.some(f=>f.provider_order_id&&f.provider==='LOB'))throw new AppError('A submitted postcard needs provider cancellation review before refund.',409,'KEEPSAKES_LOB_CANCEL_REVIEW');
  try{
  for(const f of fulfillments){
   if(f.provider_order_id&&f.provider==='PRODIGI'){
    const current=await getProdigiOrder(f.provider_order_id);
    if(current.status!=='cancelled')await cancelProdigiOrder(f.provider_order_id);
    await query("UPDATE keepsakes_fulfillments SET status='CANCELLED',updated_at=now() WHERE id=$1",[f.id]);
   }
  }
  if(refund&&order.paid_at&&order.refunded_cents<order.total_cents){
   const result=await keepsakesStripe('refunds',{payment_intent:order.stripe_payment_intent,reason:['requested_by_customer','duplicate','fraudulent'].includes(reason)?reason:'requested_by_customer','metadata[keepsakes_order_id]':id},`keepsakes-refund:${id}`);
   await query("UPDATE keepsakes_orders SET stripe_refund_id=$2,status='REFUND_PENDING',updated_at=now() WHERE id=$1",[id,result.id]);
  }else if(order.paid_at)throw new AppError('Use refund to cancel a paid order after supplier cancellation.',409,'KEEPSAKES_PAID_CANCEL_REQUIRES_REFUND');
  else{
   if(order.stripe_session_id)await keepsakesStripe(`checkout/sessions/${order.stripe_session_id}/expire`,{},`keepsakes-expire:${id}`);
   await query("UPDATE keepsakes_orders SET status='CANCELLED',updated_at=now() WHERE id=$1",[id]);
  }
  await query("UPDATE keepsakes_fulfillments SET status='CANCELLED',updated_at=now() WHERE order_id=$1",[id]);
  await query('UPDATE keepsakes_entitlements SET revoked_at=now() WHERE order_id=$1',[id]);await audit(user,refund?'keepsakes_refund_requested':'keepsakes_cancelled',id,{});
  return {requested:true};
  }catch(error){
   // Preserve successful remote cancellations even if a later provider fails.
   await query("UPDATE keepsakes_orders SET status='REQUIRES_REVIEW',last_error=$2,updated_at=now() WHERE id=$1",[id,error.code||'KEEPSAKES_CANCELLATION_REVIEW']);
   await query("UPDATE keepsakes_fulfillments SET status='REQUIRES_REVIEW',last_error=$2 WHERE order_id=$1 AND status<>'CANCELLED'",[id,error.code||'KEEPSAKES_CANCELLATION_REVIEW']);
   await audit(user,'keepsakes_cancellation_requires_review',id,{code:error.code||'PROVIDER_ERROR'});
   return {requiresReview:true};
  }
 });
 if(result.requiresReview)throw new AppError('Cancellation or refund needs review. Confirm provider history before retry; completed supplier cancellations were retained.',409,'KEEPSAKES_CANCELLATION_REVIEW');
 return result;
}
export {prodigiStatus};

export async function retryKeepsakesItem(orderId,jobId,user){
 assertKeepsakesManager(user);
 return transaction(async()=>{await lockKeepsakesOrder(orderId);const o=(await query('SELECT * FROM keepsakes_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];const job=(await query('SELECT * FROM keepsakes_fulfillments WHERE order_id=$1 AND id=$2 FOR UPDATE',[orderId,jobId])).rows[0];
 if(!o?.paid_at||refundedOrderHold(o)||['CANCELLED','REFUNDED','REFUND_PENDING'].includes(o.status)||!job||!['FAILED','REQUIRES_REVIEW'].includes(job.status))throw new AppError('This item cannot be retried in its current state.',409,'KEEPSAKES_RETRY_BLOCKED');
 const allJobs=(await query('SELECT status FROM keepsakes_fulfillments WHERE order_id=$1',[orderId])).rows;if(orderHasGlobalHold(o,allJobs))throw new AppError('Resolve the payment or order-level hold before retrying fulfillment.',409,'KEEPSAKES_RETRY_BLOCKED');
 if(job.provider==='LOB'&&!job.provider_order_id&&job.attempts>0&&Date.now()-new Date(job.created_at).getTime()>23*3600000&&!['KEEPSAKES_LOB_ARTWORK_SIZE','KEEPSAKES_LOB_FRONT_SPEC','KEEPSAKES_LOB_BACK_SPEC'].includes(job.last_error))throw new AppError('Review the original provider request before retrying this item.',409,'KEEPSAKES_LOB_OUTCOME_UNKNOWN');
 if(job.last_error==='KEEPSAKES_STOCK_REVIEW'){
 const item=o.snapshot.items[job.item_index];if(item.inventoryReserved===false){
 const blocked=o.snapshot.items.filter(i=>i.product.id===item.product.id&&i.inventoryReserved===false),count=blocked.reduce((n,i)=>n+remainingItemUnits(i),0);
 const product=(await query('SELECT * FROM keepsakes_products WHERE id=$1 FOR UPDATE',[item.product.id])).rows[0],config=product?.operational_config;
 if(!product?.active||!product.verified||!config?.productionReady||(config.stockUnits==null?!config.stockConfirmed:config.stockUnits<count))throw new AppError('Confirm sufficient stock and production capacity in Products before retrying this item.',409,'KEEPSAKES_STOCK_REVIEW');
 if(config.stockUnits!=null)await query("UPDATE keepsakes_products SET operational_config=jsonb_set(operational_config,'{stockUnits}',to_jsonb((operational_config->>'stockUnits')::integer-$2)) WHERE id=$1",[item.product.id,count]);
 for(const i of blocked){i.inventoryReserved=true;i.stockReview=false;}await query('UPDATE keepsakes_orders SET snapshot=$2 WHERE id=$1',[orderId,JSON.stringify(o.snapshot)]);
 }}
 await query("UPDATE keepsakes_fulfillments SET status='RETRY',next_attempt_at=now(),lease_until=NULL,updated_at=now() WHERE id=$1",[jobId]);await audit(user,'keepsakes_item_retry_requested',orderId,{jobId});return {requested:true};});
}
