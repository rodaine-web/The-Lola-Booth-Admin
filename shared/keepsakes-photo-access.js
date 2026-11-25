export function normalizePhotoLookup(channel,value){
 const text=String(value||'').trim();
 if(channel==='EMAIL')return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)&&text.length<=254?text.toLowerCase():null;
 if(channel!=='SMS'||!/^\+?[\d\s().-]+$/.test(text))return null;
 let digits=text.replace(/\D/g,'');
 if(digits.length===10&&!text.startsWith('+'))digits='1'+digits;
 return /^[1-9]\d{7,14}$/.test(digits)?'+'+digits:null;
}
export function photoSourceForProduct(product,assets,selectedId){
 const selected=assets.find(a=>a.id===selectedId);
 if(!selected)return {asset:null,reason:'Choose your photo first.'};
 const related=assets.filter(a=>a.sessionId&&a.sessionId===selected.sessionId||a.id===selected.id);
 const original=related.find(a=>!a.branded&&['ORIGINAL','PROCESSED'].includes(a.kind));
 const strip=related.find(a=>a.kind==='BRANDED_STRIP'&&a.branded);
 if(product.source==='ORIGINAL_UNBRANDED')return {asset:original,reason:original?'':'An unbranded photo is not available for this moment yet.'};
 if(product.source==='BRANDED_STRIP')return {asset:strip,reason:strip?'':'A branded photo strip is not available for this moment yet.'};
 if(product.source==='PHOTO_AND_STRIP')return {asset:original&&strip?original:null,strip,reason:original&&strip?'':'This package needs an unbranded photo and branded strip from this moment.'};
 return {asset:selected,reason:''};
}
