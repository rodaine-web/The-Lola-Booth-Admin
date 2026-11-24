import {query} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {assertKeepsakes} from './keepsakes-service.js';
import {publishedStationPolicy,stationPackageSelections} from './keepsake-station-booking-service.js';
import {DEFAULT_STATION_POLICY,quoteCelebrationStation} from '../../../shared/keepsake-station-policy.js';
import {KEEPSAKES_CORE_PRODUCTS} from '../../../shared/keepsakes-core-catalogue.js';
import {keepsakeStationProposalInput} from '../../../shared/keepsake-station-input.js';
const issue=(message,code='STATION_CONFIGURATION')=>new AppError(message,422,code);
const authorized=user=>user?.roles?.some(r=>['OWNER','SUPER_ADMIN','ADMIN'].includes(r));
export async function stationProposalQuote(raw,selections,user){
 if(!raw)return null;assertKeepsakes();const input=keepsakeStationProposalInput.parse(raw);
 const approval=input.priceApprovalReason;if(approval&&!authorized(user))throw new AppError('Commercial station approvals require an administrator.',403,'FORBIDDEN');
 let policy=await publishedStationPolicy();
 if(input.policyVersion&&input.policyVersion!==policy.version){
  if(input.policyVersion===DEFAULT_STATION_POLICY.version)policy=DEFAULT_STATION_POLICY;
  else{const row=(await query('SELECT * FROM keepsake_station_policies WHERE version=$1',[input.policyVersion])).rows[0];if(!row)throw issue('The station policy is unavailable. Review the station configuration.');policy={...row.configuration,version:row.version,status:row.status};}
 }
 const ids=selections.map(s=>s.experience_id).filter(Boolean),packageIds=selections.flatMap(s=>s.packages||[]).map(p=>p.package_id).filter(Boolean);
 const catalog={experiences:(await query('SELECT id,name,slug FROM experiences WHERE id=ANY($1::uuid[]) AND active AND deleted_at IS NULL',[ids])).rows.map(e=>({...e,key:/mirror/i.test(e.slug||e.name)?'mirror':/vogue/i.test(e.slug||e.name)?'vogue':/glam/i.test(e.slug||e.name)?'glam':'other'})),packages:(await query('SELECT id,experience_id,name,tier_key,pricing_profile FROM packages WHERE id=ANY($1::uuid[]) AND active AND deleted_at IS NULL',[packageIds])).rows};
 const prices=input.unitPrices||{};if(Object.keys(prices).length&&!approval)throw issue('Explain and approve quote-specific unit price overrides.');
 let quote;
 if(input.mode==='CELEBRATION'){
  try{quote=quoteCelebrationStation({...input,selections:stationPackageSelections(selections.flatMap(s=>(s.packages||[]).map(p=>({experienceId:s.experience_id,packageId:p.package_id}))),catalog)},policy);}catch(e){throw issue(e.message);}
  if(!quote.minimumSatisfied)throw issue(`Add ${quote.remaining} more paid keychains or magnets before saving the station proposal.`,'STATION_MINIMUM_REQUIRED');
  quote.lines=quote.lines.map(l=>{if(l.key==='station'||l.complimentary||!l.quantity)return l;const unitCents=prices[l.key]??l.unitCents;if(unitCents==null)throw issue('Enter and approve an Admin price for every custom-quote quantity.');return {...l,unitCents,totalCents:l.quantity*unitCents,customQuote:false};});
 }else{
  if(!approval)throw issue('Review and approve the private business station pricing.');
  if(input.complimentary&&Object.values(input.complimentary).some(Boolean))throw issue('Business quotes do not use celebration Complimentary Keepsakes.');
  const quantities={...input.paid,...input.optional};const lines=[];
  for(const [key,quantity]of Object.entries(quantities)){if(!quantity)continue;if(prices[key]==null)throw issue('Enter an agreed private unit price for every requested business product.');lines.push({key,quantity,unitCents:prices[key],totalCents:quantity*prices[key],fulfillment:key==='postcard'?'LOB':'IN_HOUSE'});}
  quote={stations:input.stations?.length||input.stationCount||1,lines,complimentary:{keychain:0,magnet:0},paid:input.paid||{},combinedPaid:(input.paid?.keychain||0)+(input.paid?.magnet||0),minimumPaid:0,remaining:0,minimumSatisfied:true,totalQualifying:(quantities.keychain||0)+(quantities.magnet||0),totalProducts:lines.reduce((n,l)=>n+l.quantity,0)};
 }
 const stations=input.stations||[{location:'Main Keepsake Station',hours:quote.hours||input.hours||1}];
 if(input.stationCount&&input.stationCount!==stations.length)throw issue('Add one configuration record for each business station.');
 const baseStation=quote.lines.find(l=>l.key==='station');quote.lines=quote.lines.filter(l=>l.key!=='station');
 const normalized=stations.map((s,i)=>{const defaultCents=input.mode==='CELEBRATION'&&i===0?baseStation?.totalCents:null;const feeCents=s.feeCents??defaultCents;if(feeCents==null)throw issue('Enter an all-inclusive fee for every additional or business station.');if(defaultCents!=null&&(feeCents!==defaultCents||s.hours!==quote.hours)&&!approval)throw issue('Explain and approve a nonstandard celebration station fee or duration.');if(i>0&&!approval)throw issue('Approve the additional station configuration and all-inclusive fees.');return {...s,feeCents};});
 quote.lines.unshift(...normalized.map((s,i)=>({key:'station',quantity:1,unitCents:s.feeCents,totalCents:s.feeCents,stationIndex:i,hours:s.hours,location:s.location})));
 const subtotalCents=quote.lines.reduce((n,l)=>n+l.totalCents,0);if(!Number.isSafeInteger(subtotalCents)||quote.lines.some(l=>!Number.isSafeInteger(l.totalCents)))throw issue('Station amount exceeds supported precision.');
 return {...quote,schemaVersion:'keepsake-station-v1',mode:input.mode,policyVersion:policy.version,configuration:input,stations:normalized,subtotalCents,totalCents:subtotalCents,commercialReady:policy.status==='PUBLISHED'||Boolean(approval),capacityVerified:false,internalApproval:approval?{reason:approval,userId:user.id,at:new Date().toISOString()}:null,lines:quote.lines.map(l=>{const p=KEEPSAKES_CORE_PRODUCTS.find(p=>p.key===l.key);return {...l,title:l.key==='station'?'The Lola Keepsake Station':p.title,image:p?.image||null,fulfillment:l.key==='postcard'?'LOB':l.key==='station'?'SERVICE':'IN_HOUSE'};})};
}
export function stationProposalLines(quote){return quote?quote.lines.map(l=>({type:'KEEPSAKE',keepsake_key:l.key,complimentary:l.complimentary===true,description:(l.complimentary?'Complimentary Keepsakes — ':'')+l.title,detail:l.key==='station'?`${l.hours} hours · ${l.location} · attendant, equipment, setup and breakdown included`:`${l.quantity} × $${(l.unitCents/100).toFixed(2)} each · ${l.title}${l.key==='postcard'?' · Printed and mailed through Lob':' · In-house production'}`,quantity:l.quantity,unit_price:l.unitCents/100,line_total:l.totalCents/100,image:l.image,stripe_tax_code:l.key==='station'?'txcd_20030000':'txcd_99999999'})):[];}
export function assertStationCommercialReady(proposal){if(proposal.content?.keepsake_station&&!proposal.content.keepsake_station.commercialReady)throw new AppError('Approve the station commercial pricing before sending or accepting this proposal.',409,'STATION_PRICE_APPROVAL_REQUIRED');}
