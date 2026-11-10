import fs from 'node:fs';
import {isCorporateEvent} from '../../../shared/proposal-imagery.js';

// Reviewed customer-supplied photographs. Fixed paths only; no remote downloads.
// Embed once when generating the snapshot so sent/accepted proposals remain fixed.
const photo=name=>({dataUri:'data:image/jpeg;base64,'+fs.readFileSync(new URL(`../../../public/brand/proposals/approved/${name}.jpg`,import.meta.url)).toString('base64'),source:'LOLA approved photo: '+name});
export function freezeDefaultProposalMedia(scenario){
 const wedding=scenario.eventType==='Wedding';
 const business=isCorporateEvent(scenario.eventType)||isCorporateEvent(scenario.variables?.event_type);
 const slots=wedding?{cover:'wedding-cover',event:'wedding-event',why:'wedding-why'}:business?{cover:'digital',event:'brand-event',why:'brand-event'}:{cover:'celebration',event:'brand-event',why:'celebration'};
 scenario.mediaImages ||= {};
 for(const [slot,name] of Object.entries(slots))if(!scenario.mediaImages[slot]?.length)scenario.mediaImages[slot]=[photo(name)];
 for(const item of scenario.experiences){
  const slot='experience:'+item.experience_id;
  if(!scenario.mediaImages[slot]?.length&&(!item.visuals?.hero||business)&&['glam','digital','360','mirror','vogue','audio'].includes(item.key))scenario.mediaImages[slot]=['glam','digital','360','mirror','vogue'].includes(item.key)?[photo((business?'corporate-':'natural-')+(item.key==='digital'?'glam':item.key))]:['audio'].includes(item.key)?[{dataUri:'data:image/jpeg;base64,'+fs.readFileSync(new URL(`../../../public/brand/proposals/${item.key}.jpg`,import.meta.url)).toString('base64'),source:'LOLA catalog illustration: '+item.key}]:[photo(item.key)];
 }
 return scenario;
}
