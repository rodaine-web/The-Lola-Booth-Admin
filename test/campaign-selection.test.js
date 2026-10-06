import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCampaignSelections,withoutCampaignBundle,removeCampaignExperience} from '../shared/campaign-selection.js';
const pkg={campaign_id:'c',campaign_offer_key:'DUO',price:500};
const bundle=[{experience_id:'glam',packages:[pkg]},{experience_id:'360',packages:[pkg]},{experience_id:'audio',packages:[]}];
test('replacing a campaign bundle removes all old components and retains unrelated services',()=>{
 const replacement={selections:[{experience_id:'glam',packages:[{campaign_id:'new',campaign_offer_key:'glam',price:800}]}]};
 const result=mergeCampaignSelections(bundle,replacement);
 assert.deepEqual(result.map(s=>s.experience_id),['audio','glam']);assert.equal(result[1].packages[0].price,800);
});
test('choosing a regular package or removing an experience releases the entire bundle',()=>{
 const result=withoutCampaignBundle(bundle,'360');assert.deepEqual(result.map(s=>s.experience_id),['360','audio']);assert.deepEqual(result[0].packages,[]);
 assert.deepEqual(removeCampaignExperience(bundle,'glam').map(s=>s.experience_id),['audio']);
});
