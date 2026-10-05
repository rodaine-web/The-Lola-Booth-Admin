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
