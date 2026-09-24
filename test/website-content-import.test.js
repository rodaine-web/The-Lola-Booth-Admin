import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importDecision, checksum } from '../server/src/services/website-content-import.js';
import { projectWebsitePackage } from '../server/src/services/website-pricing.js';
const m=JSON.parse(fs.readFileSync(new URL('../server/import-data/live-website.json',import.meta.url)));
test('approved package inventory has 16 unique experience keys and exact newest prices',()=>{
  assert.equal(new Set(m.packages.map(p=>p.key)).size,16);
  for(const [experience,prices] of Object.entries({glam:[599,899,1499,null],'360':[699,1099,1699,null],vogue:[899,1499,2299,null],audio:[299,449,699,null]}))assert.deepEqual(m.packages.filter(p=>p.experience===experience).map(p=>p.starting_price),prices);
});
test('Custom cannot project numeric zero and package publication prices are numeric',()=>{
  assert.equal(projectWebsitePackage({name:'CUSTOM',starting_price:'0.00'}).starting_price,null);
  assert.equal(projectWebsitePackage({name:'CUSTOM',starting_price:0}).display_price,'Custom');
  assert.equal(projectWebsitePackage({name:'Essential',starting_price:'599.00'}).display_price,599);
  assert.equal(projectWebsitePackage({name:'Essential',starting_price:'599.00'},{showStartingPrice:false}).display_price,'Request Pricing');
});
test('import plans create, update, repeat skip and refuses manual or deleted edits',()=>{
  const target={starting_price:599,status:'PUBLISHED'},old={starting_price:499,status:'PUBLISHED'};
  assert.equal(importDecision(null,target),'CREATE');
  assert.equal(importDecision(old,target,null,old),'UPDATE');
  assert.equal(importDecision(target,target,target),'SKIP');
  assert.equal(importDecision({...target,status:'DRAFT'},target,target),'CONFLICT');
  assert.equal(importDecision({...target,starting_price:650},target,target),'CONFLICT');
  assert.equal(importDecision({...target,deleted_at:new Date()},target,target),'CONFLICT');
  assert.equal(importDecision(null,target,target),'CONFLICT');
});
test('unowned drafts are protected except untouched migration seeds',()=>{
  const draft={status:'DRAFT',created_at:'2026-09-01',updated_at:'2026-09-01'};
  assert.equal(importDecision(draft,{status:'PUBLISHED'}),'CONFLICT');
  assert.equal(importDecision(draft,{status:'PUBLISHED'},null,null,true),'UPDATE');
  assert.equal(importDecision({...draft,updated_by:'admin'},{status:'PUBLISHED'},null,null,true),'CONFLICT');
});
test('approved experience order, Vogue asset, media checksums, FAQ and page SEO retained',()=>{
  assert.deepEqual(m.experiences.map(e=>e.key),['glam','360','vogue','audio']);
  assert.equal(m.experiences[2].asset,'assets/vogue.jpg');
  assert.equal(new Set(m.media.map(x=>x.sha256)).size,m.media.length);
  assert.equal(checksum(Buffer.from('test')).length,64);
  assert.deepEqual(m.faqs,m.baseline.faqs);
  assert.deepEqual(m.testimonials.map(t => t.client_name), ["Terry", "Jeff · Event Noire", "Didi"]);
  assert.ok(m.testimonials.every(t => t.source_approval_note));
  for(const p of m.pages){assert.ok(p.title);assert.ok(p.seo.description);}
  assert.equal(m.settings.phone,'773-240-2744');
  assert.equal(m.settings.facebook_url,null);
});
