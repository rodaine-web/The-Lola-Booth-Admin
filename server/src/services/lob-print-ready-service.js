import {lobProofReady} from '../../../shared/lob-proof-policy.js';
import {fileURLToPath} from 'node:url';
import {normalizeUsMailAddress} from '../../../shared/us-mail-address.js';
import crypto from 'node:crypto';
// Lola Booth: local/test-only print-ready postcard renderer & Lob multipart transport.
// Never publishes gallery files. Never uses live credentials.
import {query} from '../db/pool.js';
import {galleryStorage} from './gallery-storage.js';
import {decryptSecretJson} from './integration-secrets.js';
import {writeAudit} from './audit-service.js';
import {AppError} from '../utils/errors.js';
import sharp from 'sharp';
import {lobPrintTestEnabled,postcardFrontProfile,postcardPreparationEnabled} from '../../../shared/postcard-print-policy.js';
import {claimPostcardDispatch} from './postcard-dispatch-claim.js';

// Bundle a licensed font so private address previews work in minimal production images.
process.env.FONTCONFIG_FILE ||= fileURLToPath(new URL('../assets/postcard-fonts/fonts.conf',import.meta.url));
const fail=(message,code=422)=>{throw new AppError(message,code,'POSTCARD_PRINT_READY');};
// LOLA_LOB_DISPATCH_HARDENING_V2: staging may use test API ONLY with a separate opt-in.
const testOnly=()=>{if(!lobPrintTestEnabled(process.env))fail('Lob TEST mode requires an explicit environment-specific test opt-in on hosted deployments.',403);};
const asBuffer=async stream=>{let chunks=[],size=0;for await(const chunk of stream){size+=chunk.length;if(size>18*1024*1024)fail('Artwork file is too large.');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);};
const canvas={width:1875,height:1275};
// Full-resolution finished layouts only; never upscale a strip or crop the trim artwork.
export async function renderPhoto(bytes) {
 const normalized=await sharp(bytes,{limitInputPixels:40_000_000}).rotate().toBuffer();
 const metadata=await sharp(normalized).metadata();
 const profile=postcardFrontProfile(metadata.width,metadata.height);
 if(!profile.eligible)fail(profile.reason);
 const image=sharp(normalized).rotate(profile.rotation);
 if(profile.kind==='BLEED_READY')return image.resize(canvas.width,canvas.height,{fit:'contain',background:'#ffffff',withoutEnlargement:true}).png({compressionLevel:8}).toBuffer();
 // Keep the finished 4×6 layout inside the trim area, with white bleed outside.
 const trim=await image.resize(1800,1200,{fit:'contain',background:'#ffffff',withoutEnlargement:true}).png().toBuffer();
 return sharp({create:{...canvas,channels:3,background:'#ffffff'}}).composite([{input:trim,left:38,top:38}]).png({compressionLevel:8}).toBuffer();
}
async function record(albumId,postcardId){
 const r=await query(`SELECT p.*,m.storage_provider AS front_provider,m.storage_key AS front_key,m.mime_type AS front_mime,m.checksum AS front_checksum,b.sha256 AS back_checksum,b.storage_provider AS back_provider,b.storage_key AS back_key,b.status AS back_status,b.width_px AS back_width,b.height_px AS back_height
 FROM gallery_postcards p JOIN gallery_people guest ON guest.id=p.person_id AND guest.album_id=p.album_id AND guest.status='ACTIVE' JOIN gallery_albums album ON album.id=p.album_id AND album.status NOT IN('ARCHIVED','EXPIRED') JOIN gallery_media m ON m.id=p.media_id AND m.album_id=p.album_id AND m.status='VISIBLE' AND m.media_type='IMAGE'
 JOIN gallery_media_people mp ON mp.album_id=p.album_id AND mp.media_id=p.media_id AND mp.person_id=p.person_id
 JOIN fiesta_gallery_shares fs ON fs.album_id=p.album_id AND fs.person_id=p.person_id AND fs.filename=m.filename
 JOIN gallery_postcard_back_artworks b ON b.id = CASE WHEN p.back_url ~ '^gallery-artwork:[a-f0-9-]{36}$' THEN substring(p.back_url FROM 17)::uuid ELSE NULL END AND b.album_id=p.album_id
 WHERE p.album_id=$1 AND p.id=$2 AND p.front_url='gallery-media:'||p.media_id::text AND m.filename IS NOT NULL`,[albumId,postcardId]);
 if(!r.rowCount)fail('Only internally prepared Fiesta photo postcards can be rendered.',404);
 const p=r.rows[0];if(p.back_status!=='APPROVED')fail('Postcard back is not approved.');
 const superseded=await query(`SELECT 1 FROM gallery_postcard_back_artworks a JOIN gallery_postcard_back_artworks newer ON newer.album_id=a.album_id AND newer.status='APPROVED' AND newer.version>a.version WHERE a.id=substring($1 FROM 17)::uuid LIMIT 1`,[p.back_url]);
 if(superseded.rowCount)fail('A newer postcard back is approved. Rebuild and reapprove this postcard before dispatch.',409);
 if(!['image/jpeg','image/png'].includes(p.front_mime))fail('Unsupported front photo format.');
 if(!((p.back_width===1875&&p.back_height===1275)||(p.back_width===1275&&p.back_height===1875)))fail('Approved back is not a 4x6 print canvas.');
 return p;
}
async function renderFiles(p){
 const storage=galleryStorage();
 if(storage.provider!==p.front_provider||storage.provider!==p.back_provider)fail('Private artwork storage is unavailable for this environment.',503);
 const frontSource=await asBuffer(await storage.get(p.front_key));
 if(crypto.createHash('sha256').update(frontSource).digest('hex')!==p.front_checksum)fail('Original photo integrity check failed.');
 const front=await renderPhoto(frontSource);
 const backSource=await asBuffer(await storage.get(p.back_key));
 if(crypto.createHash('sha256').update(backSource).digest('hex')!==p.back_checksum)fail('Approved back integrity check failed.');
 // Approved art must preserve its exact pixels, not stretch or crop. A portrait back is rotated into landscape.
 const backImage=sharp(backSource,{limitInputPixels:40_000_000});
 const dim=await backImage.metadata();
 const artwork=await (dim.width===1275&&dim.height===1875?backImage.rotate(90):backImage).png({compressionLevel:8}).toBuffer();
 // Reserve the entire right half for address, postage and barcode, including bleed.
 const white=Buffer.from('<svg width="1875" height="1275"><rect x="937" y="0" width="938" height="1275" fill="white"/></svg>');
 const back=await sharp(artwork).composite([{input:white}]).png().toBuffer();
 return {front,back};
}
export async function previewSide(albumId,postcardId,side){
 if(!postcardPreparationEnabled(process.env))fail('Private postcard preparation is disabled.',403);if(!['front','back'].includes(side))fail('Invalid side.');
 const proof=await renderProof(albumId,postcardId);
 return side==='back'?proof.personalizedBack:proof.front;
}
const xml=value=>String(value||'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export async function renderProof(albumId,postcardId){
 if(!postcardPreparationEnabled(process.env))fail('Private postcard preparation is disabled.',403);return renderPostcardProof(albumId,postcardId);
}
// Internal renderer shared by separately authorized test and live workflows.
export async function renderPostcardProof(albumId,postcardId){
 const p=await record(albumId,postcardId),files=await renderFiles(p),address=decryptSecretJson(p.recipient_ciphertext);
 const request=(await query('SELECT return_address_ciphertext FROM gallery_mailing_requests WHERE album_id=$1',[albumId])).rows[0];
 const sender=request?.return_address_ciphertext?decryptSecretJson(request.return_address_ciphertext):null;
 const senderLines=sender?[sender.name,sender.address_line1,sender.address_line2,`${sender.address_city}, ${sender.address_state} ${sender.address_zip}`].filter(Boolean):[];
 const lines=[address.name,address.address_line1,address.address_line2,`${address.address_city}, ${address.address_state} ${address.address_zip}`].filter(Boolean);
 const svg=Buffer.from(`<svg width="1875" height="1275">${senderLines.map((line,i)=>`<text x="1000" y="${90+i*28}" font-size="20" font-family="sans-serif">${xml(line)}</text>`).join('')}<rect x="1600" y="100" width="190" height="140" fill="none" stroke="#888"/><text x="1610" y="170" font-size="24">POSTAGE</text>${lines.flatMap(line=>String(line).match(/.{1,32}/g)||[]).map((line,i)=>`<text x="1000" y="${680+i*45}" font-size="30" font-family="sans-serif">${xml(line)}</text>`).join('')}<rect x="1000" y="1120" width="750" height="80" fill="#eee"/><text x="1010" y="1170" font-size="22">Reserved barcode zone — proof only</text></svg>`);
 const personalizedBack=await sharp(files.back).composite([{input:svg}]).png().toBuffer();
 const hash=crypto.createHash('sha256').update(files.front).update(files.back).update(JSON.stringify(address)).update(JSON.stringify(sender)).update(String(p.revision)).digest('hex');
 return {...files,personalizedBack,hash,postcard:p,sender};
}
export async function submitLobPrintTest(albumId,postcardId,user){
 const {enqueueMailing}=await import('./gallery-mailing-service.js');return enqueueMailing(albumId,postcardId,user);
}
export async function executeLobPrintTest(albumId,postcardId,user,job){
 testOnly();
 const key=process.env.LOB_TEST_API_KEY||'';
 if(!key.startsWith('test_'))fail('A Lob TEST key is required. Live keys are forbidden.',503);
 const sender=job?.sender_ciphertext?normalizeUsMailAddress(decryptSecretJson(job.sender_ciphertext)):null;
 if(!sender)fail('This mailing job has no approved client return address.',409);
 const p=await record(albumId,postcardId);
 if(p.status!=='APPROVED')fail('Only approved, unsubmitted postcards can be sent to Lob test.');
 // Existing person is the verified gallery recipient identity. No default extra copies.
 const duplicate=await query(`SELECT 1 FROM gallery_postcards WHERE album_id=$1 AND person_id=$2 AND id<>$3 AND (status IN ('SUBMITTING','FAILED') OR status='SUBMITTED_TEST' AND NOT $4) LIMIT 1`,[albumId,p.person_id,postcardId,Boolean(job?.extra_copy_reason?.trim())]);
 if(duplicate.rowCount)fail('A postcard for this guest is submitted, being submitted or awaiting failure reconciliation. Review it before allowing another copy.',409);
 const address=decryptSecretJson(p.recipient_ciphertext);
 for(const k of ['name','address_line1','address_city','address_state','address_zip'])if(!address?.[k])fail('Missing postcard recipient address field.');
 if(address.address_country!=='US'||!/^\d{5}(-\d{4})?$/.test(address.address_zip))fail('US mailing address is invalid.');
 if(!p.consent_at||!p.consent_source)fail('Mail consent is not recorded.');
 // Render BEFORE acquiring the submit lease: a render failure cannot affect postcard status.
 const proof=await renderProof(albumId,postcardId);
 if(!job||job.revision!==p.revision||job.proof_hash!==proof.hash||p.proof_hash!==proof.hash)fail('The approved proof changed. Review and approve it again.',409);
 // Lossless re-encoding preserves every approved pixel while keeping multipart uploads bounded.
 const [front,back]=await Promise.all([proof.front,proof.back].map(bytes=>sharp(bytes).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer()));
 if(front.length+back.length>4_800_000)fail('Combined PNG artwork exceeds the safe Lob upload budget. Review image compression and QR legibility before test submission.');
 const form=new FormData();
 for(const [k,v] of Object.entries(address))if(v!==null&&v!==undefined)form.append(`to[${k}]`,String(v));
 for(const [key,value]of Object.entries(sender))if(value)form.append(`from[${key}]`,value);form.append('size','4x6');form.append('use_type','marketing');
 form.append('description','The Lola Booth QA personalized postcard');
 form.append('metadata[gallery_album_id]',albumId);form.append('metadata[postcard_id]',postcardId);form.append('metadata[mailing_job_id]',job.id);
 form.append('front',new Blob([front],{type:'image/png'}),'fiesta-photo-front.png');
 form.append('back',new Blob([back],{type:'image/png'}),'approved-event-back.png');
 const leased=await claimPostcardDispatch(albumId,postcardId,p.person_id,{allowExtra:Boolean(job.extra_copy_reason),jobId:job.id});
 if(!leased.rowCount)fail('Postcard already submitted or being processed.',409);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
 try{
  const res=await fetch('https://api.lob.com/v1/postcards',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64'),'Idempotency-Key':`${postcardId}:${job.revision}`},body:form,signal:controller.signal});
  const payload=await res.json().catch(()=>({}));
  if(!res.ok||!/^psc_[a-zA-Z0-9]+$/.test(payload?.id||''))throw new Error(payload?.error?.message||`Lob rejected postcard (${res.status}).`);
  await query(`UPDATE gallery_postcards SET status='SUBMITTED_TEST',lob_postcard_id=$3,lob_status=$4,provider_render_status=$5,last_error=NULL,updated_at=now() WHERE album_id=$1 AND id=$2 AND status='SUBMITTING'`,[albumId,postcardId,payload.id,String(payload.status||'processed'),lobProofReady(payload,postcardId)?'rendered':String(payload.status||'processed')]);
  await writeAudit({req:{user},action:'gallery_lob_print_ready_test_submitted',entity:'gallery_album',entityId:albumId,after:{postcardId,lobId:payload.id}});
  return {postcard_id:postcardId,lob_postcard_id:payload.id,status:payload.status||'processed'};
 }catch(e){
  // Fail closed: a network error may mean Lob received the request. Never automatically retry a potentially sent order.
  await query(`UPDATE gallery_postcards SET status='FAILED',last_error=$3,updated_at=now() WHERE album_id=$1 AND id=$2 AND status='SUBMITTING'`,[albumId,postcardId,String(e.message).slice(0,300)]);
  fail('Lob TEST submission could not be confirmed. Review status before retrying; no automatic retry is allowed.',502);
 }finally{clearTimeout(timer)}
}
export async function lobTestProof(albumId,postcardId){
 testOnly();const key=process.env.LOB_TEST_API_KEY||'';
 if(!key.startsWith('test_'))fail('Lob TEST key required.',503);
 const r=await query(`SELECT lob_postcard_id FROM gallery_postcards WHERE album_id=$1 AND id=$2 AND status='SUBMITTED_TEST'`,[albumId,postcardId]);
 const lobId=r.rows[0]?.lob_postcard_id;if(!/^psc_[A-Za-z0-9]+$/.test(lobId||''))fail('No test postcard proof available.',404);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
 try{const response=await fetch(`https://api.lob.com/v1/postcards/${lobId}`,{headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64')},signal:controller.signal});
 if(!response.ok)fail('Lob proof lookup failed.',502);
 const item=await response.json();return {id:item.id,status:item.status,url:item.url||null,thumbnails:item.thumbnails||[],failure_reason:item.failure_reason||null};
 }finally{clearTimeout(timer)}
}
