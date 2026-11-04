export function packageEntitlementLabels(item){
 const photo=['glam','vogue'].includes(item.experience),hours=item.serviceHours==null?null:item.serviceHours+(item.extraHours||0);
 return [hours?`${hours} active service hours`:item.rentalHours?`Up to ${item.rentalHours} rental hours`:null,
  item.attendantIncluded?'Professional attendant included':null,
  item.digitalSessionsUnlimited?'Unlimited digital sessions during booked service hours':null,
  item.customGreeting?'Custom audio greeting included':null,
  item.audioStyle?`${item.audioStyle.toLowerCase()} audio display styling`:null,
  item.galleryDays?`${item.galleryDays}-day gallery access from publication`:null,
  photo?`${item.unlimitedPrints?'Unlimited':item.selectedPrints??item.prints} physical prints included in the selected allowance`:null,
  item.designs!=null?`${item.designs} creative design${item.designs===1?'':'s'}`:null,
  item.musicSelections!=null?`${item.musicSelections} music selection${item.musicSelections===1?'':'s'}`:null,
  item.phones?`${item.phones} recording phone${item.phones===1?'':'s'}`:null,
  item.backdrop?`${item.backdrop==='PREMIUM'?'Premium':'Standard'} backdrop`:null,
  item.enclosure?'Magazine enclosure included':null,
  item.digitalSharing?'Digital sharing included':null,
  item.includedAddonKeys?.includes('red-carpet')?'Red carpet included':null,
  item.reporting?`${item.reporting.toLowerCase()} engagement reporting`:null,
  `Travel within Chicago${item.travelMinutes?` + ${item.travelMinutes} minutes beyond city limits`:''}`,
  item.approvedScope?`Approved scope: ${item.approvedScope}`:null
 ].filter(Boolean);
}

export function orderedPricingPackages(rows){
 const catalogs=['STANDARD','PROFESSIONAL','ACTIVATION','CUSTOM'],experiences=['glam','360','vogue','audio'],tiers=['ESSENTIAL','SIGNATURE','LUXE','EVENT','EVENT_PLUS','EVENT_PREMIUM','ACTIVATION','CAMPAIGN','CUSTOM_PRODUCTION'];
 const rank=(values,key)=>{const index=values.indexOf(key);return index<0?999:index;};
 return [...rows].sort((a,b)=>rank(catalogs,a.catalog_key)-rank(catalogs,b.catalog_key)||rank(experiences,a.pricing_profile?.experience)-rank(experiences,b.pricing_profile?.experience)||rank(tiers,a.tier_key)-rank(tiers,b.tier_key)||Number(a.display_order||0)-Number(b.display_order||0)||a.name.localeCompare(b.name));
}
