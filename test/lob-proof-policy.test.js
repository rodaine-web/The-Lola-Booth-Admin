import test from 'node:test';import assert from 'node:assert/strict';import {lobProofReady} from '../shared/lob-proof-policy.js';
const proof={id:'psc_QA',status:'processed',metadata:{postcard_id:'qa-card'},url:'https://lob-assets.com/postcards/psc_QA.pdf?signature=synthetic',thumbnails:[1,2].map(n=>({large:`https://lob-assets.com/postcards/psc_QA_thumb_large_${n}.png?signature=synthetic`}))};
test('a processed postcard with both generated sides and matching metadata is ready for proof review',()=>{assert.equal(lobProofReady(proof,'qa-card'),true);assert.equal(lobProofReady({...proof,status:'rendered'},'qa-card'),true);});
test('missing sides, incorrect guest mapping, untrusted assets and failed rendering cannot enter live review',()=>{
 for(const altered of [{...proof,thumbnails:proof.thumbnails.slice(0,1)},{...proof,url:'https://example.invalid/postcards/psc_QA.pdf'},{...proof,url:'https://lob-assets.com/postcards/psc_OTHER.pdf'},{...proof,metadata:{postcard_id:'other-card'}},{...proof,status:'queued'},{...proof,failure_reason:'render failure'}])assert.equal(lobProofReady(altered,'qa-card'),false);
});
