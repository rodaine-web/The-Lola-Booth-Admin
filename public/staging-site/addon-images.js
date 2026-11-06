(() => {
 'use strict';
 const keys={'extra-glam-hour':'hours','extra-360-hour':'hours','extra-vogue-hour':'hours','red-carpet':'backdrop','creative-design':'branding','branded-sharing':'branding','lead-capture':'data','engagement-report':'data','print-station':'prints','audio-phone':'audio','audio-styling':'audio','postcard-setup':'signage','postcard-mailing':'prints','travel':'travel','overnight':'travel'};
 window.lolaAddonImage=item=>{
  const key=item.pricing_policy?.key;
  if(key==='attendant'||item.pricing_policy?.category==='STAFF')return 'assets/corporate.jpg';
  let image=keys[key];
  if(!image){const name=String(item.name||'').toLowerCase();image=/audio|phone/.test(name)?'audio':/guestbook/.test(name)?'guestbook':/print|postcard|postage/.test(name)?'prints':/hour|idle|setup/.test(name)?'hours':/backdrop|carpet|floral/.test(name)?'backdrop':/data|capture|report/.test(name)?'data':/sign|design/.test(name)?'signage':/rush|delivery/.test(name)?'rush':/travel|logistic/.test(name)?'travel':'branding';}
  return 'assets/booking-addon-'+image+'.jpg';
 };
})();
