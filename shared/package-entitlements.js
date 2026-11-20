import {printableExperiences,primaryExperienceKeys} from './experience-catalog.js';
export function packageEntitlementLabels(item){
 if(item.experience==='virtual'&&item.virtual){
  const v=item.virtual,duration={DAY:'24 Hours',THREE_DAYS:'3 Days',WEEK:'1 Week',MONTHLY:'Monthly Subscription'}[v.duration];
  return ['Branded digital photo experience','Access by QR code or link','Digital photo sharing',`Duration: ${duration}`,
   v.participantAllowance?`Agreed participant/session allowance: ${v.participantAllowance}`:'Participant/session allowance requires an agreed scope',
   v.activeExperiences?`Active branded experiences: ${v.activeExperiences}`:'Active branded experiences require an agreed scope',
   v.customTemplates!=null?`Custom templates: ${v.customTemplates}`:null,
   v.branding?`Branding: ${v.branding}`:null,v.creativeWork?`Creative work: ${v.creativeWork}`:null,v.support?`Support: ${v.support}`:null,
   v.additionalUsageCents!=null?`Additional usage: $${(v.additionalUsageCents/100).toFixed(2)} per ${v.usageUnit}`:'Additional usage charges require agreement',
   v.startDate?`Service start: ${v.startDate}`:null,
   ...(v.duration==='MONTHLY'?[`Monthly recurring service`,`${v.minimumIsProposed?'Proposed minimum commitment':'Minimum commitment'}: ${v.minimumMonths} months`,`One-time setup: $${(v.setupFeeCents/100).toFixed(2)}`,v.renewalDate?`Renewal: ${v.renewalDate}`:null]:[])
  ].filter(Boolean);
 }
 const photo=printableExperiences.includes(item.experience),hours=item.serviceHours==null?null:item.serviceHours+(item.extraHours||0);
 if(Array.isArray(item.featureLabels))return item.featureLabels.map(label=>label.replaceAll('{hours}',String(hours??item.rentalHours??'Flexible')).replaceAll('{prints}',String(item.unlimitedPrints?'Unlimited':item.selectedPrints??item.prints??0)));
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
 const catalogs=['STANDARD','PROFESSIONAL','ACTIVATION','CUSTOM'],experiences=[...primaryExperienceKeys,'virtual','audio'],tiers=['ESSENTIAL','SIGNATURE','LUXE','EVENT','EVENT_PLUS','EVENT_PREMIUM','ACTIVATION','CAMPAIGN','CUSTOM_PRODUCTION'];
 const rank=(values,key)=>{const index=values.indexOf(key);return index<0?999:index;};
 return [...rows].sort((a,b)=>rank(catalogs,a.catalog_key)-rank(catalogs,b.catalog_key)||rank(experiences,a.pricing_profile?.experience)-rank(experiences,b.pricing_profile?.experience)||rank(tiers,a.tier_key)-rank(tiers,b.tier_key)||Number(a.display_order||0)-Number(b.display_order||0)||a.name.localeCompare(b.name));
}
