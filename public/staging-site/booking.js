(() => {
 'use strict';
 const form=document.querySelector('[data-multi-booking]');if(!form)return;
 const base=String(window.LOLA_CONFIG?.apiBase||'').replace(/\/$/,'');
 const esc=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const money=value=>value==null?'Custom quote':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
 const definitions=[
 {key:'glam',name:'The Lola Glam',category:'DSLR PHOTO BOOTH',image:'assets/booking-glam.png',description:'A modern, professional photo booth experience.'},
 {key:'360',name:'The Lola 360',category:'360° VIDEO EXPERIENCE',image:'assets/redesign-360-device.jpg',description:'A cinematic 360° video experience.'},
 {key:'mirror',name:'The Lola Magic Mirror',category:'INTERACTIVE MIRROR',image:'assets/redesign-mirror-device.jpg',description:'An interactive, full-length mirror experience.'},
 {key:'vogue',name:'The Lola Vogue',category:'EDITORIAL PHOTO EXPERIENCE',image:'assets/redesign-vogue-device.jpg',description:'A fashion-forward editorial photo experience.'}
 ];
 let catalog={experiences:[],packages:[],addons:[]},chosen=new Map(),addons=new Map(),expanded=false,ready=false,busy=false,submissionId=crypto.randomUUID();
 const el=selector=>form.querySelector(selector);
 const businessEvents=['Corporate Event','Conference','Brand Activation','Product Launch','Trade Show','Company Celebration','Other Business Event'];
 const eventType=el('[name=eventType]');let individualEvents=eventType.innerHTML;
 function business(){return el('[name=customerType]').value==='BUSINESS';}
 function catalogGuidance(){return business()?'Select experiences and optional add-ons. We’ll curate your custom proposal.':'Choose available catalog packages. Pricing will be confirmed in your quote.';}
 function submitLabel(){return business()?'Request a Quote →':'Submit Request →';}
 function updateMode(){document.querySelectorAll('[data-customer-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.customerChoice===el('[name=customerType]').value)));if(ready)el('[data-catalog-status]').textContent=catalogGuidance();const current=eventType.value;if(business()){if(!eventType.hasAttribute('data-business-event-types'))individualEvents=eventType.innerHTML;eventType.setAttribute('data-business-event-types','');eventType.innerHTML='<option value="">Select business event type</option>'+businessEvents.map(x=>'<option>'+x+'</option>').join('');eventType.value=businessEvents.includes(current)?current:'';}else if(eventType.hasAttribute('data-business-event-types')){eventType.removeAttribute('data-business-event-types');eventType.innerHTML=individualEvents;eventType.value='';}el('[data-business-company]').hidden=!business();el('[data-booking-selection-help]').textContent=business()?'Choose the experiences you’re interested in. We’ll curate a custom package for your business event.':'Select one or more experiences for your event. Each experience has its own package. ';el('button[type=submit]').textContent=submitLabel();el('[data-booking-price-help]').textContent=business()?'We’ll review your preferences and send a proposal with pricing.':'Starting prices are estimates. Availability, custom services and the final quote will be confirmed by LOLA.';}

 function eligible(addon){if(addon.pricing_policy){const policy=addon.pricing_policy;return (business()||!['PRINTS','EXTRA_HOURS','TRAVEL'].includes(policy.category))&&[...chosen].some(([key,item])=>policy.experiences.includes(key)&&!catalog.packages.find(p=>p.id===item.packageId)?.pricing_profile?.includedAddonKeys?.includes(policy.key));}const keys=[...chosen.keys()],name=addon.name.toLowerCase();if(/audio.*guestbook/.test(name)&&keys.includes('audio'))return false;if(/print|guestbook/.test(name)&&!/audio/.test(name)&&!keys.includes('glam'))return false;if(/backdrop/.test(name)&&!keys.some(x=>['glam','vogue'].includes(x)))return false;return keys.length>0;}
 function custom(pkg){return pkg.pricing_mode==='CUSTOM'||/custom/i.test(pkg.website_key||pkg.name);}
 function renderExperiences(){
  const active=document.activeElement;const focusKey=active?.dataset?.experience?'[data-experience="'+active.dataset.experience+'"]':active?.dataset?.experiencePackage?'[data-experience-package="'+active.dataset.experiencePackage+'"]':null;
  el('[data-booking-experiences]').innerHTML=definitions.map(def=>{
   const experience=catalog.experiences.find(x=>x.key===def.key&&(business()||catalog.packages.some(p=>p.experience_id===x.id))),options=catalog.packages.filter(x=>x.experience_id===experience?.id&&(!catalog.pricingVersion||x.catalog_key==='STANDARD'||x.pricing_profile?.quoteRequired)),selection=chosen.get(def.key),pkg=options.find(x=>x.id===selection?.packageId),available=!!experience&&options.length>0;
   if(business())return `<article class="booking-experience-card">${window.lolaExperiencePicture&&def.key!=='audio'?window.lolaExperiencePicture(def.key,'booking'):`<img src="${def.image}" alt="${esc(def.name)} equipment">`}<div class="booking-card-body"><label><input data-experience="${def.key}" type="checkbox" ${selection?'checked':''} ${experience?'':'disabled'}> Add ${esc(def.name)} to my event</label><h3>${esc(def.name)}</h3><strong>${esc(def.category)}</strong><p>${esc(def.description)}</p></div></article>`;
   return `<article class="booking-experience-card">${window.lolaExperiencePicture&&def.key!=='audio'?window.lolaExperiencePicture(def.key,'booking'):`<img src="${def.image}" alt="${esc(def.name)} equipment">`}<div class="booking-card-body"><label><input data-experience="${def.key}" type="checkbox" ${selection?'checked':''} ${available?'':'disabled'}> Add ${esc(def.name)} to my event</label><h3>${esc(def.name)}</h3><strong class="booking-category">${esc(def.category)}</strong><p>${esc(def.description)}</p><label>Package for ${esc(def.name)}<select data-experience-package="${def.key}" ${selection?'':'disabled'} ${selection?'required':''}><option value="">Select a package</option>${options.map(x=>`<option value="${esc(x.id)}" ${pkg?.id===x.id?'selected':''}>${esc(x.pricing_profile?.tier||x.name)}${!business()&&!custom(x)?' — '+money(x.starting_price):''}</option>`).join('')}</select></label><small>${available?'Check the box above to choose a package.':'Packages are currently unavailable. Please contact LOLA.'}</small>${pkg&&custom(pkg)?`<label>Your custom requirements<textarea data-custom-notes="${def.key}" maxlength="1500">${esc(selection.customNotes||'')}</textarea></label>`:''}<details><summary>View package details →</summary>${pkg?`<p><strong>${esc(pkg.name)}</strong>${business()?'':' · '+(custom(pkg)?'Custom quote':money(pkg.starting_price))}</p>${pkg.duration?`<p>Duration: ${esc(pkg.duration)} hours</p>`:''}<p>${esc(pkg.website_short_description||'')}</p><ul>${(pkg.website_features?.length?pkg.website_features:pkg.items||[]).map(x=>`<li>${esc(typeof x==='string'?x:x.label)}</li>`).join('')}</ul>${custom(pkg)?'<p>Tell us what you need. A personalized quote will be prepared.</p>':''}`:'<p>Select a package to view its catalog details.</p>'}</details></div></article>`;
  }).join('');
  if(focusKey)el(focusKey)?.focus();
 }
 function renderAddons(){
  const eligibleItems=catalog.addons.filter(eligible);for(const id of addons.keys())if(!eligibleItems.some(x=>x.id===id))addons.delete(id);
  const card=item=>`<article class="booking-addon-card"><img src="${window.lolaAddonImage(item)}" alt="${esc(item.name)} illustration" width="1536" height="1024" loading="lazy"><label><input data-addon="${esc(item.id)}" type="checkbox" ${addons.has(item.id)?'checked':''}><span><strong>${esc(item.name)}</strong>${business()?'':'<br>'+(item.pricing_type==='CUSTOM'?'Custom quote':money(item.price))+(item.pricing_type==='PER_HOUR'?' / hour':'')}</span></label><p>${business()?'':esc(item.description||'')}</p>${addons.has(item.id)&&(item.pricing_policy?.maxQuantity>1||['PER_HOUR','PER_GUEST','PER_UNIT'].includes(item.pricing_type))?`<label>Quantity for ${esc(item.name)}<input type="number" data-addon-quantity="${esc(item.id)}" value="${addons.get(item.id)}" min="1" max="${item.pricing_policy?.maxQuantity||24}" required></label>`:''}</article>`;
  el('[data-booking-addons]').innerHTML=eligibleItems.slice(0,6).map(card).join('')||'<p>Choose an experience to see eligible add-ons.</p>';
  el('[data-booking-more-addons]').innerHTML=eligibleItems.slice(6).map(card).join('');el('[data-booking-more-addons]').hidden=!expanded;
  const more=el('[data-more-addons]');more.hidden=eligibleItems.length<=6;more.textContent=expanded?'− Show fewer add-ons':`+ View More Add-ons (${Math.max(0,eligibleItems.length-6)} more options)`;more.setAttribute('aria-expanded',String(expanded));
 }
 function summary(){
  const rows=[...chosen].map(([key,item])=>{const pkg=catalog.packages.find(x=>x.id===item.packageId);return `<p><strong>${esc(definitions.find(x=>x.key===key).name)}</strong>${business()?'':' — '+(pkg?esc(pkg.name):'Choose a package')}${pkg&&!business()?' · '+(custom(pkg)?'Custom quote':money(pkg.starting_price)):''}</p>`;});
  const extras=[...addons].map(([id,quantity])=>{const item=catalog.addons.find(x=>x.id===id);return `<p>${esc(item.name)} × ${quantity}${business()?'':' · '+(item.pricing_type==='CUSTOM'?'Custom quote':money(Number(item.price)*quantity))}</p>`;});
  el('[data-booking-summary]').innerHTML=rows.length?rows.join('')+(extras.length?'<h3>Selected add-ons</h3>'+extras.join(''):''):'Select an experience to start your request.';
  if(!business()&&rows.length){const ps=[...chosen.values()].map(s=>catalog.packages.find(p=>p.id===s.packageId)),as=[...addons].map(([id,quantity])=>({item:catalog.addons.find(a=>a.id===id),quantity}));const fixed=ps.every(p=>p&&!custom(p))&&as.every(({item})=>item.pricing_type!=='CUSTOM');const total=ps.reduce((n,p)=>n+Number(p?.starting_price||0),0)+as.reduce((n,a)=>n+Number(a.item.price||0)*a.quantity,0);el('[data-booking-summary]').innerHTML+='<div class="summary-next"><strong>'+ (fixed?'Estimated subtotal':'Custom quotation')+'</strong><h3>'+(fixed?money(total):'Request a Quote')+'</h3><p>Final pricing, applicable taxes and logistics will be confirmed in your proposal.</p></div>'; }
 }
 form.addEventListener('input',event=>{
  const target=event.target;
  if(target.dataset.addonQuantity){addons.set(target.dataset.addonQuantity,Number(target.value));summary();}
  if(target.dataset.customNotes&&chosen.has(target.dataset.customNotes))chosen.get(target.dataset.customNotes).customNotes=target.value;
 });
 form.addEventListener('change',event=>{
  const target=event.target;
  if(target.name==='customerType'){updateMode();renderExperiences();renderAddons();}
  if(target.dataset.experience){const key=target.dataset.experience;target.checked?chosen.set(key,{experienceId:catalog.experiences.find(x=>x.key===key&&(business()||catalog.packages.some(p=>p.experience_id===x.id))).id,packageId:''}):chosen.delete(key);renderExperiences();renderAddons();}
  if(target.dataset.experiencePackage){const item=chosen.get(target.dataset.experiencePackage);if(item){item.packageId=target.value;item.customNotes='';renderExperiences();renderAddons();}}
  if(target.dataset.customNotes)chosen.get(target.dataset.customNotes).customNotes=target.value;
  if(target.dataset.addon){const item=catalog.addons.find(x=>x.id===target.dataset.addon);if(target.checked&&['inflatable-enclosure','premium-enclosure'].includes(item?.pricing_policy?.key))for(const other of catalog.addons)if(other.id!==item.id&&['inflatable-enclosure','premium-enclosure'].includes(other.pricing_policy?.key))addons.delete(other.id);target.checked?addons.set(target.dataset.addon,1):addons.delete(target.dataset.addon);renderAddons();}
  if(target.dataset.addonQuantity)addons.set(target.dataset.addonQuantity,Number(target.value));
  summary();
 });
 el('[data-more-addons]').addEventListener('click',()=>{expanded=!expanded;renderAddons();});
 async function loadCatalog(){
  ready=false;el('button[type=submit]').disabled=true;el('[data-catalog-retry]').hidden=true;
  try {if(!/^https:\/\//.test(base)&&!/^http:\/\/(localhost|127\.0\.0\.1):/.test(base))throw new Error('Catalog unavailable');const response=await fetch(base+'/api/public/booking-catalog',{headers:{Accept:'application/json'},cache:'no-store'});if(!response.ok)throw new Error('Catalog unavailable');catalog=await response.json();
   const requested=new URLSearchParams(location.search);
   if(requested.get('customerType')==='BUSINESS')el('[name=customerType]').value='BUSINESS';
   if(requested.get('experience')==='audio'&&!definitions.some(d=>d.key==='audio'))definitions.push({key:'audio',name:'The Lola Audio Guestbook',category:'STANDALONE RENTAL',image:'assets/audio.jpg',description:'Flat $299 per event. Delivery or round-trip shipping quoted separately.'});
   if(requested.get('experience')){
    const experience=catalog.experiences.find(x=>x.key===requested.get('experience'));
    const pkg=catalog.packages.find(x=>x.id===requested.get('packageId')&&x.experience_id===experience?.id&&(!catalog.pricingVersion||x.catalog_key==='STANDARD'||x.pricing_profile?.quoteRequired));
    if(experience&&(pkg||requested.get('customerType')==='BUSINESS'))chosen.set(experience.key,{experienceId:experience.id,packageId:pkg?.id||'',customNotes:''});
   }
   if(business()&&requested.get('experiences'))for(const key of requested.get('experiences').split(',')){const x=catalog.experiences.find(x=>x.key===key);if(x&&definitions.some(d=>d.key===key))chosen.set(key,{experienceId:x.id,packageId:'',customNotes:''});}
   if(business()&&requested.get('addons'))for(const id of requested.get('addons').split(',')){const a=catalog.addons.find(a=>a.id===id);if(a&&eligible(a))addons.set(id,1);}
   updateMode();ready=true;renderExperiences();renderAddons();summary();el('[data-catalog-status]').textContent=catalogGuidance();}
  catch {el('[data-catalog-status]').textContent='We couldn’t load available options. Please retry or contact LOLA.';el('[data-catalog-retry]').hidden=false;}
  el('button[type=submit]').disabled=!ready;
 }
 el('[data-catalog-retry]').addEventListener('click',loadCatalog);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!ready)return;
  const status=el('[data-form-status]');status.className='';
  if(!chosen.size){status.textContent=business()?'Choose at least one experience.':'Choose at least one experience and its package.';status.focus();return;}
  if(!business()&&[...chosen.values()].some(x=>!x.packageId)){status.textContent='Choose a package for every selected experience.';status.focus();return;}
  if(!form.reportValidity())return;
  const payload=Object.fromEntries(new FormData(form));payload.guestCount=Number(payload.guestCount);payload.marketing_email_opt_in=el('[name=marketing_email_opt_in]').checked;payload.formKind='BOOKING';payload.form_id='availability';payload.bookingVersion=2;if(catalog.pricingVersion)payload.pricingVersion=catalog.pricingVersion;payload.eventCategory=business()?'CUSTOM_PRODUCTION':'PRIVATE_CELEBRATION';payload.catalogKey=business()?'CUSTOM':'STANDARD';payload.submissionId=submissionId;payload.selections=[...chosen.values()].map(x=>business()?{experienceId:x.experienceId}:{...x});payload.addons=[...addons].map(([addonId,quantity])=>({addonId,quantity}));payload.landing_page_url=location.origin+location.pathname;
  try {for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']){const value=sessionStorage.getItem('lola_'+key);if(value)payload[key]=value;}payload.referrer_url=sessionStorage.getItem('lola_referrer_url')||document.referrer||'';}catch{}
  const button=el('button[type=submit]');busy=true;button.disabled=true;button.textContent='Submitting…';status.textContent='';
  try {const response=await fetch(base+'/api/public/inquiries',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({}));if(!response.ok){const fields=data.error?.details?.fieldErrors;const guidance=fields?Object.entries(fields).map(([key,values])=>`${key}: ${values.join(' ')}`).join(' '):'';throw new Error(response.status===429?'We’re receiving too many requests right now. Please wait a little and try again.':guidance||data.error?.message||'We couldn’t submit your request right now. Your information is still here. Please try again.');}window.lolaTrackLeadConversion?.(data,submissionId);status.className='success';status.textContent=business()?'Your Quote Request Has Been Submitted! We’ve received your preferences. Our team will review your event and share a proposal with pricing. Your date is not reserved yet.':'Your Request Has Been Submitted! Thank you for choosing The LOLA Booth. We’ve received your event details and selected experiences. Our team will review availability and contact you with the next steps. Your date is not reserved yet.';form.reset();updateMode();chosen.clear();addons.clear();submissionId=crypto.randomUUID();renderExperiences();renderAddons();summary();}
  catch(error){status.textContent=error.message;}
  finally {busy=false;button.disabled=false;button.textContent=submitLabel();status.focus();}
 });
 window.addEventListener('lola:design-ready',()=>{renderExperiences();});
 updateMode();renderExperiences();renderAddons();loadCatalog();
})();
