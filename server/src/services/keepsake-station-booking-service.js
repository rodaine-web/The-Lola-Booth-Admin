import {query} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {assertKeepsakes} from './keepsakes-service.js';
import {DEFAULT_STATION_POLICY,quoteCelebrationStation,STATION_PRODUCT_KEYS,STATION_EXPERIENCES} from '../../../shared/keepsake-station-policy.js';
import {KEEPSAKES_CORE_PRODUCTS} from '../../../shared/keepsakes-core-catalogue.js';
import {keepsakeStationInput} from '../../../shared/keepsake-station-input.js';
export async function publishedStationPolicy(){
 const row=(await query("SELECT version,configuration FROM keepsake_station_policies WHERE status='PUBLISHED' ORDER BY created_at DESC,id DESC LIMIT 1")).rows[0];
 return row?{...row.configuration,version:row.version,status:'PUBLISHED'}:DEFAULT_STATION_POLICY;
}
export async function publicStationPolicy(){
 assertKeepsakes();const policy=await publishedStationPolicy();
 return {version:policy.version,pricingPublished:policy.status==='PUBLISHED',experiences:STATION_EXPERIENCES,packages:policy.packages,products:KEEPSAKES_CORE_PRODUCTS.filter(p=>STATION_PRODUCT_KEYS.includes(p.key)).map(({key,title,description,image,route})=>({key,title,description,image,route,variant:'4x6'})),...(policy.status==='PUBLISHED'?{paidTiers:policy.paidTiers,optionalTiers:policy.optionalTiers}:{})};
}
export function stationPackageSelections(selections,catalog){
 return selections.map(item=>{const pkg=catalog.packages.find(p=>p.id===item.packageId&&p.experience_id===item.experienceId),exp=catalog.experiences.find(e=>e.id===item.experienceId);return {experience:exp?.key,tier:String(pkg?.tier_key||pkg?.pricing_profile?.tier||String(pkg?.name||'').match(/\b(Essential|Signature|Luxe)\b/i)?.[1]||'').toUpperCase()};});
}
export async function bookingStationConfiguration(raw,payload,catalog,{preview=false}={}){
 if(!raw)return null;assertKeepsakes();const input=keepsakeStationInput.parse(raw),business=payload.customerType==='BUSINESS',policy=await publishedStationPolicy();
 if(business){
  if(input.complimentary)throw new AppError('Business Keepsakes use a custom quote with no automatic celebration allowance.',422,'STATION_BUSINESS_CONFIGURATION');
  return {mode:'BUSINESS',requestOnly:true,stationCount:input.stationCount||1,hours:input.hours||null,products:{...input.paid,...input.optional},notes:input.notes||'',configuration:input,pricingReady:false,capacityVerified:false};
 }
 if(input.stationCount&&input.stationCount!==1)throw new AppError('Additional celebration stations are quoted by Admin.',422,'STATION_CONFIGURATION');
 if(input.policyVersion!==policy.version)throw new AppError('The Keepsake Station offer changed. Reload and review your choices.',409,'STATION_POLICY_CHANGED');
 try{
  const quote=quoteCelebrationStation({...input,selections:stationPackageSelections(payload.selections,catalog)},policy);
  if(input.hours!=null&&input.hours!==quote.hours)throw new AppError('Nonstandard station hours need an Admin quote.',422,'STATION_CONFIGURATION');
  if(!preview&&!quote.minimumSatisfied)throw new AppError(`Add ${quote.remaining} more paid keychains or magnets to include the Keepsake Station.`,422,'STATION_MINIMUM_REQUIRED');
  return {mode:'CELEBRATION',configuration:input,quote,pricingReady:policy.status==='PUBLISHED'&&!quote.customQuote,requestOnly:policy.status!=='PUBLISHED'||quote.customQuote,notes:input.notes||''};
 }catch(e){if(e instanceof AppError)throw e;throw new AppError(e.message,422,'STATION_CONFIGURATION');}
}
