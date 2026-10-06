import test from 'node:test';
import assert from 'node:assert/strict';
import {composeCampaignOffers} from '../server/src/services/campaign-offers.js';
import {campaignContent} from '../shared/campaign-content.js';
const experience={id:'360-id',name:'360 Video Booth',slug:'360-video-booth',active:true};
test('campaign offers retain package features and advertised discount',()=>{
 const campaign={id:'campaign',name:'Holiday',content_json:campaignContent({format:'TEXT',offers:[{key:'offer',kind:'EXPERIENCE',catalog_id:experience.id,package_id:'signature',name:'Signature',original_price:1099,discount_type:'PERCENT',discount_value:15}]})};
 const [offer]=composeCampaignOffers(campaign,[experience],[{id:'signature',experience_id:experience.id,active:true,items:['Four hours','Unlimited videos']}]);
 assert.equal(offer.discounted,934.15);assert.equal(offer.saving,164.85);assert.deepEqual(offer.selections[0].packages[0].features,['Four hours','Unlimited videos']);
 assert.equal(composeCampaignOffers(campaign,[{...experience,active:false}],[]).length,0);
 assert.equal(composeCampaignOffers(campaign,[experience],[{id:'signature',experience_id:'wrong'}]).length,0);
});
test('two-experience campaign bundles allocate their price exactly once',()=>{
 const catalog=[experience,{id:'glam-id',name:'Glam Photo Booth',slug:'glam-photo-booth'}];
 const offers=composeCampaignOffers({id:'c',name:'Duo',content_json:campaignContent({duo_price:1799.99})},catalog,[]);
 const duo=offers.find(o=>o.key==='DUO');assert.ok(duo);assert.equal(duo.selections.length,2);
 assert.equal(duo.selections.reduce((n,s)=>n+s.price,0),1799.99);
 assert.equal(duo.selections.reduce((n,s)=>n+s.packages[0].original_price,0),1799.99);
 assert.equal(composeCampaignOffers({id:'c',name:'Duo',content_json:campaignContent()},[experience],[]).some(o=>o.key==='DUO'),false);
});
test('planner rules cover every active package of Glam, 360 and Vogue at 15 percent',()=>{
 const experiences=['glam','360','vogue','audio'].map(id=>({id,name:id,active:true}));
 const packages=experiences.flatMap(e=>['Essential','Signature','Premium'].map((name,index)=>({id:e.id+index,experience_id:e.id,name,starting_price:999.99+index*100,active:true,items:['Attendant']})));
 packages.push({id:'custom',experience_id:'glam',name:'Custom',starting_price:0,active:true},{id:'custom-priced',experience_id:'360',name:'Custom quote',starting_price:100,active:true},{id:'inactive',experience_id:'glam',name:'Old',starting_price:100,active:false},{id:'deleted',experience_id:'vogue',starting_price:100,deleted_at:'2026-10-01'});
 const campaign={id:'planner',name:'Wedding planner',content_json:{format:'HTML',offers:experiences.slice(0,3).map(e=>({key:'EXPERIENCE_'+e.id,kind:'EXPERIENCE',catalog_id:e.id,package_scope:'ALL_REGULAR',discount_type:'PERCENT',discount_value:15}))}};
 const offers=composeCampaignOffers(campaign,experiences,packages);
 assert.equal(offers.length,9);assert.equal(new Set(offers.map(o=>o.key)).size,9);
 for(const o of offers){const pkg=packages.find(p=>p.id===o.package_id);assert.equal(o.original,Number(pkg.starting_price));assert.equal(o.discounted,Math.round(Math.round(pkg.starting_price*100)*.85)/100);assert.equal(o.selections[0].packages[0].price,o.discounted);assert.deepEqual(o.selections[0].packages[0].features,['Attendant']);}
 assert.equal(offers.some(o=>o.catalog_id==='audio'),false);
 assert.equal(composeCampaignOffers(campaign,experiences.map(e=>e.id==='vogue'?{...e,active:false}:e),packages).length,6);
});
