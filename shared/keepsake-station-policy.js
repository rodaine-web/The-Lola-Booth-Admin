import {KEEPSAKES_CORE_PRODUCTS} from './keepsakes-core-catalogue.js';
export const STATION_EXPERIENCES=Object.freeze(['glam','mirror','vogue']);
export const STATION_PRODUCT_KEYS=Object.freeze(['keychain','magnet','framed-photo','jacketed-print','acrylic-display','postcard']);
export const QUALIFYING_PRODUCT_KEYS=Object.freeze(['keychain','magnet']);
export const stationEligibility=key=>({retail:KEEPSAKES_CORE_PRODUCTS.some(p=>p.key===key),station:STATION_PRODUCT_KEYS.includes(key),complimentary:QUALIFYING_PRODUCT_KEYS.includes(key),mandatoryPaid:QUALIFYING_PRODUCT_KEYS.includes(key),inHouse:STATION_PRODUCT_KEYS.includes(key)&&key!=='postcard',lob:key==='postcard',premium:['premium-acrylic','photo-book','metal-print'].includes(key)});
export const DEFAULT_STATION_POLICY={
 version:'station-draft-20261123',status:'DRAFT',currency:'USD',effectiveAt:null,
 packages:{ESSENTIAL:{hours:2,stationCents:34900,complimentary:25,minimumPaid:25,complimentaryChoices:[{keychain:25,magnet:0},{keychain:0,magnet:25}]},SIGNATURE:{hours:4,stationCents:49900,complimentary:50,minimumPaid:50,complimentaryChoices:[{keychain:50,magnet:0},{keychain:0,magnet:50}]},LUXE:{hours:6,stationCents:64900,complimentary:100,minimumPaid:100,complimentaryChoices:[{keychain:100,magnet:0},{keychain:0,magnet:100},{keychain:50,magnet:50}]}},
 paidTiers:[{min:1,keychain:1299,magnet:999},{min:25,keychain:699,magnet:599},{min:50,keychain:599,magnet:499},{min:100,keychain:499,magnet:399},{min:250,keychain:449,magnet:349},{min:500,keychain:399,magnet:299}],
 optionalTiers:[{min:1,'jacketed-print':999,'framed-photo':2999,'acrylic-display':2999,postcard:499},{min:10,'jacketed-print':799,'framed-photo':2799,'acrylic-display':2799,postcard:399},{min:25,'jacketed-print':599,'framed-photo':2599,'acrylic-display':2499,postcard:349},{min:50,'jacketed-print':499,'framed-photo':2399,'acrylic-display':2299,postcard:299},{min:100,'jacketed-print':449,'framed-photo':2199,'acrylic-display':2099,postcard:249},{min:250,'jacketed-print':399,'framed-photo':null,'acrylic-display':null,postcard:229},{min:500,'jacketed-print':null,'framed-photo':null,'acrylic-display':null,postcard:199}]
};
const integer=(n,label)=>{if(!Number.isSafeInteger(n)||n<0)throw Error(`${label} must be a non-negative whole number.`);return n;};
const tierFor=(tiers,quantity)=>[...tiers].reverse().find(t=>quantity>=t.min);
// Pure cents-only engine; both the public form and Admin must use its server result.
// An accepted snapshot is immutable and is never recalculated from a newer policy.
export function quoteCelebrationStation(input,policy=DEFAULT_STATION_POLICY){
 const eligible=(input.selections||[]).filter(s=>STATION_EXPERIENCES.includes(s.experience));
 if(!eligible.length)throw Error('Choose an eligible Glam, Magic Mirror or Vogue experience.');
 const ranks=['ESSENTIAL','SIGNATURE','LUXE'];
 const tier=eligible.reduce((highest,s)=>ranks.indexOf(s.tier)>ranks.indexOf(highest)?s.tier:highest,null),offer=policy.packages[tier];
 if(!offer)throw Error('Choose a supported celebration package.');
 const free=input.complimentary||{},paid=input.paid||{},optional=input.optional||{};
 for(const key of Object.keys(free))if(!QUALIFYING_PRODUCT_KEYS.includes(key))throw Error('Only keychains and magnets can be Complimentary Keepsakes.');
 const complimentary={keychain:integer(free.keychain??0,'Complimentary keychains'),magnet:integer(free.magnet??0,'Complimentary magnets')};
 if(!offer.complimentaryChoices.some(c=>c.keychain===complimentary.keychain&&c.magnet===complimentary.magnet))throw Error('Choose an approved Complimentary Keepsakes selection for your package.');
 for(const key of Object.keys(paid))if(!QUALIFYING_PRODUCT_KEYS.includes(key))throw Error('Only paid keychains and magnets qualify for the minimum.');
 const quantity={keychain:integer(paid.keychain??0,'Paid keychains'),magnet:integer(paid.magnet??0,'Paid magnets')},combined=quantity.keychain+quantity.magnet;
 if(!Number.isSafeInteger(combined))throw Error('Quantity is too large.');
 const remaining=Math.max(0,offer.minimumPaid-combined),tierPrices=tierFor(policy.paidTiers,combined),lines=[{key:'station',quantity:1,unitCents:offer.stationCents,totalCents:offer.stationCents,hours:offer.hours}];
 for(const key of QUALIFYING_PRODUCT_KEYS){if(complimentary[key])lines.push({key,quantity:complimentary[key],complimentary:true,unitCents:0,totalCents:0});if(quantity[key])lines.push({key,quantity:quantity[key],complimentary:false,unitCents:tierPrices[key],totalCents:quantity[key]*tierPrices[key]});}
 for(const [key,value]of Object.entries(optional)){
  if(!STATION_PRODUCT_KEYS.includes(key)||QUALIFYING_PRODUCT_KEYS.includes(key))throw Error('Choose an optional station product from the shared catalogue.');
  const count=integer(value,'Optional quantity');if(!count)continue;
  const unitCents=tierFor(policy.optionalTiers,count)[key];
  lines.push({key,quantity:count,unitCents,totalCents:unitCents==null?null:count*unitCents,customQuote:unitCents==null,fulfillment:key==='postcard'?'LOB':'IN_HOUSE',variant:key==='postcard'?'4x6-us-mail':'4x6'});
 }
 const customQuote=lines.some(l=>l.customQuote),subtotalCents=customQuote?null:lines.reduce((n,l)=>n+l.totalCents,0);
 if(lines.some(l=>l.totalCents!=null&&!Number.isSafeInteger(l.totalCents))||subtotalCents!=null&&!Number.isSafeInteger(subtotalCents))throw Error('Amount exceeds supported precision.');
 const baseCents=integer(input.baseCents??0,'Existing booking price');
 if(subtotalCents!=null&&!Number.isSafeInteger(baseCents+subtotalCents))throw Error('Amount exceeds supported precision.');
 return {policyVersion:policy.version,policyStatus:policy.status,tier,hours:offer.hours,stations:1,complimentary,paid:quantity,combinedPaid:combined,minimumPaid:offer.minimumPaid,remaining,minimumSatisfied:remaining===0,paidTierMinimum:tierPrices?.min??null,lines,subtotalCents,totalCents:subtotalCents==null?null:baseCents+subtotalCents,totalQualifying:offer.complimentary+combined,totalProducts:lines.filter(l=>l.key!=='station').reduce((n,l)=>n+l.quantity,0),customQuote,purchasable:policy.status==='PUBLISHED'&&remaining===0&&!customQuote,capacityVerified:false};
}
