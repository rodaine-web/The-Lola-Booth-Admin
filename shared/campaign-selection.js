const key=p=>p.campaign_id?`${p.campaign_id}:${p.campaign_offer_key}`:null;
// Replacing one part of a bundle removes the whole previous bundle, so proposals
// never retain an orphaned campaign component or charge a bundle twice.
export function withoutCampaignBundle(current,experienceId){
 const target=current.find(s=>s.experience_id===experienceId);
 const keys=new Set((target?.packages||[]).map(key).filter(Boolean));
 return current.filter(s=>s.experience_id===experienceId||!(s.packages||[]).some(p=>keys.has(key(p)))).map(s=>s.experience_id===experienceId?{...s,packages:(s.packages||[]).filter(p=>!p.campaign_id)}:s);
}
export function mergeCampaignSelections(current,offer){
 const ids=new Set(offer.selections.map(s=>s.experience_id));
 let retained=current;
 for(const id of ids)retained=withoutCampaignBundle(retained,id);
 return [...retained.filter(s=>!ids.has(s.experience_id)),...offer.selections];
}
export function removeCampaignExperience(current,experienceId){
 return withoutCampaignBundle(current,experienceId).filter(s=>s.experience_id!==experienceId);
}
