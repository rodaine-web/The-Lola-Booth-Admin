(() => {
 'use strict';
 const base=String(window.LOLA_CONFIG?.apiBase||'').replace(/\/$/,'');
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(value));
 async function load(){
  try{
   const response=await fetch(base+'/api/public/pricing-catalog',{cache:'no-store'});
   if(response.status===404)return;
   if(!response.ok)throw Error('Package pricing is temporarily unavailable. Please contact LOLA for a quote.');
   const data=await response.json();window.lolaVersionedPricingActive=true;
   const tabs=document.querySelector('.experience-tabs');if(!tabs)return;
   const navigation=document.createElement('div');navigation.className='experience-tabs';navigation.setAttribute('aria-label','Package catalogs');
   const catalogs=[['STANDARD','Private & company celebrations'],['PROFESSIONAL','Conferences & professional events'],['ACTIVATION','Brand activations & campaigns']];
   navigation.innerHTML=catalogs.map(([key,label],i)=>`<button type="button" class="experience-tab ${i?'':'active'}" aria-pressed="${i?'false':'true'}" data-pricing-catalog="${key}">${label}</button>`).join('');tabs.before(navigation);
   // Preserve the approved Custom card copy while the published catalog supplies priced tiers.
   const customCards=new Map(Array.from(document.querySelectorAll('[data-experience-panel]')).map(panel=>[panel.dataset.experiencePanel,panel.querySelector('[data-package-key$=":custom"]')?.outerHTML]));
   function customHref(experience,pkg){return 'availability.html?'+new URLSearchParams({eventCategory:'CUSTOM_PRODUCTION',experience,packageId:pkg.id});}
   function render(key){
    navigation.querySelectorAll('button').forEach(button=>{const active=button.dataset.pricingCatalog===key;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    document.querySelectorAll('[data-experience-panel]').forEach(panel=>{
     const experience=panel.dataset.experiencePanel,grid=panel.querySelector('.pricing-grid');
     const rows=data.packages.filter(p=>p.catalog_key===key&&p.pricing_profile.experience===experience);
     grid.innerHTML=rows.filter(p=>!p.pricing_profile.quoteRequired).map(p=>{const x=p.pricing_profile;const features=[x.serviceHours?`${x.serviceHours} active service hours`:x.rentalHours?`Up to ${x.rentalHours} rental hours`:'Rental scope confirmed in your quote',...(experience==='audio'?[x.phones?`${x.phones} recording phone${x.phones>1?'s':''}`:'Recording deliverables as agreed','Custom greeting included']:['Unlimited digital sessions during service hours',`${x.prints} physical prints included`,`${x.designs} creative design${x.designs===1?'':'s'}`]),x.backdrop?`${x.backdrop==='PREMIUM'?'Premium':'Standard'} backdrop`:null,x.enclosure?'Magazine enclosure included':null,x.digitalSharing?'Digital sharing included':null,`Travel within Chicago${x.travelMinutes?` + ${x.travelMinutes} minutes beyond city limits`:''} included`,x.reporting?`${x.reporting.toLowerCase()} engagement reporting`:null].filter(Boolean);return `<article class="pricing-card${p.most_popular?' featured':''}">${p.most_popular?'<div class="pricing-badge">Most Popular</div>':''}<h3>${escape(x.tier)}</h3><div class="starting">${x.quoteRequired?'Approved quote required':x.startingAt?'Starting at':'Package price'}</div><div class="price">${p.starting_price===null?'Custom quote':money(p.starting_price)}</div><hr><ul>${features.map(text=>`<li>${escape(text)}</li>`).join('')}</ul>${x.deliveryApprovalRequired?'<p>Final delivery scope and timing require approval before booking.</p>':''}<p>Tax is calculated separately using your billing address. Travel outside coverage requires review.</p><a class="btn gold" href="${x.quoteRequired?customHref(experience,p):'availability.html'}">${x.startingAt||x.quoteRequired?'Request a quote':'Check availability'} →</a></article>`;}).join('');
     {
      const custom=data.packages.find(p=>p.active!==false&&p.pricing_profile.experience===experience&&p.pricing_profile.quoteRequired);
      const markup=customCards.get(experience);
      if(custom&&markup){const wrapper=document.createElement('div');wrapper.innerHTML=markup;wrapper.querySelectorAll('a').forEach(link=>link.setAttribute('href',customHref(experience,custom)));grid.append(wrapper.firstElementChild);}
     }
    });
   }
   navigation.addEventListener('click',event=>{const button=event.target.closest('[data-pricing-catalog]');if(button)render(button.dataset.pricingCatalog);});render('STANDARD');
   document.querySelectorAll('[data-experience-addons]').forEach(section=>{const key=section.dataset.experienceAddons;section.querySelector('.addons-grid').innerHTML=data.addons.filter(a=>a.pricing_policy.experiences.includes(key)&&a.pricing_policy.category!=='TRAVEL').map(a=>`<div class="addon-card"><h4>${escape(a.name)}</h4><p>${['FROM','CUSTOM','CALCULATED'].includes(a.pricing_policy.method)?'Requires a reviewed quote':money(a.price)}${a.pricing_policy.method==='PER_HOUR'?' / hour':''}</p></div>`).join('');});
  }catch(error){const notice=document.createElement('p');notice.setAttribute('role','alert');notice.textContent=error.message;document.querySelector('.experience-tabs')?.before(notice);}
 }
 load();
})();
