// Build a reviewable staging-only inventory from captured live pages; never writes public records.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
const source=path.resolve(process.argv[2]||'audit-output/goal2/live-before');
const target=path.resolve(process.argv[3]||'/private/tmp/lola-staging');
const inventory=JSON.parse(await fs.readFile(path.join(source,'inventory.json'),'utf8'));
const baseline=JSON.parse(await fs.readFile(path.join(source,'public-site.json'),'utf8'));
const records=new Map(), assets=new Map(), homes=new Map(), liveSettings={...baseline.settings};
const txt=($,n)=>$(n).text().replace(/\s+/g,' ').trim();
function add(type,key,payload,order,url){const identity=type+':'+key;const old=records.get(identity);records.set(identity,{channel:'STAGING',cms_type:type,entity_key:key,payload:{...old?.payload,...payload},status:'PUBLISHED',display_order:order??old?.display_order??1,source_url:url||old?.source_url});}
async function asset(src,alt=''){
 if(!src)return null;
 if(src.startsWith('data:image/')){const match=src.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/s);if(!match)throw Error('Unsupported inline asset');const data=Buffer.from(match[2],'base64');src=`assets/approved-${createHash('sha256').update(data).digest('hex').slice(0,16)}.${match[1]==='jpeg'?'jpg':match[1]}`;await fs.writeFile(path.join(target,src),data);}
 if(!src.startsWith('assets/'))throw Error('Unmapped live asset '+src);
 const clean=src.split('?')[0];const bytes=await fs.readFile(path.join(target,clean));
 const url='/staging-site/'+clean;
 if(!assets.has(clean)){assets.set(clean,true);add('media',clean,{title:alt||path.basename(clean),alt_text:alt,url,filename:path.basename(clean),sha256:createHash('sha256').update(bytes).digest('hex')},assets.size,'https://thelolabooth.com/'+clean);}
 return url;
}
// Home first captures descriptions shared by the pricing page.
for(const entry of [...inventory].sort((a,b)=>(a.page==='index.html'?-1:b.page==='index.html'?1:a.page.localeCompare(b.page)))){
 const $=load(await fs.readFile(path.join(source,entry.page),'utf8'));
 const slug=entry.page==='index.html'?'home':entry.page.replace('.html','');
 const url=entry.url;
 if(slug==='home'){for(const [key,selector] of [['service_area','[data-site-service-area]'],['copyright_text','[data-site-copyright]'],['brand_line','[data-brand-line]']]){const value=txt($,$(selector).first());if(value)liveSettings[key]=value.replace(/^Service area:\s*/,'');}}
 $('link[href="/favicon.png"]').attr('href','/staging-site/favicon.png');
 if(slug==='home'){
  $('.event-card').parent().attr('data-cms-events','home');
  $('.static-testimonials').attr('data-cms-testimonials','');$('.testimonial-section').attr('data-cms-testimonial-section','');
  for(const [i,e] of $('.hero-slide').toArray().entries()){const src=$(e).attr('style')?.match(/url\(['"]?([^)'" ]+)/)?.[1];const image=await asset(src,`LOLA event photograph ${i+1}`);add('hero','home-slide-'+(i+1),{image,fallback_image:image,alt_text:`LOLA event photograph ${i+1}`},i+1,url);}
  $('[data-cms-packages="home"] [data-package-key]').each((_,e)=>homes.set($(e).attr('data-package-key'),txt($,$(e).find('p.muted'))));
  $('.testimonial-card').each((i,e)=>add('testimonials','home-testimonial-'+(i+1),{client_display_name:txt($,$(e).find('.testimonial-meta strong')),event_type:txt($,$(e).find('.testimonial-meta span')),quote:txt($,$(e).find('.testimonial-quote')).replace(/^[“"]|[”"]$/g,''),rating:5,source_note:'Currently visible on production; copied without changing production approval state.'},i+1,url));
  for(const [i,e] of $('.event-card').toArray().entries()){const name=txt($,$(e).find('h3')),key=name.toLowerCase().replace(/\s+/g,'-');$(e).attr('data-event-key',key);const image=await asset($(e).find('img').attr('src'));add('eventTypes',key,{name,slug:key,short_description:txt($,$(e).find('p')),home_description:txt($,$(e).find('p')),image,fallback_image:image},i+1,url);}
 }
 for(const [i,e] of $('[data-experience-key]').toArray().entries()){
  const key=$(e).attr('data-experience-key'),home=slug==='home';const original=baseline.experiences.find(x=>x.slug.includes(key));const image=await asset($(e).find('img').attr('src'));
  const payload={slug:'lola-'+key,name:home?txt($,$(e).find('h3')):original?.name,image,fallback_image:'/staging-site/assets/'+({glam:'glam.jpg','360':'booth360.jpg',vogue:'vogue.jpg',audio:'audio.jpg'}[key]),source_catalog_id:original?.id};
  if(home)Object.assign(payload,{website_name:txt($,$(e).find('h3')),website_short_description:txt($,$(e).find('p'))});
  else Object.assign(payload,{website_label:txt($,$(e).find('.eyebrow')),website_heading:txt($,$(e).find('h2')),website_kicker:txt($,$(e).find('.experience-kicker')),website_long_description:txt($,$(e).find('.muted')),features:$(e).find('li').map((_,li)=>txt($,li)).get()});
  add('experiences',key,payload,i+1,url);
 }
 if(slug==='packages')$('[data-package-key]').each((i,e)=>{const key=$(e).attr('data-package-key'),custom=key.endsWith(':custom'),original=baseline.packages.find(x=>x.website_key===key);add('packages',key,{name:txt($,$(e).find('h3')),website_key:key,pricing_mode:custom?'CUSTOM':'STARTING',starting_price:custom?null:Number(txt($,$(e).find('.price')).replace(/[^0-9.]/g,'')),currency:'USD',website_short_description:txt($,$(e).find('.sub')),website_home_description:homes.get(key)||'',website_custom_heading:$(e).find('.big-copy').html(),website_features:$(e).find('li').map((_,li)=>txt($,li)).get(),most_popular:$(e).hasClass('featured'),source_catalog_id:original?.id},i+1,url);});
 if(slug==='faq')$('details').each((i,e)=>add('faqs','faq-'+(i+1),{question:txt($,$(e).find('summary')),answer:txt($,$(e).find('p')),category:'GENERAL'},i+1,url));
 for(const e of $('img[src]').toArray()){const image=await asset($(e).attr('src'),$(e).attr('alt'));$(e).attr('src',image).attr('data-cms-media',image.replace('/staging-site/',''));}
 // Every business-managed leaf copy slot gets its own lifecycle, including newly added live copy.
 const dynamic='[data-package-key],[data-experience-key],[data-event-key],[data-cms-gallery],[data-cms-faqs],[data-cms-testimonials],[data-site-email],[data-site-phone],[data-site-service-area],[data-site-copyright],[data-brand-line],[data-site-socials],script,style,svg,select';
 let count=Math.max(0,...$('[data-cms-copy]').toArray().map(e=>Number(($(e).attr('data-cms-copy')||'').split('.').pop())||0));
 for(const e of $('[data-cms-copy],h1,h2,h3,h4,p,li,summary,figcaption,a,small,span,.feature-label,.script-note,.hero-script,.tagline,.intro,.brand-wordmark,.brand-submark,.brand-activation-points span').toArray()){
  const n=$(e);if(n.closest(dynamic).length){n.removeAttr('data-cms-copy');continue;}if(n.find('h1,h2,h3,h4,p,li,summary,figcaption,a,small,span,svg,img,input,button').length||!txt($,e))continue;
  const key=n.attr('data-cms-copy')||`${slug}.${String(++count).padStart(3,'0')}`;n.attr('data-cms-copy',key);add('pageItems',key,{page_slug:slug,slot_key:key,html:n.html(),...(e.tagName==='a'?{href:n.attr('href')}:{})},records.size+1,url);
 }
 add('content','page.'+slug,{content_key:'page.'+slug,title:$('title').text(),seo_title:$('meta[property="og:title"]').attr('content')||$('title').text(),seo_description:$('meta[name="description"]').attr('content')||''},inventory.indexOf(entry)+1,url);
 // Static copies are resilience only. Tracking is never exported to staging.
 $('script').each((_,e)=>{const n=$(e);if((n.attr('src')||'').includes('googletagmanager')||/gtag\(|dataLayer|fbq\(|ttq\./.test(n.html()||''))n.remove();});
 $('meta[name="robots"]').remove();$('head').append('<meta name="robots" content="noindex,nofollow">');$('link[rel="canonical"]').remove();
 $('body').prepend('<aside class="staging-notice" style="padding:10px;text-align:center;background:#20253b;color:white">STAGING · CMS qualification · Public website V1 is unchanged</aside>');
 // Externalize executable inline scripts for Admin hosting CSP.
 for(const [i,e] of $('script:not([src])').toArray().entries()){const n=$(e);if(n.attr('type')==='application/ld+json')continue;const file=`page-${slug}-${i}.js`;await fs.writeFile(path.join(target,file),n.html()||'');n.attr('src',file).text('');}
 if(!$('script[src="config.js"]').length)$('body').append('<script src="config.js"></script><script src="app.js"></script>');
 await fs.writeFile(path.join(target,entry.page),$.html());
}
for(const [key,value] of Object.entries(liveSettings))if(value!==null&&value!==undefined)add('settings',key,{value},records.size+1,'https://thelolabooth.com/');
const manifest={version:1,channel:'STAGING',capturedPages:inventory,records:[...records.values()],notes:['Gallery and Events routes remain unpublished on production. Gallery has no currently visible production items; staging-only qualification fixtures are separate.','No Careers route is currently live. About copy is included as page items.']};
await fs.mkdir('server/import-data',{recursive:true});await fs.writeFile('server/import-data/staging-website.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({records:records.size,byType:Object.fromEntries([...new Set(manifest.records.map(r=>r.cms_type))].map(t=>[t,manifest.records.filter(r=>r.cms_type===t).length]))},null,2));
