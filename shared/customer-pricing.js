// Keep internal approval reasons, routing evidence and consumable costs out of customer JSON.
export function customerPricing(value){
 if(Array.isArray(value))return value.map(customerPricing);
 if(!value||typeof value!=='object'||value instanceof Date||value instanceof Uint8Array)return value;
 if(value.schemaVersion===1&&value.catalogVersion&&Array.isArray(value.entitlements)){
  const {override,...quote}=value;
  return {...quote,entitlements:quote.entitlements.map(({printEstimate,...item})=>item),travel:{status:quote.travel.status,amountCents:quote.travel.amountCents,allowanceMinutes:quote.travel.allowanceMinutes,...(quote.travel.excessOneWayMiles!=null?{excessOneWayMiles:quote.travel.excessOneWayMiles}: {})}};
 }
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,customerPricing(item)]));
}
