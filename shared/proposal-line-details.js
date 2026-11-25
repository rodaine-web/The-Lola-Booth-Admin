import {packageEntitlementLabels} from './package-entitlements.js';
const text=value=>typeof value==='string'?value.trim():'';
export function proposalLineDetail(line,{experiences=[],entitlements=[],addons=[]}={}){
 const supplied=text(line.detail)||text(line.secondary_description)||text(line.notes);if(supplied)return supplied;
 const experience=experiences.find(e=>e.experience_id===line.experience_id||(e.packages||[]).some(p=>p.package_id===line.package_id));
 const pkg=experience?.packages?.find(p=>p.package_id===line.package_id),entitlement=entitlements.find(p=>p.packageId===line.package_id);
 if(['PACKAGE','EXPERIENCE_SELECTED','EXPERIENCE'].includes(line.type)){const summary=text(pkg?.description)||text(experience?.description),labels=entitlement?packageEntitlementLabels(entitlement).filter(label=>!summary.toLowerCase().includes(label.toLowerCase())):[];return [summary,labels.join('; ')].filter(Boolean).join(' · ')||'Rental of the selected experience for the package and service period specified in this proposal.';}
 if(line.type==='ADDON')return text(addons.find(a=>a.id===line.addon_id)?.description)||'Selected event enhancement, supplied in the quantity shown and subject to the agreed event scope.';
 if(line.type==='PRINT_UPGRADE')return 'Additional physical print allowance beyond the prints included in the selected package.';
 if(line.type==='EXTRA_HOURS')return `${line.quantity} additional service hour${Number(line.quantity)===1?'':'s'} for the selected experience.`;
 if(line.type==='SETUP')return 'One-time setup and configuration of the selected experience.';
 if(line.type==='TRAVEL')return 'Event transport and logistics for the agreed venue and service schedule.';
 if(line.type==='OTHER')return 'Additional event charges as agreed for this quotation.';
 return 'Selected service or product in the quantity shown; its scope is specified in this proposal.';
}
