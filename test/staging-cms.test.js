import test from 'node:test';
import assert from 'node:assert/strict';
import {projectStagingSite,validateStagingRecord,freezesPublicMutation,approvedStagingImage} from '../server/src/services/staging-cms-service.js';
test('public channel and unpublished records never appear in staging output',()=>{
  const row={id:'one',channel:'STAGING',cms_type:'hero',entity_key:'hero-1',display_order:1,payload:{image:'/staging-site/assets/glam.jpg'},status:'PUBLISHED'};
  assert.equal(projectStagingSite([row]).heroSlides.length,1);
  for(const status of ['DRAFT','ARCHIVED'])assert.equal(projectStagingSite([{...row,status}]).heroSlides.length,0);
  assert.equal(projectStagingSite([{...row,channel:'PUBLIC'}]).heroSlides.length,0);
  assert.equal(projectStagingSite([]).heroSlides.length,0);
});
test('channel cannot be selected or smuggled through payload; order and custom pricing are explicit',()=>{
  assert.throws(()=>validateStagingRecord('hero',{channel:'PUBLIC',entity_key:'a'}),/read-only/);
  const row=validateStagingRecord('packages',{entity_key:'glam:custom',status:'PUBLISHED',display_order:3,payload:{id:'public-id',channel:'PUBLIC',status:'PUBLISHED',starting_price:0,pricing_mode:'CUSTOM'}});
  assert.equal(row.payload.channel,undefined);assert.equal(row.payload.id,undefined);
  const site=projectStagingSite([{...row,id:'staging-id',channel:'STAGING',cms_type:'packages'}]);
  assert.equal(site.packages[0].display_price,'Request Pricing');assert.equal(site.packages[0].website_display_order,3);
});
test('legacy public write routes are frozen while staging and normal operations remain separate',()=>{
  for(const path of ['/website/hero/123/publish','/website/media/123','/packages/123','/experiences'])assert.equal(freezesPublicMutation(path),true);
  assert.equal(freezesPublicMutation('/settings',{contact_email:'changed'}),true);
  assert.equal(freezesPublicMutation('/website/staging/hero/123'),false);
  assert.equal(freezesPublicMutation('/leads/123'),false);
});
test('staging image URLs are constrained to approved assets or staging uploads',()=>{
  assert.equal(approvedStagingImage('/staging-site/assets/glam.jpg'),true);
  for(const value of ['javascript:alert(1)','https://evil.example/a.jpg','/staging-site/assets/../config.js'])assert.equal(approvedStagingImage(value),false);
});
