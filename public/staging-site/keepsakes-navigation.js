(() => {
 'use strict';
 // This bundle is served exclusively by the staging hosting project.
 const links={gallery:'https://staginggallery.thelolabooth.com',shop:'https://stagingshop.thelolabooth.com'};
 document.addEventListener('click',event=>{const audience=event.target.closest('[data-package-audience]')?.dataset.packageAudience;if(audience)document.querySelectorAll('[data-celebration-station-rates]').forEach(node=>{node.hidden=audience==='BUSINESS';});});
 const business=new URLSearchParams(location.search).get('customerType')==='BUSINESS';if(business)document.querySelector('[data-celebration-station-rates]')?.setAttribute('hidden','');
 for(const nav of document.querySelectorAll('.navlinks,.mobile-menu,[aria-label="Footer navigation"]'))for(const [key,url]of Object.entries(links)){if(nav.querySelector('[data-lola-destination="'+key+'"]'))continue;const a=document.createElement('a');a.href=url;a.dataset.lolaDestination=key;a.textContent=key==='gallery'?'Gallery':'Shop';nav.append(a);}
})();
