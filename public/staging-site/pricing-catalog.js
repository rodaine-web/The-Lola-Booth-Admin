(() => {
 'use strict';
 const navigation=document.querySelector('[aria-label="Booking for"]');
 if(!navigation)return;
 // This page owns its approved card layout; the generic CMS renderer must not replace it.
 window.lolaVersionedPricingActive=true;
 const base=String(window.LOLA_CONFIG?.apiBase||'').replace(/\/$/,'');
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(value));
 const offerings=[
  {key:'glam',name:'The Glam',image:'assets/booking-glam.png',description:'Studio-quality portraits, flattering lighting and custom event design. A polished photo booth experience for your guests and your brand.'},
  {key:'360',name:'The 360 Booth',image:'assets/booking-360.png',description:'Dynamic, shareable videos that put your guests at the center of the experience. Bring movement and energy to your next event.'},
  {key:'vogue',name:'The Vogue',image:'assets/vogue.jpg',description:'A magazine-style photo experience with a customizable enclosure. Create editorial portraits and branded moments guests will remember.'},
  {key:'audio',name:'The Audio Guest Book',image:'assets/audio.jpg',description:'Capture guest voices, messages and stories with a personalized audio experience. Create a lasting keepsake or a memorable brand interaction.'}
 ];
 const businessHref=key=>'availability.html?'+new URLSearchParams({customerType:'BUSINESS',...(key?{experience:key}:{})});
 document.querySelector('[data-business-experiences]').innerHTML=offerings.map(item=>`<article class="business-experience-card"><img src="${item.image}" alt="${escape(item.name)}" width="600" height="400" loading="lazy"><div class="business-experience-copy"><h3>${escape(item.name)}</h3><p>${escape(item.description)}</p><a class="btn gold" href="${businessHref(item.key)}">Request a Quote →</a></div></article>`).join('');
 function renderBusinessAddons(items){
  document.querySelector('[data-business-addons]').innerHTML=items.map(item=>`<article class="addon-card"><h4>${escape(item.name)}</h4><p>${escape(item.description||'Tell us what you have in mind. We’ll confirm the details in your proposal.')}</p></article>`).join('');
 }
 const fallbackAddons=new Map();
 document.querySelectorAll('[data-experience-addons] .addon-card').forEach(card=>{const name=card.querySelector('h4')?.textContent;if(name&&!fallbackAddons.has(name))fallbackAddons.set(name,{name,description:card.querySelector('p')?.textContent});});
 renderBusinessAddons([...fallbackAddons.values()]);
 const bookingLinks=[...document.querySelectorAll('a[href="availability.html"]')].filter(link=>!link.closest('[data-audience-view]')).map(link=>{link.removeAttribute('data-cms-copy');return {link,href:link.getAttribute('href'),text:link.textContent};});
 function selectAudience(audience){
  navigation.querySelectorAll('button').forEach(button=>{const selected=button.dataset.packageAudience===audience;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
  document.querySelectorAll('[data-audience-view]').forEach(section=>{section.hidden=section.dataset.audienceView!==audience;});
  bookingLinks.forEach(({link,href,text})=>{link.setAttribute('href',audience==='BUSINESS'?businessHref():href);link.textContent=audience==='BUSINESS'?'Request a Quote →':text;});
 }
 navigation.addEventListener('click',event=>{const button=event.target.closest('[data-package-audience]');if(button)selectAudience(button.dataset.packageAudience);});
 selectAudience(new URLSearchParams(location.search).get('customerType')==='BUSINESS'?'BUSINESS':'INDIVIDUAL');
 async function load(){
  try{
   const response=await fetch(base+'/api/public/pricing-catalog',{cache:'no-store'});
   if(response.status===404)return;
   if(!response.ok)throw Error('Package catalog unavailable');
   const data=await response.json();
   document.querySelectorAll('[data-package-key]').forEach(card=>{
    const [experience,tier]=card.dataset.packageKey.split(':');
    const pkg=data.packages.find(p=>p.pricing_profile.experience===experience&&(tier==='custom'?p.pricing_profile.quoteRequired:p.catalog_key==='STANDARD'&&p.tier_key===tier.toUpperCase()));
    card.hidden=!pkg;if(!pkg)return;
    const href='availability.html?'+new URLSearchParams({customerType:'INDIVIDUAL',experience,packageId:pkg.id,...(tier==='custom'?{eventCategory:'CUSTOM_PRODUCTION'}:{})});
    card.querySelectorAll('a').forEach(link=>link.setAttribute('href',href));
    if(tier==='custom')return;
    card.querySelector('.price').textContent=pkg.starting_price==null?'Request a quote':money(pkg.starting_price);
    card.classList.toggle('featured',!!pkg.most_popular);
    let badge=card.querySelector('.pricing-badge');
    if(pkg.most_popular&&!badge){badge=document.createElement('div');badge.className='pricing-badge';badge.textContent='Most Popular';card.prepend(badge);}
    if(badge)badge.hidden=!pkg.most_popular;
    // Preserve the original presentation, with the current approved service scope.
    const profile=pkg.pricing_profile;
    card.querySelectorAll('li').forEach(item=>{
     if(profile.serviceHours&&/\d+ hours/i.test(item.textContent))item.textContent=item.textContent.replace(/(Up to )?\d+ hours/i,`${profile.serviceHours} hours`);
     if(/on-site photo printing|\d+ physical (photo )?prints included/i.test(item.textContent))item.textContent=`${profile.prints} physical photo prints included`;
     if(profile.backdrop&&/backdrop/i.test(item.textContent))item.textContent=profile.backdrop==='PREMIUM'?'Premium backdrop selection':'Standard backdrop';
    });
    if(profile.rentalHours){const duration=document.createElement('li');duration.textContent=`Up to ${profile.rentalHours} hours of rental`;card.querySelector('ul').prepend(duration);}
   });
   document.querySelectorAll('[data-experience-addons] .addon-card').forEach(card=>{
    const label=card.querySelector('h4')?.textContent.trim(),price=card.querySelector('.mini-script');if(!price)return;
    const aliases={'Additional Booth Hour':'extra-glam-hour','Additional 360 Hour':'extra-360-hour','Additional Vogue Hour':'extra-vogue-hour','Red Carpet + Stanchions':'red-carpet','Red Carpet':'red-carpet','Extra Audio Phone':'audio-phone'};
    const addon=data.addons.find(a=>a.name.toLowerCase()===label.toLowerCase()||a.pricing_policy?.key===aliases[label]);
    const crossSell=label==='360 Video Booth'?'360':label==='Audio Guestbook'?'audio':null;
    const entry=crossSell&&data.packages.find(p=>p.catalog_key==='STANDARD'&&p.tier_key==='ESSENTIAL'&&p.pricing_profile.experience===crossSell);
    if(addon)price.textContent=['CUSTOM','CALCULATED'].includes(addon.pricing_policy?.method)?'Available upon request':`${addon.pricing_policy?.method==='FROM'?'Starting at ':''}${money(addon.price)}${addon.pricing_type==='PER_HOUR'?' / hour':''}`;
    else if(entry)price.textContent='Starting at '+money(entry.starting_price);
    else if(/\$/.test(price.textContent))price.textContent='Available upon request';
   });
   renderBusinessAddons(data.addons.filter(item=>item.active!==false&&item.pricing_policy?.category!=='TRAVEL'));
  }catch(error){console.warn('LOLA package catalog unavailable; approved individual cards and business offerings remain available.',error);}
 }
 load();
})();
