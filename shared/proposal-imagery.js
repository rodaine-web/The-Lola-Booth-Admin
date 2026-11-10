export function isCorporateEvent(value=''){
 return /corporate|business|brand|activation|campaign|conference|trade\s*show|product\s*launch|company\s*celebration/i.test(String(value));
}
export function proposalExperienceImage(key,eventType=''){
 const match=String(key).toLowerCase();
 const experience=['mirror','360','vogue','audio','glam'].find(k=>match.includes(k))||'glam';
 if(experience==='audio')return '/brand/proposals/audio.jpg';
 return '/brand/proposals/approved/'+(isCorporateEvent(eventType)?'corporate-':'natural-')+experience+'.jpg';
}
