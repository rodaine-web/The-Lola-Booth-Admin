import {variableInsertProduct} from '../../../shared/keepsakes-core-catalogue.js';
import {previewTemplateFor} from '../../../shared/keepsakes-preview-templates.js';
import crypto from 'node:crypto';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {keepsakesStaging} from '../../../shared/keepsakes.js';
import {assertKeepsakes,addressForProdigi,keepsakesStripe,keepsakesSnapshot} from './keepsakes-service.js';
import {decryptSecretJson} from './integration-secrets.js';
import {verifiedGalleryBytes} from './gallery-media-delivery.js';
import {galleryStorage} from './gallery-storage.js';
import {renderKeepsakesArtwork,renderVariableInsertArtwork} from './keepsakes-artwork.js';
import {createProdigiDraft,submitProdigiOrder,getProdigiOrder,prodigiShipments,prodigiQuote,prodigiMoneyCents} from './prodigi-service.js';
import {sendCommunication,brandedEmailHtml} from './automation-service.js';
import {withKeepsakesOrderLock} from './keepsakes-order-lock.js';
import {STANDARD_POSTCARD_TEMPLATE,STANDARD_POSTCARD_SHA256} from '../../../shared/postcard-template.js';
import {standardPostcardBack} from './keepsakes-postcard-template.js';

const fail=(message,code='KEEPSAKES_FULFILLMENT_REVIEW')=>new AppError(message,409,code);
const secret=()=>process.env.INTEGRATION_SECRET_KEY;
const sign=value=>crypto.createHmac('sha256',secret()).update(value).digest('base64url');
export function keepsakesArtworkToken(id,index,checksum,expires=Math.floor(Date.now()/1000)+7*86400){
 const payload=Buffer.from(JSON.stringify({id,index,checksum,expires})).toString('base64url');return `${payload}.${sign(payload)}`;
}
export async function keepsakesSupplierArtwork(token){
 assertKeepsakes();const [payload,signature,...extra]=String(token).split('.');
 if(!payload||payload.length>1000||!/^[-\w]{43}$/.test(signature||'')||extra.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(sign(payload))))throw fail('Artwork unavailable.','KEEPSAKES_ARTWORK_UNAVAILABLE');
 let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{throw fail('Artwork unavailable.');}
 if(!Number.isInteger(data.expires)||data.expires<Date.now()/1000||!Number.isInteger(data.index)||data.index<0)throw fail('Artwork link expired.');
 const f=(await query(`SELECT f.artwork,o.paid_at,o.refunded_cents,o.status FROM keepsakes_fulfillments f JOIN keepsakes_orders o ON o.id=f.order_id WHERE f.id=$1`,[data.id])).rows[0],art=f?.artwork?.[data.index];
 if(!f?.paid_at||f.refunded_cents||['CANCELLED','REFUNDED','REFUND_PENDING'].includes(f.status)||!art||art.checksum!==data.checksum)throw fail('Artwork unavailable.');
 return verifiedGalleryBytes({...art,mime_type:'image/png'},async()=>{},{maxBytes:20*1024*1024});
}
async function savedArtwork(f,item){
 if(f.artwork.length)return f.artwork;
 const selected=item.assets[0],media=(await query('SELECT * FROM gallery_media WHERE id=$1 AND checksum=$2',[selected.mediaId,selected.checksum])).rows[0];
 if(!media)throw fail('The purchased photo source changed.');
 const bytes=await verifiedGalleryBytes(media),rendered=variableInsertProduct(item.product,item.variant)?await renderVariableInsertArtwork({bytes,key:item.product.key,customization:item.customization,ratio:previewTemplateFor(item.product.key,{variant:item.variant})?.physicalAspectRatio}):await renderKeepsakesArtwork({bytes,spec:item.variant.printSpec,customization:{...item.customization,positionX:item.customization.x,positionY:item.customization.y}});
 const storage=galleryStorage(),key=await storage.put(rendered.buffer,'image/png');
 const artwork=[{storage_key:key,storage_provider:storage.provider,checksum:rendered.sha256,size_bytes:rendered.buffer.length,md5:crypto.createHash('md5').update(rendered.buffer).digest('hex'),spec:rendered.spec,productionSizing:rendered.productionSizing,sourceChecksum:selected.checksum}];
 await query('UPDATE keepsakes_fulfillments SET artwork=$2,updated_at=now() WHERE id=$1',[f.id,JSON.stringify(artwork)]);return artwork;
}
function supplierUrl(f,art,index=0){
 const origin=process.env.KEEPSAKES_ARTWORK_ORIGIN||process.env.PUBLIC_BASE_URL;
 if(!origin?.startsWith('https://'))throw fail('A public HTTPS staging artwork endpoint is required.');
 const url=new URL(origin);if(!/^(stagingapi\.thelolabooth\.com|[a-z0-9-]+\.up\.railway\.app)$/.test(url.hostname))throw fail('Use the staging API artwork origin.');
 return `${url.origin}/api/keepsakes/artwork/${keepsakesArtworkToken(f.id,index,art.checksum)}`;
}
export function prodigiDraftMayRetry(current,error,attempts){
 return current?.status==='draft'&&Array.isArray(current.issues)&&current.issues.length===0
  &&error?.code==='PRODIGI_REQUEST_FAILED'&&[400,409,429,502,503,504].includes(error.details?.providerStatus)
  &&Number.isInteger(attempts)&&attempts>=1&&attempts<3;
}
async function fulfillProdigi(f,order,item,contact){
 const artwork=await savedArtwork(f,item);let current;
 if(f.provider_order_id)current=await getProdigiOrder(f.provider_order_id);
 else{
  const shippingAddress=addressForProdigi(contact.shippingAddress),quote=await prodigiQuote({items:[{catalogueVariantId:item.variant.sku,quantity:item.units,attributes:item.variant.attributes||{},assets:[{printArea:item.variant.printArea||'default'}]}],shippingAddress,shippingMethod:'standard',currencyCode:'USD'});
  if(prodigiMoneyCents(quote.total)>prodigiMoneyCents(item.supplierQuote.total))throw fail('Supplier costs increased after checkout. Review before fulfillment.');
  const draft=await createProdigiDraft({merchantReference:`lola-keepsakes:${f.id}`,recipient:{name:contact.shippingAddress.name,email:contact.email,address:shippingAddress},shippingMethod:'standard',items:[{sku:item.variant.sku,quantity:item.units,sizing:'fitPrintArea',attributes:item.variant.attributes||{},assets:[{printArea:item.variant.printArea||'default',url:supplierUrl(f,artwork[0]),md5Hash:artwork[0].md5}]}],submit:false},`lola-keepsakes:${f.id}`);
  if(!draft.id)throw fail('Prodigi did not return a draft order identifier.');
  await query('UPDATE keepsakes_fulfillments SET provider_order_id=$2,provider_cost_cents=$3,shipping_cost_cents=$4,updated_at=now() WHERE id=$1',[f.id,draft.id,prodigiMoneyCents(quote.total)-prodigiMoneyCents(quote.shipping),prodigiMoneyCents(quote.shipping)]);
  current=await getProdigiOrder(draft.id);
 }
 if(current.status==='draft'){
  try{await submitProdigiOrder(current.id);}
  catch(error){
   // Accepted drafts may be readable before the supplier can submit them.
   // Reconcile the durable ID first; never create a replacement order.
   current=await getProdigiOrder(current.id);
   if(current.status==='draft'){
    if(prodigiDraftMayRetry(current,error,f.attempts)){
     await query("UPDATE keepsakes_fulfillments SET status='RETRY',lease_until=NULL,next_attempt_at=now()+interval '30 seconds',last_error='PRODIGI_SUBMISSION_PENDING',updated_at=now() WHERE id=$1",[f.id]);return;
    }
    throw error;
   }
  }
  current=await getProdigiOrder(current.id);
 }
 const known=['draft','pending_submission','submitted','in_production','on_hold','paused','partially_shipped','shipped','completed','cancelled','failed'];
 if(!known.includes(current.status))throw fail('Prodigi returned an unknown order state. Reconcile it before retrying.');
 let tracking=[];
 if(['partially_shipped','shipped','completed'].includes(current.status)){
  const shipments=await prodigiShipments(current.id),rows=Array.isArray(shipments)?shipments:shipments.shipments||[];
  tracking=rows.map(s=>({carrier:s.carrier,trackingNumber:s.trackingNumber,trackingUrl:s.trackingUrl,dispatchedAt:s.dispatchedAt,deliveredAt:s.deliveredAt}));
 }
 const status=['failed','on_hold','paused'].includes(current.status)?'REQUIRES_REVIEW':current.status==='completed'?'COMPLETE':current.status==='cancelled'?'CANCELLED':current.status==='shipped'?'SHIPPED':'SUBMITTED';
 await query("UPDATE keepsakes_fulfillments SET status=$2,tracking=$3,lease_until=NULL,submitted_at=COALESCE(submitted_at,now()),next_attempt_at=now()+interval '15 minutes',last_error=$4,updated_at=now() WHERE id=$1",[f.id,status,JSON.stringify(tracking),status==='REQUIRES_REVIEW'?`Prodigi state: ${current.status}`:null]);
}
async function fulfillLob(f,order,item){
 const {sendKeepsakesLob,reconcileKeepsakesLob,renderKeepsakesPostcardBack}=await import('./keepsakes-lob.js');
 if(f.provider_order_id){
  const status=await reconcileKeepsakesLob(f.provider_order_id);
  const events=status.tracking_events||[],failed=Boolean(status.failure_code)||['failed','rejected','deleted'].includes(status.status),delivered=events.some(e=>e.name==='Delivered'||e.type==='postcard.delivered');
  await query("UPDATE keepsakes_fulfillments SET status=$3,tracking=$2,lease_until=NULL,next_attempt_at=now()+interval '1 day',last_error=$4,updated_at=now() WHERE id=$1",[f.id,JSON.stringify([{expectedDelivery:status.expected_delivery_date,mailingDate:status.send_date,events}]),failed?'REQUIRES_REVIEW':delivered?'COMPLETE':'SUBMITTED',failed?'Lob reported a postcard failure.':null]);return;
 }
 if(f.attempts>1&&Date.now()-new Date(f.created_at).getTime()>23*3600000)throw fail('Lob idempotency window expired. Reconcile the original request before retry.');
 const art=await savedArtwork(f,item),front=await verifiedGalleryBytes({...art[0],mime_type:'image/png'},async()=>{},{maxBytes:20*1024*1024});
 let source;
 if(item.variant.backTemplate===STANDARD_POSTCARD_TEMPLATE){
  if(item.backArtworkChecksum!==STANDARD_POSTCARD_SHA256)throw fail('The purchased postcard template changed.');
  source=await standardPostcardBack();
 }else{
 const back=(await query("SELECT * FROM gallery_postcard_back_artworks WHERE album_id=$1 AND id=$2 AND status='APPROVED'",[order.album_id,item.backArtworkId])).rows[0];
 if(!back||back.sha256!==item.backArtworkChecksum)throw fail('The approved postcard back changed. Review the purchased artwork.');
 const storage=galleryStorage(),chunks=[];for await(const chunk of await storage.get(back.storage_key))chunks.push(chunk);source=Buffer.concat(chunks);
 if(storage.provider!==back.storage_provider||crypto.createHash('sha256').update(source).digest('hex')!==back.sha256)throw fail('Postcard back integrity could not be verified.');
 }
 const recipient=item.recipients[f.recipient_index],backBytes=await renderKeepsakesPostcardBack({bytes:source,backTemplate:item.variant.backTemplate,postcardArtworkColor:item.postcardArtworkColor,message:recipient.message,messageFont:recipient.messageFont,messageColor:recipient.messageColor,messageZone:item.variant.messageZone});
 const result=await sendKeepsakesLob({idempotencyKey:`keepsakes:${f.id}`,front,back:backBytes,to:recipient,from:item.returnAddress});
 await query("UPDATE keepsakes_fulfillments SET provider_order_id=$2,status='SUBMITTED',lease_until=NULL,submitted_at=now(),tracking=$3,next_attempt_at=now()+interval '1 day',updated_at=now() WHERE id=$1",[f.id,result.id,JSON.stringify([{expectedDelivery:result.expected_delivery_date,mailingDate:result.send_date}])]);
}
async function fulfillDigital(f,order,item){
 for(const asset of item.assets){
  const media=(await query('SELECT * FROM gallery_media WHERE id=$1 AND checksum=$2',[asset.mediaId,asset.checksum])).rows[0];
  if(!media)throw fail('The purchased original is unavailable.');await verifiedGalleryBytes(media);
  await query('INSERT INTO keepsakes_entitlements(order_id,media_id,checksum) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[order.id,media.id,media.checksum]);
 }
 await query("UPDATE keepsakes_fulfillments SET status='COMPLETE',lease_until=NULL,updated_at=now() WHERE id=$1",[f.id]);
}
async function reconcileKeepsakesPayment(order){
 const calculations=order.snapshot.taxCalculations?.length?order.snapshot.taxCalculations:order.snapshot.taxCalculationId?[{id:order.snapshot.taxCalculationId}]:[];
 const recorded=order.tax_transactions||[];
 for(const [index,calculation]of calculations.entries())if(!recorded.some(t=>t.index===index)&&!(index===0&&order.tax_transaction_id&&!order.snapshot.taxCalculations?.length)){
  const suffix=index?`:${index}`:'',tax=await keepsakesStripe('tax/transactions/create_from_calculation',{calculation:calculation.id,reference:`keepsakes:${order.id}${suffix}`},`keepsakes-tax:${order.id}${suffix}`);
  if(!tax.id)throw fail('Stripe tax recording requires review.');recorded.push({index,id:tax.id});
  await query('UPDATE keepsakes_orders SET tax_transaction_id=$2,tax_transactions=$3 WHERE id=$1',[order.id,recorded[0].id,JSON.stringify(recorded)]);
 }
 // Fees remain explicitly unknown until a settled balance transaction exists.
 if(order.stripe_fee_cents===null){
  const intent=await keepsakesStripe(`payment_intents/${encodeURIComponent(order.stripe_payment_intent)}?expand[]=latest_charge.balance_transaction`);
  const balance=intent.latest_charge?.balance_transaction;
  if(balance&&typeof balance==='object'&&balance.currency==='usd'&&Number.isSafeInteger(balance.fee))await query('UPDATE keepsakes_orders SET stripe_fee_cents=$2 WHERE id=$1',[order.id,balance.fee]);
 }
}
export async function processKeepsakesQueue({limit=5}={}){
 if(!keepsakesStaging()||process.env.KEEPSAKES_FULFILLMENT_ENABLED!=='true')return [];
 if(!(await query("SELECT to_regclass('keepsakes_fulfillments') table_name")).rows[0].table_name)return [];
 await query("UPDATE keepsakes_fulfillments SET status='REQUIRES_REVIEW',last_error='Worker lease expired; reconcile before retry.',lease_until=NULL WHERE status='PROCESSING' AND lease_until<now()");
 const results=[];
 for(let n=0;n<Math.min(limit,10);n++){
  const f=await transaction(async()=>{
   const row=(await query(`SELECT f.* FROM keepsakes_fulfillments f JOIN keepsakes_orders o ON o.id=f.order_id
   WHERE f.status IN('QUEUED','RETRY','SUBMITTED','SHIPPED') AND f.next_attempt_at<=now() AND o.paid_at IS NOT NULL AND o.refunded_cents=0 AND o.status NOT IN('CANCELLED','REFUNDED','REFUND_PENDING')
   ORDER BY f.next_attempt_at FOR UPDATE OF f SKIP LOCKED LIMIT 1`)).rows[0];
   if(!row)return null;
   return (await query("UPDATE keepsakes_fulfillments SET status='PROCESSING',attempts=attempts+1,lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=$1 RETURNING *",[row.id])).rows[0];
  });if(!f)break;
  try{await withKeepsakesOrderLock(f.order_id,async()=>{
   const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1',[f.order_id])).rows[0];order.snapshot=keepsakesSnapshot(order.snapshot);
   const item=order.snapshot.items[f.item_index],contact=decryptSecretJson(order.contact_ciphertext);
   if(!order.paid_at||order.refunded_cents||['CANCELLED','REFUNDED','REFUND_PENDING'].includes(order.status))return;
   await reconcileKeepsakesPayment(order);
   if(f.provider==='DIGITAL')await transaction(()=>fulfillDigital(f,order,item));
   else if(f.provider==='PRODIGI')await fulfillProdigi(f,order,item,contact);
   else if(f.provider==='LOB')await fulfillLob(f,order,item);
   else if(f.provider==='DIGITAL_EDIT')await query("UPDATE keepsakes_fulfillments SET status='EDITING',lease_until=NULL,updated_at=now() WHERE id=$1",[f.id]);
   else if(f.provider==='IN_HOUSE'){await savedArtwork(f,item);await query("UPDATE keepsakes_fulfillments SET status='AWAITING_PRODUCTION',lease_until=NULL,updated_at=now() WHERE id=$1",[f.id]);}
   else throw fail('Unknown fulfillment provider.');
   await query('INSERT INTO keepsakes_events(order_id,action,details) VALUES($1,$2,$3)',[order.id,'fulfillment_reconciled',JSON.stringify({fulfillmentId:f.id,provider:f.provider})]);
   results.push({id:f.id,status:'PROCESSED'});
   });
  }catch(error){
   await query("UPDATE keepsakes_fulfillments f SET status='REQUIRES_REVIEW',lease_until=NULL,last_error=$2,updated_at=now() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM keepsakes_orders o WHERE o.id=f.order_id AND (o.refunded_cents>0 OR o.status IN('CANCELLED','REFUNDED','REFUND_PENDING')))",[f.id,error.code||'KEEPSAKES_FULFILLMENT_ERROR']);
   await query("UPDATE keepsakes_orders SET status='REQUIRES_REVIEW',last_error=$2,updated_at=now() WHERE id=$1 AND refunded_cents=0 AND status NOT IN('CANCELLED','REFUNDED','REFUND_PENDING')",[f.order_id,error.code||'KEEPSAKES_FULFILLMENT_ERROR']);
   results.push({id:f.id,status:'REQUIRES_REVIEW'});
  }
 }
 await query(`UPDATE keepsakes_orders o SET status=CASE
 WHEN EXISTS(SELECT 1 FROM keepsakes_fulfillments f WHERE f.order_id=o.id AND f.status='REQUIRES_REVIEW') THEN 'REQUIRES_REVIEW'
 WHEN NOT EXISTS(SELECT 1 FROM keepsakes_fulfillments f WHERE f.order_id=o.id AND f.status<>'COMPLETE') THEN 'COMPLETE'
 WHEN NOT EXISTS(SELECT 1 FROM keepsakes_fulfillments f WHERE f.order_id=o.id AND f.status NOT IN('COMPLETE','SHIPPED')) THEN 'SHIPPED'
 ELSE 'FULFILLING' END,updated_at=now()
 WHERE o.paid_at IS NOT NULL AND o.refunded_cents=0 AND o.status IN('PAID','FULFILLING','REQUIRES_REVIEW','SHIPPED') AND EXISTS(SELECT 1 FROM keepsakes_fulfillments f WHERE f.order_id=o.id)`);
 return results;
}
export async function queueKeepsakesNotification(orderId,milestone='confirmation'){
 const order=(await query("SELECT * FROM keepsakes_orders WHERE id=$1 AND (paid_at IS NOT NULL OR status IN('PAYMENT_FAILED','EXPIRED','CANCELLED'))",[orderId])).rows[0];if(!order)return;
 const contact=decryptSecretJson(order.contact_ciphertext),allowed=String(process.env.KEEPSAKES_TEST_EMAIL_ALLOWLIST||'').toLowerCase().split(',').map(v=>v.trim());
 if(!allowed.includes(contact.email.toLowerCase()))return;
 const url=`${(process.env.GALLERY_PUBLIC_ORIGIN||process.env.CLIENT_ORIGIN).replace(/\/$/,'')}/keepsakes/orders/${contact.statusToken}`;
 const body=`Thank you for choosing The Lola Keepsakes. Your test order ${order.id} status is ${order.status}. View your order and available downloads: ${url}`;
 const communication=(await query(`INSERT INTO communications(type,channel,direction,subject,recipient,rendered_body,rendered_html,message_summary,status,send_mode,idempotency_key,trigger_key)
 VALUES('EMAIL','EMAIL','OUTBOUND',$1,$2,$3,$4,$3,'DRAFT','SEND_NOW',$5,'KEEPSAKES_TRANSACTIONAL')
 ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id,status`,['Your Lola Keepsakes order update',contact.email,body,brandedEmailHtml(body,{ctaLabel:'VIEW ORDER',ctaUrl:url}),`keepsakes:${order.id}:${milestone}`])).rows[0];
 if(['DRAFT','FAILED'].includes(communication.status))return (await sendCommunication(communication.id)).communication;
 return communication;
}
export async function processKeepsakesNotifications(){
 if(!keepsakesStaging()||process.env.KEEPSAKES_FULFILLMENT_ENABLED!=='true'||!process.env.KEEPSAKES_TEST_EMAIL_ALLOWLIST)return [];
 if(!(await query("SELECT to_regclass('keepsakes_orders') table_name")).rows[0].table_name)return [];
 // Skip acknowledged milestones so a large batch cannot starve older orders.
 const orders=(await query(`SELECT o.id,o.status FROM keepsakes_orders o
 LEFT JOIN communications c ON c.idempotency_key='keepsakes:'||o.id::text||':'||o.status
 WHERE (o.paid_at IS NOT NULL OR o.status IN('PAYMENT_FAILED','EXPIRED','CANCELLED'))
 AND (c.id IS NULL OR (c.status IN('DRAFT','FAILED') AND c.failure_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'))
 ORDER BY o.updated_at DESC,o.id LIMIT 100`)).rows,results=[];
 for(const order of orders){
  try{const sent=await queueKeepsakesNotification(order.id,order.status);if(sent)results.push({id:order.id,status:sent.status});if(results.length>=10)break;}
  catch(error){
   await query("INSERT INTO keepsakes_events(order_id,action,provider_event_id,details) VALUES($1,'notification_requires_review',$2,$3) ON CONFLICT DO NOTHING",[order.id,`notification-review:${order.id}:${order.status}`,JSON.stringify({code:error.code||'NOTIFICATION_ERROR'})]);
  }
 }return results;
}
