// Allocate discounted merchandise in exact cents; shipping is never discounted.
export const itemNetCents=item=>item.netUnitCents?item.netUnitCents.reduce((n,c)=>n+c,0):item.product.retailCents*item.units;
export const itemRangeCents=(item,start,count)=>item.netUnitCents?item.netUnitCents.slice(start,start+count).reduce((n,c)=>n+c,0):item.product.retailCents*count;
export function allocateKeepsakesDiscount(items,discountCents){
 const subtotal=items.reduce((n,i)=>n+i.product.retailCents*i.units,0);
 if(!Number.isSafeInteger(discountCents)||discountCents<0||discountCents>subtotal)throw Error('Invalid discount allocation');
 let gross=0,allocated=0;
 for(const item of items){item.netUnitCents=Array.from({length:item.units},()=>{gross+=item.product.retailCents;const cumulative=Math.floor(discountCents*gross/subtotal),discount=cumulative-allocated;allocated=cumulative;return item.product.retailCents-discount;});}
 return subtotal-discountCents;
}
