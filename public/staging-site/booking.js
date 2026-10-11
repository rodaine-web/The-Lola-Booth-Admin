(() => {
 'use strict';
 const form=document.querySelector('[data-multi-booking]');if(!form)return;
 const base=String(window.LOLA_CONFIG?.apiBase||'').replace(/\/$/,'');
 const esc=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const money=value=>value==null?'Custom quote':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
 const definitions=[
  {key:'glam',name:'The LOLA Glam',category:'DSLR PHOTO BOOTH',image:'assets/booking-glam.png',description:'Our signature DSLR photo booth delivers beautiful, studio-quality photos with a polished editorial look. Perfect for weddings, birthdays, corporate events and brand activations.'},
  {key:'360',name:'The LOLA 360',category:'360° VIDEO BOOTH',image:'assets/booking-360.png',description:'Our 360-degree video booth captures dynamic, shareable videos from every angle, bringing energy and excitement to your celebration.'},
  {key:'vogue',name:'The LOLA Vogue',category:'CUSTOMIZABLE MAGAZINE PHOTO BOX',image:'assets/vogue.jpg',description:'Step into the spotlight with our customizable magazine-style photo box featuring a professional DSLR camera. Create editorial-inspired portraits and branded magazine moments.'},
  {key:'audio',name:'The LOLA Guestbook',category:'AUDIO GUESTBOOK',image:'assets/audio.jpg',description:'Capture the voices and memories of your guests. Friends and family leave personal recorded messages that become a keepsake long after the event.'}
 ];
 let catalog={experiences:[],packages:[],addons:[]},chosen=new Map(),addons=new Map(),expanded=false,ready=false,busy=false,submissionId=crypto.randomUUID();
 const el=selector=>form.querySelector(selector);
 const addonImages={'Audio Guestbook':'audio','Guestbook':'guestbook','Premium Backdrop':'backdrop','Data Capture':'data','Custom Signage':'signage','Extra Hour':'hours','Additional Prints':'prints','Rush Delivery':'rush','Branding':'branding','Travel':'travel'};
 function eligible(addon){const keys=[...chosen.keys()],name=addon.name.toLowerCase();if(/audio.*guestbook/.test(name)&&keys.includes('audio'))return false;if(/print|guestbook/.test(name)&&!/audio/.test(name)&&!keys.includes('glam'))return false;if(/backdrop/.test(name)&&!keys.some(x=>['glam','vogue'].includes(x)))return false;return keys.length>0;}
 function custom(pkg){return pkg.pricing_mode==='CUSTOM'||/custom/i.test(pkg.website_key||pkg.name);}
 function renderExperiences(){
  const active=document.activeElement;const focusKey=active?.dataset?.experience?'[data-experience="'+active.dataset.experience+'"]':active?.dataset?.experiencePackage?'[data-experience-package="'+active.dataset.experiencePackage+'"]':null;
  el('[data-booking-experiences]').innerHTML=definitions.map(def=>{
   const experience=catalog.experiences.find(x=>x.key===def.key&&catalog.packages.some(p=>p.experience_id===x.id)),options=catalog.packages.filter(x=>x.experience_id===experience?.id),selection=chosen.get(def.key),pkg=options.find(x=>x.id===selection?.packageId),available=!!experience&&options.length>0;
   return `<article class="booking-experience-card"><img src="${def.image}" alt="${esc(def.name)} equipment" width="400" height="500" loading="lazy"><div class="booking-card-body"><label><input data-experience="${def.key}" type="checkbox" ${selection?'checked':''} ${available?'':'disabled'}> Add ${esc(def.name)} to my event</label><h3>${esc(def.name)}</h3><strong class="booking-category">${esc(def.category)}</strong><p>${esc(def.description)}</p><label>Package for ${esc(def.name)}<select data-experience-package="${def.key}" ${selection?'':'disabled'} ${selection?'required':''}><option value="">Select a package</option>${options.map(x=>`<option value="${esc(x.id)}" ${pkg?.id===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><small>${available?'Check the box above to choose a package.':'Packages are currently unavailable. Please contact LOLA.'}</small>${pkg&&custom(pkg)?`<label>Your custom requirements<textarea data-custom-notes="${def.key}" maxlength="1500">${esc(selection.customNotes||'')}</textarea></label>`:''}<details><summary>View package details →</summary>${pkg?`<p><strong>${esc(pkg.name)}</strong> · ${custom(pkg)?'Custom quote':money(pkg.starting_price)}</p>${pkg.duration?`<p>Duration: ${esc(pkg.duration)} hours</p>`:''}<p>${esc(pkg.website_short_description||'')}</p><ul>${(pkg.website_features?.length?pkg.website_features:pkg.items||[]).map(x=>`<li>${esc(typeof x==='string'?x:x.label)}</li>`).join('')}</ul>${custom(pkg)?'<p>Tell us what you need. A personalized quote will be prepared.</p>':''}`:'<p>Select a package to view its catalog details.</p>'}</details></div></article>`;
  }).join('');
  if(focusKey)el(focusKey)?.focus();
 }
 function renderAddons(){
  const eligibleItems=catalog.addons.filter(eligible);for(const id of addons.keys())if(!eligibleItems.some(x=>x.id===id))addons.delete(id);
  const card=item=>`<article class="booking-addon-card">${addonImages[item.name]?`<img src="assets/booking-addon-${addonImages[item.name]}.jpg" alt="${esc(item.name)} illustration" width="1536" height="1024" loading="lazy">`:'<div class="booking-asset-pending" role="img" aria-label="Illustration unavailable">Image coming soon</div>'}<label><input data-addon="${esc(item.id)}" type="checkbox" ${addons.has(item.id)?'checked':''}><span><strong>${esc(item.name)}</strong><br>${item.pricing_type==='CUSTOM'?'Custom quote':money(item.price)}${item.pricing_type==='PER_HOUR'?' / hour':''}</span></label><p>${esc(item.description||'')}</p>${addons.has(item.id)&&['PER_HOUR','PER_GUEST'].includes(item.pricing_type)?`<label>Quantity for ${esc(item.name)}<input type="number" data-addon-quantity="${esc(item.id)}" value="${addons.get(item.id)}" min="1" max="24" required></label>`:''}</article>`;
  el('[data-booking-addons]').innerHTML=eligibleItems.slice(0,6).map(card).join('')||'<p>Choose an experience to see eligible add-ons.</p>';
  el('[data-booking-more-addons]').innerHTML=eligibleItems.slice(6).map(card).join('');el('[data-booking-more-addons]').hidden=!expanded;
  const more=el('[data-more-addons]');more.hidden=eligibleItems.length<=6;more.textContent=expanded?'− Show fewer add-ons':`+ View More Add-ons (${Math.max(0,eligibleItems.length-6)} more options)`;more.setAttribute('aria-expanded',String(expanded));
 }
 function summary(){
  const rows=[...chosen].map(([key,item])=>{const pkg=catalog.packages.find(x=>x.id===item.packageId);return `<p><strong>${esc(definitions.find(x=>x.key===key).name)}</strong> — ${pkg?esc(pkg.name):'Choose a package'}${pkg?' · '+(custom(pkg)?'Custom quote':money(pkg.starting_price)):''}</p>`;});
  const extras=[...addons].map(([id,quantity])=>{const item=catalog.addons.find(x=>x.id===id);return `<p>${esc(item.name)} × ${quantity} · ${item.pricing_type==='CUSTOM'?'Custom quote':money(Number(item.price)*quantity)}</p>`;});
  el('[data-booking-summary]').innerHTML=rows.length?rows.join('')+(extras.length?'<h3>Selected add-ons</h3>'+extras.join(''):''):'Select an experience to start your request.';
 }
 form.addEventListener('input',event=>{
  const target=event.target;
  if(target.dataset.addonQuantity){addons.set(target.dataset.addonQuantity,Number(target.value));summary();}
  if(target.dataset.customNotes&&chosen.has(target.dataset.customNotes))chosen.get(target.dataset.customNotes).customNotes=target.value;
 });
 form.addEventListener('change',event=>{
  const target=event.target;
  if(target.dataset.experience){const key=target.dataset.experience;target.checked?chosen.set(key,{experienceId:catalog.experiences.find(x=>x.key===key&&catalog.packages.some(p=>p.experience_id===x.id)).id,packageId:''}):chosen.delete(key);renderExperiences();renderAddons();}
  if(target.dataset.experiencePackage){const item=chosen.get(target.dataset.experiencePackage);if(item){item.packageId=target.value;item.customNotes='';renderExperiences();renderAddons();}}
  if(target.dataset.customNotes)chosen.get(target.dataset.customNotes).customNotes=target.value;
  if(target.dataset.addon){target.checked?addons.set(target.dataset.addon,1):addons.delete(target.dataset.addon);renderAddons();}
  if(target.dataset.addonQuantity)addons.set(target.dataset.addonQuantity,Number(target.value));
  summary();
 });
 el('[data-more-addons]').addEventListener('click',()=>{expanded=!expanded;renderAddons();});
 async function loadCatalog(){
  ready=false;el('button[type=submit]').disabled=true;el('[data-catalog-retry]').hidden=true;
  try {if(!/^https:\/\//.test(base)&&!/^http:\/\/(localhost|127\.0\.0\.1):/.test(base))throw new Error('Catalog unavailable');const response=await fetch(base+'/api/public/booking-catalog',{headers:{Accept:'application/json'},cache:'no-store'});if(!response.ok)throw new Error('Catalog unavailable');catalog=await response.json();ready=true;renderExperiences();renderAddons();summary();el('[data-catalog-status]').textContent='Choose available catalog packages. Pricing will be confirmed in your quote.';}
  catch {el('[data-catalog-status]').textContent='We couldn’t load available options. Please retry or contact LOLA.';el('[data-catalog-retry]').hidden=false;}
  el('button[type=submit]').disabled=!ready;
 }
 el('[data-catalog-retry]').addEventListener('click',loadCatalog);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!ready)return;
  const status=el('[data-form-status]');status.className='';
  if(!chosen.size){status.textContent='Choose at least one experience and its package.';status.focus();return;}
  if([...chosen.values()].some(x=>!x.packageId)){status.textContent='Choose a package for every selected experience.';status.focus();return;}
  if(!form.reportValidity())return;
  const payload=Object.fromEntries(new FormData(form));payload.guestCount=Number(payload.guestCount);payload.marketing_email_opt_in=el('[name=marketing_email_opt_in]').checked;payload.formKind='BOOKING';payload.form_id='availability';payload.bookingVersion=2;payload.submissionId=submissionId;payload.selections=[...chosen.values()].map(x=>({...x}));payload.addons=[...addons].map(([addonId,quantity])=>({addonId,quantity}));payload.landing_page_url=location.origin+location.pathname;
  try {for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']){const value=sessionStorage.getItem('lola_'+key);if(value)payload[key]=value;}payload.referrer_url=sessionStorage.getItem('lola_referrer_url')||document.referrer||'';}catch{}
  const button=el('button[type=submit]');busy=true;button.disabled=true;button.textContent='Submitting…';status.textContent='';
  try {const response=await fetch(base+'/api/public/inquiries',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({}));if(!response.ok){const fields=data.error?.details?.fieldErrors;const guidance=fields?Object.entries(fields).map(([key,values])=>`${key}: ${values.join(' ')}`).join(' '):'';throw new Error(response.status===429?'We’re receiving too many requests right now. Please wait a little and try again.':guidance||data.error?.message||'We couldn’t submit your request right now. Your information is still here. Please try again.');}status.className='success';status.textContent='Your Request Has Been Submitted! Thank you for choosing The LOLA Booth. We’ve received your event details and selected experiences. Our team will review availability and contact you with the next steps. Your date is not reserved yet.';form.reset();chosen.clear();addons.clear();submissionId=crypto.randomUUID();renderExperiences();renderAddons();summary();}
  catch(error){status.textContent=error.message;}
  finally {busy=false;button.disabled=false;button.textContent='Submit Request →';status.focus();}
 });
 renderExperiences();renderAddons();loadCatalog();
})();
