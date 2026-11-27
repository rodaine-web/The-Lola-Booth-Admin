import crypto from 'node:crypto';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {query} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {assertKeepsakes,keepsakesSnapshot} from './keepsakes-service.js';
import {assertKeepsakesManager} from './keepsakes-admin-service.js';
import {orderHasGlobalHold} from '../../../shared/keepsakes-order-workflow.js';
import {withKeepsakesOrderLock} from './keepsakes-order-lock.js';
import {verifiedGalleryBytes} from './gallery-media-delivery.js';
import {galleryStorage} from './gallery-storage.js';
import {standardPostcardBack} from './keepsakes-postcard-template.js';
import {STANDARD_POSTCARD_TEMPLATE,STANDARD_POSTCARD_SHA256} from '../../../shared/postcard-template.js';
import {decryptSecretJson} from './integration-secrets.js';
import {prepareKeepsakesLobFiles,keepsakesLobAddress,renderKeepsakesPostcardBack,reconcileKeepsakesLob} from './keepsakes-lob.js';
import {syncKeepsakesOrder} from './keepsakes-lifecycle-service.js';
import {writeAudit} from './audit-service.js';
const fail=(message,code='KEEPSAKES_POSTCARD_REVIEW')=>{throw new AppError(message,409,code);};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const mailing={left:808,top:488,width:984,height:712};
export async function postcardRecord(id){
 const job=(await query("SELECT * FROM keepsakes_fulfillments WHERE id=$1 AND provider='LOB'",[id])).rows[0];if(!job)fail('Postcard unavailable.');
 const order=(await query('SELECT * FROM keepsakes_orders WHERE id=$1',[job.order_id])).rows[0],jobs=(await query('SELECT status FROM keepsakes_fulfillments WHERE order_id=$1',[job.order_id])).rows;
 if(!order?.paid_at||job.status==='CANCELLED'||orderHasGlobalHold(order,jobs))fail('This postcard is unavailable while its payment or cancellation is under review.');
 const item=keepsakesSnapshot(order.snapshot).items[job.item_index],to=keepsakesLobAddress(item.recipients[job.recipient_index]),from=keepsakesLobAddress(item.returnAddress);
 return {job,order,item,to,from,addressFingerprint:hash(JSON.stringify({to,from}))};
}
async function saveArt(bytes){const storage=galleryStorage(),key=await storage.put(bytes,'image/png');return {storage_key:key,storage_provider:storage.provider,checksum:hash(bytes),size_bytes:bytes.length,mime_type:'image/png',width:1875,height:1275,density:300};}
async function originalBack(record){const {order,item,job}=record;let source;
 if(item.variant.backTemplate===STANDARD_POSTCARD_TEMPLATE){if(item.backArtworkChecksum!==STANDARD_POSTCARD_SHA256)fail('The purchased postcard template changed.');source=await standardPostcardBack();}
 else {const back=(await query("SELECT * FROM gallery_postcard_back_artworks WHERE id=$1 AND album_id=$2 AND status='APPROVED'",[item.backArtworkId,order.album_id])).rows[0];if(!back||back.sha256!==item.backArtworkChecksum)fail('The purchased postcard back needs template review.');const storage=galleryStorage();if(storage.provider!==back.storage_provider)fail('Postcard storage is unavailable.');const chunks=[];let size=0;for await(const chunk of await storage.get(back.storage_key)){size+=chunk.length;if(size>18*1024*1024)fail('The postcard back is too large.');chunks.push(chunk);}source=Buffer.concat(chunks);if(hash(source)!==back.sha256)fail('The approved postcard back could not be verified.');}
 const r=item.recipients[job.recipient_index];return renderKeepsakesPostcardBack({bytes:source,backTemplate:item.variant.backTemplate,postcardArtworkColor:item.postcardArtworkColor,message:r.message,messageFont:r.messageFont,messageColor:r.messageColor,messageZone:item.variant.messageZone});
}
export async function validatePostcardProof(front,back,{requireConnectQr=false}={}){
 const files=await prepareKeepsakesLobFiles(front,back),pixels=await sharp(files.back).extract(mailing).removeAlpha().raw().toBuffer();
 if(pixels.some(v=>v<245))fail('Keep the entire right-hand mailing area blank white. Lob adds the recipient, return address, barcode and postage there.','KEEPSAKES_POSTCARD_MAILING_AREA');
 const {data,info}=await sharp(files.back).ensureAlpha().raw().toBuffer({resolveWithObject:true}),qr=jsQR(new Uint8ClampedArray(data),info.width,info.height)?.data;
 if(requireConnectQr&&qr!=='https://thelolabooth.com/connect')fail('The approved Lola Booth Connect QR must remain readable on the postcard back.','KEEPSAKES_POSTCARD_QR');
 return {...files,validation:{valid:true,width:1875,height:1275,dpi:300,finishedSize:'6 × 4 in',bleedSize:'6.25 × 4.25 in',safeInsetPx:75,mailingArea:mailing,mailingAreaClear:true,connectQr:requireConnectQr?true:qr==='https://thelolabooth.com/connect',combinedBytes:files.front.length+files.back.length,maxCombinedBytes:4800000}};
}
export async function ensurePostcardProof(record){
 const {job,item,addressFingerprint}=record;let proof=(await query('SELECT * FROM keepsakes_postcard_proofs WHERE fulfillment_id=$1',[job.id])).rows[0];if(proof)return proof;
 if(!job.artwork?.[0])fail('The purchased front artwork is still preparing. Refresh this item shortly.');
 const front=await verifiedGalleryBytes(job.artwork[0],async()=>{},{maxBytes:20*1024*1024}),back=await originalBack(record);let files;try{files=await validatePostcardProof(front,back,{requireConnectQr:item.variant.backTemplate===STANDARD_POSTCARD_TEMPLATE});}catch(error){if(!(error instanceof AppError))throw error;files={front,back,validation:{valid:false,issues:[error.message],combinedBytes:front.length+back.length,maxCombinedBytes:4800000}};}
 const frontArt=await saveArt(files.front),backArt=await saveArt(files.back);
 const ambiguous=!job.provider_order_id&&job.attempts>1&&job.last_error&&!['KEEPSAKES_LOB_ARTWORK_SIZE','KEEPSAKES_LOB_FRONT_SPEC','KEEPSAKES_LOB_BACK_SPEC'].includes(job.last_error);
 proof=(await query("INSERT INTO keepsakes_postcard_proofs(fulfillment_id,front,back,validation,address_fingerprint,submitted_at,dispatch_state) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(fulfillment_id) DO UPDATE SET fulfillment_id=EXCLUDED.fulfillment_id RETURNING *",[job.id,frontArt,backArt,files.validation,addressFingerprint,job.submitted_at||null,job.provider_order_id?'SENT':ambiguous?'UNKNOWN':'PREPARED'])).rows[0];return proof;
}
export const postcardProofFingerprint=p=>hash(JSON.stringify({revision:p.revision,front:p.front.checksum,back:p.back.checksum,address:p.address_fingerprint}));
function publicProof(record,proof){return {id:record.job.id,status:record.job.status,providerId:record.job.provider_order_id,providerStatus:record.job.tracking?.[0]?.providerStatus||null,revision:proof.revision,validation:proof.validation,approved:proof.approved_revision===proof.revision,submitted:!!record.job.provider_order_id,editable:!record.job.provider_order_id&&!['SENDING','UNKNOWN'].includes(proof.dispatch_state),dispatchState:proof.dispatch_state,recipient:record.item.recipients[record.job.recipient_index],returnAddress:record.item.returnAddress,message:record.item.recipients[record.job.recipient_index].message,frontUrl:`/keepsakes-admin/postcards/${record.job.id}/front`,backUrl:`/keepsakes-admin/postcards/${record.job.id}/back`};}
export async function postcardProofView(id,user){assertKeepsakes();assertKeepsakesManager(user);return withKeepsakesOrderLock((await postcardRecord(id)).job.order_id,async()=>{const r=await postcardRecord(id),p=await ensurePostcardProof(r);return publicProof(r,p);});}
export async function postcardProofBytes(id,side,user){assertKeepsakes();assertKeepsakesManager(user);if(!['front','back'].includes(side))fail('Choose a postcard side.');const r=await postcardRecord(id),p=await ensurePostcardProof(r);return verifiedGalleryBytes(p[side],async()=>{await postcardRecord(id);},{maxBytes:20*1024*1024});}
export async function replacePostcardProof(id,side,bytes,user){assertKeepsakes();assertKeepsakesManager(user);if(!['front','back'].includes(side)||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>18*1024*1024)fail('Upload a JPEG or PNG up to 18 MB.');
 const first=await postcardRecord(id);return withKeepsakesOrderLock(first.job.order_id,async()=>{const r=await postcardRecord(id),proof=await ensurePostcardProof(r);
 if(r.job.provider_order_id||proof.submitted_at||['SENDING','UNKNOWN'].includes(proof.dispatch_state)||r.job.lease_until&&new Date(r.job.lease_until)>new Date())fail('This copy is already submitted or its submission outcome needs reconciliation. It cannot be replaced or sent again.');
 const m=await sharp(bytes,{limitInputPixels:40000000}).metadata();if(!['png','jpeg'].includes(m.format)||(m.pages||1)!==1)fail('Upload one static JPEG or PNG.');
 const front=side==='front'?bytes:await verifiedGalleryBytes(proof.front),back=side==='back'?bytes:await verifiedGalleryBytes(proof.back),files=await validatePostcardProof(front,back,{requireConnectQr:r.item.variant.backTemplate===STANDARD_POSTCARD_TEMPLATE});
 const art=await saveArt(files[side]);await query("UPDATE keepsakes_postcard_proofs SET "+side+"=$2,revision=revision+1,validation=$3,approved_revision=NULL,approved_fingerprint=NULL,approved_by=NULL,approved_at=NULL,dispatch_started_at=NULL,dispatch_state='PREPARED',updated_at=now() WHERE fulfillment_id=$1",[id,art,files.validation]);
 await query("UPDATE keepsakes_fulfillments SET status='AWAITING_ARTWORK_APPROVAL',last_error=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[id]);await syncKeepsakesOrder(r.job.order_id);await writeAudit({req:{user},action:'keepsakes_postcard_artwork_replaced',entity:'keepsakes_fulfillment',entityId:id,after:{side,revision:proof.revision+1,checksum:art.checksum}});return {saved:true,revision:proof.revision+1};
 });}
export async function approvePostcardProof(id,input,user){assertKeepsakes();assertKeepsakesManager(user);if(input?.confirmed!==true||!Number.isInteger(input.revision)||Object.keys(input).some(k=>!['confirmed','revision'].includes(k)))fail('Review both postcard sides, addresses and print guides before approving.');const initial=await postcardRecord(id);return withKeepsakesOrderLock(initial.job.order_id,async()=>{const r=await postcardRecord(id),p=await ensurePostcardProof(r);
 if(r.job.provider_order_id||p.dispatch_state==='SENT')return {submitted:true};if(p.revision!==input.revision||p.address_fingerprint!==r.addressFingerprint||!p.validation.valid)fail('The postcard proof changed. Refresh and review it again.');if(['SENDING','UNKNOWN'].includes(p.dispatch_state))fail('Reconcile the existing provider submission before trying again.');
 await query('UPDATE keepsakes_postcard_proofs SET approved_revision=revision,approved_fingerprint=$2,approved_by=$3,approved_at=now(),updated_at=now() WHERE fulfillment_id=$1',[id,postcardProofFingerprint(p),user.id]);await query("UPDATE keepsakes_fulfillments SET status='RETRY',last_error=NULL,next_attempt_at=now(),lease_until=NULL,updated_at=now() WHERE id=$1",[id]);await writeAudit({req:{user},action:'keepsakes_postcard_proof_approved',entity:'keepsakes_fulfillment',entityId:id,after:{revision:p.revision,fingerprint:postcardProofFingerprint(p)}});return {approved:true,queued:true};});}
export async function refreshPostcardStatus(id,user){assertKeepsakes();assertKeepsakesManager(user);const initial=await postcardRecord(id);return withKeepsakesOrderLock(initial.job.order_id,async()=>{const r=await postcardRecord(id);if(!r.job.provider_order_id)fail('This postcard has not been submitted to Lob.');const result=await reconcileKeepsakesLob(r.job.provider_order_id),events=result.tracking_events||[],failed=!!result.failure_code||['failed','rejected','deleted'].includes(result.status),delivered=events.some(e=>e.name==='Delivered'||e.type==='postcard.delivered'),status=failed?'REQUIRES_REVIEW':delivered?'COMPLETE':'SUBMITTED';
 await query('UPDATE keepsakes_fulfillments SET status=$2,last_error=$3,tracking=$4,updated_at=now(),next_attempt_at=now()+interval \'15 minutes\' WHERE id=$1',[id,status,failed?'Lob reported a postcard failure.':null,JSON.stringify([{providerStatus:result.status,expectedDelivery:result.expected_delivery_date,mailingDate:result.send_date,events}])]);await syncKeepsakesOrder(r.job.order_id);return {status,providerStatus:result.status};});}
