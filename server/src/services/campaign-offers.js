import {query} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {campaignContent,campaignOfferPrice,campaignInterestOptions,expandCampaignPackageOffers} from '../../../shared/campaign-content.js';
import {experienceKey} from '../../../shared/proposal-scenario.js';

const round=n=>Math.round(Number(n)*100)/100;
// Resolve advertised offers to catalog identities, including the approved two-experience bundle.
export function composeCampaignOffers(campaign,experiences,packages){
 const c=campaignContent(campaign.content_json);
 const catalog=experiences.filter(e=>e.active!==false&&!e.deleted_at);
 const raw=c.format==='CORPORATE'?campaignInterestOptions(c).map(o=>({...o,kind:'EXPERIENCE',original_price:o.price,discount_type:'NONE',hours:4,features:o.key==='DUO'?c.duo_features:c[o.key==='GLAM'?'glam_features':'360_features'],experience_ids:(o.key==='DUO'?['glam','360']:[o.key==='GLAM'?'glam':'360']).map(k=>catalog.find(e=>experienceKey(e)===k)?.id).filter(Boolean)})):expandCampaignPackageOffers(c.offers,catalog,packages);
 return raw.filter(o=>o.kind==='EXPERIENCE').map(o=>{
  const ids=o.experience_ids||[o.catalog_id];
  const expected=o.key==='DUO'?2:1;
  if(ids.length!==expected||ids.some(id=>!catalog.some(e=>e.id===id)))return null;
  const pricing=campaignOfferPrice(o);
  const pkg=o.package_id?packages.find(p=>p.id===o.package_id&&p.active!==false&&!p.deleted_at&&(!p.experience_id||p.experience_id===ids[0])):null;
  if(o.package_id&&!pkg)return null;
  const allocate=(total,index)=>index===ids.length-1?round(total-round(total/ids.length)*(ids.length-1)):round(total/ids.length);
  const selections=ids.map((id,index)=>{
   const exp=catalog.find(e=>e.id===id);
   const price=index===ids.length-1?round(pricing.discounted-round(pricing.discounted/ids.length)*(ids.length-1)):round(pricing.discounted/ids.length);
   return {experience_id:id,name:exp.name,packages:[{package_id:pkg?.id||null,campaign_id:campaign.id,campaign_offer_key:o.key,name:`${campaign.name} — ${o.name}`,price,original_price:allocate(pricing.original,index),discount:round(allocate(pricing.original,index)-price),description:o.description||pkg?.proposal_description||pkg?.description||exp.proposal_description||exp.description||'',included_hours:o.hours||pkg?.included_hours,features:pkg?.items?.length?pkg.items:(o.features||pkg?.website_features||[])}],price};
  });
  return {...o,...pricing,campaign_id:campaign.id,campaign_name:campaign.name,selections};
 }).filter(Boolean);
}
export async function campaignOffers(campaignId){
 const campaign=(await query("SELECT * FROM campaigns WHERE id=$1 AND deleted_at IS NULL AND status NOT IN ('CANCELLED','FAILED')",[campaignId])).rows[0];
 if(!campaign)throw new AppError('Campaign is unavailable.',404,'CAMPAIGN_UNAVAILABLE');
 const [experiences,packages]=await Promise.all([query('SELECT * FROM experiences'),query("SELECT p.*,COALESCE(json_agg(pi.label ORDER BY pi.display_order) FILTER(WHERE pi.id IS NOT NULL),'[]') items FROM packages p LEFT JOIN package_items pi ON pi.package_id=p.id GROUP BY p.id")]);
 return {id:campaign.id,name:campaign.name,offers:composeCampaignOffers(campaign,experiences.rows,packages.rows)};
}
export async function proposalCampaignCatalog(){
 const campaigns=(await query("SELECT id FROM campaigns WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED','FAILED') ORDER BY updated_at DESC")).rows;
 return {data:(await Promise.all(campaigns.map(c=>campaignOffers(c.id)))).filter(c=>c.offers.length)};
}
export async function resolveProposalCampaignPackages(input){
 const requested=(input.selected_experiences||[]).flatMap(e=>(e.packages||[]).filter(p=>p.campaign_id).map(p=>({experience_id:e.experience_id,...p})));
 const resolved=new Map();
 for(const p of requested){
  const key=p.campaign_id+':'+p.campaign_offer_key;
  if(!resolved.has(key)){
   const c=await campaignOffers(p.campaign_id);const offer=c.offers.find(o=>o.key===p.campaign_offer_key);
   if(!offer)throw new AppError('The selected campaign offer is unavailable.',422,'INVALID_CAMPAIGN_OFFER');
   if(offer.selections.some(s=>!requested.some(r=>r.campaign_id===p.campaign_id&&r.campaign_offer_key===p.campaign_offer_key&&r.experience_id===s.experience_id)))throw new AppError('Select all experiences included in this campaign bundle.',422,'INCOMPLETE_CAMPAIGN_BUNDLE');
   resolved.set(key,offer);
  }
  if(!resolved.get(key).selections.some(s=>s.experience_id===p.experience_id))throw new AppError('Campaign offer does not belong to this experience.',422,'INVALID_CAMPAIGN_OFFER');
 }
 return resolved;
}

export async function campaignEmailContent(campaign) {
 if (!(campaign.content_json?.offers || []).some(o => o.package_scope === 'ALL_REGULAR')) return campaign;
 const resolved = await campaignOffers(campaign.id);
 return {...campaign, content_json:{...campaignContent(campaign.content_json), offers:[...resolved.offers, ...(campaign.content_json.offers || []).filter(o=>o.kind==='ADDON')]}};
}
