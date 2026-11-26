export function normalizePhotoLookup(channel,value){
 const text=String(value||'').trim();
 if(channel==='EMAIL')return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)&&text.length<=254?text.toLowerCase():null;
 if(channel!=='SMS'||!/^\+?[\d\s().-]+$/.test(text))return null;
 let digits=text.replace(/\D/g,'');
 if(digits.length===10&&!text.startsWith('+'))digits='1'+digits;
 return /^[1-9]\d{7,14}$/.test(digits)?'+'+digits:null;
}
export function photoSourceForProduct(product,assets,selectedId){
 const selected=assets.find(a=>a.id===selectedId)||(!selectedId&&assets.length===1?assets[0]:null);
 if(!selected)return {asset:null,reason:'Choose your photo first.'};
 const related=assets.filter(a=>a.sessionId&&a.sessionId===selected.sessionId||a.id===selected.id);
 const originals=related.filter(a=>!a.branded&&['ORIGINAL','PROCESSED'].includes(a.kind)),strips=related.filter(a=>a.kind==='BRANDED_STRIP'&&a.branded);
 const original=originals.find(a=>a.id===selected.id)||(originals.length===1?originals[0]:undefined);
 const strip=strips.find(a=>a.id===selected.id)||(strips.length===1?strips[0]:undefined);
 if(product.source==='ORIGINAL_UNBRANDED')return {asset:original,reference:selected,reason:original?'':'This edit needs an original photo without the event frame or overlay. Only a branded image is available for this moment, or you need to choose the specific original photo to edit.'};
 if(product.source==='BRANDED_STRIP')return {asset:strip,reference:selected,reason:strip?'':'A branded photo strip is needed for this editing service.'};
 if(product.source==='PHOTO_AND_STRIP')return {asset:original&&strip?original:null,reference:selected,strip,reason:original&&strip?'':'This package needs an original photo without an overlay and a branded strip from the same moment.'};
 return {asset:selected,reason:''};
}

export {GUEST_RETRIEVAL_MESSAGE as PHOTO_LOOKUP_MESSAGE} from './guest-retrieval-policy.js';

// Only authorized collection assets enter this function. Source-kind and per-gallery
// product permissions are separate from customer contact/checkout email.
export function eligibleProductPhotos(product,assets=[]){
 const result=new Map();
 for(const a of assets){const source=photoSourceForProduct(product,assets,a.id);
  if(source.asset&&(!Object.hasOwn(source.asset,'merchandiseEligible')||source.asset.merchandiseEligible)&&
   [source.asset,source.strip].filter(Boolean).every(a=>(product.collection==='digital'?a.retailDigitalEligible!==false:a.retailMerchandiseEligible!==false)&&(!Array.isArray(a.allowedProductIds)||a.allowedProductIds.includes(product.productId))))result.set(source.asset.id,source.asset);
 }
 return [...result.values()];
}
export function selectedProductPhoto(product,assets=[],selectedId){
 const eligible=eligibleProductPhotos(product,assets);
 return eligible.some(a=>a.id===photoSourceForProduct(product,assets,selectedId).asset?.id)?selectedId:(eligible.length===1?eligible[0].id:selectedId);
}
