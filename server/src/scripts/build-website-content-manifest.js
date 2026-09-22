import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || '/private/tmp/lola-website-cms');
const sourceRef = process.argv[3] || 'HEAD';
const output = path.resolve('server/import-data/live-website.json');
const existing = await fs.readFile(output,'utf8').then(JSON.parse).catch(()=>null);
const before = existing?.baseline || JSON.parse(await fs.readFile('audit-output/website-cms/before/public-site.json', 'utf8'));
const manifest = { version: 1, pricingBefore: existing?.pricingBefore || before.packages, baselineCapturedAt: existing?.baselineCapturedAt || JSON.parse(await fs.readFile('audit-output/website-cms/before/http-evidence.json','utf8')).checkedAt, source: 'https://thelolabooth.com', sourceRevision: execFileSync('git',['-C',root,'rev-parse','--short',sourceRef],{encoding:'utf8'}).trim(), sourceApprovedAt: execFileSync('git',['-C',root,'show','-s','--format=%cI',sourceRef],{encoding:'utf8'}).trim(), pages: [], packages: [], experiences: [], hero: [], events: [], gallery: [], faqs: before.faqs, testimonials: before.testimonials, media: [], settings: {}, baseline: before };
const assetMap = new Map();
const homePackageDescriptions = {};
const text = ($, e) => $(e).text().replace(/\s+/g, ' ').trim();
const asset = async (source, alt = '') => {
  if (!source?.startsWith('assets/')) return null;
  const clean = source.split('?')[0];
  if (!assetMap.has(clean)) {
    const buffer = await fs.readFile(path.join(root, clean));
    const ext = path.extname(clean).toLowerCase();
    if (!['.jpg','.jpeg','.png','.webp','.svg'].includes(ext)) return null;
    assetMap.set(clean, { path: clean, filename: path.basename(clean), sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.length, mimeType: ({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'})[ext], alt: alt || `The LOLA Booth ${path.basename(clean, ext).replace(/[-_]/g,' ')}`, url: new URL(clean, manifest.source).href });
  }
  return clean;
};
const files = (await fs.readdir(root)).filter(file => file.endsWith('.html') && file !== '404.html').sort();
for (const file of files) {
  const original = await fs.readFile(path.join(root, file), 'utf8');
  const $ = load(original);
  const slug = file === 'index.html' ? 'home' : file.replace('.html','');
  const page = { slug, file, title: $('title').text(), seo: {}, headings: [], sections: [], copy: {}, links: [], assets: [] };
  $('meta[name],meta[property]').each((_, e) => { page.seo[$(e).attr('name') || $(e).attr('property')] = $(e).attr('content'); });
  page.seo.canonical = $('link[rel="canonical"]').attr('href');
  $('h1,h2,h3').each((_,e) => page.headings.push({tag:e.tagName,text:text($,e)}));
  $('body > section, main > section').each((i,e) => page.sections.push({index:i,selector:e.tagName+(e.attribs.class?'.'+e.attribs.class.split(/\s+/).join('.'):''),headings:$(e).find('h1,h2,h3').map((_,h)=>text($,h)).get()}));
  $('a[href]').each((_,e)=>page.links.push({text:text($,e),href:$(e).attr('href')}));
  for (const e of $('img[src]').toArray()) {
    const key = await asset($(e).attr('src'),$(e).attr('alt'));
    if(key){page.assets.push(key);$(e).attr('data-cms-media',key);}
  }
  for (const match of original.matchAll(/url\(['"]?(assets\/[^)'"\s]+)['"]?\)/g)) {const key=await asset(match[1]);if(key)page.assets.push(key);}
  // Bound text slots, not a page builder: existing markup/layout remains in source.
  const dynamic = '[data-cms-packages], [data-experience-panel] .pricing-grid, [data-cms-experiences], [data-cms-events="home"], .event-overview-card, [data-cms-gallery], [data-cms-faqs], [data-cms-testimonials], [data-site-socials], script, style, svg, select';
  let slot=0;
  for(const e of $('h1,h2,h3,h4,p,li,summary,figcaption,a,small,.event-meta-card strong,.event-meta-card span,.feature-label,.script-note,.hero-script,.tagline,.intro').toArray()){
    const el=$(e);
    if(el.closest(dynamic).length || el.find('h1,h2,h3,h4,p,li,summary,figcaption,a,small,svg,img,input,button').length || !text($,e))continue;
    const id=`${slug}.${String(++slot).padStart(3,'0')}`;
    el.attr('data-cms-copy',id);
    page.copy[id]={html:el.html(),...(e.tagName==='a'?{href:el.attr('href')}: {})};
  }
  if(slug==='home'){
    $('[data-cms-packages="home"] > *').each((i,e)=>{const key=`glam:${['essential','signature','luxe','custom'][i]}`;$(e).attr('data-package-key',key);homePackageDescriptions[key]=text($,$(e).find('p.muted'));});
    $('.hero-slide').each((i,e)=>{const src=$(e).attr('style')?.match(/url\(['"]?([^)'" ]+)/)?.[1];manifest.hero.push({asset:src,alt:assetMap.get(src)?.alt||`LOLA event photograph ${i+1}`,order:i+1});});
    $('[data-cms-experiences="home"] > *').each((i,e)=>{const key=['glam','360','vogue','audio'][i];$(e).attr('data-experience-key',key);manifest.experiences.push({key,name:text($,$(e).find('h3')),homeDescription:text($,$(e).find('p')),asset:$(e).find('img').attr('src'),order:i+1});});
    $('[data-cms-events="home"] > *').each((i,e)=>{const name=text($,$(e).find('h3'));const key=name.toLowerCase().replace(/\s+/g,'-');$(e).attr('data-event-key',key);manifest.events.push({key,name,homeOrder:i+1,homeDescription:text($,$(e).find('p')),asset:$(e).find('img').attr('src')});});
  }
  if(slug==='packages'){
    $('[data-experience-panel]').each((_,panel)=>{
      const experience=$(panel).attr('data-experience-panel');
      $(panel).find('.pricing-card').each((i,e)=>{
        const key=`${experience}:${['essential','signature','luxe','custom'][i]}`;
        $(e).attr('data-package-key',key);
        const custom=i===3;
        manifest.packages.push({key,experience,name:text($,$(e).find('h3')),starting_price:custom?null:Number($(e).find('.price').text().replace(/[^0-9.]/g,'')),pricing_mode:custom?'CUSTOM':'STARTING',display_price:custom?'Custom':$(e).find('.price').text().trim(),custom_heading:$(e).find('.big-copy').html()||null,description:text($,$(e).find('.sub')),features:$(e).find('li').map((_,li)=>text($,li)).get(),most_popular:$(e).hasClass('featured'),order:i+1});
      });
    });
  }
  if(slug==='experiences'){
    $('[data-cms-experiences] .split').each((_,e)=>{
      const key=$(e).attr('id');$(e).attr('data-experience-key',key);
      // Homepage may be read after this file alphabetically: attach later.
      manifest.experiences.push({key,pageLabel:text($,$(e).find('.eyebrow')),heading:text($,$(e).find('h2')),description:text($,$(e).find('.muted')),features:$(e).find('li').map((_,li)=>text($,li)).get(),kicker:text($,$(e).find('.experience-kicker')),asset:$(e).find('img').attr('src')});
    });
  }
  if(slug==='events')$('.event-overview-card').each((i,e)=>{const name=text($,$(e).find('h2'));const key=name.toLowerCase().replace(/\s+/g,'-');$(e).attr('data-event-key',key);manifest.events.push({key,name,order:i+1,description:text($,$(e).find('p')),asset:$(e).find('img').attr('src')});});
  if(slug==='gallery')$('[data-cms-gallery] .gallery-card').each((i,e)=>manifest.gallery.push({asset:$(e).find('img').attr('src'),alt:$(e).find('img').attr('alt'),title:text($,$(e).find('strong')),caption:text($,$(e).find('.gallery-card-meta span')),tags:[...($(e).attr('data-category')||'').split(/\s+/),`media:${$(e).attr('data-media-type')||'photo'}`],order:i+1,category:'ALL'}));
  if(slug==='faq')page.staticFaqs=$('details').map((_,e)=>({question:text($,$(e).find('summary')),answer:text($,$(e).find('p'))})).get();
  // Add the same runtime to the link hub without introducing an admin diagnostics UI.
  if(slug==='connect'&&!$('script[src="app.js"]').length)$('body').append('<script src="config.js"></script><script src="app.js"></script>');
  page.assets=[...new Set(page.assets)];
  manifest.pages.push(page);
  await fs.writeFile(path.join(root,file),$.html());
}
const merge=(items)=>[...new Map(items.map(x=>[x.key,{}])).keys()].map(key=>Object.assign({},...items.filter(x=>x.key===key)));
manifest.experiences=merge(manifest.experiences).sort((a,b)=>a.order-b.order);
manifest.events=merge(manifest.events).sort((a,b)=>a.order-b.order);
manifest.media=[...assetMap.values()];
for(const p of manifest.packages)if(homePackageDescriptions[p.key])p.homeDescription=homePackageDescriptions[p.key];
const home=manifest.pages.find(x=>x.slug==='home');
manifest.settings={contact_email:'info@thelolabooth.com',phone:'773-240-2744',website:'https://thelolabooth.com',instagram_url:'https://www.instagram.com/thelolabooth/',tiktok_url:'https://www.tiktok.com/@thelolabooth',facebook_url:null,pinterest_url:null,brand_line:'Good people. Better photos.',canonical_domain:'https://thelolabooth.com',site_title:home.title,default_meta_description:home.seo.description,social_share_title:home.seo['og:title'],social_share_description:home.seo['og:description']};
await fs.writeFile(output,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({pages:manifest.pages.length,packages:manifest.packages.length,experiences:manifest.experiences.length,events:manifest.events.length,gallery:manifest.gallery.length,faqs:manifest.faqs.length,media:manifest.media.length},null,2));
