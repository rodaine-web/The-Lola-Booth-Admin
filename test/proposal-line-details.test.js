import test from 'node:test';
import assert from 'node:assert/strict';
import {proposalLineDetail} from '../shared/proposal-line-details.js';
test('rental detail uses the selected package and frozen entitlement scope',()=>{
 const context={experiences:[{experience_id:'glam',description:'Professional DSLR photo booth.',packages:[{package_id:'signature',description:'Signature photo experience.'}]}],entitlements:[{packageId:'signature',experience:'glam',serviceHours:4,prints:100,attendantIncluded:true}]};
 const detail=proposalLineDetail({type:'PACKAGE',package_id:'signature',quantity:1},context);assert.match(detail,/Signature photo experience/);assert.match(detail,/4 active service hours/);assert.match(detail,/100 physical prints/);
});
test('every charge type gets details and written custom scope is preserved',()=>{
 for(const type of ['PACKAGE','EXPERIENCE_SELECTED','EXPERIENCE','ADDON','PRINT_UPGRADE','EXTRA_HOURS','SETUP','TRAVEL','OTHER','CUSTOM'])assert.ok(proposalLineDetail({type,quantity:2}).length>20,type);
 assert.equal(proposalLineDetail({type:'CUSTOM',detail:'Owner-approved delivery arrangement.'}),'Owner-approved delivery arrangement.');
 assert.equal(proposalLineDetail({type:'ADDON',addon_id:'backdrop'},{addons:[{id:'backdrop',description:'Selected premium backdrop.'}]}),'Selected premium backdrop.');
});

test('existing package inclusion prose is not repeated in rental details',()=>{const detail=proposalLineDetail({type:'PACKAGE',package_id:'p'},{experiences:[{packages:[{package_id:'p',description:'4 active service hours'}]}],entitlements:[{packageId:'p',experience:'audio',serviceHours:4}]});assert.equal(detail.split('4 active service hours').length-1,1);});
