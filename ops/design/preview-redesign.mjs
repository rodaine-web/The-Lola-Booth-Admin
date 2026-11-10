// Visual preview only. All writes are rejected; no request is forwarded to staging.
import fs from 'node:fs/promises';
import express from 'express';
import {redesignExperienceContent,redesignHeroes,redesignPartners,redesignGuestScenes} from '../../shared/redesign-content.js';
const site=JSON.parse(await fs.readFile('.qa/redesign/live-site-before.json','utf8'));
const pricing=JSON.parse(await fs.readFile('.qa/redesign/live-pricing-before.json','utf8'));
const {records}=JSON.parse(await fs.readFile('server/import-data/lola-redesign-copy.json','utf8'));
site.pageItems=[...site.pageItems,...records.map(x=>({...x.payload,id:x.entity_key,entity_key:x.entity_key,display_order:x.display_order}))];
site.experiences=site.experiences.map(x=>{const update=redesignExperienceContent.find(d=>String(x.slug).includes(d.key));if(!update)return x;const p={...x,name:update.name,website_name:update.name,website_short_description:update.description,website_long_description:update.description,image:update.image,display_order:update.display_order};for(const field of ['website_card','website_about','website_landscape','website_booking']){p[field+'_crop']=update[field+'_crop'];p[field+'_image']=update[field+'_image']||update[field+'_crop'].source;}return p;});
site.heroSlides=[...site.heroSlides,...Object.entries(redesignHeroes).filter(([page])=>page!=='home').map(([page,crop])=>({entity_key:'redesign.hero.'+page,page_slug:page,image:crop.source,image_crop:crop,display_order:-100}))];
site.heroSlides.push(...redesignGuestScenes.map(x=>({...x,page_slug:'home',experience_key:x.key,caption:x.name,entity_key:'redesign.hero.home.'+x.key})));
site.partners=redesignPartners.map(([key,name,file])=>({id:key,name,image:file?'/staging-site/assets/'+file:'',url:''}));
pricing.packages=pricing.packages.filter(p=>p.catalog_key==='STANDARD');
const app=express();app.get('/config.js',(_q,r)=>r.type('js').send('window.LOLA_CONFIG={environment:"staging",cmsChannel:"STAGING",apiBase:"http://localhost:5196",formsEnabled:false}'));
app.get('/api/public/staging/site',(_q,r)=>r.json(site));app.get('/api/public/pricing-catalog',(_q,r)=>r.json(pricing));
app.get('/api/public/booking-catalog',(_q,r)=>r.json({...pricing,pricingVersion:pricing.id,experiences:site.experiences.map(x=>({...x,id:x.source_catalog_id,key:redesignExperienceContent.find(d=>String(x.slug).includes(d.key))?.key}))}));
app.use('/api',(_q,r)=>r.status(405).json({error:{message:'Read-only local visual preview. No data was submitted.'}}));
app.use('/staging-site',express.static('public/staging-site'));app.use(express.static('public/staging-site'));app.listen(5196,'127.0.0.1',()=>console.log('Local visual preview: http://localhost:5196 — all writes disabled'));
