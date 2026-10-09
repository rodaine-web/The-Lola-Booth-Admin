export const PLANNING_MOODS=['Elegant','Glamorous','Modern','Minimal','Fun','Romantic','Corporate','Luxury','Bold','Custom'];
export const BACKDROP_COLLECTION=[['LOLA Ivory','CLASSIC'],['Midnight','CLASSIC'],['Champagne Glow','GLAM'],['Silver Luxe','GLAM'],['Modern Arch','MODERN'],['Garden Romance','FLORAL'],['Blush','CLASSIC'],['Emerald Luxe','GLAM'],['Celebration','MODERN'],['Studio White','CLASSIC']];
export function planningRequirements(experiences=[],printing=false){
 const requirements=new Set(['event_details','theme','colors']);
 for(const experience of experiences){
  const name=String(experience.name||experience).toLowerCase();
  if(/glam|photo|classic/.test(name))for(const key of ['backdrop','overlay','welcome_screen','assets',...(printing?['print_design']:[])])requirements.add(key);
  if(/360/.test(name))for(const key of ['video_overlay','intro_outro','music','assets','environment'])requirements.add(key);
  if(/vogue/.test(name))for(const key of ['display_messaging','assets','environment'])requirements.add(key);
  if(/audio|guestbook/.test(name))for(const key of ['greeting','phone_placement','signage'])requirements.add(key);
 }
 return [...requirements];
}
export function normalizedPlanningValue(key,value){
 const text=String(value??'').trim();
 return ['start_time','end_time'].includes(key)?text.slice(0,5):text;
}
export const CREATIVE_COMPONENTS=['overlay','welcome_screen','print_design','video_overlay','intro_outro','display_messaging','signage'];
export function requiredCreativeComponents(experiences=[],printing=false){
 return experiences.flatMap(experience=>planningRequirements([experience],printing).filter(key=>CREATIVE_COMPONENTS.includes(key)).map(component=>({experienceId:experience.id,experienceName:experience.name,component})));
}
export function creativeCoverage(required,proofs=[]){
 return required.map(item=>({...item,complete:proofs.some(proof=>proof.status==='APPROVED' && Number(proof.approved_version)===Number(proof.version) && !proof.deleted_at && proof.metadata?.components?.some(component=>component.experienceId===item.experienceId && component.component===item.component))}));
}
export const PLANNING_EVENT_FIELDS={event_name:'Event name',event_type:'Event type',event_date:'Event date',start_time:'Start time',end_time:'End time',venue_name:'Venue name',primary_contact_name:'Primary contact name',primary_contact_email:'Primary contact email',primary_contact_phone:'Primary contact phone'};
export const PLANNING_EXTRA_FIELDS={theme:'Event theme',music:'Music preference',environment:'Background / environment',display_messaging:'Display messaging',greeting:'Audio guestbook greeting / script',phone_placement:'Phone placement',signage:'Signage instructions'};
export function missingPlanningFields(brief={},requirements=[],hasBackdrop=false,assetCount=0){
 const missing=[];
 if(requirements.includes('event_details'))for(const [key,label] of Object.entries(PLANNING_EVENT_FIELDS))if(!String(brief[key]??'').trim())missing.push({key,label,step:0,message:`Enter ${label.toLowerCase()}.`});
 for(const [key,label] of Object.entries(PLANNING_EXTRA_FIELDS))if(requirements.includes(key)&&!String(brief[key]??'').trim())missing.push({key,label,step:1,message:`Enter ${label.toLowerCase()}.`});
 if(requirements.includes('colors')&&!brief.colors?.length)missing.push({key:'colors',label:'Event colors',step:1,message:'Add at least one event color.'});
 if(requirements.includes('backdrop')&&!hasBackdrop)missing.push({key:'backdrop',label:'Backdrop',step:2,message:'Select a collection backdrop, your own artwork, or a custom design.'});
 if(requirements.includes('assets')&&!assetCount&&brief.assets_not_required!==true)missing.push({key:'assets',label:'Client assets',step:3,message:'Upload an asset or confirm that no logos or other assets are needed.'});
 return missing;
}
export function planningCompletion(brief,requirements,hasBackdrop,assetCount){
 const items=[['event_details',['event_name','event_type','event_date','start_time','end_time','venue_name','primary_contact_name','primary_contact_email','primary_contact_phone'].every(key=>Boolean(brief[key]?.trim()))],['theme',Boolean(brief.theme)],['colors',Boolean(brief.colors?.length)],['backdrop',hasBackdrop],['assets',assetCount>0||brief.assets_not_required===true],...['music','environment','display_messaging','greeting','phone_placement','signage'].map(key=>[key,Boolean(brief[key]?.trim())])];
 return items.filter(([key])=>requirements.includes(key)).map(([key,complete])=>({key,complete}));
}
export function validPlanningUpload(buffer,mimeType){
 if(!buffer?.length||buffer.length>8*1024*1024)return false;
 if(mimeType==='image/png')return buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mimeType==='image/jpeg')return buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
 if(mimeType==='application/pdf')return buffer.subarray(0,5).toString()==='%PDF-';
 return false;
}
