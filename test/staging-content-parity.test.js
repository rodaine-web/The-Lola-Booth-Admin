import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {load} from 'cheerio';
import {projectStagingSite,validateStagingRecord} from '../server/src/services/staging-cms-service.js';
const manifest=JSON.parse(fs.readFileSync('server/import-data/staging-website.json','utf8'));
const site=projectStagingSite(manifest.records);
test('each exported business copy and media slot has a published staging record',()=>{
 for(const entry of manifest.capturedPages){
  const $=load(fs.readFileSync('public/staging-site/'+entry.page,'utf8'));
  for(const el of $('[data-cms-copy]').toArray())assert.ok(site.pageItems.some(r=>r.slot_key===$(el).attr('data-cms-copy')),entry.page+': '+$(el).attr('data-cms-copy'));
  for(const el of $('[data-cms-media]').toArray())assert.ok(site.media.some(r=>r.entity_key===$(el).attr('data-cms-media')),entry.page+': '+$(el).attr('data-cms-media'));
  assert.equal($('meta[name="robots"]').attr('content'),'noindex,nofollow');
  assert.equal($('script[src*="googletagmanager"]').length,0);
  assert.equal($('script:not([src]):not([type="application/ld+json"])').length,0);
 }
});
test('homepage and pricing cards share catalog identities, prices and custom handling',()=>{
 const home=load(fs.readFileSync('public/staging-site/index.html','utf8'));
 const packages=load(fs.readFileSync('public/staging-site/packages.html','utf8'));
 assert.equal(site.packages.length,16);
 for(const el of home('[data-package-key]').toArray()){
  const key=home(el).attr('data-package-key');const cms=site.packages.find(r=>r.website_key===key);
  assert.ok(cms,key);assert.equal(packages(`[data-package-key="${key}"]`).length,1);
  if(cms.pricing_mode==='CUSTOM'){assert.equal(cms.starting_price,null);assert.equal(cms.display_price,'Request Pricing');}
  else assert.equal(Number(home(el).find('.price').text().replace(/[^0-9.]/g,'')),cms.starting_price);
 }
});
test('all manifest records validate and approved assets exist; image identity is stable',()=>{
 for(const row of manifest.records){validateStagingRecord(row.cms_type,row);assert.equal(row.status,'PUBLISHED');assert.equal(row.channel,'STAGING');}
 for(const media of site.media)assert.ok(fs.existsSync('public'+media.url),media.url);
 for(const [key,file] of Object.entries({glam:'glam.jpg','360':'booth360.jpg',vogue:'vogue.jpg',audio:'audio.jpg'}))assert.equal(site.experiences.find(x=>x.entity_key===key).fallback_image,'/staging-site/assets/'+file);
 const keys=manifest.records.map(r=>r.cms_type+':'+r.entity_key);assert.equal(new Set(keys).size,keys.length);
});
test('empty and unpublished channel projections never synthesize published content',()=>{
 for(const status of ['DRAFT','ARCHIVED']){
  const empty=projectStagingSite(manifest.records.map(r=>({...r,status})));
  for(const key of ['pageItems','heroSlides','experiences','packages','eventTypes','gallery','testimonials','faqs','media'])assert.deepEqual(empty[key],[]);
  assert.deepEqual(empty.settings,{});assert.deepEqual(empty.content,{});
 }
});
