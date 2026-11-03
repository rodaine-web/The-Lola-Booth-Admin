export const defaultPricingRules={dispatchLabel:'Downtown Chicago',dispatchAddress:null,dispatchCoordinates:null,mileageRateCents:250,manualReviewMinutes:90,sharedTripPolicy:'LONGEST_COVERAGE',stripCounting:'INDIVIDUAL',routingMode:'MANUAL_REVIEW',printOperations:{costPerSheetCents:null,sheetsPerHour:null},trafficPolicy:'STANDARDIZED',printPrices:{glam:{100:15000,200:22500,250:27500,500:45000},vogue:{100:20000,200:30000,250:35000,500:55000}}};
const names={glam:'The LOLA Glam','360':'The LOLA 360',vogue:'The LOLA Vogue',audio:'Audio Guest Book'};
const standard={glam:[599,899,1499],'360':[699,1099,1699],vogue:[899,1499,2299],audio:[299,449,699]};
const professional={glam:[999,1399,1999],'360':[1199,1599,2299],vogue:[1499,1999,2899],audio:[449,699,999]};
const activation={glam:[1499,2499,null],'360':[1799,2999,null],vogue:[2299,3499,null],audio:[799,1299,null]};
export function pricingPackageDefaults(){
 const result=[];
 for(const [catalog,prices,tiers] of [['STANDARD',standard,['Essential','Signature','Luxe']],['PROFESSIONAL',professional,['Event','Event Plus','Event Premium']],['ACTIVATION',activation,['Activation','Campaign','Custom Production']]]){
  for(const [experience,amounts] of Object.entries(prices))amounts.forEach((price,index)=>{
   const audio=experience==='audio',photo=['glam','vogue'].includes(experience),custom=price===null;
   const profile={experience,attendantIncluded:!audio,digitalSessionsUnlimited:!audio,customGreeting:audio,audioStyle:audio&&catalog==='STANDARD'?['BASIC','ENHANCED','PREMIUM'][index]:null,galleryDays:catalog==='STANDARD'?[30,60,90][index]:null,tier:tiers[index],serviceHours:audio?null:(catalog==='STANDARD'?[2,4,6]:catalog==='PROFESSIONAL'?[3,4,6]:[4,6,null])[index],rentalHours:audio&&catalog==='STANDARD'?[8,12,24][index]:null,prints:photo?(catalog==='STANDARD'?[0,200,500]:catalog==='PROFESSIONAL'?[100,250,500]:[200,500,0])[index]:0,designs:audio?null:(catalog==='STANDARD'?(experience==='360'?[1,2,3]:[1,1,2]):catalog==='PROFESSIONAL'?[1,2,2]:[1,3,null])[index],musicSelections:experience==='360'&&catalog==='STANDARD'?[1,3,5][index]:null,travelMinutes:(catalog==='ACTIVATION'?[30,60,0]:[0,30,60])[index],extraHourCents:{glam:25000,'360':20000,vogue:17500}[experience]||null,phones:audio&&catalog==='STANDARD'?[1,1,2][index]:null,audioDeliveryTargetDays:audio&&catalog==='STANDARD'?[7,5,3][index]:null,deliveryApprovalRequired:audio||catalog!=='STANDARD',startingAt:catalog==='ACTIVATION'&&!custom,quoteRequired:custom,includedAddonKeys:[],digitalSharing:!audio,backdrop:experience==='glam'?(index?'PREMIUM':'STANDARD'):null,enclosure:experience==='vogue',reporting:catalog==='PROFESSIONAL'?['BASIC','STANDARD','EXPANDED'][index]:catalog==='ACTIVATION'?['BASIC','EXPANDED',null][index]:null,coordination:catalog==='STANDARD'?'STANDARD':index?'ENHANCED':'STANDARD'};
   if(experience==='glam'&&index>0)profile.includedAddonKeys.push('premium-backdrop');
   if(catalog!=='STANDARD'&&!audio)profile.includedAddonKeys.push('branded-sharing','engagement-report');
   if(catalog==='PROFESSIONAL'&&index===0)profile.includedAddonKeys=['engagement-report'];
   if(catalog==='ACTIVATION'&&index===1)profile.includedAddonKeys.push('lead-capture');
   if(catalog==='STANDARD'&&index===2&&['360','vogue'].includes(experience))profile.includedAddonKeys.push('red-carpet');
   result.push({name:`${names[experience]} — ${tiers[index]}`,catalog_key:catalog,tier_key:tiers[index].toUpperCase().replaceAll(' ','_'),starting_price:price===null?null:price.toFixed(2),pricing_mode:custom?'CUSTOM':'STARTING',pricing_profile:profile});
  });
 }
 return result;
}
export function pricingAddonDefaults(){
 const all=['glam','360','vogue','audio'];
 return [
 ['extra-glam-hour','Extra Glam hour',250,'PER_HOUR',['glam'],'EXTRA_HOURS'],['extra-360-hour','Extra 360 hour',200,'PER_HOUR',['360'],'EXTRA_HOURS'],['extra-vogue-hour','Extra Vogue hour',175,'PER_HOUR',['vogue'],'EXTRA_HOURS'],
 ['red-carpet','Red carpet and stanchions',150,'FIXED',['360','vogue'],'ENHANCEMENT'],['creative-design','Additional creative design',100,'PER_UNIT',['glam','360','vogue'],'CREATIVE'],['branded-sharing','Branded sharing screen',150,'FIXED',['glam','360','vogue'],'CREATIVE'],['lead-capture','Lead capture configuration',250,'FIXED',['glam','360','vogue'],'MARKETING'],['engagement-report','Engagement report',150,'FIXED',['glam','360','vogue'],'MARKETING'],['attendant','Additional attendant',50,'FROM',['glam','360','vogue'],'STAFF'],['print-station','Dedicated still-photo print station',350,'FROM',['360'],'PRINTS'],['audio-phone','Additional Audio Guest Book phone',175,'PER_UNIT',['audio'],'EQUIPMENT'],['audio-styling','Styled audio display upgrade',125,'FIXED',['audio'],'ENHANCEMENT'],['postcard-setup','Postcard design and mailing setup',250,'FROM',['glam','vogue'],'FULFILLMENT'],['postcard-mailing','Postcard printing and postage',0,'CUSTOM',['glam','vogue'],'FULFILLMENT'],['travel','Additional travel',0,'CALCULATED',all,'TRAVEL'],['overnight','Overnight logistics',0,'CUSTOM',all,'TRAVEL']
 ].map(([key,name,price,method,experiences,category])=>({name,price:price.toFixed(2),pricing_type:['FROM','CALCULATED'].includes(method)?'CUSTOM':method,pricing_policy:{key,method,experiences,category,minQuantity:1,maxQuantity:['PER_HOUR','PER_UNIT','FROM'].includes(method)?24:1,approvalRequired:['FROM','CUSTOM','CALCULATED'].includes(method),resources:[]}}));
}
