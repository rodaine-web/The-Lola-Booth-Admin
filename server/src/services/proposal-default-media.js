import fs from 'node:fs';
import {isCorporateEvent,proposalPhotoName} from '../../../shared/proposal-imagery.js';

// Reviewed fixed assets only. Freeze at composition; issued snapshots stay unchanged.
const photo=name=>({dataUri:'data:image/jpeg;base64,'+fs.readFileSync(new URL(`../../../public/brand/proposals/approved/${name}.jpg`,import.meta.url)).toString('base64'),source:'LOLA approved photo: '+name});
export function freezeDefaultProposalMedia(scenario){
 const business=scenario.audience==='BUSINESS'||isCorporateEvent(scenario.eventType)||isCorporateEvent(scenario.variables?.event_type);
 const wedding=!business&&scenario.eventType==='Wedding';
 const selected=(scenario.experiences||[]).map(item=>proposalPhotoName(item.key||item.name,scenario.eventType,business?'BUSINESS':'CELEBRATION')).filter(Boolean);
 // A business cover demonstrates the selected experience, never a generic social booth.
 // Virtual-only proposals use the approved laptop example throughout.
 const virtualOnly=selected.length>0&&selected.every(name=>name==='virtual');
 const slots=virtualOnly?{cover:'virtual',event:'virtual',why:'virtual'}:business?{cover:selected[0],event:selected[1]||selected[0],why:selected[0]}:wedding?{cover:'wedding-cover',event:'wedding-event',why:'wedding-why'}:{cover:'celebration',event:'celebration',why:'celebration'};
 scenario.mediaImages ||= {};
 for(const [slot,name] of Object.entries(slots))if(name&&!scenario.mediaImages[slot]?.length)scenario.mediaImages[slot]=[photo(name)];
 for(const item of scenario.experiences||[]){
  const slot='experience:'+item.experience_id;
  if(scenario.mediaImages[slot]?.length)continue;
  const name=proposalPhotoName(item.key||item.name,scenario.eventType,business?'BUSINESS':'CELEBRATION');
  if(name)scenario.mediaImages[slot]=[photo(name)];
  else if(item.key==='audio')scenario.mediaImages[slot]=[{dataUri:'data:image/jpeg;base64,'+fs.readFileSync(new URL('../../../public/brand/proposals/audio.jpg',import.meta.url)).toString('base64'),source:'LOLA catalog illustration: audio'}];
  // Unknown experiences have no guessed Glam or wedding imagery.
 }
 return scenario;
}
