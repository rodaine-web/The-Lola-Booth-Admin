// Keep internal approval reasons, routing evidence and consumable costs out of customer JSON.
export function customerPricing(value){
 if(Array.isArray(value))return value.map(customerPricing);
 if(!value||typeof value!=='object'||value instanceof Date||value instanceof Uint8Array)return value;
 if(value.pricing_profile?.businessPlan){const {catalog_key,tier_key,pricing_profile,starting_price,...rest}=value;return customerPricing(rest);}
 if(value.schemaVersion===1&&value.catalogVersion&&Array.isArray(value.entitlements)){
  const {override,businessPlan,...quote}=value;
  if(businessPlan){delete quote.catalogKey;quote.lines=quote.lines.map(({originalUnitPriceCents,experienceDiscountCents,businessRole,...line})=>line);}
  return {...quote,entitlements:quote.entitlements.map(({printEstimate,...item})=>{if(businessPlan){delete item.businessPlan;delete item.tier;delete item.includedExperiences;delete item.packageName;}return item;}),travel:{status:quote.travel.status,amountCents:quote.travel.amountCents,allowanceMinutes:quote.travel.allowanceMinutes,...(quote.travel.excessOneWayMiles!=null?{excessOneWayMiles:quote.travel.excessOneWayMiles}: {})}};
 }
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,customerPricing(item)]));
}
