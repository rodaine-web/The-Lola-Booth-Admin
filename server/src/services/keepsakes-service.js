import {PRINT_REVIEW_VERSION,PRINT_REVIEW_STATEMENT} from '../../../shared/keepsakes-print-policy.js';
import {keepsakesCoreProduct,variableInsertProduct} from '../../../shared/keepsakes-core-catalogue.js';
import {previewTemplateFor} from '../../../shared/keepsakes-preview-templates.js';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {resolvePhotoLink} from './gallery-photo-link-service.js';
import {resolveGalleryToken,allowedMedia} from './private-gallery-service.js';
import {verifiedGalleryBytes} from './gallery-media-delivery.js';
import {encryptSecretJson,decryptSecretJson} from './integration-secrets.js';
import {keepsakesStaging,keepsakesCart} from '../../../shared/keepsakes.js';
import {stripeConfiguration,verifyStripeAccount} from './stripe-configuration.js';
import {prodigiQuote,prodigiStatus,prodigiMoneyCents} from './prodigi-service.js';
import {galleryStorage} from './gallery-storage.js';
import {lockKeepsakesOrder} from './keepsakes-order-lock.js';
import {STANDARD_POSTCARD_TEMPLATE,STANDARD_POSTCARD_SHA256} from '../../../shared/postcard-template.js';
import {standardPostcardBack} from './keepsakes-postcard-template.js';

export const keepsakesHash=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:String(value)).digest('hex');
export function keepsakesSnapshot(snapshot){return {...snapshot,items:snapshot.items.map(item=>{const {recipientsCiphertext,...rest}=item;const privateData=recipientsCiphertext?decryptSecretJson(recipientsCiphertext):{};return {...rest,shippingAddress:privateData.shippingAddress||item.shippingAddress,recipients:privateData.recipients||item.recipients||[],returnAddress:privateData.returnAddress||item.returnAddress};})};}
export function assertKeepsakes(){if(!keepsakesStaging())throw new AppError('Keepsakes is available in staging only.',404,'KEEPSAKES_DISABLED');}
const unavailable=()=>new AppError('This photo or order is unavailable.',404,'KEEPSAKES_UNAVAILABLE');
export const stripeHeaders=()=>({Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`,'Stripe-Version':'2026-08-26.dahlia'});
export async function keepsakesStripe(path,body,key,request=fetch){
 assertKeepsakes();
 if(stripeConfiguration().mode!=='TEST'||!stripeConfiguration().enabled)throw new AppError('Stripe test payments are not configured.',409,'KEEPSAKES_STRIPE_NOT_READY');
 const response=await request(`https://api.stripe.com/v1/${path}`,{method:body?'POST':'GET',headers:{...stripeHeaders(),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(20000),redirect:'error'});
 const result=await response.json();
 if(!response.ok)throw new AppError('Stripe could not complete this request. Check the integration configuration.',502,'KEEPSAKES_STRIPE_ERROR');
 return result;
}
export function keepsakesReadiness(){
 const stripe=stripeConfiguration();
 const checkout=keepsakesStaging()&&process.env.KEEPSAKES_CHECKOUT_ENABLED==='true'&&process.env.KEEPSAKES_FULFILLMENT_ENABLED==='true'&&stripe.enabled&&stripe.mode==='TEST'&&stripe.webhookConfigured&&process.env.KEEPSAKES_TAX_REVIEWED==='true';
 return {checkout,stripe:stripe.readiness,prodigi:prodigiStatus(),mode:'SANDBOX',fulfillmentEnabled:process.env.KEEPSAKES_FULFILLMENT_ENABLED==='true',notificationsConfigured:Boolean(process.env.KEEPSAKES_TEST_EMAIL_ALLOWLIST),message:checkout?'Test checkout is available. No live orders.':'Shopping preview: test checkout awaits payment, tax and fulfillment configuration.'};
}
export async function keepsakesScope(type,token){
 assertKeepsakes();
 if(type==='session'){
  const {sessionAssets}=await import('./keepsakes-photo-access-service.js');
  const {session,assets}=await sessionAssets(token),settingsByAlbum=new Map();
  for(const a of assets)if(!settingsByAlbum.has(a.albumId))settingsByAlbum.set(a.albumId,await keepsakesSettings(a.albumId));
  // Permissions stay attached to each source album, including multi-gallery carts.
  return {albumId:assets[0]?.albumId,scopeHash:keepsakesHash(`session:${token}`),session,settingsByAlbum,
   assets:assets.map(a=>{const settings=settingsByAlbum.get(a.albumId);return {...a,
    allowedProductIds:settings.enabled?settings.productIds:[],
    digital_eligible:settings.enabled&&a.merchandise_eligible&&((['ORIGINAL','PROCESSED'].includes(a.kind)&&!a.branded)||(a.kind==='BRANDED_STRIP'&&a.branded)),
    merchandise_eligible:settings.enabled&&a.merchandise_eligible&&(!a.branded||settings.brandedMerchandise)};})};
 }
 const resolved=type==='photo'?await resolvePhotoLink(token):{grant:await resolveGalleryToken(type==='p'?'PERSON':type==='a'?'ALBUM':'INVALID',token)};
 const permitted=await allowedMedia(resolved.grant);
 const anchors=permitted.filter(m=>m.media_type==='IMAGE'&&(!resolved.mediaId||m.id===resolved.mediaId));
 const albumId=resolved.grant.album_id;
 // Session expansion is explicit and anchored to an already authorized photo.
 // A PHOTO capability must never inherit its parent ALBUM's entire media set.
 const assets=anchors.length?(await query(`SELECT a.*,m.filename,m.width,m.height,m.mime_type,m.checksum,m.storage_key,m.storage_provider,m.size_bytes,m.status,m.media_type
 FROM gallery_photo_sessions s JOIN gallery_session_assets a ON a.session_id=s.id AND a.album_id=s.album_id
 JOIN gallery_media m ON m.id=a.media_id AND m.album_id=a.album_id
 WHERE s.album_id=$1 AND s.anchor_media_id=ANY($2::uuid[]) AND m.status<>'ARCHIVED'
 ORDER BY s.created_at,a.sort_order,a.id`,[albumId,anchors.map(m=>m.id)])).rows:[];
 const represented=new Set(assets.map(a=>a.media_id)),commerce=await keepsakesSettings(albumId);
 for(const media of anchors)if(!represented.has(media.id))assets.push({...media,id:media.id,media_id:media.id,label:'Available photo',kind:'COMPOSITE',branded:true,merchandise_eligible:commerce.enabled&&commerce.brandedMerchandise,digital_eligible:false,included:true});
 return {grant:resolved.grant,albumId,assets,scopeHash:keepsakesHash(`${type}:${token}`)};
}
export async function keepsakesSettings(albumId){
 const row=(await query('SELECT * FROM keepsakes_gallery_settings WHERE album_id=$1',[albumId])).rows[0];
 return {enabled:row?.enabled||false,brandedMerchandise:row?.branded_merchandise||false,originalSales:row?.original_sales||false,productIds:row?.product_ids||[],returnAddress:row?.return_address||null};
}
export async function availableProducts(scope){
 const settings=scope.settingsByAlbum?{enabled:[...scope.settingsByAlbum.values()].some(s=>s.enabled),originalSales:true,brandedMerchandise:true,productIds:[...new Set([...scope.settingsByAlbum.values()].flatMap(s=>s.enabled?s.productIds:[]))]}:await keepsakesSettings(scope.albumId);
 if(!settings.enabled)return {settings,products:[]};
 const products=(await query('SELECT * FROM keepsakes_products WHERE active AND verified AND retired_at IS NULL AND id=ANY($1::uuid[]) ORDER BY title',[settings.productIds])).rows;
 return {settings,products:products.filter(p=>p.provider==='DIGITAL_EDIT'?scope.assets.some(a=>a.digital_eligible):p.provider==='DIGITAL'?settings.originalSales&&scope.assets.some(a=>a.digital_eligible&&!a.included):scope.assets.some(a=>a.merchandise_eligible&&(!a.branded||settings.brandedMerchandise)))};
}
export async function keepsakesView(type,token){
 const scope=await keepsakesScope(type,token),{settings,products}=await availableProducts(scope);
 return {album:{id:scope.albumId,title:scope.grant.title},enabled:settings.enabled,
 assets:scope.assets.map(a=>({id:a.id,mediaId:a.media_id,label:a.label,kind:a.kind,width:a.width,height:a.height,orientation:a.width>a.height?'landscape':'portrait',url:`/api/keepsakes/access/${type}/${token}/assets/${a.id}`,digitalEligible:settings.originalSales&&a.digital_eligible&&!a.included,included:a.included,merchandiseEligible:a.merchandise_eligible&&(!a.branded||settings.brandedMerchandise)})),
 products:products.map(p=>({id:p.id,title:p.title,category:p.category,provider:p.provider,retailCents:p.retail_cents,currency:p.currency,variants:p.variants,available:true})),readiness:keepsakesReadiness()};
}
export async function keepsakesAsset(type,token,assetId){
 const scope=await keepsakesScope(type,token),asset=scope.assets.find(a=>a.id===assetId);
 if(!asset)throw unavailable();
 // Originals may be previewed but are never returned full-size by the shop.
 const bytes=await verifiedGalleryBytes(asset,async()=>{if(!(await keepsakesScope(type,token)).assets.some(a=>a.id===assetId))throw unavailable();});
 return sharp(bytes,{limitInputPixels:60_000_000}).rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();
}
export async function keepsakesPostcardPreview(type,token,input){
 const scope=await keepsakesScope(type,token),{products}=await availableProducts(scope);
 const product=products.find(p=>p.id===input.productId&&p.provider==='LOB'),variant=product?.variants.find(v=>v.id===input.variantId);
 if(variant?.backTemplate!==STANDARD_POSTCARD_TEMPLATE)throw new AppError('The approved postcard preview is unavailable.',404,'KEEPSAKES_BACK_ARTWORK_REQUIRED');
 const {renderKeepsakesPostcardBack}=await import('./keepsakes-lob.js');
 const rendered=await renderKeepsakesPostcardBack({...input,bytes:await standardPostcardBack(),backTemplate:STANDARD_POSTCARD_TEMPLATE});
 return sharp(rendered).resize({width:1200}).jpeg({quality:88,chromaSubsampling:'4:4:4'}).toBuffer();
}
const addressForProdigi=a=>({line1:a.address1,line2:a.address2||'',townOrCity:a.city,stateOrCounty:a.state,postalOrZipCode:a.zip,countryCode:a.country});
export {addressForProdigi};
export async function quoteKeepsakes(type,token,input){
 const cart=keepsakesCart.parse(input),scope=await keepsakesScope(type,token),{settings,products}=await availableProducts(scope),items=[],issues=[],warnings=[];
 if(!settings.enabled)throw new AppError('Shopping is not enabled for this gallery.',409,'KEEPSAKES_GALLERY_DISABLED');
 if(cart.items.reduce((sum,item)=>sum+item.quantity*Math.max(1,item.recipients.length),0)>100)throw new AppError('Use up to 100 physical units per purchase.',422,'KEEPSAKES_CART_LIMIT');
 let subtotal=0,shipping=0;
 for(const item of cart.items){
  const product=products.find(p=>p.id===item.productId),variant=product?.variants.find(v=>v.id===item.variantId);
  if(!product||!variant){const current=(await query('SELECT catalogue_key,title,active,verified FROM keepsakes_products WHERE id=$1',[item.productId])).rows[0];const label=keepsakesCoreProduct(current?.catalogue_key)?.title||current?.title||'This keepsake';throw new AppError(`${label}: ${product&&!variant?'the selected style changed. Edit this item and choose a current style.':current?.active&&current?.verified?'ordering is not enabled for these Gallery photos. Choose an eligible photo or remove this item.':'ordering is currently unavailable. Remove this item to continue with the rest of your cart.'}`,409,'KEEPSAKES_PRODUCT_UNAVAILABLE');}
  const assets=item.assetIds.map(id=>scope.assets.find(a=>a.id===id));
  if(assets.some(a=>!a||a.allowedProductIds&&!a.allowedProductIds.includes(product.id)))throw unavailable();
  if(new Set(item.assetIds).size!==item.assetIds.length)throw new AppError('Select each photo once per item.',422,'KEEPSAKES_ASSET_DUPLICATE');
  if(product.provider==='DIGITAL_EDIT'){
   const {photoSourceForProduct}=await import('../../../shared/keepsakes-photo-access.js');
   const core=keepsakesCoreProduct(product.catalogue_key),required=core&&photoSourceForProduct(core,assets.map(a=>({...a,sessionId:a.session_id})),assets[0]?.id);
   if(!required?.asset||assets.some(a=>!a.digital_eligible)||item.quantity!==1||assets.length!==(core.source==='PHOTO_AND_STRIP'?2:1))throw new AppError(required?.reason||'Suitable original editing sources are required.',422,'KEEPSAKES_EDIT_SOURCE');
   if(!product.operational_config?.editingReady)throw new AppError('This editing service is being prepared.',409,'KEEPSAKES_EDIT_NOT_READY');
   for(const a of assets)await verifiedGalleryBytes(a);
  }else if(product.provider==='DIGITAL'){
   if(!settings.originalSales||assets.some(a=>!a.digital_eligible||a.included||!['ORIGINAL','PROCESSED'].includes(a.kind)))throw new AppError('This photo is included already or is not eligible for digital purchase.',422,'KEEPSAKES_DIGITAL_NOT_ELIGIBLE');
   if(item.quantity!==1)throw new AppError('Digital downloads need a quantity of one.',422,'KEEPSAKES_QUANTITY_INVALID');
  }else{
   if(assets.some(a=>!a.merchandise_eligible||(a.branded&&!settings.brandedMerchandise)))throw new AppError('Merchandise permission is missing for this photo.',422,'KEEPSAKES_MERCHANDISE_PERMISSION');
   if(assets.length!==1)throw new AppError('This product supports one print area. Select one available photo.',422,'KEEPSAKES_PRINT_AREA');
   if(product.catalogue_key==='framed-photo'&&variant.previewAssetId==='frame-metal')throw new AppError('Metal frames are coming soon.',409,'KEEPSAKES_CONFIGURATION_PENDING');
   if(!variant.printSpec&&!variableInsertProduct(product,variant))throw new AppError('A verified print specification is required.',409,'KEEPSAKES_PRINT_SPEC');
   // Render before taking payment, using verified private source bytes.
   const {renderKeepsakesArtwork,renderVariableInsertArtwork}=await import('./keepsakes-artwork.js');
   const allowUpscale=type==='session'&&['IN_HOUSE','LOB'].includes(product.provider);
   if(allowUpscale)item.printReviewPolicy={version:PRINT_REVIEW_VERSION,allowUpscale:true};
   const bytes=await verifiedGalleryBytes(assets[0]),artwork=variableInsertProduct(product,variant)?await renderVariableInsertArtwork({bytes,key:product.catalogue_key,customization:item.customization,ratio:previewTemplateFor(product.catalogue_key,{variant})?.physicalAspectRatio}):await renderKeepsakesArtwork({bytes,spec:variant.printSpec,allowUpscale,customization:{...item.customization,positionX:item.customization.x,positionY:item.customization.y}});
   if(type==='session'&&!variableInsertProduct(product,variant)){const inchesW=artwork.renderedSize.widthPx/variant.printSpec.dpi,inchesH=artwork.renderedSize.heightPx/variant.printSpec.dpi;const dpi=Math.min(artwork.crop.width/inchesW,artwork.crop.height/inchesH);if(dpi<150){if(allowUpscale)warnings.push(`${keepsakesCoreProduct(product.catalogue_key)?.title||product.title}: this crop may print soft or pixelated. Review the proof carefully before approving.`);else throw new AppError('This photo does not have enough resolution for the selected print size. Choose another photo or a smaller size.',422,'KEEPSAKES_PRINT_RESOLUTION');}}
   if(artwork.buffer.length>20*1024*1024)throw new AppError('The configured print file exceeds the supported artwork size.',422,'KEEPSAKES_ARTWORK_SIZE');
  }
  if(product.provider!=='DIGITAL_EDIT'&&product.category!=='bundle'&&assets.length!==1)throw new AppError('Select one photo for this product.',422,'KEEPSAKES_ASSET_COUNT');
  if(product.provider==='LOB'&&(!item.recipients.length||!item.returnAddress))throw new AppError('Postcards need a sender name and return address, plus one name and address per recipient.',422,'KEEPSAKES_POSTCARD_ADDRESS');
  if(product.provider!=='LOB'&&item.recipients.length)throw new AppError('Only postcards accept separate recipients.',422,'KEEPSAKES_RECIPIENTS_INVALID');
  if(product.provider==='LOB'&&variant.backTemplate===STANDARD_POSTCARD_TEMPLATE&&item.quantity!==1)throw new AppError('Choose one recipient per postcard; copies cannot multiply recipients.',422,'KEEPSAKES_POSTCARD_QUANTITY');
  const units=product.provider==='LOB'?item.quantity*item.recipients.length:item.quantity;
  if(scope.settingsByAlbum&&!['DIGITAL_EDIT','IN_HOUSE','LOB'].includes(product.provider))throw new AppError('This configuration is awaiting verified ordering support.',409,'KEEPSAKES_CONFIGURATION_PENDING');
  if(product.provider==='IN_HOUSE'){
   const operational=product.operational_config||{};
   if(!item.shippingAddress&&!cart.shippingAddress)throw new AppError('Enter a delivery address for your physical keepsakes.',422,'KEEPSAKES_SHIPPING_REQUIRED');
   if(!operational.productionReady||!operational.stockConfirmed&&operational.stockUnits==null||operational.stockUnits!=null&&(!Number.isSafeInteger(operational.stockUnits)||operational.stockUnits<units))throw new AppError('Stock, production capacity and delivery must be confirmed for this product.',409,'KEEPSAKES_PRODUCTION_NOT_READY');
   if(!Number.isSafeInteger(operational.shippingCents)||operational.shippingCents<0)issues.push('Delivery pricing is being updated. Please try again shortly.');
   shipping+=operational.shippingCents||0;item.shippingCents=operational.shippingCents||0;
  }
  if(product.provider==='PRODIGI'){
   if(!cart.shippingAddress)throw new AppError('A shipping address is required.',422,'KEEPSAKES_SHIPPING_REQUIRED');
   const quote=await prodigiQuote({items:[{catalogueVariantId:variant.sku,quantity:units,attributes:variant.attributes||{},assets:[{printArea:variant.printArea||'default'}]}],shippingAddress:addressForProdigi(cart.shippingAddress),shippingMethod:'standard',currencyCode:'USD'});
   // A separate supplier shipment per cart line gives a conservative exact split.
   shipping+=prodigiMoneyCents(quote.shipping);
   item.supplierQuote={total:quote.total,shipping:quote.shipping,tax:quote.tax,quotedAt:new Date().toISOString()};
  }
  if(product.provider==='LOB'&&(!process.env.LOB_TEST_API_KEY?.startsWith('test_')||process.env.LOB_STAGING_TEST_ENABLED!=='true'))issues.push('Lob test mailing is not configured.');
  subtotal+=product.retail_cents*units;
  let backArtworkId,backArtworkChecksum;
  if(product.provider==='LOB'){
   let bytes;
   if(variant.backTemplate===STANDARD_POSTCARD_TEMPLATE){bytes=await standardPostcardBack();backArtworkChecksum=STANDARD_POSTCARD_SHA256;}
   else{
   const back=(await query("SELECT * FROM gallery_postcard_back_artworks WHERE album_id=$1 AND status='APPROVED' ORDER BY version DESC LIMIT 1",[scope.albumId])).rows[0];
   if(!back)throw new AppError('An approved postcard back is required before purchase.',409,'KEEPSAKES_BACK_ARTWORK_REQUIRED');
   const storage=galleryStorage();if(storage.provider!==back.storage_provider)throw new AppError('Artwork storage is unavailable.',503,'KEEPSAKES_ARTWORK_STORAGE');
   const chunks=[];for await(const chunk of await storage.get(back.storage_key))chunks.push(chunk);bytes=Buffer.concat(chunks);
   if(keepsakesHash(bytes)!==back.sha256)throw new AppError('Approved artwork could not be verified.',409,'KEEPSAKES_ARTWORK_CHANGED');

    backArtworkId=back.id;backArtworkChecksum=back.sha256;
   }
   const {renderKeepsakesPostcardBack}=await import('./keepsakes-lob.js');
   for(const recipient of item.recipients)await renderKeepsakesPostcardBack({bytes,message:recipient.message,messageFont:recipient.messageFont,messageColor:recipient.messageColor,messageZone:variant.messageZone,backTemplate:variant.backTemplate,postcardArtworkColor:item.postcardArtworkColor});
  }
  items.push({...item,units,previewTemplate:previewTemplateFor(product.catalogue_key,{variant}),backArtworkId,backArtworkChecksum,product:{id:product.id,key:product.catalogue_key,configurationVersion:product.updated_at,title:keepsakesCoreProduct(product.catalogue_key)?.title||product.title,category:product.category,provider:product.provider,retailCents:product.retail_cents,taxCode:product.tax_code},variant,assets:assets.map(a=>({id:a.id,mediaId:a.media_id,checksum:a.checksum,label:a.label,kind:a.kind})),returnAddress:product.provider==='LOB'?item.returnAddress:undefined});
 }
 if(type==='session'){
  const totals=new Map();for(const i of items.filter(i=>i.product.provider==='IN_HOUSE'))totals.set(i.product.id,(totals.get(i.product.id)||0)+i.units);
  const stock=(await query('SELECT id,operational_config FROM keepsakes_products WHERE id=ANY($1::uuid[])',[[...totals.keys()]])).rows;
  if([...totals].some(([id,n])=>stock.some(p=>p.id===id&&p.operational_config.stockUnits!=null&&p.operational_config.stockUnits<n)))throw new AppError('The combined quantities exceed the available stock. Reduce this product quantity before checkout.',409,'KEEPSAKES_PRODUCTION_NOT_READY');
 }
 let tax=0,taxCalculationId=null;const taxCalculations=[];
 const readiness=keepsakesReadiness();
 if(!readiness.checkout)issues.push(readiness.message);
 const billingAddress=cart.billingAddress||cart.shippingAddress||cart.items.find(i=>i.recipients.length)?.recipients[0];
 if(!billingAddress)issues.push('Enter a billing address for tax calculation.');
 if(items.some(i=>!/^txcd_\d{8}$/.test(i.product.taxCode||'')))issues.push('Tax pricing is being updated. Please try again shortly.');
 if(readiness.checkout&&billingAddress&&!issues.length){
  await verifyStripeAccount();
  // Stripe Tax calculates one destination at a time. Postcard recipients can
  // live in different states even though the customer makes one payment.
  const groups=new Map();
  const add=(address,item,amount,shippingCents,reference,source)=>{
   const key=JSON.stringify([source,address.address1,address.address2,address.city,address.state,address.zip,address.country]);
   if(!groups.has(key))groups.set(key,{address,source,lines:[],subtotal:0,shipping:0});
   const group=groups.get(key);group.lines.push({amount,reference,taxCode:item.product.taxCode});group.subtotal+=amount;group.shipping+=shippingCents;
  };
  items.forEach((item,index)=>{
   if(item.product.provider==='LOB')item.recipients.forEach((recipient,n)=>add(recipient,item,item.product.retailCents*item.quantity,0,`${index}:${n}`,'shipping'));
   else add(item.shippingAddress||cart.shippingAddress||billingAddress,item,item.product.retailCents*item.units,item.product.provider==='PRODIGI'?prodigiMoneyCents(item.supplierQuote.shipping):(item.shippingCents||0),String(index),['DIGITAL','DIGITAL_EDIT'].includes(item.product.provider)?'billing':'shipping');
  });
  if(groups.size>25)throw new AppError('Use up to 25 tax destinations per purchase.',422,'KEEPSAKES_DESTINATION_LIMIT');
  for(const group of groups.values()){
   const a=group.address,body={currency:'usd','customer_details[address][line1]':a.address1,'customer_details[address][line2]':a.address2||'','customer_details[address][city]':a.city,'customer_details[address][state]':a.state,'customer_details[address][postal_code]':a.zip,'customer_details[address][country]':a.country,'customer_details[address_source]':group.source,'shipping_cost[amount]':String(group.shipping)};
   group.lines.forEach((line,n)=>{body[`line_items[${n}][amount]`]=String(line.amount);body[`line_items[${n}][reference]`]=line.reference;body[`line_items[${n}][tax_code]`]=line.taxCode;body[`line_items[${n}][tax_behavior]`]='exclusive';});
   const calculation=await keepsakesStripe('tax/calculations',body),amount=calculation.tax_amount_exclusive;
   if(!calculation.id||!Number.isSafeInteger(amount)||calculation.amount_total!==group.subtotal+group.shipping+amount)throw new AppError('Tax calculation could not be verified.',502,'KEEPSAKES_TAX_INVALID');
   tax+=amount;taxCalculations.push({id:calculation.id,taxCents:amount});
  }
  taxCalculationId=taxCalculations[0]?.id||null;
 }
 const snapshot={items:items.map(item=>{const {recipients,returnAddress,shippingAddress,...rest}=item;return {...rest,recipientsCiphertext:encryptSecretJson({recipients,returnAddress,shippingAddress})};}),taxCalculationId,taxCalculations,issues,warnings},total=subtotal+shipping+tax;
 const row=(await query(`INSERT INTO keepsakes_quotes(album_id,scope_hash,snapshot,contact_ciphertext,subtotal_cents,shipping_cents,tax_cents,total_cents,checkout_ready)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,expires_at`,[scope.albumId,scope.scopeHash,JSON.stringify(snapshot),encryptSecretJson({email:cart.email,shippingAddress:cart.shippingAddress,billingAddress:cart.billingAddress}),subtotal,shipping,tax,total,issues.length===0])).rows[0];
 const {keepsakesProofDescriptors}=await import('./keepsakes-proof-service.js');
 return {quoteId:row.id,subtotalCents:subtotal,shippingCents:shipping,taxCents:tax,totalCents:total,currency:'USD',expiresAt:row.expires_at,checkoutReady:!issues.length,issues,warnings,...(items.some(i=>i.printReviewPolicy)?{printApprovalVersion:PRINT_REVIEW_VERSION,printApprovalStatement:PRINT_REVIEW_STATEMENT}:{}),proofs:keepsakesProofDescriptors(type,token,row.id,items)};
}
export async function checkoutKeepsakes(type,token,quoteId,{proofReviewed=false,printApprovalVersion}={}){
 const scope=await keepsakesScope(type,token);
 if(!keepsakesReadiness().checkout)throw new AppError('Test checkout is not ready.',409,'KEEPSAKES_CHECKOUT_NOT_READY');
 const order=await transaction(async()=>{
  const quote=(await query('SELECT * FROM keepsakes_quotes WHERE id=$1 AND scope_hash=$2 AND expires_at>now() FOR UPDATE',[quoteId,scope.scopeHash])).rows[0];
  if(!quote?.checkout_ready)throw new AppError('Refresh the cart quote before checkout.',409,'KEEPSAKES_QUOTE_EXPIRED');
  if(quote.snapshot.items.some(item=>!['DIGITAL','DIGITAL_EDIT'].includes(item.product.provider))&&!proofReviewed)throw new AppError('Review the print layouts and recipient details before checkout.',422,'KEEPSAKES_PROOF_REVIEW_REQUIRED');
  const printApprovalRequired=quote.snapshot.items.some(i=>i.printReviewPolicy);
  if(printApprovalRequired&&(!proofReviewed||printApprovalVersion!==PRINT_REVIEW_VERSION))throw new AppError('Review and accept the current print-size, crop and image-quality confirmation before checkout.',422,'KEEPSAKES_PRINT_APPROVAL_REQUIRED');
  const {settings,products}=await availableProducts(scope);
  if(type==='session'){
   for(const i of quote.snapshot.items){
    const p=products.find(p=>p.id===i.product.id),digital=i.product.provider==='DIGITAL_EDIT';
    if(!settings.enabled||!p||p.retail_cents!==i.product.retailCents||new Date(p.updated_at).toISOString()!==new Date(i.product.configurationVersion).toISOString()||JSON.stringify(p.variants.find(v=>v.id===i.variant.id))!==JSON.stringify(i.variant)||i.assets.some(a=>!scope.assets.some(s=>s.id===a.id&&s.checksum===a.checksum&&s.allowedProductIds.includes(p.id)&&(digital?s.digital_eligible:s.merchandise_eligible))))throw new AppError('Your product configuration or photo permissions changed. Refresh the cart.',409,'KEEPSAKES_QUOTE_CHANGED');
    if(p.provider==='IN_HOUSE'&&(!p.operational_config?.productionReady||p.operational_config.stockUnits!=null&&p.operational_config.stockUnits<i.units))throw new AppError('Stock or production capacity changed. Refresh the cart.',409,'KEEPSAKES_PRODUCTION_NOT_READY');
   }
  }else{
  if(!settings.enabled||quote.snapshot.items.some(i=>!products.some(p=>p.id===i.product.id&&p.retail_cents===i.product.retailCents&&JSON.stringify(p.variants.find(v=>v.id===i.variant.id))===JSON.stringify(i.variant))||i.assets.some(a=>!scope.assets.some(s=>s.id===a.id&&s.checksum===a.checksum&&(i.product.provider==='DIGITAL'?settings.originalSales&&s.digital_eligible&&!s.included:s.merchandise_eligible&&(!s.branded||settings.brandedMerchandise))))))throw new AppError('The gallery or product permissions changed. Refresh your cart.',409,'KEEPSAKES_QUOTE_CHANGED');
  }

  if(type==='session'){
   const totals=new Map();for(const i of quote.snapshot.items.filter(i=>i.product.provider==='IN_HOUSE'))totals.set(i.product.id,(totals.get(i.product.id)||0)+i.units);
   const stock=(await query('SELECT id,operational_config FROM keepsakes_products WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[[...totals.keys()]])).rows;
   if([...totals].some(([id,n])=>stock.some(p=>p.id===id&&p.operational_config.stockUnits!=null&&p.operational_config.stockUnits<n)))throw new AppError('Available stock changed. Reduce the combined product quantity and refresh your cart.',409,'KEEPSAKES_PRODUCTION_NOT_READY');
  }
  let existing=(await query('SELECT * FROM keepsakes_orders WHERE quote_id=$1',[quote.id])).rows[0];
  if(existing)return existing;
  const statusToken=crypto.randomBytes(32).toString('base64url'),contact=decryptSecretJson(quote.contact_ciphertext);
  const snapshot={...quote.snapshot,...(proofReviewed?{proofReviewedAt:new Date().toISOString(),...(printApprovalRequired?{printApproval:{version:PRINT_REVIEW_VERSION,statement:PRINT_REVIEW_STATEMENT,acceptedAt:new Date().toISOString()}}:{})}:{})};
  existing=(await query(`INSERT INTO keepsakes_orders(quote_id,album_id,token_hash,contact_ciphertext,snapshot,subtotal_cents,shipping_cents,tax_cents,total_cents)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[quote.id,quote.album_id,keepsakesHash(statusToken),encryptSecretJson({...contact,statusToken}),snapshot,quote.subtotal_cents,quote.shipping_cents,quote.tax_cents,quote.total_cents])).rows[0];
  return existing;
 });
 if(order.checkout_url)return {url:order.checkout_url};
 const contact=decryptSecretJson(order.contact_ciphertext),origin=(process.env.GALLERY_PUBLIC_ORIGIN||process.env.CLIENT_ORIGIN||'http://localhost:5173').replace(/\/$/,'');
 const body={mode:'payment',customer_email:contact.email,success_url:`${origin}/keepsakes/orders/${contact.statusToken}`,cancel_url:type==='session'?`${(process.env.SHOP_PUBLIC_ORIGIN||origin).replace(/\/$/,'')}/shop/cart`:`${origin}/keepsakes/${type}/${token}`,'metadata[keepsakes_order_id]':order.id,'payment_intent_data[metadata][keepsakes_order_id]':order.id,'billing_address_collection':'required','line_items[0][price_data][currency]':'usd','line_items[0][price_data][product_data][name]':'The Lola Keepsakes — configured order (including shipping and calculated tax)','line_items[0][price_data][unit_amount]':String(order.total_cents),'line_items[0][quantity]':'1',expires_at:String(Math.floor(Date.now()/1000)+1800)};
 const session=await keepsakesStripe('checkout/sessions',body,`keepsakes:${order.id}`);
 if(!session.id||!session.url||session.livemode!==false)throw new AppError('Stripe returned an invalid test checkout.',502,'KEEPSAKES_CHECKOUT_INVALID');
 await query('UPDATE keepsakes_orders SET stripe_session_id=$2,checkout_url=$3,updated_at=now() WHERE id=$1',[order.id,session.id,session.url]);
 return {url:session.url};
}
export async function keepsakesOrderForToken(token){
 assertKeepsakes();
 if(!/^[-\w]{43}$/.test(token||''))throw unavailable();
 const order=(await query('SELECT * FROM keepsakes_orders WHERE token_hash=$1',[keepsakesHash(token)])).rows[0];
 if(!order)throw unavailable();return order;
}
export async function keepsakesOrderView(token){
 const order=await keepsakesOrderForToken(token);
 const fulfillments=(await query('SELECT id,item_index,provider,status,recipient_index,tracking,last_error,submitted_at FROM keepsakes_fulfillments WHERE order_id=$1 ORDER BY item_index',[order.id])).rows;
 const downloads=(await query(`SELECT e.id,m.filename,e.expires_at FROM keepsakes_entitlements e JOIN gallery_media m ON m.id=e.media_id WHERE e.order_id=$1 AND e.revoked_at IS NULL AND e.expires_at>now()`,[order.id])).rows.map(d=>({...d,url:`/api/keepsakes/orders/${token}/downloads/${d.id}`}));
 const edits=(await query('SELECT e.id,e.deliverable,e.expires_at FROM keepsakes_edit_outputs e JOIN keepsakes_fulfillments f ON f.id=e.fulfillment_id WHERE f.order_id=$1 AND e.revoked_at IS NULL AND e.expires_at>now()',[order.id])).rows;
 if(order.paid_at&&!order.refunded_cents)downloads.push(...edits.map(e=>({...e,filename:`Edited ${e.deliverable.toLowerCase()}`,url:`/api/keepsakes/orders/${token}/edited/${e.id}`})));
 const snapshot=keepsakesSnapshot(order.snapshot);
 return {id:order.id,quoteId:order.quote_id,status:order.status,mode:'TEST',subtotalCents:order.subtotal_cents,shippingCents:order.shipping_cents,taxCents:order.tax_cents,totalCents:order.total_cents,currency:order.currency,createdAt:order.created_at,paidAt:order.paid_at,items:snapshot.items.map((i,index)=>{
  const jobs=fulfillments.filter(f=>f.item_index===index),tracking=jobs.flatMap(f=>f.tracking||[]);
  return {id:`${order.id}:${index}`,recipients:i.product.provider==='LOB'?i.recipients.map((r,n)=>({...r,status:jobs.find(j=>j.recipient_index===n)?.status||'QUEUED'})):[],category:i.product.category,provider:i.product.provider,variant:i.variant,customization:i.customization,amountCents:i.product.retailCents*i.units,previewUrl:order.paid_at&&!order.refunded_cents?`/api/keepsakes/orders/${token}/items/${index}/preview`:null,title:i.product.title,quantity:i.units,photos:i.assets.map(a=>a.label),status:jobs.some(f=>f.status==='REQUIRES_REVIEW')?'REQUIRES_REVIEW':jobs.length&&jobs.every(f=>f.status==='COMPLETE')?'COMPLETE':jobs[0]?.status||order.status,trackingUrl:tracking.find(t=>t.trackingUrl)?.trackingUrl,estimatedDelivery:tracking.find(t=>t.expectedDelivery)?.expectedDelivery,failureReason:jobs.find(f=>f.last_error)?.last_error};
 }),fulfillments,downloads};
}
export async function keepsakesOrderPreview(token,index){
 const order=await keepsakesOrderForToken(token);
 if(!Number.isInteger(index)||index<0||!order.paid_at||order.refunded_cents)throw unavailable();
 const source=order.snapshot.items[index]?.assets[0];if(!source)throw unavailable();
 const media=(await query('SELECT * FROM gallery_media WHERE id=$1 AND checksum=$2',[source.mediaId,source.checksum])).rows[0];if(!media)throw unavailable();
 const bytes=await verifiedGalleryBytes(media);const {savedProductPreview}=await import('./keepsakes-product-preview.js');const personalized=await savedProductPreview(order.snapshot.items[index],bytes);if(personalized)return personalized;
 return sharp(bytes,{limitInputPixels:60_000_000}).rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();
}
export async function keepsakesDownload(token,id){
 const order=await keepsakesOrderForToken(token);
 const media=(await query(`SELECT m.* FROM keepsakes_entitlements e JOIN gallery_media m ON m.id=e.media_id WHERE e.id=$1 AND e.order_id=$2 AND e.revoked_at IS NULL AND e.expires_at>now() AND m.checksum=e.checksum`,[id,order.id])).rows[0];
 if(!order.paid_at||order.refunded_cents||!media)throw unavailable();
 return {bytes:await verifiedGalleryBytes(media),mime:media.mime_type,filename:media.filename};
}
// Called exclusively after the existing Stripe signature/account/event ledger checks.
export async function handleKeepsakesStripeEvent(event){
 const object=event.data?.object||{},orderId=object.metadata?.keepsakes_order_id;
 let order=orderId?(await query('SELECT id FROM keepsakes_orders WHERE id=$1',[orderId])).rows[0]:null;
 if(!order&&object.payment_intent)order=(await query('SELECT id FROM keepsakes_orders WHERE stripe_payment_intent=$1',[object.payment_intent])).rows[0];
 if(!order&&!orderId)return false;
 assertKeepsakes();
 if(event.livemode!==false||!order)throw new AppError('Keepsakes accepts matching test orders only.',409,'KEEPSAKES_EVENT_INVALID');
 await transaction(async()=>{
  await lockKeepsakesOrder(order.id);
  const row=(await query('SELECT * FROM keepsakes_orders WHERE id=$1 FOR UPDATE',[order.id])).rows[0];
  row.snapshot=keepsakesSnapshot(row.snapshot);
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
   if(object.payment_status!=='paid')return;
   if(row.stripe_session_id!==object.id||row.total_cents!==object.amount_total||object.currency!=='usd'||!object.payment_intent)throw new AppError('Payment does not match the Keepsakes checkout.',409,'KEEPSAKES_PAYMENT_MISMATCH');
   if(!row.paid_at){
    if(['CANCELLED','REFUNDED','REFUND_PENDING'].includes(row.status))throw new AppError('Payment requires reconciliation for this closed order.',409,'KEEPSAKES_PAYMENT_REVIEW');
    // Lock products in a stable order and aggregate repeated product lines.
    const reservations=new Map();for(const i of row.snapshot.items.filter(i=>i.product.provider==='IN_HOUSE'))reservations.set(i.product.id,(reservations.get(i.product.id)||0)+i.units);
    const stock=(await query('SELECT id,active,verified,operational_config FROM keepsakes_products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[...reservations.keys()]])).rows;
    if([...reservations].some(([id,n])=>!stock.some(p=>p.id===id&&p.active&&p.verified&&p.operational_config.productionReady&&(p.operational_config.stockUnits==null?p.operational_config.stockConfirmed:p.operational_config.stockUnits>=n)))){
     await query("UPDATE keepsakes_orders SET status='REQUIRES_REVIEW',stripe_payment_intent=$2,paid_at=now(),last_error='Paid order needs stock review.',updated_at=now() WHERE id=$1",[row.id,object.payment_intent]);
     await query('INSERT INTO keepsakes_events(order_id,action,provider_event_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[row.id,'paid_stock_review',event.id]);return;
    }
    for(const [id,n]of reservations)if(stock.find(p=>p.id===id)?.operational_config.stockUnits!=null)await query("UPDATE keepsakes_products SET operational_config=jsonb_set(operational_config,'{stockUnits}',to_jsonb((operational_config->>'stockUnits')::integer-$2)) WHERE id=$1",[id,n]);
    await query("UPDATE keepsakes_orders SET status='PAID',stripe_payment_intent=$2,paid_at=now(),updated_at=now() WHERE id=$1",[row.id,object.payment_intent]);
    for(const [index,item]of row.snapshot.items.entries()){
     const recipients=item.product.provider==='LOB'?item.recipients.length:1,copies=item.product.provider==='LOB'?item.quantity:1;
     for(let recipient=0;recipient<recipients;recipient++)for(let copy=0;copy<copies;copy++)await query('INSERT INTO keepsakes_fulfillments(order_id,item_index,provider,recipient_index,copy_index) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[row.id,index,item.product.provider,recipient,copy]);
    }
   }
  }else if(['checkout.session.expired','checkout.session.async_payment_failed'].includes(event.type)&&object.id===row.stripe_session_id&&!row.paid_at){
   await query("UPDATE keepsakes_orders SET status=$2,updated_at=now() WHERE id=$1",[row.id,event.type.endsWith('expired')?'EXPIRED':'PAYMENT_FAILED']);
  }else if(['refund.failed','refund.updated'].includes(event.type)&&object.status==='failed'&&object.payment_intent===row.stripe_payment_intent){
   await query("UPDATE keepsakes_orders SET status='REQUIRES_REVIEW',last_error='Stripe refund failed. Review provider history before retrying.',updated_at=now() WHERE id=$1 AND refunded_cents=0",[row.id]);
  }else if(event.type==='charge.dispute.created'&&object.payment_intent===row.stripe_payment_intent){
   await query("UPDATE keepsakes_orders SET status='REQUIRES_REVIEW',last_error='Payment dispute requires review.',updated_at=now() WHERE id=$1",[row.id]);
   await query("UPDATE keepsakes_fulfillments SET status='REQUIRES_REVIEW',last_error='Payment dispute requires review.' WHERE order_id=$1 AND status IN('QUEUED','RETRY')",[row.id]);
   await query('UPDATE keepsakes_entitlements SET revoked_at=now() WHERE order_id=$1',[row.id]);
  }else if(event.type==='charge.refunded'&&object.payment_intent===row.stripe_payment_intent){
   // Refund access changes must not depend on Stripe Tax being available.
   const taxRefund=row.tax_transaction_id&&object.amount_refunded===row.total_cents&&row.tax_refund_status!=='COMPLETE'?'PENDING':row.tax_refund_status;
   await query("UPDATE keepsakes_orders SET refunded_cents=$2,status='REFUNDED',tax_refund_status=$3,updated_at=now() WHERE id=$1",[row.id,object.amount_refunded,taxRefund]);
   await query('UPDATE keepsakes_entitlements SET revoked_at=now() WHERE order_id=$1',[row.id]);
   await query("UPDATE keepsakes_fulfillments SET status=CASE WHEN status IN('QUEUED','RETRY') THEN 'CANCELLED' ELSE 'REQUIRES_REVIEW' END,updated_at=now() WHERE order_id=$1",[row.id]);
   if(object.amount_refunded!==row.total_cents)await query("UPDATE keepsakes_orders SET last_error='Partial refund requires item and tax allocation review.' WHERE id=$1",[row.id]);
  }
  await query('INSERT INTO keepsakes_events(order_id,action,provider_event_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[row.id,event.type,event.id]);
 });return true;
}
