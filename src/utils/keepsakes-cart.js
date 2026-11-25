const VERSION=2,MAX_AGE=2*60*60*1000;
export const keepsakesCartKey=(type,token)=>`lola-keepsakes:v${VERSION}:${type}:${token}`;
export function restoreKeepsakesCart(storage,key,now=Date.now()){
 try{const raw=storage.getItem(key);if(!raw||raw.length>150000)return {};
  const saved=JSON.parse(raw);
  if(saved.version!==VERSION||!Number.isFinite(saved.savedAt)||saved.savedAt>now||now-saved.savedAt>MAX_AGE){storage.removeItem(key);return {};}
  if(!Array.isArray(saved.cart)||saved.cart.length>30||saved.cart.some(i=>!i||typeof i.productId!=='string'||typeof i.variantId!=='string'||!Array.isArray(i.assetIds)||i.assetIds.length>30||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>20||i.recipients&&(!Array.isArray(i.recipients)||i.recipients.length>20)))return {};
  return {cart:saved.cart,email:typeof saved.email==='string'?saved.email.slice(0,200):'',shippingAddress:saved.shippingAddress&&typeof saved.shippingAddress==='object'?saved.shippingAddress:undefined};
 }catch{return {};}
}
export function saveKeepsakesCart(storage,key,value,now=Date.now()){
 try{storage.setItem(key,JSON.stringify({...value,version:VERSION,savedAt:now}));}catch{/* Browsing and checkout still work if browser storage is unavailable. */}
}
