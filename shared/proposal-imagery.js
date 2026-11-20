export function isCorporateEvent(value=''){
 return /corporate|business|brand|activation|campaign|conference|trade[\s_-]*show|product[\s_-]*launch|company[\s_-]*celebration|professional/i.test(String(value));
}
export function proposalAudience(input={}){
 return String(input.customer_type||input.customerType||'').toUpperCase()==='BUSINESS'||isCorporateEvent(input.event_type)||isCorporateEvent(input.event_details?.event_type)||isCorporateEvent(input.proposal_type)?'BUSINESS':'CELEBRATION';
}
export function proposalImageKey(value=''){
 const name=String(value).toLowerCase();
 return ['virtual','mirror','360','vogue','audio','digital','glam'].find(k=>name.includes(k))||null;
}
export function proposalPhotoName(key,eventType='',audience){
 const experience=proposalImageKey(key);if(!experience||experience==='audio')return null;
 if(experience==='virtual')return 'virtual';
 if(experience!=='digital'&&/brand|activation|campaign|product[\s_-]*launch/i.test(eventType))return 'activation-'+experience;
 if(experience==='digital')return audience==='BUSINESS'||isCorporateEvent(eventType)?null:'digital';
 return (audience==='BUSINESS'||isCorporateEvent(eventType)?'corporate-':'natural-')+experience;
}
export function proposalExperienceImage(key,eventType=''){
 const experience=proposalImageKey(key);if(!experience)return null;
 if(experience==='audio')return '/brand/proposals/audio.jpg';
 const name=proposalPhotoName(key,eventType);return name?'/brand/proposals/approved/'+name+'.jpg':null;
}
