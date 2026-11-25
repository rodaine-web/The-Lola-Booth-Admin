import crypto from 'node:crypto';
import {sessionAssets} from './keepsakes-photo-access-service.js';
import {query} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {decryptSecretJson} from './integration-secrets.js';
import {bulkCsvRows} from '../../../shared/keepsakes-bulk.js';
import {keepsakesAddress} from '../../../shared/keepsakes.js';
import {normalizePhotoLookup} from '../../../shared/keepsakes-photo-access.js';
export async function reviewBulkCsv(token,csv){
 const scope=await sessionAssets(token);if(!scope.session.scopes.some(s=>s.client))throw new AppError('Bulk ordering is available to the authorized booking client.',403,'KEEPSAKES_CLIENT_REQUIRED');
 const clientAlbums=new Set(scope.session.scopes.filter(s=>s.client).map(s=>s.client.eventId));
 const albumRows=(await query('SELECT id FROM gallery_albums WHERE event_id=ANY($1::uuid[])',[[...clientAlbums]])).rows;
 const allowedAlbums=new Set(albumRows.map(a=>a.id)),assets=scope.assets.filter(a=>allowedAlbums.has(a.albumId));
 const shares=(await query('SELECT s.channel,s.recipient_ciphertext,mp.media_id FROM fiesta_gallery_shares s JOIN gallery_media_people mp ON mp.person_id=s.person_id AND mp.album_id=s.album_id WHERE s.album_id=ANY($1::uuid[])',[[...allowedAlbums]])).rows;
 const products=(await query('SELECT id,catalogue_key,variants,retail_cents,active,verified FROM keepsakes_products WHERE retired_at IS NULL AND catalogue_key IS NOT NULL')).rows;
 let records;try{records=bulkCsvRows(csv);}catch(e){throw new AppError(e.message,422,'KEEPSAKES_BULK_CSV');}
 const seen=new Map(),rows=[];
 for(const input of records){const issues=[],product=products.find(p=>p.catalogue_key===input.Product),variant=product?.variants.find(v=>v.id===input.Variant||v.label===input.Variant),quantity=Number(input.Quantity),address={name:input['Recipient Name'],address1:input['Address Line 1'],address2:input['Address Line 2'],city:input.City,state:input['State/Region'].toUpperCase(),zip:input['Postal Code'],country:input.Country.toUpperCase()};
 if(!keepsakesAddress.safeParse(address).success)issues.push('Enter a complete US name and postal address.');if(!Number.isInteger(quantity)||quantity<1||quantity>20)issues.push('Quantity must be 1–20.');if(!product||!variant)issues.push('Choose a supported product and variant.');if(!product?.active||!product?.verified)issues.push('This product is not ready for ordering.');
 const reference=input['Photo ID or Unique Photo Link'];let candidates=[];
 if(reference){let id=reference;if(reference.startsWith('https://')){try{const u=new URL(reference);if(!['staginggallery.thelolabooth.com','stagingshop.thelolabooth.com'].includes(u.hostname)||u.username||u.password)throw Error();const capability=u.pathname.match(/^\/gallery\/photo\/([\w-]{43})$/);if(capability){const {resolvePhotoLink}=await import('./gallery-photo-link-service.js');id=(await resolvePhotoLink(capability[1])).mediaId;}else id=u.searchParams.get('photo')||u.pathname.match(/\/photos\/assets\/([\w-]+)$/)?.[1]||'';}catch{id='';}}candidates=assets.filter(a=>a.id===id||a.media_id===id);}
 else{const email=normalizePhotoLookup('EMAIL',input.Email),phone=normalizePhotoLookup('SMS',input['Phone Number']),media=new Set(shares.filter(s=>{const value=normalizePhotoLookup(s.channel,decryptSecretJson(s.recipient_ciphertext).recipient);return value&&(s.channel==='EMAIL'?value===email:value===phone);}).map(s=>s.media_id));candidates=assets.filter(a=>media.has(a.media_id));}
 if(candidates.length!==1)issues.push(candidates.length?'Several photos match. Choose a specific photo.':'No authorized photo matches. Enter its Photo ID.');
 const signature=crypto.createHash('sha256').update(JSON.stringify([address,product?.id,variant?.id,quantity,candidates.map(a=>a.id),input['Optional Message']])).digest('hex'),duplicateOf=seen.get(signature);if(duplicateOf)issues.push('Duplicate row requires explicit review.');else seen.set(signature,input.row);
 rows.push({row:input.row,issues,duplicateOf,candidates:candidates.map(a=>({id:a.id,label:a.label})),address,message:input['Optional Message'],productKey:product?.catalogue_key,productId:product?.id,variantId:variant?.id,quantity,unitCents:product?.retail_cents||null});
 }
 return {rows,summary:{rows:rows.length,matched:rows.filter(r=>r.candidates.length===1).length,needsReview:rows.filter(r=>r.issues.length).length},message:'Review every photo, recipient and quantity. No identities or permissions were changed; no production has been queued.'};
}
