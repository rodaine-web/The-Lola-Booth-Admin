// Image counts are independent of supplier pages/spreads and physical copies.
export function balancedBooks(ids,{min=5,max=20}={}){
 if(new Set(ids).size!==ids.length)throw Error('Choose each photograph once.');
 if(ids.length<min)throw Error(`Choose at least ${min} different photographs.`);
 const count=Math.ceil(ids.length/max),base=Math.floor(ids.length/count),extra=ids.length%count;
 if(base<min)throw Error('Not enough photographs for another book.');
 let offset=0;return Array.from({length:count},(_,i)=>{const size=base+(i<extra?1:0),group=ids.slice(offset,offset+size);offset+=size;return group;});
}
export function facingPages(spreads){if(!Number.isInteger(spreads)||spreads<1)throw Error('Choose a valid spread count.');return spreads*2;}
export function startingBookPrice(variants,audience='GUEST',kind='BOOK',now=new Date()){
 const valid=variants.filter(v=>v.status==='ACTIVE'&&v.kind===kind&&(audience==='CLIENT'||v.audience==='GUEST')&&v.verified_at&&v.provider_product_id&&v.retail_cents>0&&(!v.effective_from||new Date(v.effective_from)<=now)&&(!v.effective_to||new Date(v.effective_to)>now));
 return valid.length?Math.min(...valid.map(v=>v.retail_cents)):null;
}
